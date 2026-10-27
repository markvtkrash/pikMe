import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { getKioskOrders, runKioskAction } from '../../src/api/kiosk';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { Alert, confirmDialog } from '../../src/utils/alert';
import {
  BUTTONS_BY_STATUS, KIOSK_POLL_MS, confirmFor, STATUS_TITLES, clockSkewMs, formatCents, groupOrders, hasEnded, isEndedError, isValidKioskToken,
  newOrderIds, pickupLabel, KioskButton, KioskData, KioskOrder, KioskStatus,
} from '../../src/utils/kiosk';
import { enableSound, isPageHidden, keepScreenAwake, playChime } from '../../src/utils/kioskDevice';

// The staff order screen. It is reached from a secret link (/kiosk/<token>) and needs no login: the token is the only credential, and
// it can only ever show and move THIS restaurant's orders. It lives outside the owner area on purpose (see ownerRouting.ts).
const STATUS_ORDER: KioskStatus[] = ['placed', 'accepted', 'ready'];
const STATUS_COLOR: Record<KioskStatus, { main: string; tint: string }> = {
  placed: { main: '#E65100', tint: '#FFF3E0' },
  accepted: { main: '#1565C0', tint: '#E3F2FD' },
  ready: { main: '#2E7D32', tint: '#E8F5E9' },
};

export default function KioskScreen() {
  const { token: rawToken } = useLocalSearchParams<{ token: string }>();
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const valid = isValidKioskToken(token);
  const wide = useWindowDimensions().width >= 900;

  const [data, setData] = useState<KioskData | null>(null);
  const [ended, setEnded] = useState(!valid);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [flash, setFlash] = useState(false);
  const [ownerSignedIn, setOwnerSignedIn] = useState(false);
  const skewRef = useRef(0);
  const seenRef = useRef<Set<string> | null>(null);
  const soundRef = useRef(false);
  soundRef.current = soundOn;

  const refresh = useCallback(async () => {
    if (!valid) return;
    try {
      const result = await getKioskOrders(token as string);
      skewRef.current = clockSkewMs(result.server_time, Date.now());
      const fresh = newOrderIds(seenRef.current, result.orders);
      seenRef.current = new Set(result.orders.map((o) => o.id));
      setData(result);
      setOffline(false);
      setUpdatedAt(Date.now());
      if (fresh.length > 0) {
        if (soundRef.current) playChime();
        setFlash(true);
      }
    } catch (e: any) {
      if (isEndedError(e?.message)) setEnded(true);
      else setOffline(true);
    }
  }, [token, valid]);

  // Look for new orders every few seconds; skip while the tab is hidden, and look at once when it comes back.
  useEffect(() => {
    if (!valid || ended) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (!isPageHidden()) await refresh();
      if (!stopped) timer = setTimeout(tick, KIOSK_POLL_MS);
    };
    tick();
    const onVisible = () => {
      if (!isPageHidden()) refresh();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [valid, ended, refresh]);

  // a clock for "in 12 min" and "updated 5s ago"
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 6000);
    return () => clearTimeout(id);
  }, [flash]);

  // Was the owner's own login left on this device? Offer to sign out (the screen never needed it).
  useEffect(() => {
    supabase.auth.getSession().then(({ data: s }) => setOwnerSignedIn(!!s.session)).catch(() => {});
  }, []);

  const linkEnded = ended || (data ? hasEnded(data.expires_at, now, skewRef.current) : false);
  const groups = groupOrders(data?.orders ?? []);
  const newCount = groups.placed.length;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.title = newCount > 0 ? `(${newCount}) New orders` : 'Orders';
  }, [newCount]);

  async function turnOnSound() {
    enableSound();
    setSoundOn(true);
    keepScreenAwake();
  }

  async function signOutOwner() {
    await useRestaurantOwnerStore.getState().logout();
    setOwnerSignedIn(false);
  }

  async function act(order: KioskOrder, button: KioskButton) {
    if (busyId) return;
    // every button asks first, so a stray tap cannot move an order on
    const ask = confirmFor(button.action, order.customer_name);
    const ok = await confirmDialog(ask.title, ask.message, { confirmText: ask.confirmText, destructive: ask.destructive });
    if (!ok) return;
    setBusyId(order.id);
    try {
      // 'wrong_state' means someone else already moved it: the refresh below shows where it is now
      await runKioskAction(button.action, token as string, order.id);
      await refresh();
    } catch (e: any) {
      if (isEndedError(e?.message)) setEnded(true);
      else Alert.alert('That did not go through', 'Check the connection and try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (linkEnded) {
    return (
      <View style={styles.center}>
        <View style={styles.endedCard}>
          <Text style={styles.endedIcon}>🔒</Text>
          <Text style={styles.endedTitle}>This link has ended</Text>
          <Text style={styles.endedBody}>Ask the restaurant for today's new link.</Text>
        </View>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1565C0" />
        {offline && <Text style={styles.offline}>Can't reach the server. Trying again…</Text>}
      </View>
    );
  }

  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;

  return (
    <View style={styles.page}>
      <View style={[styles.header, flash && styles.headerFlash]}>
        <View style={styles.flex1}>
          <Text style={styles.restaurant} numberOfLines={1}>{data.restaurant_name}</Text>
          <Text style={styles.headerSub}>
            {newCount > 0 ? `${newCount} new order${newCount === 1 ? '' : 's'}` : 'No new orders'}
            {ago !== null ? `  ·  updated ${ago}s ago` : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={refresh} accessibilityRole="button" accessibilityLabel="Refresh the orders">
          <Text style={styles.refreshText}>↻ Refresh</Text>
        </TouchableOpacity>
      </View>

      {offline && <Text style={styles.offlineBar}>Can't reach the server. Showing the last orders; trying again…</Text>}

      {ownerSignedIn && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Kiosk is set up on this device. Sign out of your owner account now?</Text>
          <TouchableOpacity style={styles.bannerBtn} onPress={signOutOwner} accessibilityRole="button">
            <Text style={styles.bannerBtnText}>Sign out</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setOwnerSignedIn(false)} accessibilityRole="button">
            <Text style={styles.bannerLink}>Not now</Text>
          </TouchableOpacity>
        </View>
      )}

      {!soundOn && Platform.OS === 'web' && (
        <TouchableOpacity style={styles.soundBar} onPress={turnOnSound} accessibilityRole="button">
          <Text style={styles.soundBarText}>🔔 Tap here to turn on the new-order sound and keep this screen awake</Text>
        </TouchableOpacity>
      )}

      <ScrollView contentContainerStyle={[styles.board, wide && styles.boardWide]}>
        {STATUS_ORDER.map((status) => (
          <View key={status} style={[styles.column, wide && styles.columnWide]}>
            <View style={[styles.columnHeader, { backgroundColor: STATUS_COLOR[status].main }]}>
              <Text style={styles.columnTitle}>{STATUS_TITLES[status]}</Text>
              <Text style={styles.columnCount}>{groups[status].length}</Text>
            </View>
            {groups[status].length === 0 && <Text style={styles.empty}>Nothing here</Text>}
            {groups[status].map((order) => (
              <OrderCard key={order.id} order={order} now={now + skewRef.current} busy={busyId === order.id} anyBusy={!!busyId} onAct={act} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function OrderCard({
  order, now, busy, anyBusy, onAct,
}: {
  order: KioskOrder;
  now: number;
  busy: boolean;
  anyBusy: boolean;
  onAct: (order: KioskOrder, button: KioskButton) => void;
}) {
  const pickup = pickupLabel(order.pickup_at, now);
  const colors = STATUS_COLOR[order.status];
  return (
    <View style={[styles.card, { borderColor: colors.main, backgroundColor: colors.tint }]}>
      <View style={styles.details}>
        <View style={styles.cardTop}>
          <Text style={styles.pickupClock}>{pickup.clock}</Text>
          <Text style={[styles.pickupRelative, pickup.late && styles.late]}>{pickup.relative}</Text>
          <Text style={styles.customer} numberOfLines={1}>{order.customer_name || 'Customer'}</Text>
        </View>

        {/* every dish on one running line: "2 × Burger (medium)  ·  1 × Fries" */}
        <Text style={styles.items}>
          {order.items.map((item, i) => `${i > 0 ? '  ·  ' : ''}${item.quantity} × ${item.name}${item.note ? ` (${item.note})` : ''}`).join('')}
        </Text>

        {!!order.customer_note && <Text style={styles.noteText}>📝 {order.customer_note}</Text>}
      </View>

      {/* the buttons are stacked down the right, just left of the amount */}
      <View style={styles.buttons}>
        {BUTTONS_BY_STATUS[order.status].map((button) => (
          <TouchableOpacity
            key={button.action}
            style={[styles.button, button.tone === 'danger' ? styles.buttonDanger : styles.buttonPrimary, anyBusy && styles.buttonOff]}
            disabled={anyBusy}
            onPress={() => onAct(order, button)}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{button.label}</Text>}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.total}>{formatCents(order.total_cents)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f6f6' },
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6f6f6', padding: 24 },
  offline: { marginTop: 16, fontSize: 14, color: '#c62828' },
  endedCard: { backgroundColor: '#fff', borderRadius: 16, padding: 32, alignItems: 'center', maxWidth: 420, width: '100%', borderWidth: 1, borderColor: '#CFD8DC' },
  endedIcon: { fontSize: 44, marginBottom: 10 },
  endedTitle: { fontSize: 22, fontWeight: '800', color: '#222', textAlign: 'center' },
  endedBody: { fontSize: 16, color: '#546E7A', textAlign: 'center', marginTop: 8 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#263238', paddingHorizontal: 16, paddingVertical: 12 },
  headerFlash: { backgroundColor: '#E65100' },
  restaurant: { fontSize: 22, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 14, color: '#CFD8DC', marginTop: 2 },
  refreshBtn: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  refreshText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  offlineBar: { backgroundColor: '#FFEBEE', color: '#c62828', fontSize: 14, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 8 },

  banner: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, backgroundColor: '#E3F2FD', paddingHorizontal: 16, paddingVertical: 10 },
  bannerText: { flex: 1, minWidth: 220, fontSize: 14, color: '#0D47A1', fontWeight: '700' },
  bannerBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  bannerBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  bannerLink: { color: '#1565C0', fontWeight: '700', fontSize: 14 },
  soundBar: { backgroundColor: '#FFF8E1', paddingHorizontal: 16, paddingVertical: 12 },
  soundBarText: { fontSize: 15, fontWeight: '800', color: '#7A4A00', textAlign: 'center' },

  board: { padding: 6, gap: 6 },
  boardWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { gap: 4 },
  columnWide: { flex: 1 },
  columnHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  columnTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  columnCount: { color: '#fff', fontSize: 14, fontWeight: '800' },
  empty: { fontSize: 15, color: '#90A4AE', textAlign: 'center', paddingVertical: 14 },

  card: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, gap: 8, flexDirection: 'row', alignItems: 'center' },
  details: { flex: 1, gap: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  pickupClock: { fontSize: 16, fontWeight: '900', color: '#222' },
  pickupRelative: { fontSize: 12, fontWeight: '800', color: '#546E7A' },
  late: { color: '#c62828' },
  customer: { fontSize: 13, fontWeight: '800', color: '#222', flex: 1, textAlign: 'right' },
  items: { fontSize: 13, fontWeight: '700', color: '#222' },
  noteText: { fontSize: 12, color: '#5D4037', fontWeight: '700', backgroundColor: '#FFF8E1', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  total: { fontSize: 14, fontWeight: '900', color: '#37474F', minWidth: 48, textAlign: 'right' },
  buttons: { gap: 4, width: 84 },
  button: { minHeight: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  buttonPrimary: { backgroundColor: '#2E7D32' },
  buttonDanger: { backgroundColor: '#c62828' },
  buttonOff: { opacity: 0.55 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
