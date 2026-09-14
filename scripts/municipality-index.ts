// scripts/municipality-index.ts
//
// Laster grensefila ÉN gang og bygger oppslaget.
//
// Skilt fra lib/municipality.ts fordi den modulen er ren og ikke skal kjenne
// filsystemet — den tar et parset GeoJSON og gir et oppslag. Denne fila er
// limet, og den hører til skriptene, ikke til lib.
//
// LAT: 10,3 MB JSON parses først når noen faktisk trenger en kommune. En
// kjøring der chunken har `cityAnchor` (per-kommune-modus, altså alt vi har
// gjort til nå) rører aldri fila.
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    buildMunicipalityIndex,
    type KommuneFeature,
    type MunicipalityIndex,
} from '../lib/municipality';

export const MUNICIPALITY_FILE = path.join(process.cwd(), 'data', 'kommuner.geojson');

let cached: MunicipalityIndex | null = null;

export function municipalityIndex(file = MUNICIPALITY_FILE): MunicipalityIndex {
    if (cached) return cached;
    if (!fs.existsSync(file)) {
        throw new Error(
            `Mangler grensefila ${file}. Den trengs for å utlede municipality når ` +
                `chunken dekker mer enn én kommune. Se data/README.md.`
        );
    }
    const features: KommuneFeature[] = JSON.parse(fs.readFileSync(file, 'utf8')).features;
    cached = buildMunicipalityIndex(features);
    return cached;
}

/** Kun for test: tvinger ny innlasting. */
export function resetMunicipalityIndex(): void {
    cached = null;
}
