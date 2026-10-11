import { supabase } from './supabase';
import { DeleteResult, parseRemovableOwners, RemovableOwner } from '../utils/ownerCleanup';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';

// Owner logins with no restaurant and whether each may be deleted yet (migration 132).
export async function listRemovableOwners(): Promise<RemovableOwner[]> {
  const { data, error } = await supabase.rpc('admin_list_removable_owners');
  if (error) throw error;
  return parseRemovableOwners(data);
}

// Deactivates the active ones among these owners, in one step. Resolves to how many changed.
export async function deactivateOwners(ownerIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('admin_deactivate_owners', { p_owner_ids: ownerIds });
  if (error) throw error;
  return Number(data) || 0;
}

// Permanently deletes owner logins (up to 50 at a time). The server checks every one again and skips any that is not eligible.
export async function deleteOwners(ownerIds: string[], accessToken: string): Promise<DeleteResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-delete-owners`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ ownerIds }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to delete the owners');
  return data as DeleteResult;
}

// Permanently deletes one owner login from Manage Users, if it passes the cleanup rules (never a customer or an admin).
export async function deleteUserAsAdmin(userId: string, accessToken: string): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-delete-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ userId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to delete the user');
}
