jest.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { supabase } from './supabase';
import {
  signUpRestaurantOwner,
  adminCreateRestaurantOwner,
  loginRestaurantOwner,
  claimRestaurant,
  getRestaurantForOwner,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  getRestaurantCoupons,
  getRestaurantMenuItems,
  refreshRestaurantMenu,
  adminResetOwnerPassword,
  adminGenerateOwnerPassword,
} from './restaurantAuth';

const getUser = supabase.auth.getUser as jest.Mock;
const from = supabase.from as jest.Mock;
const rpc = supabase.rpc as jest.Mock;

function mockFetch(status: number, body: any) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function makeQueryBuilder(terminalResult: any) {
  const builder: any = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.order = jest.fn(() => Promise.resolve(terminalResult));
  builder.single = jest.fn(() => Promise.resolve(terminalResult));
  builder.maybeSingle = jest.fn(() => Promise.resolve(terminalResult));
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('signUpRestaurantOwner', () => {
  it('posts to restaurant-auth-signup and returns the response body', async () => {
    mockFetch(200, { id: 'o1' });

    const result = await signUpRestaurantOwner('a@b.com', 'pw', 'Diner Inc');

    expect(result).toEqual({ id: 'o1' });
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/functions/v1/restaurant-auth-signup');
    expect(JSON.parse(options.body)).toEqual({ email: 'a@b.com', password: 'pw', businessName: 'Diner Inc' });
  });

  it('throws the server error message on failure', async () => {
    mockFetch(400, { error: 'Email already registered' });

    await expect(signUpRestaurantOwner('a@b.com', 'pw', 'Diner Inc')).rejects.toThrow('Email already registered');
  });
});

describe('adminCreateRestaurantOwner', () => {
  it('sends an Authorization header and returns the response body', async () => {
    mockFetch(200, { id: 'o1' });

    await adminCreateRestaurantOwner({
      email: 'a@b.com',
      password: 'pw',
      businessName: 'Diner Inc',
      googlePlaceId: 'gp1',
      restaurantName: 'Diner',
      address: 'addr',
      accessToken: 'token123',
    });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer token123');
  });

  it('falls back to a generic message when the error body has no error field', async () => {
    mockFetch(500, {});

    await expect(
      adminCreateRestaurantOwner({
        email: 'a@b.com',
        password: 'pw',
        businessName: 'Diner Inc',
        googlePlaceId: 'gp1',
        restaurantName: 'Diner',
        address: 'addr',
        accessToken: 'token123',
      })
    ).rejects.toThrow('Failed to create owner account');
  });
});

describe('loginRestaurantOwner', () => {
  it('returns the response body on success', async () => {
    mockFetch(200, { session: { access_token: 'a' } });

    await expect(loginRestaurantOwner('a@b.com', 'pw')).resolves.toEqual({ session: { access_token: 'a' } });
  });

  it('throws the server error message on failure', async () => {
    mockFetch(401, { error: 'Invalid credentials' });

    await expect(loginRestaurantOwner('a@b.com', 'pw')).rejects.toThrow('Invalid credentials');
  });
});

describe('claimRestaurant', () => {
  it('returns the response body on success', async () => {
    mockFetch(200, { id: 'r1' });

    await expect(claimRestaurant('gp1', 'Diner', 'addr', 'token')).resolves.toEqual({ id: 'r1' });
  });

  it('throws data.error when present', async () => {
    mockFetch(400, { error: 'Already claimed' });
    await expect(claimRestaurant('gp1', 'Diner', 'addr', 'token')).rejects.toThrow('Already claimed');
  });

  it('falls back to data.message when data.error is absent', async () => {
    mockFetch(400, { message: 'Something went wrong' });
    await expect(claimRestaurant('gp1', 'Diner', 'addr', 'token')).rejects.toThrow('Something went wrong');
  });

  it('falls back to a stringified body when neither error nor message is present', async () => {
    mockFetch(400, { unexpected: true });
    await expect(claimRestaurant('gp1', 'Diner', 'addr', 'token')).rejects.toThrow(JSON.stringify({ unexpected: true }));
  });
});

describe('getRestaurantForOwner', () => {
  it('throws when there is no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(getRestaurantForOwner()).rejects.toThrow('Not authenticated');
  });

  it('returns the restaurant row when found', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    from.mockReturnValue(makeQueryBuilder({ data: { id: 'r1' }, error: null }));

    await expect(getRestaurantForOwner()).resolves.toEqual({ id: 'r1' });
  });

  it('returns null when no row is found (PGRST116)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    from.mockReturnValue(makeQueryBuilder({ data: null, error: { code: 'PGRST116' } }));

    await expect(getRestaurantForOwner()).resolves.toBeNull();
  });

  it('throws for any other database error', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    from.mockReturnValue(makeQueryBuilder({ data: null, error: { code: '500', message: 'db down' } }));

    await expect(getRestaurantForOwner()).rejects.toEqual({ code: '500', message: 'db down' });
  });
});

describe('createCoupon', () => {
  it('returns data on success', async () => {
    rpc.mockResolvedValue({ data: { id: 'c1' }, error: null });

    const result = await createCoupon({
      restaurantId: 'r1',
      couponType: 'item_percent',
      discountValue: 20,
      couponCode: 'SAVE20',
      expiryDate: '2026-01-01',
    });

    expect(result).toEqual({ id: 'c1' });
    expect(rpc).toHaveBeenCalledWith('create_coupon', expect.objectContaining({
      p_restaurant_id: 'r1',
      p_coupon_type: 'item_percent',
      p_menu_item_id: null,
      p_usage_limit: null,
      p_conditions: null,
    }));
  });

  it('throws on error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'insert failed' } });

    await expect(
      createCoupon({ restaurantId: 'r1', couponType: 'item_percent', discountValue: 20, couponCode: 'X', expiryDate: '2026-01-01' })
    ).rejects.toEqual({ message: 'insert failed' });
  });
});

describe('updateCoupon', () => {
  it('defaults omitted fields to null but preserves an explicit false for isActive', async () => {
    rpc.mockResolvedValue({ data: { id: 'c1' }, error: null });

    await updateCoupon('c1', { isActive: false });

    expect(rpc).toHaveBeenCalledWith('update_coupon', expect.objectContaining({
      p_coupon_id: 'c1',
      p_coupon_type: null,
      p_is_active: false,
    }));
  });

  it('passes p_is_active as null when isActive is omitted', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });

    await updateCoupon('c1', {});

    expect(rpc).toHaveBeenCalledWith('update_coupon', expect.objectContaining({ p_is_active: null }));
  });
});

describe('deleteCoupon', () => {
  it('returns data on success and throws on error', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(deleteCoupon('c1')).resolves.toBe(true);

    rpc.mockResolvedValue({ data: null, error: { message: 'not found' } });
    await expect(deleteCoupon('c1')).rejects.toEqual({ message: 'not found' });
  });
});

describe('getRestaurantCoupons', () => {
  it('returns an empty array when data is null', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getRestaurantCoupons('r1')).resolves.toEqual([]);
  });

  it('returns the data array when present', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'c1' }], error: null });
    await expect(getRestaurantCoupons('r1')).resolves.toEqual([{ id: 'c1' }]);
  });
});

describe('getRestaurantMenuItems', () => {
  it('returns the ordered menu items', async () => {
    from.mockReturnValue(makeQueryBuilder({ data: [{ id: 'm1' }], error: null }));

    await expect(getRestaurantMenuItems('r1')).resolves.toEqual([{ id: 'm1' }]);
  });

  it('returns an empty array when data is null and throws on error', async () => {
    from.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    await expect(getRestaurantMenuItems('r1')).resolves.toEqual([]);

    from.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'db error' } }));
    await expect(getRestaurantMenuItems('r1')).rejects.toEqual({ message: 'db error' });
  });
});

describe('refreshRestaurantMenu', () => {
  it('returns the response body on success', async () => {
    mockFetch(200, { items: [] });

    await expect(refreshRestaurantMenu('r1', 'Diner', 'token')).resolves.toEqual({ items: [] });
  });

  it('throws data.error when present', async () => {
    mockFetch(500, { error: 'LLM timeout' });

    await expect(refreshRestaurantMenu('r1', 'Diner', 'token')).rejects.toThrow('LLM timeout');
  });

  it('falls back to a stringified body when data.error is absent', async () => {
    mockFetch(500, { unexpected: true });

    await expect(refreshRestaurantMenu('r1', 'Diner', 'token')).rejects.toThrow(JSON.stringify({ unexpected: true }));
  });
});

describe('adminResetOwnerPassword', () => {
  const sentBody = () => JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);

  it('posts to admin-reset-owner-password with the admin token and returns the credentials', async () => {
    mockFetch(200, { email: 'o@x.com', temporaryPassword: 'Abcdef1!', mustChangePasswordFlagged: true });

    const result = await adminResetOwnerPassword({ ownerId: 'o1', accessToken: 'tok' });

    expect(result).toEqual({ email: 'o@x.com', temporaryPassword: 'Abcdef1!', mustChangePasswordFlagged: true });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/functions\/v1\/admin-reset-owner-password$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('lets the server generate the password when none is given (no temporaryPassword key sent)', async () => {
    mockFetch(200, { email: 'o@x.com', temporaryPassword: 'ServerMade1!', mustChangePasswordFlagged: true });

    await adminResetOwnerPassword({ ownerId: 'o1', accessToken: 'tok' });

    expect(sentBody()).toEqual({ ownerId: 'o1' });
  });

  it('sends the password the admin chose', async () => {
    mockFetch(200, { email: 'o@x.com', temporaryPassword: 'MyChoice1!', mustChangePasswordFlagged: true });

    await adminResetOwnerPassword({ ownerId: 'o1', accessToken: 'tok', temporaryPassword: 'MyChoice1!' });

    expect(sentBody()).toEqual({ ownerId: 'o1', temporaryPassword: 'MyChoice1!' });
  });

  it('never sends generateOnly on a real reset', async () => {
    mockFetch(200, { email: 'o@x.com', temporaryPassword: 'MyChoice1!', mustChangePasswordFlagged: true });

    await adminResetOwnerPassword({ ownerId: 'o1', accessToken: 'tok', temporaryPassword: 'MyChoice1!' });

    expect(sentBody()).not.toHaveProperty('generateOnly');
  });

  it("surfaces the server's message (e.g. a weak password)", async () => {
    mockFetch(400, { error: 'Password needs a number' });

    await expect(
      adminResetOwnerPassword({ ownerId: 'o1', accessToken: 'tok', temporaryPassword: 'Abcdefg!' })
    ).rejects.toThrow('Password needs a number');
  });

  it('falls back to a generic message when the error body has no error field', async () => {
    mockFetch(500, {});

    await expect(adminResetOwnerPassword({ ownerId: 'o1', accessToken: 'tok' })).rejects.toThrow(
      'Failed to reset password'
    );
  });
});

describe('adminGenerateOwnerPassword', () => {
  it('asks for a suggestion only (generateOnly) and returns the password', async () => {
    mockFetch(200, { temporaryPassword: 'Suggested1!' });

    await expect(adminGenerateOwnerPassword('tok')).resolves.toBe('Suggested1!');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/functions\/v1\/admin-reset-owner-password$/);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ generateOnly: true });
  });

  it('does not send an owner id (nothing is changed)', async () => {
    mockFetch(200, { temporaryPassword: 'Suggested1!' });

    await adminGenerateOwnerPassword('tok');

    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).not.toHaveProperty('ownerId');
  });

  it("surfaces the server's message, or a generic one", async () => {
    mockFetch(403, { error: 'Admin access required' });
    await expect(adminGenerateOwnerPassword('tok')).rejects.toThrow('Admin access required');

    mockFetch(500, {});
    await expect(adminGenerateOwnerPassword('tok')).rejects.toThrow('Failed to generate a password');
  });
});
