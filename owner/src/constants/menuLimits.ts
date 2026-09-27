import { getConfigNumber } from './appConfig';

// Edit Menu's "+ Add another item" cap — a plain client-side safety limit,
// not a database constraint. A function (not a plain constant) because its
// value can come from an async DB fetch (see appConfig.ts) — call it after
// loadAppConfig() has resolved (app/_layout.tsx guarantees that for anything
// it renders). Defaults to 100 if neither the DB row nor the .env var is set.
export function getMaxManualMenuItems(): number {
  return getConfigNumber('maxManualMenuItems', 'maxManualMenuItems', 100);
}
