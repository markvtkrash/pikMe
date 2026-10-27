import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { applyOrderCoupon, cancelMyOrder, createPickupOrder, getMyOrders, getOrderCoupons, getOrderableDishes, startPayment } from '../../src/api/orders';
import { openPaymentPage } from '../../src/utils/openPayment';
import { useOrderingInfo } from '../../src/hooks/useOrderingInfo';
import { useUserProfile } from '../../src/hooks/useUserProfile';
import { useOrderCartStore } from '../../src/store/orderCartStore';
import { OrderHeader } from '../../src/components/order/OrderHeader';
import { Alert } from '../../src/utils/alert';
import {
  MAX_QTY_PER_DISH, cartCount, cartSubtotalCents, cartToOrderItems, formatCents, couponScopeNote, couponTitle, formatSlot, newIdempotencyKey, pickupSlots, reconcileCart, totalAfterDiscount,
} from '../../src/utils/orders';
import { BRAND_COLORS } from '../../src/constants/brandTheme';
import { useThemedStyles, useThemeColor } from '../../src/theme/useTheme';

const FIRST_SLOTS = 12;

// Cancels the person's unpaid orders at one restaurant (nothing was charged for them). Never throws: a failure here must not stop a new order.
async function cancelUnpaidAt(placeId: string): Promise<void> {
  try {
    const unpaid = (await getMyOrders(10)).filter((o) => o.status === 'pending_payment' && o.place_id === placeId);
    await Promise.all(unpaid.map((o) => cancelMyOrder(o.order_id).catch(() => undefined)));
  } catch {
    // ignore
  }
}

// Order for pickup, step 2: review the dishes, say who the order is for and when you will pick it up, and place it.
export default function CheckoutScreen() {
  const styles = useThemedStyles(baseStyles);
  const { color: tc } = useThemeColor();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: profile } = useUserProfile();
  const cart = useOrderCartStore((s) => s.cart);
  const setDishQuantity = useOrderCartStore((s) => s.setDishQuantity);
  const replaceCart = useOrderCartStore((s) => s.replaceCart);
  const placeId = cart.placeId ?? undefined;

  const { data: info, isLoading: infoLoading } = useOrderingInfo(placeId);
  const dishesQuery = useQuery({
    queryKey: ['orderableDishes', placeId],
    queryFn: () => getOrderableDishes(placeId as string, cart.restaurantName),
    enabled: !!placeId,
    staleTime: 0,
  });

  // the coupons this person can use on this cart, worked out by the server; the best one is chosen until they pick another (or none)
  const couponItems = useMemo(() => cartToOrderItems(cart), [cart]);
  const couponsQuery = useQuery({
    queryKey: ['orderCoupons', placeId, couponItems.map((i) => `${i.item_id}:${i.quantity}`).join(',')],
    queryFn: () => getOrderCoupons(placeId as string, couponItems),
    enabled: !!placeId && couponItems.length > 0,
    staleTime: 30 * 1000,
  });
  const coupons = couponsQuery.data ?? [];
  const [pickedCoupon, setPickedCoupon] = useState<string | null | undefined>(undefined);   // undefined = not chosen yet, null = none
  const coupon = pickedCoupon === undefined ? coupons[0] ?? null : coupons.find((c) => c.coupon_id === pickedCoupon) ?? null;

  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [note, setNote] = useState('');
  const [pickupMs, setPickupMs] = useState<number | null>(null);   // null = as soon as possible
  const [showAllSlots, setShowAllSlots] = useState(false);
  const [placing, setPlacing] = useState(false);
  // One key per attempt: a double tap, or a retry after a dropped connection, gives back the same order instead of a second one.
  const keyRef = useRef<{ key: string; signature: string } | null>(null);
  const [now] = useState(() => Date.now());

  // start the name from the profile, until the person types their own
  useEffect(() => {
    if (!nameTouched && profile?.displayName) setName(profile.displayName);
  }, [profile?.displayName, nameTouched]);

  // a dish may have gone, or changed price, since it was added: bring the cart up to date and say so
  const reconciled = useRef(false);
  useEffect(() => {
    if (reconciled.current || !dishesQuery.data || cart.lines.length === 0) return;
    reconciled.current = true;
    const { cart: fresh, removed, repriced } = reconcileCart(cart, dishesQuery.data);
    if (removed.length === 0 && repriced.length === 0) return;
    replaceCart(fresh);
    const parts: string[] = [];
    if (removed.length) parts.push(`No longer available, so removed: ${removed.join(', ')}.`);
    if (repriced.length) parts.push(`The price changed for: ${repriced.join(', ')}.`);
    Alert.alert('Your order was updated', parts.join('\n'));
  }, [dishesQuery.data, cart, replaceCart]);

  const slots = useMemo(
    () => (info?.timezone ? pickupSlots(now, info.prepMinutes, info.timezone) : []),
    [info?.timezone, info?.prepMinutes, now]
  );
  const shownSlots = showAllSlots ? slots : slots.slice(0, FIRST_SLOTS);

  const place = { placeId: cart.placeId ?? '', restaurantName: cart.restaurantName };
  const count = cartCount(cart);
  const subtotal = cartSubtotalCents(cart);
  const discount = coupon?.discount_cents ?? 0;
  const itemCouponDish = coupon?.menu_item_id ? cart.lines.find((l) => l.itemId === coupon.menu_item_id)?.name : undefined;
  const total = totalAfterDiscount(subtotal, discount);
  const closed = !infoLoading && !!info && !info.available;
  const canPlace = count > 0 && name.trim().length > 0 && !closed && !placing && !!info?.available;

  async function placeOrder() {
    if (!canPlace || !cart.placeId) return;
    setPlacing(true);
    try {
      const items = cartToOrderItems(cart);
      const signature = JSON.stringify({ items, pickupMs, name: name.trim(), note: note.trim() });
      if (!keyRef.current || keyRef.current.signature !== signature) keyRef.current = { key: newIdempotencyKey(), signature };
      // An earlier try from this cart that was never paid is only in the way (the server allows three unpaid orders at a restaurant, and
      // these are no longer shown anywhere), so it is cancelled first. Nothing was charged for it. If this fails the order goes ahead anyway.
      await cancelUnpaidAt(cart.placeId);
      const order = await createPickupOrder({
        placeId: cart.placeId,
        items,
        customerName: name.trim(),
        pickupAtMs: pickupMs,
        note,
        key: keyRef.current.key,
      });
      // The coupon goes on before payment starts (the server works the discount out again and checks the coupon is still good). If it
      // cannot be used, nothing is paid: the person is told and can choose another or none, then place the order again.
      try {
        if (coupon || (order.discount_cents ?? 0) > 0) await applyOrderCoupon(order.order_id, coupon?.coupon_id ?? null);
      } catch (couponError: any) {
        Alert.alert('The coupon could not be used', `${couponError?.message || 'Please try again.'}\nNothing was charged.`);
        return;
      }
      // The cart stays until the order is paid (the order page empties it then), so leaving the payment page puts the person back at a full cart.
      router.replace(`/order/${order.order_id}` as any);
      // straight on to paying; if that cannot start, the order screen has a Pay button to try again
      try {
        await openPaymentPage(await startPayment(order.order_id));
      } catch (payError) {
        console.warn('[checkout] payment did not start:', payError instanceof Error ? payError.message : payError);
      }
    } catch (e: any) {
      Alert.alert('Could not place the order', e?.message || 'Please try again.');
    } finally {
      setPlacing(false);
    }
  }

  if (count === 0) {
    return (
      <View style={styles.container}>
        <OrderHeader title="Your order" />
        <Text style={styles.empty}>Your cart is empty.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OrderHeader title="Your order" subtitle={cart.restaurantName} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]}>
        {closed && (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Not taking orders right now</Text>
            <Text style={styles.noticeBody}>This restaurant can't take pickup orders at the moment.</Text>
          </View>
        )}

        <View style={styles.card}>
          {cart.lines.map((line) => (
            <View key={line.itemId} style={styles.lineRow}>
              <View style={styles.flex1}>
                <Text style={styles.lineName}>{line.name}</Text>
                <Text style={styles.linePrice}>{formatCents(line.priceCents)} each</Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => setDishQuantity(place, line, line.quantity - 1)} accessibilityRole="button" accessibilityLabel={`Less ${line.name}`}>
                  <Text style={styles.stepText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qty}>{line.quantity}</Text>
                <TouchableOpacity
                  style={[styles.stepBtn, line.quantity >= MAX_QTY_PER_DISH && styles.off]}
                  disabled={line.quantity >= MAX_QTY_PER_DISH}
                  onPress={() => setDishQuantity(place, line, line.quantity + 1)}
                  accessibilityRole="button"
                  accessibilityLabel={`More ${line.name}`}
                >
                  <Text style={styles.stepText}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.lineTotal}>{formatCents(line.priceCents * line.quantity)}</Text>
            </View>
          ))}
          {discount > 0 && coupon && (
            <>
              <View style={styles.sumRow}>
                <Text style={styles.small}>Dishes</Text>
                <Text style={styles.small}>{formatCents(subtotal)}</Text>
              </View>
              <View style={styles.sumRow}>
                <Text style={styles.discountText}>Coupon {coupon.coupon_code}</Text>
                <Text style={styles.discountText}>−{formatCents(discount)}</Text>
              </View>
              {!!couponScopeNote(coupon, itemCouponDish) && <Text style={styles.small}>{couponScopeNote(coupon, itemCouponDish)}</Text>}
            </>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatCents(total)}</Text>
          </View>
          <Text style={styles.small}>Tax and any fees may be collected at pickup.</Text>
        </View>

        {coupons.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>Coupon</Text>
            {coupons.map((c) => {
              const on = coupon?.coupon_id === c.coupon_id;
              const dish = c.menu_item_id ? cart.lines.find((l) => l.itemId === c.menu_item_id)?.name : undefined;
              return (
                <TouchableOpacity
                  key={c.coupon_id}
                  style={[styles.couponRow, on && styles.couponRowOn]}
                  onPress={() => setPickedCoupon(c.coupon_id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={styles.couponIcon}>{on ? '✅' : '⭐'}</Text>
                  <View style={styles.flex1}>
                    <Text style={styles.couponTitle}>{couponTitle(c, dish)}</Text>
                    <Text style={styles.small}>Code {c.coupon_code}  ·  saves {formatCents(c.discount_cents)}</Text>
                    {!!couponScopeNote(c, dish) && <Text style={styles.scopeNote}>{couponScopeNote(c, dish)}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => setPickedCoupon(null)} accessibilityRole="button">
              <Text style={[styles.linkText, !coupon && styles.linkTextOn]}>{coupon ? "Don't use a coupon" : 'No coupon used'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>Name for the order</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(t) => { setName(t); setNameTouched(true); }}
            placeholder="Who is picking it up?"
            placeholderTextColor={tc('#999')}
            maxLength={60}
            autoCapitalize="words"
          />

          <Text style={[styles.label, styles.gap]}>Pickup time (today)</Text>
          <View style={styles.chips}>
            <TouchableOpacity
              style={[styles.chip, pickupMs === null && styles.chipOn]}
              onPress={() => setPickupMs(null)}
              accessibilityRole="button"
              accessibilityState={{ selected: pickupMs === null }}
            >
              <Text style={[styles.chipText, pickupMs === null && styles.chipTextOn]}>
                As soon as possible{info ? ` (about ${info.prepMinutes} min)` : ''}
              </Text>
            </TouchableOpacity>
            {shownSlots.map((ms) => (
              <TouchableOpacity
                key={ms}
                style={[styles.chip, pickupMs === ms && styles.chipOn]}
                onPress={() => setPickupMs(ms)}
                accessibilityRole="button"
                accessibilityState={{ selected: pickupMs === ms }}
              >
                <Text style={[styles.chipText, pickupMs === ms && styles.chipTextOn]}>{formatSlot(ms, info?.timezone ?? undefined)}</Text>
              </TouchableOpacity>
            ))}
            {!showAllSlots && slots.length > FIRST_SLOTS && (
              <TouchableOpacity style={styles.chip} onPress={() => setShowAllSlots(true)} accessibilityRole="button">
                <Text style={styles.chipText}>More times…</Text>
              </TouchableOpacity>
            )}
          </View>
          {infoLoading && <ActivityIndicator style={styles.gap} color={BRAND_COLORS.primary} />}
          {!infoLoading && slots.length === 0 && !closed && (
            <Text style={styles.small}>It's too late today to schedule a time. Choose "as soon as possible".</Text>
          )}

          <Text style={[styles.label, styles.gap]}>Note for the restaurant (optional)</Text>
          <TextInput
            style={[styles.input, styles.noteInput]}
            value={note}
            onChangeText={setNote}
            placeholder="Anything they should know"
            placeholderTextColor={tc('#999')}
            maxLength={300}
            multiline
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity style={[styles.placeBtn, !canPlace && styles.off]} disabled={!canPlace} onPress={placeOrder} accessibilityRole="button">
          {placing ? <ActivityIndicator color="#fff" /> : <Text style={styles.placeText}>Place order  ·  {formatCents(total)}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND_COLORS.background.surface },
  flex1: { flex: 1 },
  empty: { fontSize: 14, color: BRAND_COLORS.text.tertiary, textAlign: 'center', margin: 24 },
  content: { padding: 12, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  notice: { backgroundColor: '#FFF3E0', borderRadius: 12, borderWidth: 1.5, borderColor: '#E65100', padding: 14 },
  noticeTitle: { fontSize: 15, fontWeight: '800', color: '#7A3300' },
  noticeBody: { fontSize: 13, color: '#7A3300', marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e6e6e6', padding: 14, gap: 10 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineName: { fontSize: 15, fontWeight: '700', color: BRAND_COLORS.text.primary },
  linePrice: { fontSize: 12, color: BRAND_COLORS.text.tertiary, marginTop: 1 },
  lineTotal: { fontSize: 14, fontWeight: '700', color: BRAND_COLORS.text.primary, minWidth: 64, textAlign: 'right' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: BRAND_COLORS.primaryLight, borderWidth: 1.5, borderColor: BRAND_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 18, fontWeight: '800', color: BRAND_COLORS.primary, lineHeight: 20 },
  qty: { fontSize: 15, fontWeight: '800', color: BRAND_COLORS.text.primary, minWidth: 20, textAlign: 'center' },
  off: { opacity: 0.45 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 },
  totalLabel: { fontSize: 16, fontWeight: '800', color: BRAND_COLORS.text.primary },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  discountText: { fontSize: 13, fontWeight: '800', color: '#2E7D32' },
  couponRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, backgroundColor: '#F1F8E9', borderWidth: 1.5, borderColor: '#C5E1A5' },
  couponRowOn: { borderColor: '#2E7D32', backgroundColor: '#E8F5E9' },
  scopeNote: { fontSize: 12, fontWeight: '700', color: '#E65100', marginTop: 2 },
  couponIcon: { fontSize: 18 },
  couponTitle: { fontSize: 14, fontWeight: '800', color: '#1B5E20' },
  linkText: { fontSize: 13, fontWeight: '700', color: BRAND_COLORS.text.tertiary, textAlign: 'center', paddingVertical: 2 },
  linkTextOn: { color: BRAND_COLORS.text.secondary },
  totalValue: { fontSize: 16, fontWeight: '800', color: BRAND_COLORS.text.primary },
  small: { fontSize: 12, color: BRAND_COLORS.text.tertiary, lineHeight: 17 },
  label: { fontSize: 13, fontWeight: '800', color: BRAND_COLORS.text.secondary },
  gap: { marginTop: 6 },
  input: { borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: BRAND_COLORS.text.primary, backgroundColor: '#fff' },
  noteInput: { minHeight: 64, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#ECEFF1', borderWidth: 1.5, borderColor: '#B0BEC5' },
  chipOn: { backgroundColor: BRAND_COLORS.primary, borderColor: BRAND_COLORS.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: '#546E7A' },
  chipTextOn: { color: '#fff' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', paddingTop: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#e6e6e6' },
  placeBtn: { backgroundColor: BRAND_COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center' },
  placeText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
