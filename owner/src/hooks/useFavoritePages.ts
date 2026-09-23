import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../api/supabase';
import { useRestaurantOwnerStore } from '../store/restaurantOwnerStore';

// Reads/writes restaurant_owners.favorite_pages directly -- RLS already lets
// an owner update their own record, so no dedicated RPC is needed for a
// plain array toggle like this.
export function useFavoritePages() {
  const owner = useRestaurantOwnerStore((s) => s.owner);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!owner) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('restaurant_owners')
        .select('favorite_pages')
        .eq('id', owner.id)
        .single();
      if (error) throw error;
      setFavorites(new Set(data?.favorite_pages ?? []));
    } catch (error) {
      console.error('[useFavoritePages] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  }, [owner?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleFavorite(pageKey: string) {
    if (!owner) return;
    const next = new Set(favorites);
    if (next.has(pageKey)) next.delete(pageKey); else next.add(pageKey);
    setFavorites(next); // optimistic

    try {
      const { error } = await supabase
        .from('restaurant_owners')
        .update({ favorite_pages: Array.from(next) })
        .eq('id', owner.id);
      if (error) throw error;
    } catch (error) {
      console.error('[useFavoritePages] Failed to save, reverting:', error);
      setFavorites(favorites); // revert on failure
    }
  }

  return { favorites, loading, toggleFavorite, reload: load };
}
