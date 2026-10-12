import { supabase } from './supabase';
import { isRateLimitError, resetErrorMessage } from '../utils/passwordReset';

// Asks Supabase to email a 6-digit recovery code. Whether or not the address has an account the caller shows the same message: an
// unknown address is not an error here, and an email-sending failure is logged but not shown (showing it would reveal which addresses
// have accounts). Only a rate limit is reported, since it does not depend on the address.
export async function requestPasswordResetCode(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
  if (error) {
    if (isRateLimitError(error)) return { error: resetErrorMessage(error) };
    console.warn('[password-reset] request failed:', error.message);
  }
  return { error: null };
}

// Checks the emailed code. On success Supabase signs the person in with a short-lived session, which is only used to set the new
// password next.
export async function verifyRecoveryCode(email: string, code: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: 'recovery' });
  return { error: error ? resetErrorMessage(error) : null };
}

export async function setNewPassword(password: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ password });
  return { error: error ? resetErrorMessage(error) : null };
}
