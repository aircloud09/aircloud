/**
 * What a person resting in the lounge does (docs/plan/spec.md 「라운지 ·
 * 카페」): rather than sit still it has a coffee, looks at its phone, reads
 * a book and watches TV in turn, and after a long rest it dozes off.
 */

export type LoungeAct = "coffee" | "phone" | "book" | "tv" | "doze";

/** How long each pastime lasts before the next (ms). */
export const LOUNGE_ACT_MS = 25_000;
/** Idle this long since the last event, it dozes off (ms). */
export const DOZE_AFTER_MS = 5 * 60_000;

const PASTIMES: readonly LoungeAct[] = ["coffee", "phone", "book", "tv"];

/** The pastime for ``idleMs`` into a rest: one after another, then a doze. */
export function loungeAct(idleMs: number): LoungeAct {
  if (idleMs >= DOZE_AFTER_MS) return "doze";
  const turn = Math.floor(Math.max(0, idleMs) / LOUNGE_ACT_MS);
  return PASTIMES[turn % PASTIMES.length];
}
