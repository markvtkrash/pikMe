jest.mock('./supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { supabase } from './supabase';
import {
  getActiveCouponsForRestaurant,
  getActiveCouponsByPlaceId,
  activateCoupon,
  closeCouponActivation,
} from './coupons';

const from = supabase.from as jest.Mock;
const rpc = supabase.rpc as jest.Mock;

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
});

describe('getActiveCouponsForRestaurant', () => {
  it('returns an empty array when data is null', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getActiveCouponsForRestaurant('r1')).resolves.toEqual([]);
  });

  it('returns the data array when present', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'c1' }], error: null });
    await expect(getActiveCouponsForRestaurant('r1')).resolves.toEqual([{ id: 'c1' }]);
  });
});

describe('getActiveCouponsByPlaceId', () => {
  it('returns an empty array when the restaurant lookup errors', async () => {
    from.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'db error' } }));

    await expect(getActiveCouponsByPlaceId('gp1')).resolves.toEqual([]);
  });

  it('returns an empty array when the restaurant is unclaimed (no row)', async () => {
    from.mockReturnValue(makeQueryBuilder({ data: null, error: null }));

    await expect(getActiveCouponsByPlaceId('gp1')).resolves.toEqual([]);
  });

  it('returns active coupons for the resolved restaurant id', async () => {
    from.mockReturnValue(makeQueryBuilder({ data: { id: 'r1' }, error: null }));
    rpc.mockResolvedValue({ data: [{ id: 'c1' }], error: null });

    const result = await getActiveCouponsByPlaceId('gp1');

    expect(rpc).toHaveBeenCalledWith('get_active_coupons_for_restaurant', { p_restaurant_id: 'r1' });
    expect(result).toEqual([{ id: 'c1' }]);
  });
});

describe('activateCoupon', () => {
  it('returns the activation window from a single-row RPC response', async () => {
    rpc.mockResolvedValue({
      data: [{ activated_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-01T00:05:00Z', already_active: false }],
      error: null,
    });

    const result = await activateCoupon('c1');

    expect(rpc).toHaveBeenCalledWith('activate_coupon', { p_coupon_id: 'c1' });
    expect(result).toEqual({
      activatedAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-01-01T00:05:00Z',
      alreadyActive: false,
    });
  });

  it('handles a single-object RPC response (not wrapped in an array)', async () => {
    rpc.mockResolvedValue({
      data: { activated_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-01T00:05:00Z', already_active: true },
      error: null,
    });

    const result = await activateCoupon('c1');

    expect(result.alreadyActive).toBe(true);
  });

  it('throws when the coupon can no longer be activated', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Coupon is no longer available' } });

    await expect(activateCoupon('c1')).rejects.toEqual({ message: 'Coupon is no longer available' });
  });
});

describe('closeCouponActivation', () => {
  it('returns true when a row was closed', async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    await expect(closeCouponActivation('c1')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('close_coupon_activation', { p_coupon_id: 'c1' });
  });

  it('returns false when there was nothing to close', async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    await expect(closeCouponActivation('c1')).resolves.toBe(false);
  });

  it('throws on error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not authenticated' } });

    await expect(closeCouponActivation('c1')).rejects.toEqual({ message: 'not authenticated' });
  });
});
