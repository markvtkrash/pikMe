import { supabase } from './supabase';

// Which of these restaurant names are franchises, in one call (migration 126). A failure gives an empty set, so the page still works
// and simply treats everything as independent.
export async function getFranchiseNameSet(names: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 0) return new Set();
  const { data, error } = await supabase.rpc('franchise_names_among', { p_names: unique });
  if (error) {
    console.warn('[franchiseKinds] could not tell franchises apart:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row: { name: string }) => row.name));
}
