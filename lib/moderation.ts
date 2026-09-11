// lib/moderation.ts
// Tilstandsovergangene bak POST /api/admin/moderate, skilt ut fra ruten fordi
// en Next.js route-fil ikke kan eksportere annet enn HTTP-metodene sine — og
// dermed heller ikke testes.
//
// Bakgrunn (hull 2 i docs/arrangementer-og-betalende-aktorer.md): ruten hadde
// .eq('status','pending') hardkodet i update-en, så den traff aldri en
// publisert rad. Eneste vei til nedtaking gikk via PATCH /api/admin/reports med
// action='fjern_sted', og den krever en eksisterende rad i place_reports.
// Ringer en arrangør kl. 20 om en avlyst forestilling, fantes det ingen vei
// utenom SQL-editoren.
//
// Gyldige status-verdier er låst av check-constrainten i migrasjon 0001:
// ('pending','published','rejected','expired'). 'unpublish' lander derfor på
// 'rejected' — samme verdi som rapport-nedtakingen bruker — og ikke på en ny
// status som ville krevd migrasjon.

export type ActivityStatus = 'pending' | 'published' | 'rejected' | 'expired';

export type ModerationAction = 'publish' | 'reject' | 'unpublish';

export interface ModerationTransition {
    /** Statusene handlingen har lov til å gå fra. Alt annet gir 404. */
    readonly from: readonly ActivityStatus[];
    readonly to: ActivityStatus;
    /**
     * locked=true betyr «import-jobben skal aldri røre denne igjen»
     * (scripts/import-places.ts og lib/ingest.ts hopper over den).
     *
     * Nedtaking setter den, av samme grunn som action='fjern_sted' gjør det:
     * uten låsen er raden publisert igjen ved neste synk. Publisering FRIGIR
     * den tilsvarende — sier admin at raden er god, skal pipelinen eie den
     * igjen. For pending-veien er det en nulloperasjon (nye innsendinger har
     * locked=false), så eksisterende oppførsel er uendret.
     */
    readonly lock: boolean;
}

export const MODERATION_TRANSITIONS: Record<ModerationAction, ModerationTransition> = {
    // 'rejected' er med som kilde slik at en feilaktig nedtaking kan angres
    // uten SQL-editoren — det er hele poenget med endringen.
    publish: { from: ['pending', 'rejected'], to: 'published', lock: false },
    reject: { from: ['pending'], to: 'rejected', lock: false },
    unpublish: { from: ['published'], to: 'rejected', lock: true },
};

export const MODERATION_ACTIONS = Object.keys(MODERATION_TRANSITIONS) as ModerationAction[];

export function parseModerationAction(raw: unknown): ModerationAction | null {
    return typeof raw === 'string' && (MODERATION_ACTIONS as string[]).includes(raw)
        ? (raw as ModerationAction)
        : null;
}

/** Feilteksten når ingen rad matchet — nevner statusene handlingen godtar. */
export function noMatchMessage(action: ModerationAction): string {
    const { from } = MODERATION_TRANSITIONS[action];
    return `Fant ingen aktivitet med den id-en i status ${from.join(' eller ')}.`;
}
