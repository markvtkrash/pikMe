import { supabase } from './supabase';

// True if the restaurant's name matches a known US franchise/chain in the
// franchise_chains table (see migration 062). Matching is done server-side so
// the name normalization lives in one place.
export async function isFranchiseChain(restaurantName: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_franchise_chain', { p_name: restaurantName });
  if (error) throw error;
  return data === true;
}
