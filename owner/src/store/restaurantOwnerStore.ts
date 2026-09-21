import { create } from 'zustand';
import { supabase } from '../api/supabase';

interface RestaurantOwner {
  id: string;
  email: string;
  businessName: string;
}

// Matches the actual public.restaurants row shape returned by
// getRestaurantForOwner()'s `select('*')` — snake_case, straight off the
// table, not a client-side camelCase mapping.
interface Restaurant {
  id: string;
  owner_id: string;
  google_place_id: string;
  name: string;
  address: string;
  claimed_at: string;
  created_at?: string;
  updated_at?: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_at?: string | null;
  approved_by?: string | null;
  menu_link?: string | null;
  website_url?: string | null;
}

interface RestaurantOwnerStore {
  owner: RestaurantOwner | null;
  restaurant: Restaurant | null;
  session: { access_token: string; refresh_token: string } | null;
  loading: boolean;
  setOwner: (owner: RestaurantOwner | null) => void;
  setRestaurant: (restaurant: Restaurant | null) => void;
  setSession: (session: any | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useRestaurantOwnerStore = create<RestaurantOwnerStore>((set) => ({
  owner: null,
  restaurant: null,
  session: null,
  loading: false,
  setOwner: (owner) => set({ owner }),
  setRestaurant: (restaurant) => set({ restaurant }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
  logout: async () => {
    // Sign out from Supabase (ignore errors if not authenticated)
    console.log('[restaurantOwnerStore] logout called');
    try {
      await supabase.auth.signOut();
      console.log('[restaurantOwnerStore] signOut successful');
    } catch (err) {
      console.log('[restaurantOwnerStore] signOut error (expected if not authenticated):', err);
    }
    // Clear store state
    set({ owner: null, restaurant: null, session: null });
    console.log('[restaurantOwnerStore] Store cleared');
  },
}));
