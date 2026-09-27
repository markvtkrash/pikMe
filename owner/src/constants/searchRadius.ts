import { getConfigNumber } from './appConfig';

// Fetch/cache is always done at the max radius once; the options below are a
// pure client-side filter on that already-fetched data, not separate fetches.
export const RADIUS_OPTIONS_KM = [2, 3, 4, 5];
export const MAX_FETCH_RADIUS_METERS = Math.max(...RADIUS_OPTIONS_KM) * 1000;

// Distance used by the restaurant-owner claim screen when searching by zip
// code or current location — independent of the customer-facing picker
// above. A function (not a plain constant) because its value can come from
// an async DB fetch (see appConfig.ts) — call it after loadAppConfig() has
// resolved (app/_layout.tsx guarantees that for anything it renders).
// Defaults to 5km if neither the DB row nor the .env var is set.
export function getOwnerSearchRadiusMeters(): number {
  return getConfigNumber('ownerSearchRadiusMeters', 'ownerSearchRadiusMeters', 5000);
}
