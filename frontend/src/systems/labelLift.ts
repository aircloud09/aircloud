/**
 * When people crowd together (neighbouring desks, one room), their name
 * chips and bubbles cover each other. Each person's chip and bubble move as
 * one box: the one lowest on the screen, nearest the viewer, stays put, and
 * any box over a nearer one is lifted just clear of it. One that cannot be
 * lifted clear without floating away from its person keeps only its chip,
 * or shows nothing when even that cannot (the Office list still names
 * everyone and says what each is doing).
 */

/** A person's chip and the bubble over it, as drawn unlifted (px). */
export interface LabelBox {
  id: string;
  /** The bottom centre of the chip, where the person's head is. */
  x: number;
  y: number;
  chip: { width: number; height: number };
  /** How wide and how far over the chip's bottom it reaches; null with none. */
  bubble: { width: number; height: number } | null;
}

/** Where to draw a person's chip and bubble, and which of them. */
export interface Lift {
  /** How far up (px). */
  by: number;
  /** "chip" leaves the bubble out, "none" both: lifted they would still cover a nearer one. */
  show: "all" | "chip" | "none";
}

/** Space kept between a lifted box and the one under it (px). */
const LIFT_GAP = 4;
/** Lifted further than this, a box would float away from its person (px). */
export const MAX_LIFT = 160;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectOf(box: LabelBox, withBubble: boolean): Rect {
  const bubble = withBubble ? box.bubble : null;
  const half = Math.max(box.chip.width, bubble?.width ?? 0) / 2;
  const tall = bubble ? bubble.height : box.chip.height;
  return {
    left: box.x - half,
    right: box.x + half,
    top: box.y - tall,
    bottom: box.y,
  };
}

const overlaps = (a: Rect, b: Rect, lift: number): boolean =>
  a.left < b.right &&
  b.left < a.right &&
  a.top - lift < b.bottom &&
  b.top < a.bottom - lift;

/** How far up ``rect`` must go to clear every placed one; null past MAX_LIFT. */
function liftClear(rect: Rect, placed: Rect[]): number | null {
  let lift = 0;
  for (;;) {
    const under = placed.find((other) => overlaps(rect, other, lift));
    if (!under) return lift;
    lift = rect.bottom - under.top + LIFT_GAP;
    if (lift > MAX_LIFT) return null;
  }
}

/** Where to draw each person's chip and bubble so none covers a nearer one. */
export function liftLabels(boxes: LabelBox[]): Map<string, Lift> {
  const nearestFirst = [...boxes].sort(
    (a, b) => b.y - a.y || a.id.localeCompare(b.id),
  );
  const lifts = new Map<string, Lift>();
  const placed: Rect[] = [];
  for (const box of nearestFirst) {
    const tries: [Lift["show"], Rect][] = box.bubble
      ? [
          ["all", rectOf(box, true)],
          ["chip", rectOf(box, false)],
        ]
      : [["all", rectOf(box, false)]];
    const fit = tries
      .map(([show, rect]) => ({ show, rect, by: liftClear(rect, placed) }))
      .find((each) => each.by !== null);
    if (!fit || fit.by === null) {
      lifts.set(box.id, { by: 0, show: "none" });
      continue;
    }
    lifts.set(box.id, { by: fit.by, show: fit.show });
    placed.push({
      ...fit.rect,
      top: fit.rect.top - fit.by,
      bottom: fit.rect.bottom - fit.by,
    });
  }
  return lifts;
}
