// app/api/kart/route.ts
//
// Hele kartutsnittet: totalen, og enten alle stedene eller klynger. Kontrakt:
// docs/api-kart.md. Logikken i lib/kart.ts og SQL-funksjonen activities_map
// (migrasjon 0018).
//
// Et eget endepunkt, ikke en modus i /api/activities: svaret har en annen
// form (klynger, ikke rader) og ingen blaing. Lista i arket under kartet
// bruker fortsatt /api/activities med bbox + lat/lng + cursor — nærmest
// brukeren først, med blaing, uendret.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { QueryParamError, parsePoint } from '../../../lib/activities-query';
import {
    KART_TERSKEL,
    formKartSvar,
    parseKartBbox,
    rutenettFor,
    type KartRpcSvar,
} from '../../../lib/kart';
import { categoryFacetsFor } from '../../../lib/facets';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const bbox = parseKartBbox(searchParams.get('bbox'));
        const point = parsePoint(searchParams.get('lat'), searchParams.get('lng'));
        const kind = searchParams.get('kind');
        const categories = (searchParams.get('category') ?? '')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
        const grid = rutenettFor(bbox);

        const { data, error } = await supabaseAdmin().rpc('activities_map', {
            p_west: bbox.west,
            p_south: bbox.south,
            p_east: bbox.east,
            p_north: bbox.north,
            p_kind: kind,
            p_categories: categories.length > 0 ? categories : null,
            // Dyreparken under Fornøyelsespark, Trysil under Aking. null når
            // ingen valgt kategori har en fasett. Regelen: lib/facets.ts.
            p_category_facets: categoryFacetsFor(categories),
            p_cols: grid.kolonner,
            p_rows: grid.rader,
            p_threshold: KART_TERSKEL,
            p_lat: point?.lat ?? null,
            p_lng: point?.lng ?? null,
        });
        if (error) throw new Error(error.message);
        return NextResponse.json(formKartSvar(data as KartRpcSvar, bbox, grid));
    } catch (error) {
        if (error instanceof QueryParamError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        console.error('[kart]', error);
        return NextResponse.json(
            { success: false, error: 'Kunne ikke hente kartet' },
            { status: 500 }
        );
    }
}
