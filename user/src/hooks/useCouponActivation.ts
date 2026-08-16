import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { activateCoupon, closeCouponActivation } from '../api/coupons';
import type { Coupon } from '../types';

interface Options {
  // Called once the coupon has been closed (manually or auto-expired) so the
  // caller can remove it from whatever list it's rendering.
  onClosed?: (couponId: string) => void;
}

export function useCouponActivation({ onClosed }: Options = {}) {
  const [activeCoupon, setActiveCoupon] = useState<Coupon | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  // The coupon awaiting the "activate now?" confirmation, rendered via a real
  // Modal (CouponConfirmModal) rather than Alert.alert — RN Web's Alert
  // doesn't support multi-button confirmations, so a tap on "activate" there
  // would otherwise silently do nothing.
  const [pendingCoupon, setPendingCoupon] = useState<Coupon | null>(null);

  const openActivation = useCallback(async (coupon: Coupon) => {
    try {
      const result = await activateCoupon(coupon.id);
      setActiveCoupon(coupon);
      setExpiresAt(result.expiresAt);
    } catch {
      Alert.alert('Coupon unavailable', 'This coupon can no longer be activated.');
    }
  }, []);

  // Tapping a coupon that's already mid-activation (from an earlier fetch)
  // just reopens the same countdown — no re-warning, no second use burned.
  const handlePress = useCallback((coupon: Coupon) => {
    if (coupon.activated_at && coupon.expires_at) {
      setActiveCoupon(coupon);
      setExpiresAt(coupon.expires_at);
      return;
    }
    setPendingCoupon(coupon);
  }, []);

  const confirmActivate = useCallback(() => {
    setPendingCoupon((coupon) => {
      if (coupon) openActivation(coupon);
      return null;
    });
  }, [openActivation]);

  const cancelActivate = useCallback(() => {
    setPendingCoupon(null);
  }, []);

  const handleDone = useCallback(() => {
    if (activeCoupon) {
      const couponId = activeCoupon.id;
      closeCouponActivation(couponId).catch(() => {});
      onClosed?.(couponId);
    }
    setActiveCoupon(null);
    setExpiresAt(null);
  }, [activeCoupon, onClosed]);

  return { activeCoupon, expiresAt, pendingCoupon, handlePress, confirmActivate, cancelActivate, handleDone };
}
