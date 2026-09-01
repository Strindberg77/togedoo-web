// scripts/import-places.test.ts
// Enhetstester for fase B: den utvidede ball-/racketsport-selektoren og den
// sport-avledede tittel-etiketten. Ingen nettverk, ingen database — rene
// funksjoner og en strengsjekk på selektoren.
// Kjør: node --import tsx --test scripts/import-places.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PLACE_CATEGORIES, ballTitleLabel } from './import-places';

const ballbane = PLACE_CATEGORIES.find((c) => c.key === 'ballbane')!;

test('selektoren henter alle seks sportene', () => {
    for (const sport of ['soccer', 'basketball', 'multi', 'tennis', 'volleyball', 'handball']) {
        assert.ok(
            ballbane.selector.includes(sport),
            `${sport} mangler i selektoren`
        );
    }
});

test('selektoren er fortsatt begrenset til offentlige pitcher', () => {
    assert.ok(ballbane.selector.includes('"leisure"="pitch"'));
    assert.ok(ballbane.selector.includes('["access"!="private"]'));
});

test('kategoriverdien er uendret — «Ballbane» er databasenøkkelen', () => {
    assert.equal(ballbane.category, 'Ballbane');
    assert.equal(ballbane.label, 'Ballbane');
});

test('sport-spesifikke tittel-etiketter', () => {
    assert.equal(ballTitleLabel('tennis'), 'Tennisbane');
    assert.equal(ballTitleLabel('table_tennis'), 'Bordtennisbord');
    assert.equal(ballTitleLabel('volleyball'), 'Volleyballbane');
    assert.equal(ballTitleLabel('handball'), 'Håndballbane');
});

test('bordtennis blir ALDRI «Tennisbane» (understreng-fella)', () => {
    // Mønstrene er ankret, så «table_tennis» treffer aldri /^tennis$/.
    assert.equal(ballTitleLabel('table_tennis'), 'Bordtennisbord');
    assert.equal(ballTitleLabel('tabletennis'), 'Bordtennisbord');
    assert.equal(ballTitleLabel('table-tennis'), 'Bordtennisbord');
});

test('beach-varianter faller inn under hovedsporten', () => {
    assert.equal(ballTitleLabel('beachvolleyball'), 'Volleyballbane');
    assert.equal(ballTitleLabel('beach_volleyball'), 'Volleyballbane');
    assert.equal(ballTitleLabel('beachhandball'), 'Håndballbane');
});

test('generiske ballsporter gir «Ballbane»', () => {
    assert.equal(ballTitleLabel('soccer'), 'Ballbane');
    assert.equal(ballTitleLabel('basketball'), 'Ballbane');
    assert.equal(ballTitleLabel('multi'), 'Ballbane');
});

test('semikolonliste: generisk vinner over spesifikk', () => {
    // «tennis;soccer» er i praksis en flerbruksflate — «Ballbane» er ærligst.
    assert.equal(ballTitleLabel('tennis;soccer'), 'Ballbane');
    assert.equal(ballTitleLabel('multi;handball'), 'Ballbane');
    // … men en ren spesifikk liste beholder sporten.
    assert.equal(ballTitleLabel('tennis;volleyball'), 'Tennisbane');
});

test('flersports-tagg: største anlegg navngir stedet', () => {
    // Prioritet tennis > volleyball > håndball > bordtennis. Et bord er det
    // minst definerende anlegget, så det taper mot alle de andre.
    assert.equal(ballTitleLabel('tennis;table_tennis'), 'Tennisbane');
    assert.equal(ballTitleLabel('table_tennis;volleyball'), 'Volleyballbane');
    assert.equal(ballTitleLabel('handball;table_tennis'), 'Håndballbane');
});

test('ukjent eller manglende sport faller trygt til «Ballbane»', () => {
    assert.equal(ballTitleLabel(undefined), 'Ballbane');
    assert.equal(ballTitleLabel(''), 'Ballbane');
    assert.equal(ballTitleLabel('cricket'), 'Ballbane');
});

test('etiketten er per element — kun ballbane har overstyring', () => {
    assert.equal(ballbane.titleLabelFor?.({ sport: 'tennis' }), 'Tennisbane');
    for (const cat of PLACE_CATEGORIES.filter((c) => c.key !== 'ballbane')) {
        assert.equal(cat.titleLabelFor, undefined, `${cat.key} skal bruke label`);
    }
});
