jest.mock('../api/supabase', () => ({
  supabase: {
    auth: { signOut: jest.fn() },
  },
}));

import { useRestaurantOwnerStore } from './restaurantOwnerStore';
import { supabase } from '../api/supabase';

const signOut = supabase.auth.signOut as jest.Mock;
const initialState = useRestaurantOwnerStore.getState();

beforeEach(() => {
  jest.clearAllMocks();
  useRestaurantOwnerStore.setState(initialState, true);
});

describe('restaurantOwnerStore', () => {
  it('starts with no owner, restaurant, or session', () => {
    const s = useRestaurantOwnerStore.getState();
    expect(s.owner).toBeNull();
    expect(s.restaurant).toBeNull();
    expect(s.session).toBeNull();
    expect(s.loading).toBe(false);
  });

  it('setOwner, setRestaurant, setSession, and setLoading set fields independently', () => {
    const owner = { id: 'o1', email: 'a@b.com', businessName: 'Diner Inc' };
    const restaurant = { id: 'r1', ownerId: 'o1', googlePlaceId: 'gp1', name: 'Diner', address: 'addr', claimedAt: '2024-01-01' };
    const session = { access_token: 'a', refresh_token: 'r' };

    useRestaurantOwnerStore.getState().setOwner(owner);
    useRestaurantOwnerStore.getState().setRestaurant(restaurant);
    useRestaurantOwnerStore.getState().setSession(session);
    useRestaurantOwnerStore.getState().setLoading(true);

    const s = useRestaurantOwnerStore.getState();
    expect(s.owner).toEqual(owner);
    expect(s.restaurant).toEqual(restaurant);
    expect(s.session).toEqual(session);
    expect(s.loading).toBe(true);
  });

  it('logout signs out of supabase and clears owner/restaurant/session but not loading', async () => {
    signOut.mockResolvedValue({ error: null });
    useRestaurantOwnerStore.setState({
      owner: { id: 'o1', email: 'a@b.com', businessName: 'Diner Inc' },
      restaurant: { id: 'r1', ownerId: 'o1', googlePlaceId: 'gp1', name: 'Diner', address: 'addr', claimedAt: '2024-01-01' },
      session: { access_token: 'a', refresh_token: 'r' },
      loading: true,
    });

    await useRestaurantOwnerStore.getState().logout();

    expect(signOut).toHaveBeenCalled();
    const s = useRestaurantOwnerStore.getState();
    expect(s.owner).toBeNull();
    expect(s.restaurant).toBeNull();
    expect(s.session).toBeNull();
    expect(s.loading).toBe(true);
  });

  it('logout still clears state even if signOut throws', async () => {
    signOut.mockRejectedValue(new Error('not authenticated'));
    useRestaurantOwnerStore.setState({
      owner: { id: 'o1', email: 'a@b.com', businessName: 'Diner Inc' },
    });

    await useRestaurantOwnerStore.getState().logout();

    expect(useRestaurantOwnerStore.getState().owner).toBeNull();
  });
});
