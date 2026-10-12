jest.mock('./supabase', () => ({
  supabase: {
    auth: { resetPasswordForEmail: jest.fn(), verifyOtp: jest.fn(), updateUser: jest.fn() },
  },
}));

import { supabase } from './supabase';
import { requestPasswordResetCode, verifyRecoveryCode, setNewPassword } from './passwordReset';

const reset = supabase.auth.resetPasswordForEmail as jest.Mock;
const verify = supabase.auth.verifyOtp as jest.Mock;
const update = supabase.auth.updateUser as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('requestPasswordResetCode', () => {
  it('trims the email and reports success', async () => {
    reset.mockResolvedValue({ data: {}, error: null });
    expect(await requestPasswordResetCode('  a@b.co ')).toEqual({ error: null });
    expect(reset).toHaveBeenCalledWith('a@b.co');
  });
  it('hides other failures so account existence is not revealed', async () => {
    reset.mockResolvedValue({ data: null, error: { message: 'Error sending recovery email', status: 500 } });
    expect(await requestPasswordResetCode('a@b.co')).toEqual({ error: null });
  });
  it('reports a rate limit', async () => {
    reset.mockResolvedValue({ data: null, error: { message: 'rate limit', status: 429 } });
    expect((await requestPasswordResetCode('a@b.co')).error).toMatch(/wait a minute/);
  });
});

describe('verifyRecoveryCode', () => {
  it('verifies as a recovery token', async () => {
    verify.mockResolvedValue({ data: {}, error: null });
    expect(await verifyRecoveryCode(' a@b.co', '123456')).toEqual({ error: null });
    expect(verify).toHaveBeenCalledWith({ email: 'a@b.co', token: '123456', type: 'recovery' });
  });
  it('explains a wrong or expired code', async () => {
    verify.mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid', status: 403 } });
    expect((await verifyRecoveryCode('a@b.co', '000000')).error).toMatch(/wrong or has expired/);
  });
});

describe('setNewPassword', () => {
  it('updates the password', async () => {
    update.mockResolvedValue({ data: {}, error: null });
    expect(await setNewPassword('Secret123!')).toEqual({ error: null });
    expect(update).toHaveBeenCalledWith({ password: 'Secret123!' });
  });
  it('returns a readable error', async () => {
    update.mockResolvedValue({ data: null, error: { code: 'same_password', message: 'New password should be different from the old password.' } });
    expect((await setNewPassword('x')).error).toMatch(/not used before/);
  });
});
