import { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { getRestaurantForOwner, getRestaurantMenuItems } from '../../src/api/restaurantAuth';
import { setMenuItemPrice, setOrderingEnabled, updateOrderingSettings } from '../../src/api/ordering';
import { getPaymentStatus, type PaymentStatus } from '../../src/api/payments';
import { useIsChainRestaurant } from '../../src/hooks/useIsChainRestaurant';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';
import {
  MAX_PREP_MINUTES, MIN_PREP_MINUTES, PREP_STEP_MINUTES, TIMEZONE_CHOICES, canTurnOn, centsToInput, clampPrep, countOrderable,
  deviceTimezone, orderingRequirements, parsePriceToCents, timezoneLabel, PricedItem,
} from '../../src/utils/ordering';

interface DishRow extends PricedItem {
  id: string;
}

// Tools -> Online Ordering: the owner's switch (off by default), the prices of the dishes, the timezone and the prep time.
export default function OnlineOrderingScreen() {
  const router = useRouter();
  const { restaurant, setRestaurant } = useRestaurantOwnerStore();
  const { data: isChain } = useIsChainRestaurant(restaurant?.name);
  const { favorites, toggleFavorite } = useFavoritePages();
  const [dishes, setDishes] = useState<DishRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'switch' | 'settings' | 'prices' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<number>(restaurant?.ordering_prep_minutes ?? 20);
  const [zone, setZone] = useState<string | null>(restaurant?.timezone ?? null);
  const [payment, setPayment] = useState<PaymentStatus | null>(null);

  const loadDishes = useCallback(async () => {
    if (!restaurant) return;
    try {
      const rows = (await getRestaurantMenuItems(restaurant.name, restaurant.google_place_id)) as DishRow[];
      // verified dishes first, then by name
      rows.sort((a, b) => Number(!!b.is_verified) - Number(!!a.is_verified) || a.name.localeCompare(b.name));
      setDishes(rows);
      setDrafts(Object.fromEntries(rows.map((r) => [r.item_id, centsToInput(r.price_cents)])));
      setRowErrors({});
    } catch (e: any) {
      setError(e?.message || 'Your dishes could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [restaurant]);

  useFocusEffect(
    useCallback(() => {
      loadDishes();
      if (restaurant) getPaymentStatus(restaurant.id).then(setPayment).catch(() => setPayment(null));
    }, [loadDishes, restaurant])
  );

  async function refreshRestaurant() {
    const fresh = await getRestaurantForOwner();
    if (fresh) setRestaurant(fresh as any);
  }

  const zoneChoices = useMemo(() => {
    const extra: { name: string; label: string }[] = [];
    const device = deviceTimezone();
    for (const name of [restaurant?.timezone, device]) {
      if (name && !TIMEZONE_CHOICES.some((t) => t.name === name) && !extra.some((t) => t.name === name)) {
        extra.push({ name, label: name === device && name !== restaurant?.timezone ? `This device: ${name}` : name });
      }
    }
    return [...TIMEZONE_CHOICES, ...extra];
  }, [restaurant?.timezone]);

  if (!restaurant) return null;

  const enabled = restaurant.ordering_enabled === true;
  const readiness = {
    status: restaurant.status,
    timezone: restaurant.timezone,
    items: dishes,
    isFranchise: isChain === true,
    payments: payment ? { required: payment.required, ready: payment.canTakePayments } : undefined,
  };
  const requirements = orderingRequirements(readiness);
  const ready = canTurnOn(readiness);
  const settingsDirty = zone !== (restaurant.timezone ?? null) || prep !== (restaurant.ordering_prep_minutes ?? 20);
  const dirtyDishes = dishes.filter((d) => {
    const parsed = parsePriceToCents(drafts[d.item_id] ?? '');
    return !parsed.ok || parsed.cents !== (d.price_cents ?? null);
  });

  async function toggleOrdering(next: boolean) {
    setBusy('switch');
    setError(null);
    try {
      await setOrderingEnabled(restaurant!.id, next);
      await refreshRestaurant();
    } catch (e: any) {
      setError(e?.message || 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings() {
    setBusy('settings');
    setError(null);
    try {
      await updateOrderingSettings(restaurant!.id, {
        prepMinutes: prep !== (restaurant!.ordering_prep_minutes ?? 20) ? prep : undefined,
        timezone: zone && zone !== (restaurant!.timezone ?? null) ? zone : undefined,
      });
      await refreshRestaurant();
    } catch (e: any) {
      setError(e?.message || 'The settings could not be saved');
    } finally {
      setBusy(null);
    }
  }

  async function savePrices() {
    // check every typed price first, so one typo does not leave the rest half saved
    const errors: Record<string, string> = {};
    const toSave: { id: string; cents: number | null }[] = [];
    for (const d of dirtyDishes) {
      const parsed = parsePriceToCents(drafts[d.item_id] ?? '');
      if (!parsed.ok) errors[d.item_id] = parsed.error;
      else toSave.push({ id: d.item_id, cents: parsed.cents });
    }
    setRowErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy('prices');
    setError(null);
    const failed: string[] = [];
    for (const row of toSave) {
      try {
        await setMenuItemPrice(row.id, row.cents);
      } catch (e: any) {
        errors[row.id] = e?.message || 'Not saved';
        failed.push(row.id);
      }
    }
    setRowErrors(errors);
    await loadDishes();
    setRowErrors(errors);
    setBusy(null);
    if (failed.length === 0) Alert.alert('Prices saved', `${toSave.length} price${toSave.length === 1 ? '' : 's'} updated.`);
    else setError(`${failed.length} price${failed.length === 1 ? '' : 's'} could not be saved. See the dishes marked below.`);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Online Ordering</Text>
        <FavoriteHeart active={favorites.has('tool-ordering')} onPress={() => toggleFavorite('tool-ordering')} size="large" />
      </View>
      <Text style={styles.subtitle}>{restaurant.name}</Text>

      {isChain === true ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Not available for franchise restaurants</Text>
          <Text style={styles.hint}>
            A franchise shares one menu across its branches, so it can't have its own prices or take orders here.
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.card, enabled && styles.cardOn]}>
            <Text style={styles.cardTitle}>{enabled ? '🟢 Ordering is on' : '⚪ Ordering is off'}</Text>
            <Text style={styles.hint}>
              {enabled
                ? 'Customers can order for pickup from your restaurant. Turn it off any time; orders already placed stay on your order screen.'
                : 'Ordering is off until you turn it on. Customers only see it for your restaurant once it is on.'}
            </Text>

            {!enabled && (
              <View style={styles.checklist}>
                {requirements.map((r) => (
                  <Text key={r.key} style={[styles.check, r.met ? styles.checkMet : styles.checkMissing]}>
                    {r.met ? '✓' : '○'} {r.text}
                  </Text>
                ))}
                {requirements.some((r) => r.key === 'payments' && !r.met) && (
                  <TouchableOpacity onPress={() => router.push('/restaurant/payments' as any)} accessibilityRole="link">
                    <Text style={styles.link}>Connect your bank account →</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <TouchableOpacity
              style={[styles.switchBtn, enabled ? styles.switchBtnOff : styles.switchBtnOn, (busy === 'switch' || (!enabled && !ready)) && styles.disabled]}
              disabled={busy === 'switch' || (!enabled && !ready)}
              onPress={() => toggleOrdering(!enabled)}
              accessibilityRole="button"
            >
              {busy === 'switch' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.switchText}>{enabled ? 'Turn ordering off' : 'Turn ordering on'}</Text>
              )}
            </TouchableOpacity>
            {enabled && (
              <TouchableOpacity onPress={() => router.push('/restaurant/kiosk-access' as any)} accessibilityRole="link">
                <Text style={styles.link}>Set up the order screen for your staff →</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Timezone and prep time</Text>
            <Text style={styles.hint}>
              Your timezone decides when your day ends: the staff link stops at your midnight, and customers pick pickup times for today
              in your time. The prep time is the least notice a customer must give.
            </Text>
            <View style={styles.chips}>
              {zoneChoices.map((t) => (
                <TouchableOpacity
                  key={t.name}
                  style={[styles.chip, zone === t.name && styles.chipOn]}
                  onPress={() => setZone(t.name)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: zone === t.name }}
                >
                  <Text style={[styles.chipText, zone === t.name && styles.chipTextOn]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!zone && <Text style={styles.warn}>Choose your timezone.</Text>}
            {!!zone && <Text style={styles.small}>{timezoneLabel(zone)}</Text>}

            <View style={styles.stepper}>
              <Text style={styles.stepperLabel}>Prep time</Text>
              <TouchableOpacity
                style={[styles.stepBtn, prep <= MIN_PREP_MINUTES && styles.disabled]}
                disabled={prep <= MIN_PREP_MINUTES}
                onPress={() => setPrep(clampPrep(prep - PREP_STEP_MINUTES))}
                accessibilityRole="button"
                accessibilityLabel="Less prep time"
              >
                <Text style={styles.stepText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepValue}>{prep} min</Text>
              <TouchableOpacity
                style={[styles.stepBtn, prep >= MAX_PREP_MINUTES && styles.disabled]}
                disabled={prep >= MAX_PREP_MINUTES}
                onPress={() => setPrep(clampPrep(prep + PREP_STEP_MINUTES))}
                accessibilityRole="button"
                accessibilityLabel="More prep time"
              >
                <Text style={styles.stepText}>+</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, (!settingsDirty || busy === 'settings') && styles.disabled]}
              disabled={!settingsDirty || busy === 'settings'}
              onPress={saveSettings}
              accessibilityRole="button"
            >
              {busy === 'settings' ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Prices</Text>
            <Text style={styles.hint}>
              Customers can order a dish once it is confirmed and has a price. A blank price means it can't be ordered.{' '}
              {countOrderable(dishes)} of your dishes can be ordered now.
            </Text>

            {loading && <ActivityIndicator style={styles.spinner} color="#1565C0" />}
            {!loading && dishes.length === 0 && (
              <TouchableOpacity onPress={() => router.push('/restaurant/menu-items' as any)} accessibilityRole="link">
                <Text style={styles.link}>You have no dishes yet. Add your menu first →</Text>
              </TouchableOpacity>
            )}

            {dishes.map((d) => (
              <View key={d.item_id} style={styles.dishRow}>
                <View style={styles.flex1}>
                  <Text style={styles.dishName}>{d.name}</Text>
                  {!d.is_verified && <Text style={styles.dishTag}>Not confirmed yet: confirm it to take orders for it</Text>}
                  {!!d.is_verified && !!d.is_out_of_stock && <Text style={styles.dishTag}>Marked sold out</Text>}
                  {!!rowErrors[d.item_id] && <Text style={styles.rowError}>{rowErrors[d.item_id]}</Text>}
                </View>
                <Text style={styles.dollar}>$</Text>
                <TextInput
                  style={[styles.priceInput, !!rowErrors[d.item_id] && styles.priceInputBad]}
                  value={drafts[d.item_id] ?? ''}
                  onChangeText={(text) => setDrafts((prev) => ({ ...prev, [d.item_id]: text }))}
                  placeholder="0.00"
                  placeholderTextColor="#90A4AE"
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Price of ${d.name}`}
                />
              </View>
            ))}

            {dishes.length > 0 && (
              <TouchableOpacity
                style={[styles.saveBtn, (dirtyDishes.length === 0 || busy === 'prices') && styles.disabled]}
                disabled={dirtyDishes.length === 0 || busy === 'prices'}
                onPress={savePrices}
                accessibilityRole="button"
              >
                {busy === 'prices' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveText}>
                    {dirtyDishes.length === 0 ? 'Save prices' : `Save ${dirtyDishes.length} price${dirtyDishes.length === 1 ? '' : 's'}`}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 40, gap: 12 },
  flex1: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#222' },
  subtitle: { fontSize: 14, color: '#546E7A', marginTop: -6 },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#CFD8DC', padding: 16, gap: 10 },
  cardOn: { borderColor: '#2E7D32', backgroundColor: '#F1F8F2' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222' },
  hint: { fontSize: 13, color: '#546E7A', lineHeight: 18 },
  small: { fontSize: 12, color: '#546E7A' },
  warn: { fontSize: 13, color: '#E65100', fontWeight: '700' },
  checklist: { gap: 4 },
  check: { fontSize: 13, fontWeight: '700' },
  checkMet: { color: '#2E7D32' },
  checkMissing: { color: '#E65100' },
  switchBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  switchBtnOn: { backgroundColor: '#2E7D32' },
  switchBtnOff: { backgroundColor: '#c62828' },
  switchText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  link: { fontSize: 13, fontWeight: '800', color: '#1565C0' },
  disabled: { opacity: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#ECEFF1', borderWidth: 1.5, borderColor: '#B0BEC5' },
  chipOn: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  chipText: { fontSize: 13, fontWeight: '800', color: '#546E7A' },
  chipTextOn: { color: '#fff' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperLabel: { fontSize: 14, fontWeight: '800', color: '#222', marginRight: 4 },
  stepBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#ECEFF1', borderWidth: 1.5, borderColor: '#1565C0', alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 20, fontWeight: '800', color: '#1565C0', lineHeight: 22 },
  stepValue: { fontSize: 16, fontWeight: '800', color: '#222', minWidth: 64, textAlign: 'center' },
  saveBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  spinner: { alignSelf: 'flex-start' },
  dishRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8 },
  dishName: { fontSize: 14, fontWeight: '700', color: '#222' },
  dishTag: { fontSize: 11, color: '#7A4A00', marginTop: 2 },
  rowError: { fontSize: 12, color: '#c62828', marginTop: 2 },
  dollar: { fontSize: 15, fontWeight: '800', color: '#546E7A' },
  priceInput: { width: 84, borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 15, color: '#222', textAlign: 'right', backgroundColor: '#fff' },
  priceInputBad: { borderColor: '#c62828' },
  error: { fontSize: 13, color: '#c62828', fontWeight: '700' },
});
