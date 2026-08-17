import { supabase } from './supabase';

export type RestaurantStatus = 'pending' | 'approved' | 'rejected';

export interface AdminRestaurant {
  id: string;
  owner_id: string;
  name: string;
  address: string;
  status: RestaurantStatus;
  claimed_at: string;
  restaurant_owners: { business_name: string; email: string } | null;
}

export async function getAllRestaurants(): Promise<AdminRestaurant[]> {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, owner_id, name, address, status, claimed_at, restaurant_owners:owner_id(business_name, email)')
    .order('claimed_at', { ascending: false });

  if (error) throw error;
  return (data as any) || [];
}
