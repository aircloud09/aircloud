/**
 * Which dev room chair and which spot in each room every person last had,
 * kept for this tab, so seeing the office afresh (another session shown, a
 * reload) puts everyone back where they were instead of handing places out
 * in the order people happen to be listed.
 */

const PLACES_STORAGE = "agent-office:places";
/** Plenty for every person on a busy floor; the oldest are forgotten first. */
const MAX_REMEMBERED = 128;

/** The key of a person's chair (``room`` omitted) or of its spot in a room. */
export const placeKey = (id: string, room?: string): string =>
  room ? `${id}@${room}` : id;

const isEntry = (value: unknown): value is [string, number] =>
  Array.isArray(value) &&
  typeof value[0] === "string" &&
  Number.isInteger(value[1]);

/** The places remembered in this tab (none when storage is unavailable). */
export function rememberedPlaces(): Map<string, number> {
  try {
    const raw = sessionStorage.getItem(PLACES_STORAGE);
    const entries: unknown = raw ? JSON.parse(raw) : [];
    return new Map(Array.isArray(entries) ? entries.filter(isEntry) : []);
  } catch {
    return new Map();
  }
}

/** Note the place a person took, for this tab. */
export function rememberPlace(
  places: Map<string, number>,
  key: string,
  index: number,
): void {
  places.delete(key);
  places.set(key, index);
  for (const oldest of places.keys()) {
    if (places.size <= MAX_REMEMBERED) break;
    places.delete(oldest);
  }
  try {
    sessionStorage.setItem(PLACES_STORAGE, JSON.stringify([...places]));
  } catch {
    // Storage unavailable (private mode): the places last for this page only.
  }
}

/** Whether any chair or room spot is remembered for ``id``. */
export function remembersAnything(
  places: ReadonlyMap<string, number>,
  id: string,
): boolean {
  for (const key of places.keys()) {
    if (key === id || key.startsWith(`${id}@`)) return true;
  }
  return false;
}

/**
 * A place for a newcomer, of ``count`` in the order they are taken: the one
 * it last had while that is free, else the first free one; -1 when all are
 * taken.
 */
export function choosePlace(
  count: number,
  taken: ReadonlySet<number>,
  remembered: number | undefined,
): number {
  if (remembered !== undefined && remembered < count && !taken.has(remembered))
    return remembered;
  for (let index = 0; index < count; index++) {
    if (!taken.has(index)) return index;
  }
  return -1;
}
