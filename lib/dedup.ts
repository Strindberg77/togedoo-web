// lib/dedup.ts
//
// ÉN REGEL FOR DUBLETTER, brukt to steder.
//
// ─────────────────────────────────────────────────────────────────────────
// HVORFOR REGELEN LIGGER HER OG IKKE I IMPORTEN
//
// Problemet har to halvdeler, og de må svare likt:
//
//   IMPORTEN  skal slutte å lage nye dubletter.
//   OPPRYDDINGEN skal ta ned de 263 parene som allerede ligger i basen
//                (målt sep. 2026, fire byer, publiserte rader, samme
//                kategori, under 10 m).
//
// Er de to uenige om hvem som vinner, tar oppryddingen ned rad A mens neste
// import bygger rad A og tar bort rad B. Da svinger basen mellom to
// tilstander, og ingen av dem er den vi ville hatt.
//
// Derfor er dette en REN funksjon over en nøytral form: importen mater den
// med OSM-elementer, oppryddingen med databaserader. Ingen av dem har sin
// egen kopi av regelen. lib/dedup.test.ts låser regelen; kryssjekken som
// låser at de to KALLERNE er enige, står i scripts/node-flate-dedup.test.ts.
//
// ─────────────────────────────────────────────────────────────────────────
// HVA SOM ER MÅLT, OG HVA SOM DERFOR IKKE ER MED
//
// Tre andre filtre ble forkastet på tall mot Geofabrik-fila (norway-260908):
// utstyrstagg på lekeplass (428 av 11 901), `surface=grass` på pitch (79 av
// 12 799 med sport), og en avstandsterskel flate-mot-flate (andelen med nabo
// stiger jevnt: 3,7 → 8,4 → 13,0 → 21,7 % ved 10/30/50/100 m, altså ingen
// knekk).
//
// FLATE MOT FLATE LØSES IKKE HER, og det er en beslutning, ikke en mangel:
// to flater med sammenfallende bboks-senter er ikke nødvendigvis samme sted.
// Konsentriske flater er et ekte OSM-mønster — en bane inne i et
// idrettsområde, et basseng inne i et badeanlegg — og begge blir samme
// kategori hos oss. Uten geometri (`out center tags` gir ingen ring) kan de
// ikke skilles fra en ekte dublett.
//
// De TELLES likevel, som [DedupUtfall] «to-flater». Uten det ville rapporten
// etter oppryddingen sagt «ferdig» om en base som fortsatt har par i seg.
import { distanceMeters } from './geo-polygon';

/** Hvor nær to objekter i samme kategori må ligge for å regnes som samme sted.
 *
 *  10 m er MÅLT: det er terskelen de 263 parene i basen er talt under, og
 *  den samme Geofabrik-målingen brukte. Om 5 m er tryggere er FORTSATT
 *  UBESVART — histogrammet 0–10 m er ikke kjørt. Begge kallerne leser denne
 *  konstanten, så de kan ikke komme i utakt når svaret finnes.
 *
 *  Overstyrbar av samme grunn som ski-tolleransen: to kjøringer med ulik
 *  verdi skiller «for få par» fra «feil sammenslått», uten en kodeendring
 *  imellom. */
export const DEDUP_RADIUS_M = Number(process.env.PLACES_DEDUP_M ?? 10) || 10;

/**
 * Slingringsmonn på selve sammenligningen. Én mikrometer.
 *
 * To punkter plassert nøyaktig 10 m fra hverandre gir [distanceMeters]
 * 10.000000000019043, altså «> 10», og paret ville falt utenfor en terskel
 * det ligger nøyaktig på. Feilen er i siste bit av et `Math.hypot`.
 *
 * Grensen er uansett ikke meningsfull under centimeternivå: tellingen i
 * basen bruker PostGIS-geografi, [distanceMeters] er en plan tilnærming, og
 * de to er ~0,1 % fra hverandre — 1 cm ved 10 m.
 */
const SLINGRING_M = 1e-6;

export type OsmType = 'node' | 'way' | 'relation';

/**
 * Ett objekt regelen kan vurdere, uavhengig av hvor det kom fra.
 *
 * `navn` er et BRUKBART navn ([isUsablePlaceName]) eller null — kalleren
 * har allerede avgjort det, med SIN egen navnekjede (Aking leser
 * `piste:name` før `name`). Å sende inn rå tagger i stedet ville tvunget
 * denne fila til å kjenne OSM, og da kunne den ikke vært felles.
 */
export interface DedupKandidat {
    /** «<type>/<id>», altså activities.external_id. */
    readonly externalId: string;
    readonly lat: number;
    readonly lng: number;
    readonly navn: string | null;
}

export type DedupUtfall =
    /** Taperen fjernes / tas ned. */
    | 'droppet'
    /** Begge beholdes: bare taperen har navn, og vinneren ville mistet det. */
    | 'navn-bare-pa-taper'
    /** Begge beholdes: to ulike navn motsier at det er samme sted. */
    | 'navn-uenighet'
    /** Begge beholdes: to flater kan ikke skilles uten geometri. */
    | 'to-flater';

export interface DedupPar {
    readonly vinner: string;
    readonly taper: string;
    readonly meter: number;
    readonly utfall: DedupUtfall;
    readonly vinnerNavn: string | null;
    readonly taperNavn: string | null;
}

/** «way/123» → 'way'. `null` for alt som ikke er en OSM-id — kuraterte
 *  seed-rader har external_id som «tryvann», og de skal aldri pares. */
export function osmType(externalId: string): OsmType | null {
    const m = /^(node|way|relation)\/\d+$/.exec(externalId);
    return m ? (m[1] as OsmType) : null;
}

/** Tallet i «way/123». Brukes bare til å sammenligne to objekter av samme
 *  type, så formen er allerede sjekket av [osmType]. */
function osmId(externalId: string): number {
    return Number(externalId.slice(externalId.indexOf('/') + 1));
}

/** Samme navn, uten hensyn til store bokstaver og mellomrom. */
function sammeNavn(a: string | null, b: string | null): boolean {
    return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Hvem av to vinner, FØR navnene er sett på? `null` når regelen ikke tar
 * stilling (to flater).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NODE MOT FLATE: FLATEN VINNER.
 * Den har utstrekning, så senterpunktet er utledet av ekte geometri i stedet
 * for å være ett håndplassert punkt. I Kjelsås er den også best tagget:
 * way/650069798 har `access=permissive`, `surface=grass` og
 * `description=Kindergarden`, mens node/1095094457 fire meter unna bare har
 * `access=yes` — en tagg som er direkte feil for en barnehage.
 *
 * NODE MOT NODE: LAVESTE OSM-ID VINNER.
 * Ingen av dem har areal, så geometriargumentet faller bort. Tre kandidater
 * fantes, og valget er et STABILITETSVALG, ikke et kvalitetsvalg:
 *
 *   flest tagger  — kan SNU når noen redigerer OSM
 *   nyeste id     — snur samme vei, og premierer den som dupliserte
 *   laveste id    — uforanderlig, kan aldri snu
 *
 * `external_id` er upsert-nøkkelen, og importen sletter aldri. En vinner som
 * bytter mellom to kjøringer gir brukeren ÉN ny rad OG lar den gamle bli
 * stående publisert. Tag-rikdom er et bedre mål på informasjon, men et
 * dårligere mål på hva som er stabilt — og her koster ustabilitet mer enn en
 * tapt tagg. Museums-paret i basen er illustrasjonen: node/2785549850
 * (~2014) mot node/14091419612 (~2025); den gamle har overlevd elleve års
 * gjennomgang.
 *
 * ORDNINGEN ER ASYKLISK, og det er det som gjør [dedupPairs] uavhengig av
 * rekkefølge: flater taper aldri mot noder, og noder taper bare oppover i
 * id. Til sammen én global streng ordning — flater først, så noder etter
 * stigende id.
 */
function foreslattVinner(a: DedupKandidat, b: DedupKandidat): {
    vinner: DedupKandidat;
    taper: DedupKandidat;
} | null {
    const ta = osmType(a.externalId);
    const tb = osmType(b.externalId);
    if (ta === null || tb === null) return null;
    const aErNode = ta === 'node';
    const bErNode = tb === 'node';
    if (!aErNode && !bErNode) return null; // to flater — se filhodet
    if (aErNode && !bErNode) return { vinner: b, taper: a };
    if (!aErNode && bErNode) return { vinner: a, taper: b };
    return osmId(a.externalId) < osmId(b.externalId)
        ? { vinner: a, taper: b }
        : { vinner: b, taper: a };
}

/**
 * Alle par innenfor radiusen, med dom — og settet som skal tas ut.
 *
 * KANDIDATENE MÅ VÆRE SAMME KATEGORI. Funksjonen sjekker det ikke, fordi
 * begge kallerne grupperer på forhånd og en kategori-streng her ville vært
 * en fjerde ting som kunne komme i utakt. En lekeplass og en ballbane fire
 * meter fra hverandre er to steder, og det er grupperingen som sikrer det.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DETERMINISME
 *
 * Et objekt tas ut HVIS OG BARE HVIS det taper minst ett par. Ingen
 * kjede-resonnering, ingen grådig matching, ingen fikspunkt-iterasjon:
 * utfallet for hvert objekt avhenger bare av MENGDEN, ikke av rekkefølgen.
 *
 * Det er velfundert fordi «taper mot» er en streng PARTIELL ORDNING (se
 * [foreslattVinner]) — det finnes ingen sykler, så «taperne» er nøyaktig
 * komplementet til de maksimale elementene.
 *
 * MERK EN FØLGE: i en kjede A–B–C der A og C ligger lenger fra hverandre enn
 * radiusen, kan både A og B tas ut selv om A aldri ble sammenlignet med C.
 * Det er tilsiktet. Alternativet — «ta bare ut den som taper mot en som
 * overlever» — krever en iterasjon som ikke har ett entydig svar, og tre
 * objekter innenfor 20 m av hverandre er uansett ett sted.
 */
export function dedupPairs(
    kandidater: readonly DedupKandidat[],
    radius = DEDUP_RADIUS_M
): { tapere: Set<string>; par: DedupPar[] } {
    // Sortert på breddegrad, så hvert objekt bare sammenlignes med dem som i
    // det hele tatt KAN ligge nær nok. Uten den er ~4 000 lekeplasser i basen
    // 16 millioner avstander. Samme grep som forkastningsfilteret i
    // skianleggVerify: et objekt som ligger mer enn radiusen unna i
    // BREDDEGRAD alene, ligger mer enn radiusen unna.
    const sortert = [...kandidater].sort(
        (a, b) => a.lat - b.lat || a.externalId.localeCompare(b.externalId)
    );
    // Vinduet er bevisst litt for vidt: det skal aldri utelukke et par den
    // ekte testen ville godtatt.
    const dLat = (radius + SLINGRING_M) / 111_320 + 1e-9;

    const par: DedupPar[] = [];
    const tapere = new Set<string>();

    for (let i = 0; i < sortert.length; i++) {
        const a = sortert[i];
        for (let j = i + 1; j < sortert.length && sortert[j].lat <= a.lat + dLat; j++) {
            const b = sortert[j];
            const meter = distanceMeters(
                { lat: a.lat, lon: a.lng },
                { lat: b.lat, lon: b.lng }
            );
            if (meter > radius + SLINGRING_M) continue;

            const foreslatt = foreslattVinner(a, b);
            if (foreslatt === null) {
                // To flater, eller en external_id som ikke er en OSM-id.
                if (osmType(a.externalId) && osmType(b.externalId)) {
                    par.push({
                        // Rekkefølgen er vilkårlig her — ingen av dem vinner —
                        // men den må være STABIL, så id-en avgjør.
                        vinner: a.externalId,
                        taper: b.externalId,
                        meter: rund(meter),
                        utfall: 'to-flater',
                        vinnerNavn: a.navn,
                        taperNavn: b.navn,
                    });
                }
                continue;
            }

            const { vinner, taper } = foreslatt;
            const utfall: DedupUtfall =
                taper.navn !== null && vinner.navn === null
                    ? 'navn-bare-pa-taper'
                    : taper.navn !== null &&
                        vinner.navn !== null &&
                        !sammeNavn(taper.navn, vinner.navn)
                      ? 'navn-uenighet'
                      : 'droppet';

            par.push({
                vinner: vinner.externalId,
                taper: taper.externalId,
                meter: rund(meter),
                utfall,
                vinnerNavn: vinner.navn,
                taperNavn: taper.navn,
            });
            if (utfall === 'droppet') tapere.add(taper.externalId);
        }
    }

    return {
        tapere,
        // Stabil rekkefølge: rapporten skal se lik ut mellom to kjøringer av
        // samme data, uansett hvilken rekkefølge inndata kom i.
        par: par.sort(
            (x, y) => x.taper.localeCompare(y.taper) || x.vinner.localeCompare(y.vinner)
        ),
    };
}

const rund = (m: number) => Math.round(m * 10) / 10;

/** Parene som IKKE ble løst, gruppert på årsak. Tallet rapporten må vise, så
 *  ingen tror basen er ren etter oppryddingen. */
export function uloste(par: readonly DedupPar[]): Record<Exclude<DedupUtfall, 'droppet'>, number> {
    return {
        'to-flater': par.filter((p) => p.utfall === 'to-flater').length,
        'navn-bare-pa-taper': par.filter((p) => p.utfall === 'navn-bare-pa-taper').length,
        'navn-uenighet': par.filter((p) => p.utfall === 'navn-uenighet').length,
    };
}

// ─────────────────────────── NEDTAKINGEN ───────────────────────────
//
// SQL-EN LIGGER HER, SAMMEN MED REGELEN, av samme grunn som regelen selv er
// felles: både importen og oppryddingen skriver den ut, og to varianter ville
// kunnet ta ned ulike rader eller bruke ulike overganger.

/**
 * SQL-en som tar ned radene regelen fjernet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HVORFOR HVERKEN IMPORTEN ELLER OPPRYDDINGEN SKRIVER SELV
 *
 * Importen sletter aldri og tar aldri ned — verifisert: det finnes ingen
 * `.delete()` eller `delete from` mot `activities` i kodebasen. Et objekt som
 * slutter å bli en rad forsvinner derfor ikke; raden står publisert til noen
 * gjør noe.
 *
 * Fristelsen er å la skriptet sette `status='rejected'` selv. Tre grunner til
 * at det ikke gjør det:
 *
 *   1. REGELEN HAR ALDRI KJØRT MOT EKTE DATA. Første gang er mot 263 par.
 *      En regel som viser seg å være feil, og som har avpublisert 263 rader
 *      før noen leste utskriften, er en dårlig handel mot ett lim-inn.
 *   2. PRESEDENSEN. docs/runbooks/oslo-alpin.md gjør nøyaktig dette for de to
 *      erstattede OSM-radene: koden bygger dem ikke lenger, et menneske tar
 *      dem ned. Én mekanisme, ikke to.
 *   3. `--dry-run` VILLE BLITT EN LØGN. En tørrkjøring som avpubliserer rader
 *      er ikke tørr, og å gjøre nedtakingen betinget av et flagg ville gitt
 *      to kodeveier der den ene aldri testes.
 *
 * `rejected + locked` er nøyaktig det `unpublish` i lib/moderation.ts gjør:
 * raden beholder id-en sin, forsvinner fra API-et (som kun serverer
 * `published`), og låsen hindrer at importen skriver den igjen om regelen
 * senere skrus av. `publish` angrer hele operasjonen.
 */
export function nedtakingsSql(eksterneIder: readonly string[]): string {
    // Id-ene er laget av oss fra OSM-type og -id, så formen er kjent. Vakten
    // står likevel: strengen limes inn i en SQL-editor, og en id som ikke ser
    // ut som en id skal stoppe utskriften, ikke pyntes på.
    const ugyldige = eksterneIder.filter((id) => osmType(id) === null);
    if (ugyldige.length) {
        return (
            `\nDUBLETTER: ${eksterneIder.length} rader, men ${ugyldige.length} av ` +
            `id-ene har uventet form (f.eks. «${ugyldige[0]}»). SQL-en skrives ikke ut.`
        );
    }
    if (eksterneIder.length === 0) return '';
    const liste = [...eksterneIder].sort().map((id) => `'${id}'`).join(',\n      ');
    return [
        ``,
        `NEDTAKING (${eksterneIder.length} rader)`,
        `  Kontroller først:`,
        ``,
        `    select a.external_id, a.title, a.category, a.status, a.locked`,
        `    from public.activities a`,
        `    join public.sources s on s.id = a.source_id`,
        `    where s.slug = 'osm-steder' and a.external_id in (`,
        `      ${liste}`,
        `    );`,
        ``,
        `  Ta dem så ned — samme overgang som 'unpublish' i lib/moderation.ts:`,
        ``,
        `    update public.activities a`,
        `    set status = 'rejected', locked = true`,
        `    from public.sources s`,
        `    where a.source_id = s.id and s.slug = 'osm-steder'`,
        `      and a.status = 'published'`,
        `      and a.external_id in (`,
        `      ${liste}`,
        `      );`,
        ``,
        `  «and a.status = 'published'» speiler from: ['published'] i`,
        `  MODERATION_TRANSITIONS.unpublish, så SQL-en aldri gjør noe overgangen`,
        `  ikke ville gjort. Angre med POST /api/admin/moderate {action:'publish'}.`,
        ``,
    ].join('\n');
}
