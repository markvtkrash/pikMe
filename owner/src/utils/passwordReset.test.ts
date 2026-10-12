import {
  isValidEmail, normalizeResetCode, isCompleteResetCode, resendSecondsLeft, newPasswordProblem, isRateLimitError, resetErrorMessage,
  passwordRequirements, RESEND_COOLDOWN_SECONDS,
} from './passwordReset';

describe('isValidEmail', () => {
  it.each(['a@b.co', ' user@example.com ', 'first.last+tag@mail.example.org'])('accepts %j', (e) => expect(isValidEmail(e)).toBe(true));
  it.each(['', 'plain', 'a@b', 'a b@c.com', '@c.com'])('rejects %j', (e) => expect(isValidEmail(e)).toBe(false));
});

describe('normalizeResetCode', () => {
  it('keeps digits only and caps at 6', () => {
    expect(normalizeResetCode('123 456')).toBe('123456');
    expect(normalizeResetCode('12-34-56-78')).toBe('123456');
    expect(normalizeResetCode('ab12')).toBe('12');
    expect(normalizeResetCode('')).toBe('');
  });
});

describe('isCompleteResetCode', () => {
  it('needs exactly six digits', () => {
    expect(isCompleteResetCode('123456')).toBe(true);
    expect(isCompleteResetCode('12345')).toBe(false);
    expect(isCompleteResetCode('1234567')).toBe(false);
    expect(isCompleteResetCode('12345a')).toBe(false);
  });
});

describe('resendSecondsLeft', () => {
  it('is 0 before any code was sent', () => expect(resendSecondsLeft(null, 1000)).toBe(0));
  it('counts down from the cooldown and rounds up', () => {
    expect(resendSecondsLeft(0, 0)).toBe(RESEND_COOLDOWN_SECONDS);
    expect(resendSecondsLeft(0, 59_500)).toBe(1);
    expect(resendSecondsLeft(0, 60_000)).toBe(0);
    expect(resendSecondsLeft(0, 120_000)).toBe(0);
  });
});

describe('passwordRequirements / newPasswordProblem', () => {
  it('lists five rules and marks the ones met', () => {
    expect(passwordRequirements('')).toHaveLength(5);
    expect(passwordRequirements('Good1234!').every((r) => r.met)).toBe(true);
    expect(passwordRequirements('abc').filter((r) => r.met).map((r) => r.label)).toEqual(['Lowercase letter (a-z)']);
  });
  it('requires every rule, then a matching confirmation', () => {
    expect(newPasswordProblem('Sh0rt!', 'Sh0rt!')).toMatch(/requirements/);
    expect(newPasswordProblem('alllowercase1!', 'alllowercase1!')).toMatch(/requirements/);
    expect(newPasswordProblem('NoNumber!!', 'NoNumber!!')).toMatch(/requirements/);
    expect(newPasswordProblem('NoSpecial123', 'NoSpecial123')).toMatch(/requirements/);
    expect(newPasswordProblem('Good1234!', 'Good1234?')).toMatch(/do not match/);
    expect(newPasswordProblem('Good1234!', 'Good1234!')).toBeNull();
  });
});

describe('isRateLimitError / resetErrorMessage', () => {
  it('recognises rate limits by status, code or text', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ code: 'over_email_send_rate_limit' })).toBe(true);
    expect(isRateLimitError({ message: 'For security purposes, you can only request this after 42 seconds.' })).toBe(true);
    expect(isRateLimitError({ message: 'Token has expired or is invalid' })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
  it('explains a wrong or expired code', () => {
    expect(resetErrorMessage({ message: 'Token has expired or is invalid' })).toMatch(/wrong or has expired/);
    expect(resetErrorMessage({ code: 'otp_expired' })).toMatch(/wrong or has expired/);
  });
  it('explains rate limits, reused and weak passwords, and network failures', () => {
    expect(resetErrorMessage({ status: 429 })).toMatch(/wait a minute/);
    expect(resetErrorMessage({ code: 'same_password', message: 'New password should be different from the old password.' })).toMatch(/not used before/);
    expect(resetErrorMessage({ code: 'weak_password', message: 'Password is known to be weak' })).toMatch(/too easy/);
    expect(resetErrorMessage({ message: 'Failed to fetch' })).toMatch(/Could not reach/);
  });
  it('falls back to the original message, then to a generic one', () => {
    expect(resetErrorMessage({ message: 'Boom' })).toBe('Boom');
    expect(resetErrorMessage({})).toMatch(/Something went wrong/);
    expect(resetErrorMessage(null)).toMatch(/Something went wrong/);
  });
});
