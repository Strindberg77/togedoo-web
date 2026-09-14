// lib/osm-claims.ts
//
// HVEM EIER RADEN når et sted finnes både i en kuratert seed og i OSM.
//
// PROBLEMET. Upserten er `(source_id, external_id)` (migrasjon 0001, unique
// på de to). En seed-rad under 'kuratert-vintertilbud' og en import-rad under
// 'osm-steder' kolliderer derfor ALDRI. Importen lager en ny rad ved siden av
// seed-raden, hver eneste kjøring. Det skjedde med Korketrekkeren: seed-raden
// har et verifisert punkt ved Frognerseteren, import-raden hadde bbox-punktet
// midt i løypa. Import-raden ble slettet for hånd, og ville kommet tilbake ved
// neste kjøring av Aking for Oslo.
//
// LÅSING LØSER DET IKKE. Begge skriverne slår opp låste rader med
// `.eq('source_id', source.id)` (scripts/import-places.ts, lib/ingest.ts,
// scripts/seed-*.ts) — altså kun innenfor sin EGEN kilde. Å låse en seed-rad
// sier ingenting til importen.
//
// DETTE ER IKKE ET DEDUP-PROBLEM. Det finnes ingen nøkkel som kan slå de to
// radene sammen, fordi de ikke ER samme rad: den ene er kuratert og
// håndverifisert, den andre er maskinutledet. Spørsmålet er hvem som EIER
// stedet, og det er en kuratorbeslutning — ikke noe som kan utledes.
//
// ─────────────────────────────────────────────────────────────────────────
// MEKANISMEN: en CLAIM er en påstand om at et OSM-objekt allerede er dekket
// av en kuratert rad. Importen bygger da ingen rad for det objektet.
//
// Ingen rad flyttes mellom kilder. Seed-raden blir stående der den er, med
// sin egen `id`, sin egen external_id og sin egen kilde — og redigeres
// fortsatt i seed-fila. Det er den viktigste egenskapen ved denne løsningen,
// og grunnen til at den er reversibel: å fjerne en claim er én linje, og
// ingen rad-id har vært innom noe annet.
//
// ÉN-TIL-MANGE FALLER UT GRATIS. En claim er ikke en nøkkel, så flere
// kuraterte rader kan claime SAMME OSM-objekt. Tryvann og Wyller er to
// anlegg med hvert sitt startpunkt 30 minutters kjøretur fra hverandre, men
// ÉN relasjon i OSM. Begge claimer den; OSM-objektet blir ingen rad; begge
// kuraterte rader beholder sitt eget punkt. Den tidligere anbefalingen — å
// flytte seed-raden til source_id='osm-steder' med external_id=<osm-id> —
// kunne ikke uttrykt dette i det hele tatt, fordi to rader ikke kan dele
// external_id innenfor samme kilde.
//
// ─────────────────────────────────────────────────────────────────────────
// TO UAVHENGIGE LAG hindrer at raden kommer tilbake:
//
//   Lag 1 (dette): [applyOsmClaims] i buildRows. Objektet blir aldri en rad.
//   Lag 2:         `locked` på en allerede eksisterende OSM-rad. Importen
//                  filtrerer låste rader bort før upsert ([writableRows]).
//
// Lag 2 er backstop for det tilfellet at en claim fjernes ved et uhell.
//
// ─────────────────────────────────────────────────────────────────────────
// EN GAMMEL OSM-RAD SOM ERSTATTES skal IKKE slettes og IKKE settes til
// 'expired'. Importen sletter aldri noe, og 'expired' betyr «arrangementet
// er over» (lib/event-window.ts, expireOldEvents) — et sted utløper ikke.
//
// Riktig håndtering er `status='rejected' + locked=true`, som er nøyaktig
// det eksisterende 'unpublish' i lib/moderation.ts gjør. Da forsvinner raden
// fra API-et (som kun serverer 'published'), den beholder sin id, låsen er
// lag 2, og 'publish' angrer hele operasjonen uten SQL-editoren. Ingen ny
// mekanisme, ingen migrasjon.

export interface OsmClaim {
    /**
     * OSM-objektet som IKKE skal bli en rad, skrevet «<type>/<id>».
     *
     * MERK at dette er en EXTERNAL_ID, ikke et vilkårlig OSM-objekt.
     * Importen setter `external_id = \`${el.type}/${el.id}\`` på elementet som
     * faktisk blir raden. For Aking er det ANKERET i klyngen, ikke de 14
     * segmentene — en claim på et segment ville aldri truffet noe. Står en
     * claim oppført som «traff ingenting» i rapporten, er dette den første
     * tingen å sjekke.
     */
    readonly osmId: string;
    /** Kilde-slugen til den kuraterte raden som eier stedet. */
    readonly source: string;
    /** external_id på den kuraterte raden. */
    readonly externalId: string;
    /**
     * KONTROLLPUNKTET. En del av OSM-objektets `name`, små/store bokstaver
     * spiller ingen rolle. Importen advarer når navnet ikke stemmer.
     *
     * Typen er `string | null`, ikke valgfri, og det er med vilje: en claim
     * uten kontroll er en claim ingen har verifisert. `null` betyr «objektet
     * har ikke navn i OSM» og er et eksplisitt valg, ikke en utelatelse —
     * samme asymmetri som [PlaceCategoryDef.isFree].
     *
     * HVORFOR NAVN OG IKKE KOORDINAT: et koordinat i claimen ville vært en
     * kopi av seed-radens koordinat, og kopier driver fra hverandre. Navnet
     * er dessuten det kuratoren FAKTISK ser når hun slår opp objektet på
     * osm.org, så det kontrollerer selve handlingen som kan gå galt — å lime
     * inn feil id.
     */
    readonly expectName: string | null;
    /** Hvorfor den kuraterte raden er bedre. Skrives for neste person. */
    readonly note: string;
}

/**
 * MANUELT VEDLIKEHOLDT. Ikke utledet, og det er ikke latskap.
 *
 * En utledet matching (navn + avstand) ville vært nettopp den feilkilden
 * spørsmålet «en feilmatch gir feil sted» peker på: norske alpinanlegg har
 * nesten like navn og deler daler. Varingskollen har alpinbakke og
 * langrennsstadion i samme dal; Trollvannskleiva og Grefsenkleiva ligger i
 * samme ås. En terskel som slår begge veier finnes ikke.
 *
 * Prisen er at lista må vedlikeholdes, og at den rotner i stillhet hvis
 * ingen ser etter. Det er [staleClaims] og navnekontrollen sitt ansvar.
 */
export const OSM_CLAIMS: readonly OsmClaim[] = [
    {
        osmId: 'relation/1459739',
        source: 'kuratert-vintertilbud',
        externalId: 'korketrekkeren-aking',
        expectName: 'Korketrekkeren',
        // Seed-raden har et håndverifisert punkt ved Frognerseteren, der man
        // faktisk begynner å ake. Importen forankrer på bbox-senteret, som
        // for en 2 km lang trasé havner midt i løypa — og akkurat den raden
        // er merket «UPÅLITELIG KARTPUNKT» av importens egen rapport.
        note: 'Seed har verifisert startpunkt ved Frognerseteren; importen gir bbox-senteret midt i løypa.',
    },
    // ─────────────────────────────────────────────────────────────────────
    // VENTER PÅ OSLO-SEEDEN FOR ALPINT (egen oppgave). Id-ene er kjent, men
    // en claim kan ikke skrives før seed-raden finnes — [assertClaimsResolve]
    // ville feilet med én gang. Skriv dem sammen med seed-entryene:
    //
    //   relation/2259942  →  Tryvann OG Wyller          (to rader, én relasjon)
    //   relation/1762278  →  Trollvannskleiva OG Grefsenkleiva (to rader, én relasjon)
    //
    // Det er disse to som gjør én-til-mange til et krav og ikke et
    // tankeeksperiment: anleggene har hvert sitt startpunkt en halvtimes
    // kjøretur fra hverandre, og ett bbox-senter er feil for begge.
    //
    // ─────────────────────────────────────────────────────────────────────
    // IKKE SKREVET, FORDI ID-EN IKKE ER SLÅTT OPP:
    //
    //   kirkerudbakken-skisenter   (OSM: recreation_ground, id ukjent her)
    //   varingskollen-alpinsenter  (OSM: recreation_ground, id ukjent her)
    //
    // Begge ligger UTENFOR de fire importbyene (Bærum og Nittedal), så
    // importen henter dem ikke i dag og kollisjonen kan ikke oppstå ennå.
    // Den oppstår den dagen nasjonal modus finnes. Slå opp id-ene da — de
    // skal ikke gjettes her.
];

/** Claims gruppert på OSM-objekt. Flere kuraterte rader kan eie samme objekt. */
export function claimsByOsmId(
    claims: readonly OsmClaim[] = OSM_CLAIMS
): Map<string, OsmClaim[]> {
    const m = new Map<string, OsmClaim[]>();
    for (const c of claims) {
        const liste = m.get(c.osmId);
        if (liste) liste.push(c);
        else m.set(c.osmId, [c]);
    }
    return m;
}

/** Stemmer OSM-navnet med det claimen forventet? `null` = ingen kontroll
 *  mulig (objektet har ikke navn), og da er svaret true — en claim som
 *  eksplisitt sier «uten navn» skal ikke advare hver kjøring. */
export function claimNameMatches(claim: OsmClaim, osmName: string | undefined): boolean {
    if (claim.expectName === null) return true;
    return (osmName ?? '').toLowerCase().includes(claim.expectName.toLowerCase());
}

/**
 * Claims som ALDRI traff et objekt i denne kjøringen.
 *
 * VIKTIG FORBEHOLD, som kallstedet må skrive ut sammen med lista: en kjøring
 * med `--city=Oslo --category=aking` henter ikke Kirkerudbakken i Bærum, så
 * «traff ingenting» betyr der bare «utenfor kjøringens rekkevidde». Lista er
 * først et dødt-claim-varsel når kjøringen dekket alle byer og alle
 * kategorier.
 */
export function staleClaims(
    seen: ReadonlySet<string>,
    claims: readonly OsmClaim[] = OSM_CLAIMS
): OsmClaim[] {
    return claims.filter((c) => !seen.has(c.osmId));
}

/**
 * Vakt for seed-skriptene: hver claim mot denne kilden må peke på en
 * external_id som faktisk finnes i seeden.
 *
 * Uten den kan et seed-entry døpes om eller slettes mens claimen blir
 * stående, og da undertrykker importen et OSM-objekt til fordel for en rad
 * som ikke finnes — stedet forsvinner helt fra appen, i stillhet. Kastes
 * hardt, og fanges i `--dry-run`, samme mønster som splitFor().
 */
export function assertClaimsResolve(
    source: string,
    seedExternalIds: readonly string[],
    claims: readonly OsmClaim[] = OSM_CLAIMS
): void {
    const finnes = new Set(seedExternalIds);
    const foreldrelose = claims
        .filter((c) => c.source === source && !finnes.has(c.externalId))
        .map((c) => `${c.osmId} → ${c.externalId}`);
    if (foreldrelose.length) {
        throw new Error(
            `OSM-claims peker på seed-rader som ikke finnes i ${source}: ` +
                `${foreldrelose.join(', ')}. Enten mangler seed-entryet, eller ` +
                `claimen skal fjernes fra lib/osm-claims.ts.`
        );
    }
}
