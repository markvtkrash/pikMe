jest.mock('../api/supabase', () => ({
  supabase: {
    auth: { signOut: jest.fn().mockResolvedValue({ error: null }) },
  },
}));

import { supabase } from '../api/supabase';
import { useRestaurantOwnerStore } from './restaurantOwnerStore';

const signOut = supabase.auth.signOut as jest.Mock;

function reset() {
  useRestaurantOwnerStore.setState({
    owner: null,
    restaurant: null,
    session: null,
    loading: false,
    restaurantError: null,
    mustChangePassword: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  signOut.mockResolvedValue({ error: null });
  reset();
});

describe('mustChangePassword', () => {
  it('defaults to false', () => {
    expect(useRestaurantOwnerStore.getState().mustChangePassword).toBe(false);
  });

  it('can be set and cleared', () => {
    useRestaurantOwnerStore.getState().setMustChangePassword(true);
    expect(useRestaurantOwnerStore.getState().mustChangePassword).toBe(true);
    useRestaurantOwnerStore.getState().setMustChangePassword(false);
    expect(useRestaurantOwnerStore.getState().mustChangePassword).toBe(false);
  });

  it('does not disturb the other fields', () => {
    useRestaurantOwnerStore.getState().setOwner({ id: 'o1', email: 'a@b.c', businessName: 'Biz' });
    useRestaurantOwnerStore.getState().setMustChangePassword(true);
    expect(useRestaurantOwnerStore.getState().owner?.id).toBe('o1');
  });

  it('is cleared on logout, so the next login starts clean', async () => {
    useRestaurantOwnerStore.getState().setMustChangePassword(true);
    await useRestaurantOwnerStore.getState().logout();
    expect(useRestaurantOwnerStore.getState().mustChangePassword).toBe(false);
  });
});

describe('restaurantError', () => {
  it('defaults to null, can be set, and is cleared on logout', async () => {
    expect(useRestaurantOwnerStore.getState().restaurantError).toBeNull();
    useRestaurantOwnerStore.getState().setRestaurantError('db down');
    expect(useRestaurantOwnerStore.getState().restaurantError).toBe('db down');
    await useRestaurantOwnerStore.getState().logout();
    expect(useRestaurantOwnerStore.getState().restaurantError).toBeNull();
  });
});

describe('logout', () => {
  it('signs out and clears owner, restaurant and session', async () => {
    useRestaurantOwnerStore.setState({
      owner: { id: 'o1', email: 'a@b.c', businessName: 'Biz' },
      restaurant: { id: 'r1' } as any,
      session: { access_token: 't', refresh_token: 'r' },
    });

    await useRestaurantOwnerStore.getState().logout();

    expect(signOut).toHaveBeenCalled();
    const s = useRestaurantOwnerStore.getState();
    expect(s.owner).toBeNull();
    expect(s.restaurant).toBeNull();
    expect(s.session).toBeNull();
  });

  it('still clears the store if signing out throws', async () => {
    signOut.mockRejectedValue(new Error('not authenticated'));
    useRestaurantOwnerStore.setState({ owner: { id: 'o1', email: 'a@b.c', businessName: 'Biz' }, mustChangePassword: true });

    await useRestaurantOwnerStore.getState().logout();

    const s = useRestaurantOwnerStore.getState();
    expect(s.owner).toBeNull();
    expect(s.mustChangePassword).toBe(false);
  });
});
