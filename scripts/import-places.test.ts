// scripts/import-places.test.ts
// Enhetstester for fase B: den utvidede ball-/racketsport-selektoren og den
// sport-avledede tittel-etiketten. Ingen nettverk, ingen database — rene
// funksjoner og en strengsjekk på selektoren.
// Kjør: node --import tsx --test scripts/import-places.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Testene setter Overpass-konfigurasjonen via env og laster modulen LAZY med
// dynamisk import. Et vanlig `import` ville blitt heist over env-tilordningene
// under, og modulen leser dem på modulnivå — da ville retry-testene sovet i
// 20 s per forsøk og snakket med de ekte speil-URL-ene.
process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api,https://speil-b.test/api';
process.env.PLACES_OVERPASS_ROUNDS = '3';

const load = () => import('./import-places');


test('selektoren henter alle seks sportene', async () => {
    const { PLACE_CATEGORIES } = await load();
    const ballbane = PLACE_CATEGORIES.find((c) => c.key === 'ballbane')!;
    for (const sport of ['soccer', 'basketball', 'multi', 'tennis', 'volleyball', 'handball']) {
        assert.ok(
            ballbane.selector.includes(sport),
            `${sport} mangler i selektoren`
        );
    }
});

test('selektoren er fortsatt begrenset til offentlige pitcher', async () => {
    const { PLACE_CATEGORIES } = await load();
    const ballbane = PLACE_CATEGORIES.find((c) => c.key === 'ballbane')!;
    assert.ok(ballbane.selector.includes('"leisure"="pitch"'));
    assert.ok(ballbane.selector.includes('["access"!="private"]'));
});

test('kategoriverdien er uendret — «Ballbane» er databasenøkkelen', async () => {
    const { PLACE_CATEGORIES } = await load();
    const ballbane = PLACE_CATEGORIES.find((c) => c.key === 'ballbane')!;
    assert.equal(ballbane.category, 'Ballbane');
    assert.equal(ballbane.label, 'Ballbane');
});

test('sport-spesifikke tittel-etiketter', async () => {
    const { ballTitleLabel } = await load();
    assert.equal(ballTitleLabel('tennis'), 'Tennisbane');
    assert.equal(ballTitleLabel('table_tennis'), 'Bordtennisbord');
    assert.equal(ballTitleLabel('volleyball'), 'Volleyballbane');
    assert.equal(ballTitleLabel('handball'), 'Håndballbane');
});

test('bordtennis blir ALDRI «Tennisbane» (understreng-fella)', async () => {
    const { ballTitleLabel } = await load();
    // Mønstrene er ankret, så «table_tennis» treffer aldri /^tennis$/.
    assert.equal(ballTitleLabel('table_tennis'), 'Bordtennisbord');
    assert.equal(ballTitleLabel('tabletennis'), 'Bordtennisbord');
    assert.equal(ballTitleLabel('table-tennis'), 'Bordtennisbord');
});

test('beach-varianter faller inn under hovedsporten', async () => {
    const { ballTitleLabel } = await load();
    assert.equal(ballTitleLabel('beachvolleyball'), 'Volleyballbane');
    assert.equal(ballTitleLabel('beach_volleyball'), 'Volleyballbane');
    assert.equal(ballTitleLabel('beachhandball'), 'Håndballbane');
});

test('generiske ballsporter gir «Ballbane»', async () => {
    const { ballTitleLabel } = await load();
    assert.equal(ballTitleLabel('soccer'), 'Ballbane');
    assert.equal(ballTitleLabel('basketball'), 'Ballbane');
    assert.equal(ballTitleLabel('multi'), 'Ballbane');
});

test('semikolonliste: generisk vinner over spesifikk', async () => {
    const { ballTitleLabel } = await load();
    // «tennis;soccer» er i praksis en flerbruksflate — «Ballbane» er ærligst.
    assert.equal(ballTitleLabel('tennis;soccer'), 'Ballbane');
    assert.equal(ballTitleLabel('multi;handball'), 'Ballbane');
    // … men en ren spesifikk liste beholder sporten.
    assert.equal(ballTitleLabel('tennis;volleyball'), 'Tennisbane');
});

test('flersports-tagg: største anlegg navngir stedet', async () => {
    const { ballTitleLabel } = await load();
    // Prioritet tennis > volleyball > håndball > bordtennis. Et bord er det
    // minst definerende anlegget, så det taper mot alle de andre.
    assert.equal(ballTitleLabel('tennis;table_tennis'), 'Tennisbane');
    assert.equal(ballTitleLabel('table_tennis;volleyball'), 'Volleyballbane');
    assert.equal(ballTitleLabel('handball;table_tennis'), 'Håndballbane');
});

test('ukjent eller manglende sport faller trygt til «Ballbane»', async () => {
    const { ballTitleLabel } = await load();
    assert.equal(ballTitleLabel(undefined), 'Ballbane');
    assert.equal(ballTitleLabel(''), 'Ballbane');
    assert.equal(ballTitleLabel('cricket'), 'Ballbane');
});

test('etiketten er per element — kun ballbane har overstyring', async () => {
    const { PLACE_CATEGORIES } = await load();
    const ballbane = PLACE_CATEGORIES.find((c) => c.key === 'ballbane')!;
    assert.equal(ballbane.titleLabelFor?.({ sport: 'tennis' }), 'Tennisbane');
    for (const cat of PLACE_CATEGORIES.filter((c) => c.key !== 'ballbane')) {
        assert.equal(cat.titleLabelFor, undefined, `${cat.key} skal bruke label`);
    }
});

// ---------------------------------------------------------------------------
// Robusthet mot ustabil Overpass (des. 2026)
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

/** Mock som svarer med statuskodene i [statuses], én per kall, og logger URL-ene. */
function mockFetch(statuses: number[]) {
    const calls: string[] = [];
    let i = 0;
    globalThis.fetch = (async (url: string | URL) => {
        calls.push(String(url));
        const status = statuses[Math.min(i++, statuses.length - 1)];
        if (status === 200) {
            return new Response(JSON.stringify({ elements: [{ type: 'node', id: 1 }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        return new Response('', { status });
    }) as typeof fetch;
    return { calls };
}

test('500 retryes — det var 500 som feilet hele byer', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    const { fetchOverpass } = await load();
    const { calls } = mockFetch([500, 500, 200]);
    const elements = await fetchOverpass('[out:json];out;', 'test/ballbane');
    assert.equal(elements.length, 1);
    assert.equal(calls.length, 3, 'skal ha prøvd tre ganger, ikke gitt opp på første 500');
});

test('alle forbigående statuser er med i retry-settet', async () => {
    const { OVERPASS_RETRY_STATUS } = await load();
    for (const status of [429, 500, 502, 503, 504]) {
        assert.ok(OVERPASS_RETRY_STATUS.has(status), `${status} mangler`);
    }
});

test('retry veksler mellom speilene', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    const { fetchOverpass } = await load();
    const { calls } = mockFetch([500, 500, 200]);
    await fetchOverpass('[out:json];out;', 'test/ballbane');
    assert.ok(calls[0].includes('speil-a'), 'første forsøk på speil A');
    assert.ok(calls[1].includes('speil-b'), 'andre forsøk skal bytte speil');
    assert.ok(calls[2].includes('speil-a'), 'tredje går tilbake til A (runde 2)');
});

test('tre runder gir seks forsøk med to speil før det gis opp', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    const { fetchOverpass } = await load();
    const { calls } = mockFetch([503]);
    await assert.rejects(() => fetchOverpass('[out:json];out;', 'test/ballbane'));
    assert.equal(calls.length, 6, '2 speil × 3 runder');
});

test('faste feil (404) kastes umiddelbart uten retry', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    const { fetchOverpass } = await load();
    const { calls } = mockFetch([404]);
    await assert.rejects(() => fetchOverpass('[out:json];out;', 'test/ballbane'), /Overpass HTTP 404/);
    assert.equal(calls.length, 1, 'retry løser ikke en spørringsfeil');
});

// ---------------------------------------------------------------------------
// Argumentparsing — «--city Oslo» skal ikke lenger kjøre alle fire byene
// ---------------------------------------------------------------------------

test('--city=Oslo isolerer én by', async () => {
    const { parseArgs } = await load();
    assert.deepEqual(parseArgs(['--city=Oslo']).cities, ['Oslo']);
});

test('--city= tar også en kommaliste', async () => {
    const { parseArgs } = await load();
    assert.deepEqual(parseArgs(['--city=Oslo,Bergen']).cities, ['Oslo', 'Bergen']);
});

test('uten --city kjøres standardbyene', async () => {
    const { parseArgs } = await load();
    assert.equal(parseArgs([]).cities.length, 4);
});

test('«--city Oslo» med MELLOMROM avvises i stedet for å kjøre alle byene', async () => {
    const { parseArgs } = await load();
    // Den gamle parseren ignorerte dette i stillhet → full 4-by-kjøring mot prod.
    assert.throws(() => parseArgs(['--city', 'Oslo']), /Ukjent argument/);
    assert.throws(() => parseArgs(['--limit', '20']), /Ukjent argument/);
});

test('--dry-run, --limit= og --category= parses', async () => {
    const { parseArgs } = await load();
    const a = parseArgs(['--dry-run', '--limit=20', '--category=ballbane']);
    assert.equal(a.dryRun, true);
    assert.equal(a.limit, 20);
    assert.deepEqual(a.cats.map((c) => c.key), ['ballbane']);
});

test('ugyldig --limit= og ukjent kategori avvises', async () => {
    const { parseArgs } = await load();
    assert.throws(() => parseArgs(['--limit=0']), /positivt tall/);
    assert.throws(() => parseArgs(['--limit=abc']), /positivt tall/);
    assert.throws(() => parseArgs(['--category=fotballbane']), /Ukjent kategori/);
});
