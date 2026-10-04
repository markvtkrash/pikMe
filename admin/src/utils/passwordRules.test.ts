import * as client from './passwordRules';
// The copy the edge function actually enforces. Imported straight from the
// functions folder so any drift between the two shows up as a test failure.
import * as server from '../../../supabase/functions/admin-reset-owner-password/passwordRules';

const VALID = 'Abcdef1!';

// [password, expected error or null]
const CASES: [string, string | null][] = [
  [VALID, null],
  ['Zx9$Zx9$', null],
  ['Str0ng&LongerPassw0rd!', null],
  ['a'.repeat(0), 'Password is required'],
  ['Ab1!', 'Password must be at least 8 characters'],
  ['Abcde1!', 'Password must be at least 8 characters'], // 7 chars
  ['Abcdef1!' + 'x'.repeat(65), 'Password must be 72 characters or fewer'], // 73 chars
  ['Abcdef 1!', 'Password must not contain spaces'],
  [' Abcdef1!', 'Password must not contain spaces'],
  ['Abcdef1!\t', 'Password must not contain spaces'],
  ['abcdef1!', 'Password needs an uppercase letter'],
  ['ABCDEF1!', 'Password needs a lowercase letter'],
  ['Abcdefg!', 'Password needs a number'],
  ['Abcdefg1', 'Password needs a special character (e.g. ! @ # $ %)'],
];

describe.each([
  ['client (admin screen)', client],
  ['server (edge function)', server],
])('validateTemporaryPassword — %s', (_name, impl) => {
  it.each(CASES)('%j -> %j', (password, expected) => {
    expect(impl.validateTemporaryPassword(password)).toBe(expected);
  });

  it('accepts exactly 8 and exactly 72 characters', () => {
    expect(impl.validateTemporaryPassword('Abcdef1!')).toBeNull();
    expect(impl.validateTemporaryPassword('Abcdef1!' + 'x'.repeat(64))).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(impl.validateTemporaryPassword(undefined)).toBe('Password is required');
    expect(impl.validateTemporaryPassword(null)).toBe('Password is required');
    expect(impl.validateTemporaryPassword(12345678)).toBe('Password is required');
    expect(impl.validateTemporaryPassword({})).toBe('Password is required');
  });

  it('accepts every special character the owner change-password screen accepts', () => {
    for (const ch of '!@#$%^&*()_+-=[]{};\':"\\|,.<>/?'.split('')) {
      expect(impl.validateTemporaryPassword(`Abcdef1${ch}`)).toBeNull();
    }
  });
});

describe('client and server agree', () => {
  it('give the same answer for every case', () => {
    for (const [password] of CASES) {
      expect(client.validateTemporaryPassword(password)).toBe(server.validateTemporaryPassword(password));
    }
  });

  it('use the same length limits', () => {
    expect(client.MIN_PASSWORD_LENGTH).toBe(server.MIN_PASSWORD_LENGTH);
    expect(client.MAX_PASSWORD_LENGTH).toBe(server.MAX_PASSWORD_LENGTH);
  });
});

describe('passwordChecks (live checklist)', () => {
  const metLabels = (pw: string) => client.passwordChecks(pw).filter((c) => c.met).map((c) => c.label);

  it('has every item unmet for an empty password', () => {
    expect(client.passwordChecks('').every((c) => !c.met)).toBe(true);
  });

  it('has every item met for a valid password', () => {
    expect(client.passwordChecks(VALID).every((c) => c.met)).toBe(true);
  });

  it('is all met exactly when validateTemporaryPassword accepts', () => {
    for (const [password, expected] of CASES) {
      const allMet = client.passwordChecks(password).every((c) => c.met);
      expect(allMet).toBe(expected === null);
    }
  });

  it('flags a space and an over-long password', () => {
    expect(metLabels('Abcdef 1!')).not.toContain('No spaces');
    expect(metLabels('Abcdef1!' + 'x'.repeat(65))).not.toContain('8–72 characters');
  });
});

describe('generateTemporaryPassword (server)', () => {
  const LOOKALIKES = /[0O1lI]/;

  it('produces 14 characters by default and honors a custom length', () => {
    expect(server.generateTemporaryPassword()).toHaveLength(14);
    expect(server.generateTemporaryPassword(20)).toHaveLength(20);
  });

  it('always meets the strength rules (both copies)', () => {
    for (let i = 0; i < 300; i++) {
      const pw = server.generateTemporaryPassword();
      expect(server.validateTemporaryPassword(pw)).toBeNull();
      expect(client.validateTemporaryPassword(pw)).toBeNull();
    }
  });

  it('avoids look-alike characters (0/O, 1/l/I)', () => {
    for (let i = 0; i < 300; i++) {
      expect(server.generateTemporaryPassword()).not.toMatch(LOOKALIKES);
    }
  });

  it('is not repeated across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(server.generateTemporaryPassword());
    expect(seen.size).toBe(200);
  });

  it('puts the guaranteed characters in varying positions', () => {
    // The first character shouldn't always be the uppercase one.
    const firstIsUpper = Array.from({ length: 200 }, () => /[A-Z]/.test(server.generateTemporaryPassword()[0]));
    expect(firstIsUpper.some((v) => v)).toBe(true);
    expect(firstIsUpper.some((v) => !v)).toBe(true);
  });
});
