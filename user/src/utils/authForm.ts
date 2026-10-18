// The checks and wording for the one sign-in / create-account form (email and password, with two buttons). Pure, so they can be tested.
import { isValidEmail } from './passwordReset';

export const MIN_PASSWORD_LENGTH = 6;

export const ENTER_BOTH_MESSAGE = 'Please enter your email and password.';
export const ENTER_EMAIL_MESSAGE = 'Please enter your email.';
export const ENTER_PASSWORD_MESSAGE = 'Please enter your password.';
export const INVALID_EMAIL_MESSAGE = 'Please enter a valid email address, like name@example.com.';
export const SHORT_PASSWORD_MESSAGE = `Your password needs at least ${MIN_PASSWORD_LENGTH} characters.`;

// A problem with the form: what to tell the person, and which box to put the cursor in.
export type FormField = 'email' | 'password';
export interface FormProblem {
  message: string;
  field: FormField;
  // true when something was simply left empty (as opposed to being typed wrong)
  missing: boolean;
}

/** What both buttons need: an email and a password, and the email must look like one. Null when fine. Nothing typed at all points at the email box
 *  first; a missing password points at the password box. */
export function validateCredentials(email: string, password: string): FormProblem | null {
  const noEmail = !email.trim();
  const noPassword = !password;
  if (noEmail && noPassword) return { message: ENTER_BOTH_MESSAGE, field: 'email', missing: true };
  if (noEmail) return { message: ENTER_EMAIL_MESSAGE, field: 'email', missing: true };
  if (!isValidEmail(email)) return { message: INVALID_EMAIL_MESSAGE, field: 'email', missing: false };
  if (noPassword) return { message: ENTER_PASSWORD_MESSAGE, field: 'password', missing: true };
  return null;
}

/** Signing in: the shared checks only. */
export function validateSignIn(email: string, password: string): FormProblem | null {
  return validateCredentials(email, password);
}

/** Creating an account: the shared checks and a long enough password. Null when fine. The agreement is asked for in a popup AFTER these pass
 *  (see AGREEMENT_DOCUMENTS), so a typo is fixed before the person is asked to agree to anything. */
export function validateRegister(email: string, password: string): FormProblem | null {
  const shared = validateCredentials(email, password);
  if (shared) return shared;
  if (password.length < MIN_PASSWORD_LENGTH) return { message: SHORT_PASSWORD_MESSAGE, field: 'password', missing: false };
  return null;
}

// Create Account pressed with the email or the password left empty: a popup (not just a line on the form) says what is needed, in one line, and the
// cursor goes to the empty box when it is closed.
export const CREATE_NEEDS_TITLE = 'Email and password needed to create an account';

// The documents a person agrees to when they create an account, in the order they are listed in the popup and recorded after sign-up.
export const AGREEMENT_DOCUMENTS = [
  { type: 'privacy_policy', label: 'Privacy Policy' },
  { type: 'terms_of_service', label: 'Terms of Service' },
  { type: 'food_disclaimer', label: 'Food Disclaimer' },
] as const;

export const AGREEMENT_VERSION = '1.0';

export const AGREEMENT_TITLE = 'Before you create your account';
export const AGREEMENT_INTRO = 'Please read and agree to continue.';
export const AGREEMENT_BUTTON = 'I Agree, Create Account';

// The live legal pages (markvtkrash.com) — shared with Help so there is one definition
// instead of two drifting copies.
export const LEGAL_LINKS = {
  privacy: 'https://www.markvtkrash.com/legal/privacy',
  terms: 'https://www.markvtkrash.com/legal/terms',
  disclaimer: 'https://www.markvtkrash.com/legal/food-disclaimer',
  support: 'mailto:support@markvtkrash.com',
};

/** The message to show after a failed sign-in. The server's "Invalid login credentials" is the same whether the email has no account or the
 *  password is wrong, so it gets a hint that points to Create Account. Any other message is shown as it is. */
export function signInErrorMessage(serverMessage: string | null | undefined): string {
  const m = (serverMessage ?? '').trim();
  if (!m) return 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(m)) {
    return 'That email and password did not match. No account yet? Tap Create Account.';
  }
  return m;
}

/** After "Create Account" succeeds but no session came back, the person has to confirm their email first. */
export const CHECK_EMAIL_MESSAGE = 'Account created! Check your email for a confirmation link, or sign in if auto-confirm is enabled.';
