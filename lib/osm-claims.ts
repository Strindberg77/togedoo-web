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
    /**
     * FOREBYGGENDE CLAIM: objektet blir ikke en rad i dag uansett, og skal
     * derfor ikke meldes som dødt.
     *
     * HVA DEN LØSER. [applyOsmClaims] kjører i buildRows, altså på de
     * BERIKEDE elementene. Et Skianlegg-polygon som berikelsen forkaster
     * («usikker-heis», «ikke-alpint») når aldri dit, så claimen kan ikke
     * treffe. De fire anleggene med heis uten utforløype ville derfor stått
     * i «CLAIMS SOM IKKE TRAFF NOE» ved hver eneste nasjonale kjøring — og
     * en rapport som alltid har fire falske treff blir en rapport ingen
     * leser.
     *
     * HVORFOR CLAIMEN LIKEVEL SKAL FINNES: dommen er en egenskap ved
     * OSM-DATAENE, ikke ved anlegget. Tegnes det en `piste:type=downhill`
     * inn i Kolsås i morgen, blir polygonet «alpint», når buildRows, og
     * claimen slår inn — uten den ville importen laget en rad ved siden av
     * seed-raden, nøyaktig som med Korketrekkeren.
     *
     * PRISEN, og den er ekte: flagget slår av dødt-claim-varselet for
     * nettopp disse. Blir way/43656613 slettet i OSM, sier ingenting fra.
     * Seed-siden er fortsatt voktet av [assertClaimsResolve].
     */
    readonly expectNoHit?: boolean;
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
    // OSLO-ALPINT (sep. 2026): FEM CLAIMS FOR TO OSM-OBJEKTER.
    //
    // SLIK UTTRYKKES ÉN-TIL-MANGE. Én claim er ett PAR — (OSM-objekt,
    // kuratert rad) — ikke en nøkkel. Eier fem rader to objekter, er det fem
    // claims. [claimsByOsmId] grupperer dem, og [applyOsmClaims] gir ÉN
    // hoppet-over-linje per objekt med alle eierne listet.
    //
    // ALTERNATIVET, én claim per objekt med en liste av externalId-er, ble
    // forkastet: da måtte [assertClaimsResolve] løpe gjennom en liste i en
    // liste, og — viktigere — en claim ville ikke lenger vært det den er, en
    // påstand om at ÉN navngitt rad dekker stedet. Med fem claims fanger
    // vakten at `wyller` forsvinner fra seeden. Med to hadde bare `tryvann`
    // og `trollvannskleiva` vært voktet, og de tre andre kunne blitt slettet
    // uten at noe sa fra.
    //
    // expectName BESKRIVER OSM-OBJEKTET, ikke raden. Alle tre
    // Skimore-claimene venter «Skimore Oslo», for det er det relasjonen
    // heter. Radene heter noe annet med vilje: «Skimore» er et
    // heiskortsystem, ikke et stedsnavn.
    {
        osmId: 'relation/2259942',
        source: 'kuratert-vintertilbud',
        externalId: 'tryvann',
        expectName: 'Skimore Oslo',
        note: 'OSM har én relasjon per driftsselskap; importen ga bbox-senteret 59.9915, 10.6510 for tre anlegg med hvert sitt startpunkt.',
    },
    {
        osmId: 'relation/2259942',
        source: 'kuratert-vintertilbud',
        externalId: 'wyller',
        expectName: 'Skimore Oslo',
        note: 'Wyller har egen parkering i Sørkedalen, 30 minutters kjøretur fra Tryvann. Samme relasjon i OSM.',
    },
    {
        osmId: 'relation/2259942',
        source: 'kuratert-vintertilbud',
        externalId: 'tommkleiva',
        expectName: 'Skimore Oslo',
        note: 'Tommkleiva har eget startpunkt ved Øvresetertjern. Samme relasjon i OSM.',
    },
    {
        osmId: 'relation/1762278',
        source: 'kuratert-vintertilbud',
        externalId: 'trollvannskleiva',
        expectName: 'Oslo Skisenter',
        note: 'OSM har én relasjon per driftsselskap; importen ga bbox-senteret 59.9567, 10.8097 for to anlegg med parkering i hver sin ende av Grefsenåsen.',
    },
    {
        osmId: 'relation/1762278',
        source: 'kuratert-vintertilbud',
        externalId: 'grefsenkleiva',
        expectName: 'Oslo Skisenter',
        note: 'Grefsenkleiva har egen parkering mot Østreheimsveien. Samme relasjon i OSM.',
    },
    // ─────────────────────────────────────────────────────────────────────
    // HEIS UTEN UTFORLØYPE (sep. 2026): FIRE ANLEGG IMPORTEN IKKE KAN TA.
    //
    // Den nasjonale tørrkjøringen ga disse fire dommen `usikker-heis` — heis
    // i OSM, men ingen `piste:type=downhill` innenfor polygonet. Kravet står
    // (uten det kommer Holmenkollen, Granåsen og Linderudkollen inn som
    // alpinanlegg), så anleggene seedes i stedet.
    //
    // HVORFOR DE LIKEVEL CLAIMES, når importen ikke lager dem i dag: dommen
    // er en egenskap ved OSM-DATAENE, ikke ved anlegget. Får Kolsås en
    // `piste:type=downhill` tegnet inn i morgen, blir den «alpint» ved neste
    // kjøring og importen lager en rad ved siden av seed-raden — nøyaktig det
    // som skjedde med Korketrekkeren. Claimen er vaksinen, og den koster
    // ingenting så lenge dommen står.
    //
    // FØLGEN AV DET: disse fire claimene vil stå som «traff ingenting» i
    // dødt-claim-rapporten så lenge dommen er `usikker-heis`, fordi et
    // objekt som forkastes i berikelsen aldri når [applyOsmClaims]. Det er
    // FORVENTET for nettopp disse fire, og er ikke et tegn på at lista
    // rotner. Se docs/runbooks/alpin-usikker-heis.md.
    //
    // expectName BESKRIVER OSM-OBJEKTET. Kolsås heter «Kolsås Skisenter
    // (Kolsåsbakken)» i OSM og «Kolsås Skisenter» som rad; Ringkollen heter
    // «Ringkollen alpinbakke» i OSM og «Ringkollen» som rad.
    {
        osmId: 'way/43656613',
        source: 'kuratert-vintertilbud',
        externalId: 'kolsas-skisenter',
        expectNoHit: true,
        expectName: 'Kolsås Skisenter (Kolsåsbakken)',
        note: 'Heis i OSM, men ingen piste:type=downhill — importen dømmer «usikker-heis». Kun landuse=recreation_ground, lit, name og sport=skiing; sport=skiing alene er det Varingskollen skistadion (langrenn) også har.',
    },
    {
        osmId: 'way/544124493',
        source: 'kuratert-vintertilbud',
        externalId: 'finse-skisenter',
        expectNoHit: true,
        expectName: 'Finse Skisenter',
        note: 'Heis i OSM, ingen utforløype tagget. Seedes med manuelt verifisert punkt i Ulvik.',
    },
    {
        osmId: 'relation/16471584',
        source: 'kuratert-vintertilbud',
        externalId: 'ringkollen',
        expectNoHit: true,
        expectName: 'Ringkollen alpinbakke',
        note: 'Heis i OSM, ingen utforløype tagget. Seedes med manuelt verifisert punkt i Ringerike.',
    },
    {
        osmId: 'way/1489390372',
        source: 'kuratert-vintertilbud',
        externalId: 'grakallparken',
        expectNoHit: true,
        expectName: 'Gråkallparken',
        note: 'Heis i OSM, ingen utforløype tagget. Seedes med manuelt verifisert punkt i Trondheim.',
    },
    // ─────────────────────────────────────────────────────────────────────
    // STORANLEGG (sep. 2026): ÅTTE CLAIMS FOR TRE RADER.
    //
    // Importen ga Voss, Trysil og Geilo bbox-senteret til polygonet — oppe i
    // fjellsiden, eller mellom Geilos to ringer. Seed-radene har punktet ved
    // basen. Se docs/skianlegg-adkomst.md.
    //
    // HVER RAD EIER OGSÅ DELENE INNI. Alphapark, «child ski area», Geilolia
    // og de to navnløse ytterringene i Ski Geilo var published rader med
    // punkt inne i anlegget. Claimen gjør at de aldri blir rader igjen, også
    // om låsen på den gamle raden skulle forsvinne. De 115 NAVNLØSE
    // delflatene fra flatemålingen er IKKE claimet: de er tatt ned med lås,
    // og 115 claims ville druknet de som betyr noe.
    //
    // expectName BESKRIVER OSM-OBJEKTET. «Trysil» er et svakt kontrollpunkt,
    // men det er det polygonet heter.
    {
        osmId: 'relation/4107373',
        source: 'kuratert-vintertilbud',
        externalId: 'voss-resort',
        expectName: 'Voss Resort Fjellheisar',
        note: 'Bbox-senteret lå på 658 moh. i skogen; seed-raden har gondolens dalstasjon i Voss sentrum.',
    },
    {
        osmId: 'way/1348055350',
        source: 'kuratert-vintertilbud',
        externalId: 'voss-resort',
        expectName: 'Alphapark',
        note: 'Sesongbygget terrengpark inne i Voss Resort (5 av 5 noder i relation/4107373). Del av anlegget, ikke eget sted.',
    },
    {
        osmId: 'way/1210019615',
        source: 'kuratert-vintertilbud',
        externalId: 'trysil-skisenter',
        expectName: 'Trysil',
        note: 'Bbox-senteret lå på 861 moh. midt i fjellet; seed-raden har Trysilgondolens dalstasjon ved Turistsenteret.',
    },
    {
        osmId: 'way/55606470',
        source: 'kuratert-vintertilbud',
        externalId: 'trysil-skisenter',
        expectName: 'child ski area',
        note: 'Barneområde ved Høyfjellsenteret, 6 av 6 noder i way/1210019615. Navnet er en engelsk typebetegnelse.',
    },
    {
        osmId: 'relation/17004845',
        source: 'kuratert-vintertilbud',
        externalId: 'skigeilo',
        expectName: 'Ski Geilo',
        note: 'To ringer, én på hver side av dalen; bbox-senteret lå 430 m utenfor begge. Seed-raden har Geiloheisen i sentrum.',
    },
    {
        osmId: 'relation/10859554',
        source: 'kuratert-vintertilbud',
        externalId: 'skigeilo',
        expectName: 'Geilolia',
        note: 'recreation_ground inne i Ski Geilos sørlige ring. Del av SkiGeilo.',
    },
    {
        osmId: 'way/1238316509',
        source: 'kuratert-vintertilbud',
        externalId: 'skigeilo',
        expectName: null,
        note: 'Sørlig ytterring i relation/17004845, uten navn. Ble raden «Skianlegg i Geilolie».',
    },
    {
        osmId: 'way/1238316510',
        source: 'kuratert-vintertilbud',
        externalId: 'skigeilo',
        expectName: null,
        note: 'Nordlig ytterring i relation/17004845, uten navn. Ble raden «Skianlegg ved Vesleåne 68».',
    },
    // ─────────────────────────────────────────────────────────────────────
    // FORNØYELSESPARKER (sep. 2026). Åtte tourism=theme_park-objekter, én
    // claim hver. ALLE ER FOREBYGGENDE: importen har ingen selektor for
    // tourism=theme_park i dag, så ingen av dem kan treffe. De står her for
    // den dagen en Fornøyelsespark-, Badeland- eller Dyremøte-import finnes —
    // uten dem ville den laget en rad med polygonets midtpunkt ved siden av
    // seed-raden med inngangspunktet. Se docs/fornoyelsespark-maling.md.
    //
    // IKKE CLAIMET: de tre leisure=park som heter «Kongeparken»
    // (way/103268212, way/189732650, way/614558426). De ligger i Tromsø,
    // Bodø og ved Trysil — ekte byparker, ikke fornøyelsesparken på Ålgård.
    // En claim ville skjult dem.
    {
        osmId: 'way/48672338',
        source: 'kuratert-vintertilbud',
        externalId: 'tusenfryd',
        expectName: 'Tusenfryd',
        note: 'Polygonets midtpunkt ligger 106 m inne i parken; seed-raden har hovedinngangen (node/7687702285).',
        expectNoHit: true,
    },
    {
        osmId: 'relation/6598772',
        source: 'kuratert-vintertilbud',
        externalId: 'kongeparken',
        expectName: 'Kongeparken',
        note: 'Seed-raden har hovedinngangen (node/686254300), 130 m fra midtpunktet.',
        expectNoHit: true,
    },
    {
        osmId: 'relation/10678827',
        source: 'kuratert-vintertilbud',
        externalId: 'hunderfossen-eventyrpark',
        expectName: 'Hunderfossen',
        note: 'OSM-navnet er «Hunderfossen Familiepark»; parken heter nå Eventyrpark. Seed-raden har hovedinngangen (node/2794927148).',
        expectNoHit: true,
    },
    {
        osmId: 'way/273798788',
        source: 'kuratert-vintertilbud',
        externalId: 'lilleputthammer',
        expectName: 'Lilleputthammer',
        note: 'Bare entrance=yes i OSM. Seed-raden har inngangen på parkgrensen (node/2786099980).',
        expectNoHit: true,
    },
    {
        osmId: 'way/696667313',
        source: 'kuratert-vintertilbud',
        externalId: 'foldvik-familiepark',
        expectName: 'Foldvik',
        note: 'Seed-raden har hovedinngangen (node/6542382397).',
        expectNoHit: true,
    },
    {
        osmId: 'way/120864609',
        source: 'kuratert-vintertilbud',
        externalId: 'mikkelparken',
        expectName: 'Mikkelparken',
        note: 'Ingen inngang i OSM. Seed-raden har et omtrentlig punkt ved kundeparkeringen.',
        expectNoHit: true,
    },
    {
        osmId: 'way/69166520',
        source: 'kuratert-vintertilbud',
        externalId: 'dyreparken',
        expectName: 'Dyrepark',
        note: 'Én rad for dyrepark og fornøyelsespark: Dyremøte med fasett fornoyelsespark. Seed-raden har «Byporten» (node/1257106325).',
        expectNoHit: true,
    },
    {
        osmId: 'way/307924173',
        source: 'kuratert-vintertilbud',
        externalId: 'bo-sommarland',
        expectName: 'Sommarland',
        note: 'Badeland ute. Seed-raden har hovedinngangen (node/3131762432), 270 m fra midtpunktet.',
        expectNoHit: true,
    },
    // SILJAN SKISENTER (relation/8359960) ER IKKE CLAIMET OG IKKE SEEDET.
    // Den sto på samme liste, men ser nedlagt ut. Importen kan ikke vite om
    // et anlegg er i drift — `disused`/`abandoned` er filtrert bort i
    // selektoren, men et anlegg som er lagt ned UTEN å bli omtagget ser helt
    // levende ut i dataene. Så lenge dommen er «usikker-heis» blir den ingen
    // rad, og det er riktig utfall her. Skulle den bli tagget med en
    // utforløype senere, kommer den inn som alpinanlegg — og da er det
    // OSM-dataene som må rettes, ikke denne lista.
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
    // ─────────────────────────────────────────────────────────────────────
    // RUSH OG LEO'S (sep. 2026): OSM-DUBLETTER AV RADER VI ALLEREDE HAR.
    //
    // De kuraterte radene har ligget i kuratert-vintertilbud lenge. OSM-radene
    // kom i tillegg, under feil kategori: Rush Bergen som Idrettshall
    // (sports_centre uten sport), Rush Trondheim og Leo's som Lekeplass
    // (leisure=playground). Disse claimene TREFFER i dag, så de er ikke
    // forebyggende. De gamle OSM-radene tas ned med --nedtak i
    // scripts/seed-spill-og-moro.ts.
    //
    // IKKE CLAIMET: Leos Lekeland Forus (node/2984187381). Det finnes ingen
    // kuratert rad for Forus, og en claim uten rad er ikke lov.
    {
        osmId: 'node/13716750101',
        source: 'kuratert-vintertilbud',
        externalId: 'rush-trampolinepark-bergen',
        expectName: 'Rush',
        note: 'OSM-raden ble Idrettshall (sports_centre uten sport). Den kuraterte raden er Trampolinepark.',
    },
    {
        osmId: 'node/5549490417',
        source: 'kuratert-vintertilbud',
        externalId: 'rush-trampolinepark-trondheim',
        expectName: 'Rush',
        note: 'OSM-raden ble Lekeplass (leisure=playground). Den kuraterte raden er Trampolinepark.',
    },
    {
        osmId: 'node/12181644169',
        source: 'kuratert-vintertilbud',
        externalId: 'leos-lekeland-oslo',
        expectName: 'Leo',
        note: 'OSM-raden ble Lekeplass (leisure=playground). Den kuraterte raden er Innendørs lekeland.',
    },
    {
        osmId: 'node/5793918551',
        source: 'kuratert-vintertilbud',
        externalId: 'leos-lekeland-bergen',
        expectName: 'Leo',
        note: 'OSM-raden ble Lekeplass (leisure=playground, også amenity=fast_food). Den kuraterte raden er Innendørs lekeland.',
    },
    {
        osmId: 'node/4394667412',
        source: 'kuratert-vintertilbud',
        externalId: 'leos-lekeland-trondheim',
        expectName: 'Leo',
        note: 'OSM-raden ble Lekeplass (leisure=playground). Den kuraterte raden er Innendørs lekeland.',
    },
    // ─────────────────────────────────────────────────────────────────────
    // SPILL OG MORO (sep. 2026): kuratert i scripts/seed-spill-og-moro.ts.
    //
    // DE FLESTE ER FOREBYGGENDE: importen har ingen selektor for
    // escape_game, bowling_alley, miniature_golf eller karting.
    //
    // UNNTAKET er de fire som er leisure=sports_centre: Megazone Oslo og
    // Bergen, Harald Huysman Karting og Kragerø Actionpark. Idrettshall-
    // selektoren HENTER dem fortsatt, og claims legges på det som hentes,
    // før kategorivalget. De blir altså sett ved hver kjøring som dekker
    // byen deres, og er vanlige claims. At de ikke lenger blir Idrettshall
    // (isNonSportCentre i scripts/import-places.ts) er lag 3: den gjelder
    // også lasertag- og bowlinghaller ingen har claimet ennå. De tre gamle
    // OSM-radene tas ned med --nedtak.
    //
    // expectName BESKRIVER OSM-OBJEKTET: «Bowling1 & Gocart» er Lucky Bowl
    // Trondheim, og «Lykkeland Lekepark» heter Lykkeland som rad.
    {
        osmId: 'node/4736654480',
        source: 'kuratert-spill-og-moro',
        externalId: 'megazone-oslo',
        expectName: 'Megazone',
        note: 'Var Idrettshall (sport=laser_tag). Lasertag er ikke idrettshall.',
    },
    {
        osmId: 'node/7197772245',
        source: 'kuratert-spill-og-moro',
        externalId: 'megazone-bergen',
        expectName: 'Megazone',
        note: 'Var Idrettshall (sport=laser_tag). Seed-raden har adressenoden, samme punkt som Fangene på Fortet Bergen.',
    },
    {
        osmId: 'way/1030656428',
        source: 'kuratert-spill-og-moro',
        externalId: 'harald-huysman-karting',
        expectName: 'Harald Huysman',
        note: 'Var Idrettshall (sport=karting). Seed-raden har adressenoden for Smalvollveien 34.',
    },
    {
        osmId: 'node/9724313095',
        source: 'kuratert-spill-og-moro',
        externalId: 'fangene-pa-fortet-oslo',
        expectName: 'Fangene',
        expectNoHit: true,
        note: 'leisure=escape_game. Seed-raden har adressenoden for Nydalsveien 28.',
    },
    {
        osmId: 'node/7197772246',
        source: 'kuratert-spill-og-moro',
        externalId: 'fangene-pa-fortet-bergen',
        expectName: 'Fangene',
        expectNoHit: true,
        note: 'leisure=escape_game. Samme adresse som Megazone Bergen.',
    },
    {
        osmId: 'node/14143229452',
        source: 'kuratert-spill-og-moro',
        externalId: 'fangene-pa-fortet-stavanger',
        expectName: 'Fangene',
        expectNoHit: true,
        note: 'leisure=escape_game. Seed-raden har adressenoden for Lagårdsveien 61.',
    },
    {
        osmId: 'node/12078177859',
        source: 'kuratert-spill-og-moro',
        externalId: 'lykkeland-steinkjer',
        expectName: 'Lykkeland',
        expectNoHit: true,
        note: 'leisure="bowling_alley; laser_tag; playground" — tre verdier i én tagg, treffer ingen selektor. Seed-raden er Innendørs lekeland.',
    },
    {
        osmId: 'node/807246866',
        source: 'kuratert-spill-og-moro',
        externalId: 'lucky-bowl-trondheim',
        expectName: 'Bowling1',
        expectNoHit: true,
        note: 'OSM-navnet er utdatert; stedet heter Lucky Bowl Trondheim. Seed-raden har inngangen node/8543977715.',
    },
    {
        osmId: 'node/3370641796',
        source: 'kuratert-spill-og-moro',
        externalId: 'lucky-bowl-trondheim',
        expectName: null,
        expectNoHit: true,
        note: 'Gokartbanen (sport=karting, uten navn) 20 m fra bowlinghallen. Samme sted.',
    },
    {
        osmId: 'node/12873546691',
        source: 'kuratert-spill-og-moro',
        externalId: 'kragero-actionpark',
        expectName: 'Kragerø',
        note: 'sport=karting. Seed-raden har adressenoden for Kjølebrøndsveien 210.',
    },
    {
        osmId: 'way/1110871267',
        source: 'kuratert-spill-og-moro',
        externalId: 'dagali-opplevelser-gokart',
        expectName: null,
        expectNoHit: true,
        note: 'Banen, uten navn (operator=Dagaliopplevelser). Seed-raden har midten av banen.',
    },
    {
        osmId: 'way/688146555',
        source: 'kuratert-spill-og-moro',
        externalId: 'nmk-halsa-gokart',
        expectName: 'Halsa',
        expectNoHit: true,
        note: 'leisure=pitch + sport=karting. Seed-raden har klubblokalene, ca. 50 m unna.',
    },
    {
        osmId: 'node/4958723297',
        source: 'kuratert-spill-og-moro',
        externalId: 'oslo-camping-minigolf',
        expectName: 'Oslo Camping',
        expectNoHit: true,
        note: 'amenity=pub + leisure=miniature_golf. Seed-raden har adressenoden for Møllergata 12.',
    },
    {
        osmId: 'node/12966945763',
        source: 'kuratert-spill-og-moro',
        externalId: 'underground-golf-oslo',
        expectName: 'Underground',
        expectNoHit: true,
        note: 'leisure=miniature_golf. Seed-raden har adressenoden for Industrigata 36.',
    },
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
    return claims.filter((c) => !c.expectNoHit && !seen.has(c.osmId));
}

/**
 * Forebyggende claims som FAKTISK traff — altså objekter som ikke lenger
 * forkastes i berikelsen.
 *
 * Dette er den andre halvdelen av [expectNoHit], og den er ikke et varsel om
 * noe galt: den betyr at OSM har fått dataene som manglet. Da er spørsmålet
 * om den kuraterte raden fortsatt er bedre enn importens, eller om claimen
 * kan fjernes og stedet overlates til importen igjen.
 */
export function awakenedClaims(
    seen: ReadonlySet<string>,
    claims: readonly OsmClaim[] = OSM_CLAIMS
): OsmClaim[] {
    return claims.filter((c) => c.expectNoHit && seen.has(c.osmId));
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
