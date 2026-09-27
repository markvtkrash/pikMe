import { getConfigNumber } from './appConfig';

// Distance used by the Create Restaurant Owner screen when searching by zip
// code or current location. Same real-world setting as the owner app's claim/
// relocate flows, so it shares the 'ownerSearchRadiusMeters' DB key/env extra
// key with owner/src/constants/searchRadius.ts — one DB row controls both
// apps consistently. A function (not a plain constant) because its value can
// come from an async DB fetch (see appConfig.ts) — call it after
// loadAppConfig() has resolved (app/_layout.tsx guarantees that for anything
// it renders). Defaults to 5000m if neither the DB row nor the .env var is set.
export function getOwnerSearchRadiusMeters(): number {
  return getConfigNumber('ownerSearchRadiusMeters', 'ownerSearchRadiusMeters', 5000);
}
