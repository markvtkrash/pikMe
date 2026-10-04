// Rules and generator for the temporary password an admin sets on an owner.
// Pure (no Deno or network imports) so it can be unit-tested.
//
// admin/src/utils/passwordRules.ts holds the same validation for the admin
// screen; passwordRules.test.ts in the admin app runs the same cases against
// both copies so they can't drift apart.

export const MIN_PASSWORD_LENGTH = 8;
// bcrypt (what Supabase Auth uses) ignores everything past 72 bytes.
export const MAX_PASSWORD_LENGTH = 72;

const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;

// Returns a human-readable problem, or null if the password is acceptable.
// Same strength rules the owner's own change-password screen enforces, plus
// no whitespace (it gets read out or pasted, and stray spaces cause grief).
export function validateTemporaryPassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'Password is required';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`;
  if (/\s/.test(password)) return 'Password must not contain spaces';
  if (!/[A-Z]/.test(password)) return 'Password needs an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password needs a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password needs a number';
  if (!SPECIAL_CHARS.test(password)) return 'Password needs a special character (e.g. ! @ # $ %)';
  return null;
}

// Strong random password from a CSPRNG. At least one of each character class,
// no look-alike characters (0/O, 1/l/I) so it is easy to read out to an owner.
export function generateTemporaryPassword(length = 14): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const special = '!@#$%^&*';
  const all = upper + lower + nums + special;

  const randomInt = (max: number) => {
    // Rejection sampling so the result is unbiased.
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do {
      crypto.getRandomValues(buf);
    } while (buf[0] >= limit);
    return buf[0] % max;
  };
  const pick = (set: string) => set[randomInt(set.length)];

  const chars = [pick(upper), pick(lower), pick(nums), pick(special)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
