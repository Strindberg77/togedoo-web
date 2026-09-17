// lib/places-typeord.test.ts
//
// Engelske typebetegnelser i OSM `name`. Egen fil fordi lib/places.test.ts
// mocker fetch for hele modulen; disse er rene funksjoner.
// Kjør: node --import tsx --test lib/places-typeord.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import { isEnglishTypeLabel, isUsablePlaceName } from './places';

test('«child ski area» er ikke et brukbart navn — way/55606470, Trysil', () => {
    assert.equal(isUsablePlaceName('child ski area'), false);
    assert.equal(isUsablePlaceName('Child Ski Area'), false, 'store bokstaver redder den ikke');
    assert.equal(isUsablePlaceName('  child ski area '), false);
});

test('andre rene typebetegnelser faller også', () => {
    for (const n of ['kids area', 'ski area', 'sledding area', 'beginner slope', 'children playground', 'ski-area', 'ski park area']) {
        assert.equal(isUsablePlaceName(n), false, n);
    }
});

test('ekte norske navn slipper gjennom — også de med typeord', () => {
    for (const n of [
        'Ski',                 // kommune
        'Voll', 'voll', 'bas', 'trafo', // målt i basen: små bokstaver, norske
        'Trysil', 'Geilolia', 'Alphapark', 'Høgegga',
        'Ski Geilo',           // «Geilo» er ikke typeord
        'Skiarea Hafjell',
        'Kids Arena',          // merkenavn: «Arena» er ikke typeord
        'Parkeringsplass Sjusjøen',
        'Lift',
        'Voss Resort Fjellheisar',
        '22. juli-senteret',
    ]) {
        assert.equal(isEnglishTypeLabel(n), false, n);
    }
    assert.equal(isUsablePlaceName('Ski'), true);
    assert.equal(isUsablePlaceName('Geilolia'), true);
});

test('et navn av bare DELTE ord er ikke en engelsk betegnelse', () => {
    assert.equal(isEnglishTypeLabel('ski park'), false, 'ingen rent engelske ord');
    assert.equal(isEnglishTypeLabel('Ski Lift'), false);
});
