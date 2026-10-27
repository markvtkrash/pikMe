import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelMyOrder, getMyOrder, startPayment, testMarkPaid } from '../../src/api/orders';
import { openPaymentPage } from '../../src/utils/openPayment';
import { CUSTOMER_HOME_PATH } from '../../src/utils/customerRouting';
import { ACTIVE_ORDERS_KEY } from '../../src/hooks/useActiveOrders';
import { useOrderCartStore } from '../../src/store/orderCartStore';
import { OrderHeader } from '../../src/components/order/OrderHeader';
import { OrderModalFrame } from '../../src/components/order/OrderModalFrame';
import { Alert } from '../../src/utils/alert';
import { canCancel, formatCents, isFinal, refundNote, statusLabel } from '../../src/utils/orders';
import { BRAND_COLORS } from '../../src/constants/brandTheme';
import { useThemedStyles } from '../../src/theme/useTheme';

// Trying the flow before Stripe is connected: a button that marks the order paid. The server refuses it unless the admin setting
// orderingTestMode is on, so in production it does nothing even if it were shown.
const TEST_PAYMENTS = __DEV__ || process.env.EXPO_PUBLIC_ORDERING_TEST_MODE === 'true';

const STEPS: { status: string; label: string }[] = [
  { status: 'placed', label: 'Sent' },
  { status: 'accepted', label: 'Preparing' },
  { status: 'ready', label: 'Ready' },
  { status: 'picked_up', label: 'Picked up' },
];

function stepIndex(status: string): number {
  return STEPS.findIndex((s) => s.status === status);
}

function pickupText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Order for pickup, step 3: where the order is now. It refreshes every few seconds until the order is finished.
export default function OrderStatusScreen() {
  return (
    <OrderModalFrame>
      <OrderStatusContent />
    </OrderModalFrame>
  );
}

function OrderStatusContent() {
  const styles = useThemedStyles(baseStyles);
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useLocalSearchParams<{ orderId?: string; paid?: string }>();
  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
  // Stripe sent the person back here after the payment page (the payment itself is confirmed by Stripe's message, which can take a moment)
  const justPaid = params.paid === '1';
  const [busy, setBusy] = useState(false);

  const { data: order, isLoading, isError } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => getMyOrder(orderId as string),
    enabled: !!orderId,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data && isFinal(query.state.data.status) ? false : 5000),
  });

  // Once the order is paid the cart it was made from is done with. It stays until then, so leaving the payment page puts the person back
  // at their full cart. (Only that restaurant's cart: a different one is something the person started since.)
  const cartPlaceId = useOrderCartStore((s) => s.cart.placeId);
  const clearCart = useOrderCartStore((s) => s.clear);
  const paidPlaceId = order && order.status !== 'pending_payment' && order.status !== 'cancelled' ? order.place_id : null;
  useEffect(() => {
    if (paidPlaceId && cartPlaceId === paidPlaceId) clearCart();
  }, [paidPlaceId, cartPlaceId, clearCart]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    await queryClient.invalidateQueries({ queryKey: ['myOrders'] });
    await queryClient.invalidateQueries({ queryKey: ACTIVE_ORDERS_KEY });   // the bar at the top of the app
  }

  function confirmCancel() {
    if (!order) return;
    const paid = order.status !== 'pending_payment';
    Alert.alert(
      'Cancel this order?',
      paid ? 'The restaurant has not accepted it yet. You will be refunded.' : 'You have not paid yet, so nothing will be charged.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel order',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const result = await cancelMyOrder(order.order_id);
              if (result === 'wrong_state') Alert.alert('Too late to cancel', 'The restaurant has already started on this order.');
              await refresh();
            } catch (e: any) {
              Alert.alert('Could not cancel', e?.message || 'Please try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  async function pay() {
    if (!order) return;
    setBusy(true);
    try {
      await openPaymentPage(await startPayment(order.order_id));
      await refresh();
    } catch (e: any) {
      Alert.alert('Could not start payment', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function payForTest() {
    if (!order) return;
    setBusy(true);
    try {
      await testMarkPaid(order.order_id);
      await refresh();
    } catch (e: any) {
      Alert.alert('Test payment unavailable', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!orderId || isError || (!isLoading && !order)) {
    return (
      <View style={styles.container}>
        <OrderHeader title="Your order" closeable />
        <Text style={styles.empty}>We couldn't find that order.</Text>
      </View>
    );
  }

  if (isLoading || !order) {
    return (
      <View style={styles.container}>
        <OrderHeader title="Your order" closeable />
        <ActivityIndicator style={styles.spinner} color={BRAND_COLORS.primary} />
      </View>
    );
  }

  const current = stepIndex(order.status);
  const dead = order.status === 'cancelled' || order.status === 'refunded';
  const refund = refundNote(order.status, order.refund_status);

  return (
    <View style={styles.container}>
      <OrderHeader title={order.restaurant_name} subtitle={`Pickup around ${pickupText(order.pickup_at)}`} closeable />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.statusCard, dead && styles.statusCardDead, order.status === 'ready' && styles.statusCardReady]}>
          <Text style={styles.statusText}>{statusLabel(order.status)}</Text>
          {order.status === 'ready' && <Text style={styles.statusSub}>Head to the restaurant to pick it up.</Text>}
          {!!refund && <Text style={styles.statusSub}>{refund}</Text>}
        </View>

        {!dead && current >= 0 && (
          <View style={styles.steps}>
            {STEPS.map((s, i) => (
              <View key={s.status} style={styles.step}>
                <View style={[styles.dot, i <= current && styles.dotOn]} />
                <Text style={[styles.stepLabel, i <= current && styles.stepLabelOn]}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {order.status === 'pending_payment' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Payment</Text>
            <Text style={styles.small}>
              {justPaid
                ? 'Thanks. We are confirming your payment with the restaurant\'s bank. This page updates by itself.'
                : 'This order is not paid yet. The restaurant starts on it once you pay. Pay within 30 minutes or it is cancelled; nothing is charged until you pay.'}
            </Text>
            <TouchableOpacity style={[styles.payBtn, busy && styles.off]} disabled={busy} onPress={pay} accessibilityRole="button">
              <Text style={styles.payBtnText}>Pay {formatCents(order.total_cents)} securely</Text>
            </TouchableOpacity>
            {TEST_PAYMENTS && (
              <TouchableOpacity style={[styles.testBtn, busy && styles.off]} disabled={busy} onPress={payForTest} accessibilityRole="button">
                <Text style={styles.testBtnText}>Test: mark as paid</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your order</Text>
          {order.items.map((i, idx) => (
            <View key={`${i.item_id}-${idx}`} style={styles.lineRow}>
              <View style={styles.flex1}>
                <Text style={styles.lineName}>{i.quantity} × {i.name}</Text>
                {!!i.note && <Text style={styles.small}>{i.note}</Text>}
              </View>
              <Text style={styles.lineTotal}>{formatCents(i.unit_price_cents * i.quantity)}</Text>
            </View>
          ))}
          {(order.discount_cents ?? 0) > 0 && (
            <>
              <View style={styles.lineRow}>
                <Text style={[styles.small, styles.flex1]}>Dishes</Text>
                <Text style={styles.small}>{formatCents(order.subtotal_cents)}</Text>
              </View>
              <View style={styles.lineRow}>
                <Text style={[styles.discountText, styles.flex1]}>Coupon{order.coupon_code ? ` ${order.coupon_code}` : ''}</Text>
                <Text style={styles.discountText}>−{formatCents(order.discount_cents ?? 0)}</Text>
              </View>
            </>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalLabel}>{formatCents(order.total_cents)}</Text>
          </View>
          <Text style={styles.small}>Tax and any fees may be collected at pickup.</Text>
          {!!order.customer_name && <Text style={styles.small}>For: {order.customer_name}</Text>}
          {!!order.customer_note && <Text style={styles.small}>Note: {order.customer_note}</Text>}
        </View>

        {canCancel(order.status) && (
          <TouchableOpacity style={[styles.cancelBtn, busy && styles.off]} disabled={busy} onPress={confirmCancel} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel order</Text>
          </TouchableOpacity>
        )}

        {/* The way out: back to the restaurants (the cart is already empty once an order is placed), or to all of the person's orders */}
        <TouchableOpacity style={styles.homeBtn} onPress={() => router.replace(CUSTOMER_HOME_PATH as any)} accessibilityRole="button">
          <Text style={styles.homeBtnText}>{isFinal(order.status) ? 'Order something else' : 'Back to restaurants'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/order' as any)} accessibilityRole="link">
          <Text style={styles.linkText}>See all my orders</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND_COLORS.background.surface },
  flex1: { flex: 1 },
  spinner: { marginTop: 24 },
  empty: { fontSize: 14, color: BRAND_COLORS.text.tertiary, textAlign: 'center', margin: 24 },
  content: { padding: 12, gap: 12, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  statusCard: { backgroundColor: BRAND_COLORS.primaryLight, borderRadius: 14, borderWidth: 1.5, borderColor: BRAND_COLORS.primary, padding: 16, alignItems: 'center', gap: 4 },
  statusCardDead: { backgroundColor: '#FFEBEE', borderColor: '#c62828' },
  statusCardReady: { backgroundColor: '#E8F5E9', borderColor: '#2E7D32' },
  statusText: { fontSize: 20, fontWeight: '800', color: BRAND_COLORS.text.primary },
  statusSub: { fontSize: 13, color: BRAND_COLORS.text.secondary, textAlign: 'center' },
  steps: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  step: { alignItems: 'center', gap: 4, flex: 1 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#CFD8DC' },
  dotOn: { backgroundColor: BRAND_COLORS.primary },
  stepLabel: { fontSize: 11, color: '#90A4AE', fontWeight: '600' },
  stepLabelOn: { color: BRAND_COLORS.text.primary },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e6e6e6', padding: 14, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: BRAND_COLORS.text.primary },
  small: { fontSize: 12, color: BRAND_COLORS.text.tertiary, lineHeight: 17 },
  lineRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  lineName: { fontSize: 14, fontWeight: '600', color: BRAND_COLORS.text.primary },
  discountText: { fontSize: 13, fontWeight: '800', color: '#2E7D32' },
  lineTotal: { fontSize: 14, fontWeight: '700', color: BRAND_COLORS.text.primary },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8 },
  totalLabel: { fontSize: 15, fontWeight: '800', color: BRAND_COLORS.text.primary },
  payBtn: { backgroundColor: '#635BFF', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  payBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  testBtn: { backgroundColor: '#FFF8E1', borderColor: '#FFB300', borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  testBtnText: { fontSize: 14, fontWeight: '800', color: '#7A4A00' },
  homeBtn: { backgroundColor: BRAND_COLORS.primaryLight, borderColor: BRAND_COLORS.primary, borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  homeBtnText: { fontSize: 15, fontWeight: '800', color: BRAND_COLORS.primary },
  linkText: { fontSize: 13, fontWeight: '700', color: BRAND_COLORS.primary, textAlign: 'center', paddingVertical: 4 },
  cancelBtn: { borderColor: '#c62828', borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '800', color: '#c62828' },
  off: { opacity: 0.5 },
});
