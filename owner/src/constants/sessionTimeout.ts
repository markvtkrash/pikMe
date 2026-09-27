import { getConfigNumber } from './appConfig';

// Idle-logout timeout, in minutes — resets on any mouse/keyboard/touch
// activity; auto-signs-out when it elapses with none. A function (not a
// plain constant) because its value can come from an async DB fetch (see
// appConfig.ts) — call it after loadAppConfig() has resolved (app/_layout.tsx
// guarantees that for anything it renders). Defaults to 30 if neither the DB
// row nor the .env var is set. Deliberately a separate DB key/env var per
// app (owner vs admin), since each app's idle timeout can differ.
export function getSessionTimeoutMinutes(): number {
  return getConfigNumber('ownerSessionTimeoutMinutes', 'sessionTimeoutMinutes', 30);
}
