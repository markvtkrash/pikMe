import {
  AGREEMENT_BUTTON, AGREEMENT_DOCUMENTS, AGREEMENT_INTRO, AGREEMENT_TITLE, AGREEMENT_VERSION, CREATE_NEEDS_TITLE, ENTER_BOTH_MESSAGE, ENTER_EMAIL_MESSAGE, ENTER_PASSWORD_MESSAGE, INVALID_EMAIL_MESSAGE,
  MIN_PASSWORD_LENGTH, SHORT_PASSWORD_MESSAGE, signInErrorMessage, validateCredentials, validateRegister, validateSignIn,
} from './authForm';

describe('validateCredentials', () => {
  it('nothing typed: asks for both and points at the email box', () => {
    expect(validateCredentials('', '')).toEqual({ message: ENTER_BOTH_MESSAGE, field: 'email', missing: true });
    expect(validateCredentials('   ', '')).toEqual({ message: ENTER_BOTH_MESSAGE, field: 'email', missing: true });
  });
  it('no email: asks for the email and points at the email box', () => {
    expect(validateCredentials('', 'secret1')).toEqual({ message: ENTER_EMAIL_MESSAGE, field: 'email', missing: true });
    expect(validateCredentials('   ', 'secret1')).toEqual({ message: ENTER_EMAIL_MESSAGE, field: 'email', missing: true });
  });
  it('an email but no password: asks for the password and points at the password box', () => {
    expect(validateCredentials('a@b.com', '')).toEqual({ message: ENTER_PASSWORD_MESSAGE, field: 'password', missing: true });
  });
  it('an email that does not look like one: points at the email box, even with no password yet', () => {
    expect(validateCredentials('not-an-email', 'secret1')).toEqual({ message: INVALID_EMAIL_MESSAGE, field: 'email', missing: false });
    expect(validateCredentials('a@b', 'secret1')).toEqual({ message: INVALID_EMAIL_MESSAGE, field: 'email', missing: false });
    expect(validateCredentials('not-an-email', '')).toEqual({ message: INVALID_EMAIL_MESSAGE, field: 'email', missing: false });
  });
  it('accepts a good pair, and an email with spaces around it', () => {
    expect(validateCredentials('name@example.com', 'x')).toBeNull();
    expect(validateCredentials('  name@example.com  ', 'x')).toBeNull();
  });
  it('each message is short and plain', () => {
    for (const m of [ENTER_BOTH_MESSAGE, ENTER_EMAIL_MESSAGE, ENTER_PASSWORD_MESSAGE, INVALID_EMAIL_MESSAGE]) expect(m.length).toBeLessThanOrEqual(70);
  });
});

describe('validateSignIn', () => {
  it('asks only for the shared things: a short password is not an error when signing in', () => {
    expect(validateSignIn('name@example.com', 'a')).toBeNull();
  });
  it('does not need the agreement', () => {
    expect(validateSignIn('name@example.com', 'secret1')).toBeNull();
  });
  it('still refuses missing or bad input, pointing at the right box', () => {
    expect(validateSignIn('', 'x')).toEqual({ message: ENTER_EMAIL_MESSAGE, field: 'email', missing: true });
    expect(validateSignIn('bad', 'x')).toEqual({ message: INVALID_EMAIL_MESSAGE, field: 'email', missing: false });
    expect(validateSignIn('a@b.com', '')).toEqual({ message: ENTER_PASSWORD_MESSAGE, field: 'password', missing: true });
  });
});

describe('validateRegister', () => {
  it('needs the shared things first, pointing at the same boxes', () => {
    expect(validateRegister('', '')).toEqual({ message: ENTER_BOTH_MESSAGE, field: 'email', missing: true });
    expect(validateRegister('bad', 'secret1')).toEqual({ message: INVALID_EMAIL_MESSAGE, field: 'email', missing: false });
    expect(validateRegister('name@example.com', '')).toEqual({ message: ENTER_PASSWORD_MESSAGE, field: 'password', missing: true });
  });
  it('needs a password of at least 6 characters, and points at the password box', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(validateRegister('name@example.com', '12345')).toEqual({ message: SHORT_PASSWORD_MESSAGE, field: 'password', missing: false });
    expect(validateRegister('name@example.com', '123456')).toBeNull();
  });
  it('does not ask about the agreement: that comes in the popup, after these checks pass', () => {
    expect(validateRegister('name@example.com', 'secret1')).toBeNull();
    expect(validateRegister.length).toBe(2);
  });
  it('reports the email before the password length', () => {
    expect(validateRegister('bad', '1')?.field).toBe('email');
    expect(validateRegister('name@example.com', '1')?.field).toBe('password');
  });
  it('mentions the real length in its message', () => {
    expect(SHORT_PASSWORD_MESSAGE).toContain('6');
  });
});

describe('signInErrorMessage', () => {
  it('points a wrong-login to Create Account', () => {
    const m = signInErrorMessage('Invalid login credentials');
    expect(m).toMatch(/did not match/i);
    expect(m).toMatch(/Create Account/);
  });
  it('matches the server wording in any case', () => {
    expect(signInErrorMessage('INVALID LOGIN CREDENTIALS')).toMatch(/Create Account/);
  });
  it('shows any other message as it is', () => {
    expect(signInErrorMessage('Email not confirmed')).toBe('Email not confirmed');
    expect(signInErrorMessage('  Too many requests  ')).toBe('Too many requests');
  });
  it('has a fallback when there is no message', () => {
    for (const v of [undefined, null, '', '   ']) expect(signInErrorMessage(v)).toBe('Something went wrong. Please try again.');
  });
});

describe('the agreement popup', () => {
  it('lists the three documents, in the order they are recorded', () => {
    expect(AGREEMENT_DOCUMENTS.map((d) => d.type)).toEqual(['privacy_policy', 'terms_of_service', 'food_disclaimer']);
    expect(AGREEMENT_DOCUMENTS.map((d) => d.label)).toEqual(['Privacy Policy', 'Terms of Service', 'Food Disclaimer']);
  });
  it('records the same version as before', () => {
    expect(AGREEMENT_VERSION).toBe('1.0');
  });
  it('has short, clear wording, and the button says what happens', () => {
    expect(AGREEMENT_TITLE.length).toBeLessThanOrEqual(40);
    expect(AGREEMENT_INTRO.length).toBeLessThanOrEqual(60);
    expect(AGREEMENT_BUTTON).toMatch(/agree/i);
    expect(AGREEMENT_BUTTON).toMatch(/create account/i);
  });
});

describe('the popup for a missing email or password when creating an account', () => {
  it('says, in one line, that an email and password are needed to create an account', () => {
    expect(CREATE_NEEDS_TITLE).toBe('Email and password needed to create an account');
  });
  it('only an empty box counts as "missing"; a typed-wrong email or short password does not', () => {
    expect(validateRegister('', '')?.missing).toBe(true);
    expect(validateRegister('', 'secret1')?.missing).toBe(true);
    expect(validateRegister('a@b.com', '')?.missing).toBe(true);
    expect(validateRegister('bad', 'secret1')?.missing).toBe(false);
    expect(validateRegister('a@b.com', '123')?.missing).toBe(false);
    expect(validateRegister('a@b.com', 'secret1')).toBeNull();
  });
});
