// scripts/work-store.ts
//
// MELLOMLEDDET: hvor utdata fra hvert steg lagres mellom hent, berik og skriv.
//
// ─────────────────────────────────────────────────────────────────────────
// VALGET: FILER PÅ DISK, IKKE EN TABELL I SUPABASE
//
// Tre grunner, i vekt:
//
//  1. `--dry-run` skal ikke skrive til databasen. Lå mellomleddet i Supabase,
//     måtte tørrkjøringen enten bryte den regelen eller bruke en ANNEN
//     transportvei enn den ekte kjøringen — og da tester tørrkjøringen ikke
//     lenger den koden som faktisk kjører. Det alene avgjør spørsmålet.
//  2. Kostnad. ~39 500 objekter nasjonalt (osmium mot Geofabrik, sep. 2026)
//     ville blitt titusenvis av rundturer til Supabase for data som aldri
//     skal spørres på, bare leses sekvensielt av neste steg.
//  3. Migrasjon. En tabell krever en migrasjon og et opprydningsregime for
//     data som per definisjon er søppel etter at chunken er skrevet.
//
// PRISEN, og den er ekte: arbeidskatalogen er lokal. En kjøring startet på én
// maskin kan ikke gjenopptas på en annen. For en batchjobb som kjøres over
// natta på én maskin er det ingen kostnad; det ville vært det for en
// distribuert jobb, og da er en tabell riktig svar.
//
// ─────────────────────────────────────────────────────────────────────────
// FORMATET: NDJSON, ÉN LINJE PER ELEMENT
//
// Ikke ett stort JSON-array. Et array må være helt for å kunne parses, så en
// kjøring som dør under skrivingen etterlater en fil som ikke kan leses i det
// hele tatt. NDJSON mister bare den siste, halve linja — og den forkastes ved
// lesing. Den egenskapen er hele grunnen til at mellomleddet finnes.
//
// ─────────────────────────────────────────────────────────────────────────
// «FERDIG», IKKE «PÅBEGYNT»
//
// Hvert steg skriver til `<chunk>.<steg>.ndjson.tmp` og gjør deretter et
// atomisk `rename` til det endelige navnet. En halvskrevet fil heter alltid
// `.tmp` og blir aldri lest. FØRST etter renamet legges det til en linje i
// manifestet. Rekkefølgen er det som gjør forskjellen på de to tilstandene:
//
//   krasj før rename   → ingen fil, ingen manifestlinje  → steget kjøres om
//   krasj etter rename → fil, men ingen manifestlinje     → steget kjøres om
//   manifestlinje      → filen ER komplett
//
// Det er aldri mulig å ha en manifestlinje uten en komplett fil.
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    latestEntries,
    stageIsDone,
    type ImportChunk,
    type ManifestEntry,
    type StageName,
} from '../lib/import-chunks';

export interface WorkStore {
    /** Er steget ferdig fra før, med de samme forutsetningene? */
    isDone(chunk: ImportChunk, stage: StageName, fingerprint: string): boolean;
    /** Les et ferdig steg. Kaster hvis det ikke er ferdig. */
    read<T>(chunk: ImportChunk, stage: StageName): T[];
    /** Skriv steget og marker det ferdig. Atomisk: se filhodet. */
    write<T>(
        chunk: ImportChunk,
        stage: StageName,
        fingerprint: string,
        rows: readonly T[],
        extra?: Pick<ManifestEntry, 'seenClaims' | 'emptySets' | 'deduped' | 'settAntall'>
    ): void;
    /**
     * Skriver en SIDEFIL som ikke er et steg: den havner ikke i manifestet og
     * påvirker ikke [isDone]. Brukes til `<chunk>.before.ndjson`, settet av
     * external_id-er som fantes FØR bolken — data for en eventuell angring,
     * ikke et resultat noen skal gjenoppta fra.
     */
    writeSidecar<T>(chunk: ImportChunk, name: string, rows: readonly T[]): void;
    /** Hele manifestet, siste oppføring per (chunk, steg). */
    entries(): ReadonlyMap<string, ManifestEntry>;
    /** Menneskelig beskrivelse til logg. */
    describe(): string;
}

/**
 * Ingen lagring: stegene sender data videre i minnet, akkurat som før sømmen.
 *
 * DETTE ER STANDARD. Uten `--work` skriver importen ingen nye filer noe sted,
 * og en tørrkjøring rører fortsatt ingenting — kravet om ingen
 * oppførselsendring er da oppfylt bokstavelig, ikke omtrentlig.
 */
export class NullStore implements WorkStore {
    isDone(): boolean {
        return false;
    }
    read<T>(chunk: ImportChunk, stage: StageName): T[] {
        throw new Error(
            `Ingen arbeidskatalog: steget «${stage}» for ${chunk.id} finnes ikke lagret. ` +
                `Kjør med --work for å lagre mellomresultater.`
        );
    }
    write(): void {
        /* med vilje tom */
    }
    writeSidecar(): void {
        /* med vilje tom */
    }
    entries(): ReadonlyMap<string, ManifestEntry> {
        return new Map();
    }
    describe(): string {
        return 'ingen (mellomresultater holdes i minnet)';
    }
}

export const MANIFEST_FILE = 'manifest.ndjson';

export class FileStore implements WorkStore {
    private readonly latest: Map<string, ManifestEntry>;

    constructor(private readonly dir: string) {
        fs.mkdirSync(dir, { recursive: true });
        this.latest = latestEntries(readManifest(path.join(dir, MANIFEST_FILE)));
    }

    private file(chunk: ImportChunk, stage: StageName): string {
        return path.join(this.dir, `${chunk.id}.${stage}.ndjson`);
    }

    isDone(chunk: ImportChunk, stage: StageName, fp: string): boolean {
        // Manifestlinja er sannheten, men fila må faktisk finnes: sletter noen
        // arbeidskatalogen delvis, skal steget kjøres om, ikke kaste.
        return stageIsDone(this.latest, chunk, stage, fp) && fs.existsSync(this.file(chunk, stage));
    }

    read<T>(chunk: ImportChunk, stage: StageName): T[] {
        const f = this.file(chunk, stage);
        if (!fs.existsSync(f)) {
            throw new Error(`Mangler mellomresultat: ${f}`);
        }
        return parseNdjson<T>(fs.readFileSync(f, 'utf8'));
    }

    write<T>(
        chunk: ImportChunk,
        stage: StageName,
        fingerprint: string,
        rows: readonly T[],
        extra?: Pick<ManifestEntry, 'seenClaims' | 'emptySets' | 'deduped' | 'settAntall'>
    ): void {
        const final = this.file(chunk, stage);
        const tmp = `${final}.tmp`;
        // Én linje per element, så en avbrutt skriving mister én linje og ikke
        // hele fila.
        fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
        fs.renameSync(tmp, final); // atomisk innenfor samme filsystem
        const entry: ManifestEntry = {
            chunkId: chunk.id,
            stage,
            fingerprint,
            count: rows.length,
            at: new Date().toISOString(),
            ...(extra?.seenClaims ? { seenClaims: extra.seenClaims } : {}),
            ...(extra?.emptySets ? { emptySets: extra.emptySets } : {}),
            // `deduped` STO I Pick-TYPEN MEN BLE ALDRI SPREDT HIT (okt. 2026).
            // Kalleren sendte den, typen godtok den, og den forsvant i
            // stillhet — så `entry?.deduped` ved --resume var alltid
            // undefined, og dedup-rapporten for en gjenopptatt chunk var tom
            // uten at noe feilet. Testen under fester begge feltene.
            ...(extra?.deduped ? { deduped: extra.deduped } : {}),
            ...(extra?.settAntall ? { settAntall: extra.settAntall } : {}),
        };
        // Append ETTER renamet. Se filhodet: denne rekkefølgen er det som
        // gjør at en manifestlinje aldri kan peke på en halv fil.
        fs.appendFileSync(path.join(this.dir, MANIFEST_FILE), JSON.stringify(entry) + '\n');
        this.latest.set(`${chunk.id}/${stage}`, entry);
    }

    writeSidecar<T>(chunk: ImportChunk, name: string, rows: readonly T[]): void {
        const final = path.join(this.dir, `${chunk.id}.${name}.ndjson`);
        const tmp = `${final}.tmp`;
        fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
        fs.renameSync(tmp, final);
    }

    entries(): ReadonlyMap<string, ManifestEntry> {
        return this.latest;
    }

    describe(): string {
        return this.dir;
    }
}

/** Leser en NDJSON-logg og HOPPER OVER en siste, halv linje. Det er den
 *  normale tilstanden etter en krasj, ikke en feil. */
export function parseNdjson<T>(text: string): T[] {
    const ut: T[] = [];
    for (const linje of text.split('\n')) {
        const t = linje.trim();
        if (!t) continue;
        try {
            ut.push(JSON.parse(t) as T);
        } catch {
            // Halv linje fra en avbrutt skriving. Kan bare være den siste;
            // er den det ikke, er fila ødelagt på en måte vi uansett ikke kan
            // reparere, og å ta med resten er bedre enn å kaste alt.
        }
    }
    return ut;
}

function readManifest(file: string): ManifestEntry[] {
    if (!fs.existsSync(file)) return [];
    return parseNdjson<ManifestEntry>(fs.readFileSync(file, 'utf8'));
}
