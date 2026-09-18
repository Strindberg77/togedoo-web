// app/api/steder/route.ts
//
// Stedsforslag til søket: «Geilo · tettsted i Hol – se hva som finnes i
// nærheten». Kilden er Kartverkets stedsnavn-API; appen kaller aldri
// Kartverket selv. Kontrakten står i docs/api-steder.md, logikken i
// lib/steder.ts.
//
// SVARER ALLTID 200. Stedsforslag er et tillegg til aktivitetssøket, ikke en
// forutsetning for det: er Kartverket tregt eller nede, er svaret en tom
// liste, og appen viser aktivitetstreffene alene. En 500 her ville bare
// flyttet en feil hos Kartverket inn i appen.
import { NextRequest, NextResponse } from 'next/server';
import {
    KARTVERKET_ATTRIBUTION,
    hentSteder,
    rankSteder,
    sanitizeStedQuery,
} from '../../../lib/steder';
import { parsePoint } from '../../../lib/activities-query';

function svar(data: unknown[], kilde: 'kartverket' | 'cache' | 'ingen' | 'utilgjengelig') {
    return NextResponse.json({
        success: true,
        data,
        count: data.length,
        // Hvor svaret kom fra. `utilgjengelig` betyr at Kartverket ikke svarte
        // i tide — lista er tom eller ufullstendig, og appen skal ikke lese
        // det som «stedet finnes ikke».
        kilde,
        attribution: KARTVERKET_ATTRIBUTION,
        timestamp: new Date().toISOString(),
    });
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const q = sanitizeStedQuery(searchParams.get('q'));
    // Under tre tegn: ingen kall. «Sk» ville gitt hundrevis av steder, og
    // ingen av dem er det brukeren leter etter ennå.
    if (!q) return svar([], 'ingen');

    // En ugyldig posisjon gjør ikke svaret ubrukelig — den gjør bare
    // avstanden ukjent. Derfor ignoreres den her, i motsetning til i
    // /api/activities, der en halv posisjon ville gitt feil rekkefølge.
    let posisjon: { lat: number; lng: number } | null = null;
    try {
        posisjon = parsePoint(searchParams.get('lat'), searchParams.get('lng'));
    } catch {
        posisjon = null;
    }

    try {
        const { steder, ok, fraCache } = await hentSteder(q);
        const data = rankSteder(steder, q, posisjon);
        return svar(data, !ok ? 'utilgjengelig' : fraCache ? 'cache' : 'kartverket');
    } catch (error) {
        // hentSteder kaster ikke, men rangeringen skal heller ikke kunne ta
        // ned et tillegg. Logges, og svaret er tomt.
        console.error('[steder]', error);
        return svar([], 'utilgjengelig');
    }
}
