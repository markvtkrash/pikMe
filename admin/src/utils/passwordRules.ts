// Validation for the temporary password an admin sets on an owner. Mirrors
// supabase/functions/admin-reset-owner-password/passwordRules.ts (which the edge
// function enforces); passwordRules.test.ts runs the same cases against both so
// they can't drift apart. The server is the real gate — this is for instant
// feedback in the dialog.

export const MIN_PASSWORD_LENGTH = 8;
// bcrypt (what Supabase Auth uses) ignores everything past 72 bytes.
export const MAX_PASSWORD_LENGTH = 72;

const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;

// Returns a human-readable problem, or null if the password is acceptable.
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

export interface PasswordCheck {
  label: string;
  met: boolean;
}

// The live checklist shown under the password field.
export function passwordChecks(password: string): PasswordCheck[] {
  return [
    {
      label: `${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters`,
      met: password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH,
    },
    { label: 'Uppercase letter (A-Z)', met: /[A-Z]/.test(password) },
    { label: 'Lowercase letter (a-z)', met: /[a-z]/.test(password) },
    { label: 'Number (0-9)', met: /[0-9]/.test(password) },
    { label: 'Special character (! @ # $ %)', met: SPECIAL_CHARS.test(password) },
    { label: 'No spaces', met: password.length > 0 && !/\s/.test(password) },
  ];
}
