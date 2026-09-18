// app/page.tsx
//
// Forsiden på produksjonsadressen. Bevisst enkel og statisk: navnet, hva
// Togedoo er, og krediteringen av kildene appen faktisk viser data fra.
//
// Her sto tidligere en klientside som hentet /api/activities ved hver
// sidevisning og viste radene under overskriften «Ungfritid Aktiviteter» —
// en rest fra et forsøk på å hente fra Ungfritid som ble lagt ned (jul. 2026,
// se DATAHUB_SETUP.md). Feltnavnene den leste (org, appCategory, kommune)
// fantes ikke lenger, derav «Ukjent» overalt.
//
// Ingen aktivitetsliste og ingen kall, verken til vårt eget API eller til
// tredjepart. Serveres som en statisk side.
//
// KREDITERINGEN skal følge kildene som faktisk har publiserte rader. Målt
// 18.09.2026: OpenStreetMap (faste steder), Deichman (arrangementer), og
// Kartverket (stedsnavn i søket, adresser og kommuner). Bergen bibliotek er
// en aktiv kilde uten publiserte rader og står derfor ikke her ennå.

const KILDER = [
    {
        navn: '© OpenStreetMap contributors',
        hva: 'Faste steder: lekeplasser, parker, badeplasser, museer og mer. Lisens: ODbL.',
        lenke: 'https://www.openstreetmap.org/copyright',
    },
    {
        navn: '© Kartverket',
        hva: 'Stedsnavn, adresser og kommuner. Lisens: CC BY 4.0.',
        lenke: 'https://www.kartverket.no/api-og-data/vilkar-for-bruk',
    },
    {
        navn: 'Deichman',
        hva: 'Arrangementer ved Oslos folkebibliotek.',
        lenke: 'https://deichman.no',
    },
] as const;

export default function Forside() {
    return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
            <h1 className="text-4xl font-bold tracking-tight">Togedoo</h1>
            <p className="mt-4 text-lg text-neutral-700 dark:text-neutral-300">
                Togedoo hjelper familier å finne steder og aktiviteter i nærheten, fra lekeplassen
                rundt hjørnet til en utflukt i helgen.
            </p>

            <section className="mt-12" aria-labelledby="kilder">
                <h2 id="kilder" className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                    Kilder
                </h2>
                <ul className="mt-4 space-y-4">
                    {KILDER.map((k) => (
                        <li key={k.navn}>
                            <a
                                href={k.lenke}
                                className="font-medium underline underline-offset-4 hover:no-underline"
                                rel="noopener noreferrer"
                            >
                                {k.navn}
                            </a>
                            <p className="text-sm text-neutral-600 dark:text-neutral-400">{k.hva}</p>
                        </li>
                    ))}
                </ul>
            </section>
        </main>
    );
}
