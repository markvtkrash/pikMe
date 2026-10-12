// Pure helpers for the "forgot password" flow (email a 6-digit code, then set a new password). Kept free of the Supabase client so the
// rules can be tested.

export const RESET_CODE_LENGTH = 6;
export const RESEND_COOLDOWN_SECONDS = 60;
// Matches the customer sign-up field ("min 6 characters").
export const MIN_PASSWORD_LENGTH = 6;

export const RESET_REQUESTED_MESSAGE = "If that email has an account, we've sent a code. It can take a minute to arrive; check your spam folder too.";

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// Keeps only digits and caps the length, so a pasted "123 456" or "123-456" still works.
export function normalizeResetCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, RESET_CODE_LENGTH);
}

export function isCompleteResetCode(code: string): boolean {
  return new RegExp(`^\\d{${RESET_CODE_LENGTH}}$`).test(code);
}

// Seconds until another code may be requested; 0 when the button can be used. `sentAt` is when the last code was requested.
export function resendSecondsLeft(sentAt: number | null, now: number, cooldown: number = RESEND_COOLDOWN_SECONDS): number {
  if (sentAt === null) return 0;
  return Math.max(0, Math.ceil((sentAt + cooldown * 1000 - now) / 1000));
}

// First problem with the new password, or null when it is acceptable.
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}

interface AuthErrorLike { message?: string; status?: number; code?: string }

export function isRateLimitError(err: AuthErrorLike | null | undefined): boolean {
  if (!err) return false;
  return err.status === 429 || err.code === 'over_email_send_rate_limit' || err.code === 'over_request_rate_limit'
    || /rate limit|too many requests|after \d+ seconds?/i.test(err.message ?? '');
}

// Plain-language message for an error from sending the code, checking it or saving the new password.
export function resetErrorMessage(err: AuthErrorLike | null | undefined): string {
  if (!err) return 'Something went wrong. Please try again.';
  if (isRateLimitError(err)) return 'Too many attempts. Please wait a minute and try again.';
  const text = `${err.code ?? ''} ${err.message ?? ''}`.toLowerCase();
  if (text.includes('same_password') || text.includes('different from the old')) {
    return 'Please choose a password you have not used before.';
  }
  if (text.includes('weak')) {
    return 'That password is too easy to guess. Please choose a stronger one.';
  }
  if (text.includes('otp_expired') || text.includes('expired') || text.includes('invalid')) {
    return 'That code is wrong or has expired. Check the latest email, or request a new code.';
  }
  if (text.includes('network') || text.includes('failed to fetch')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return err.message || 'Something went wrong. Please try again.';
}
