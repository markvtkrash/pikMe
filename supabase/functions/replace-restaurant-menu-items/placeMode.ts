// Should this save go to the restaurant's own place-keyed menu, or to the shared name-keyed menu?
// (Pure, so it is unit tested; the function only gathers the facts.)
//
// An independent restaurant shows customers ONLY the items tied to its own place (migration 103), so every save for a
// claimed, non-franchise restaurant goes to its place. A franchise is never saved per place: it keeps one shared menu
// by chain name. (Items an owner or admin saved by name before this are moved onto their place by the tie script,
// migration 099, which is run before migration 103.)

export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

export function isValidPlaceId(value: unknown): value is string {
  return typeof value === 'string' && PLACE_ID_PATTERN.test(value);
}

export interface PlaceModeFacts {
  placeId: unknown;
  isChain: boolean;
}

export function decidePlaceMode(facts: PlaceModeFacts): string | null {
  if (!isValidPlaceId(facts.placeId) || facts.isChain) return null;
  return facts.placeId;
}
