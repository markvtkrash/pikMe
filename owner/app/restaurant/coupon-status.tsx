import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantCoupons, getRestaurantMenuItems, updateCoupon, deleteCoupon } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';

interface Coupon {
  id: string;
  coupon_code: string;
  coupon_type: string;
  discount_value: number;
  expiry_date: string;
  is_active: boolean;
  menu_item_id?: string | null;
  usage_limit?: number;
  times_used?: number;
}

interface MenuItem {
  id: string;
  item_id: string;
  name: string;
}

const ITEM_SPECIFIC_TYPES = ['item_percent', 'item_fixed'];

type StatusKey = 'active' | 'inactive' | 'expired' | 'orphaned';

const STATUS_FILTERS: { key: StatusKey; label: string; color: string }[] = [
  { key: 'active', label: '✓ Active', color: '#4CAF50' },
  { key: 'inactive', label: '⏸ Inactive', color: '#757575' },
  { key: 'expired', label: '❌ Expired', color: '#c62828' },
  { key: 'orphaned', label: '⚠️ Orphaned', color: '#FFA500' },
];

// A coupon's statuses aren't mutually exclusive — e.g. still active but
// pointing at a deleted menu item (active AND orphaned) — so this computes
// all that apply, and the multi-select filter below shows the UNION of
// coupons matching ANY selected status, not a single-category split like
// the four separate pages this replaces.
function computeStatuses(c: Coupon, currentItemIds: Set<string>): Set<StatusKey> {
  const now = new Date();
  const expired = new Date(c.expiry_date) <= now;
  const statuses = new Set<StatusKey>();
  if (expired) statuses.add('expired');
  else if (c.is_active) statuses.add('active');
  else statuses.add('inactive');
  if (ITEM_SPECIFIC_TYPES.includes(c.coupon_type) && c.menu_item_id && !currentItemIds.has(c.menu_item_id)) {
    statuses.add('orphaned');
  }
  return statuses;
}

export default function CouponStatusScreen() {
  const router = useRouter();
  const { restaurant } = useRestaurantOwnerStore();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [currentItems, setCurrentItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilters, setSelectedFilters] = useState<Set<StatusKey>>(new Set(['active']));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [restaurant])
  );

  async function loadData() {
    if (!restaurant) {
      router.replace('/restaurant/dashboard');
      return;
    }
    try {
      const [couponsData, itemsData] = await Promise.all([
        getRestaurantCoupons(restaurant.id),
        getRestaurantMenuItems(restaurant.name),
      ]);
      setCoupons(couponsData as Coupon[]);
      setCurrentItems(itemsData as MenuItem[]);
    } catch (error: any) {
      console.error('[coupon-status] Load error:', error);
      Alert.alert('Error', 'Failed to load coupons');
    } finally {
      setLoading(false);
    }
  }

  const currentItemIds = useMemo(() => new Set(currentItems.map((i) => i.item_id)), [currentItems]);
  const itemNameById = useMemo(() => new Map(currentItems.map((i) => [i.item_id, i.name])), [currentItems]);

  const rows = useMemo(
    () => coupons.map((c) => ({ coupon: c, statuses: computeStatuses(c, currentItemIds) })),
    [coupons, currentItemIds]
  );

  const filteredRows = rows.filter(
    ({ statuses }) => selectedFilters.size > 0 && [...selectedFilters].some((f) => statuses.has(f))
  );

  function toggleFilter(key: StatusKey) {
    setSelectedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleDeactivate(couponId: string) {
    setBusyId(couponId);
    try {
      await updateCoupon(couponId, { isActive: false });
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to deactivate coupon');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReactivate(couponId: string) {
    setBusyId(couponId);
    try {
      await updateCoupon(couponId, { isActive: true });
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to reactivate coupon');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReassign(couponId: string, newItemId: string) {
    setBusyId(couponId);
    try {
      await updateCoupon(couponId, { menuItemId: newItemId });
      setExpandedId(null);
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to reassign coupon');
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(couponId: string, couponCode: string) {
    if (!confirm(`Delete ${couponCode}? This cannot be undone.`)) return;
    performDelete(couponId);
  }

  async function performDelete(couponId: string) {
    setBusyId(couponId);
    try {
      await deleteCoupon(couponId);
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to delete coupon');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Manage Coupons</Text>
          <Text style={styles.count}>{filteredRows.length} shown</Text>
        </View>
      </View>

      <Text style={styles.filterHint}>👆 Select one or more to filter</Text>
      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((f) => {
          const selected = selectedFilters.has(f.key);
          return (
            <TouchableOpacity
              key={f.key}
              onPress={() => toggleFilter(f.key)}
              style={styles.filterCheckRow}
            >
              <View style={[styles.checkbox, { borderColor: f.color }, selected && { backgroundColor: f.color }]}>
                {selected && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
              <Text style={[styles.filterCheckLabel, { color: f.color }]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedFilters.size === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🎟️</Text>
          <Text style={styles.emptyText}>Pick at least one status above</Text>
        </View>
      ) : filteredRows.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🎟️</Text>
          <Text style={styles.emptyText}>No coupons match</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRows}
          keyExtractor={({ coupon }) => coupon.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: { coupon, statuses } }) => {
            const busy = busyId === coupon.id;
            const expanded = expandedId === coupon.id;
            return (
              <View style={styles.couponCard}>
                <View style={styles.badgeRow}>
                  {STATUS_FILTERS.filter((f) => statuses.has(f.key)).map((f) => (
                    <View key={f.key} style={[styles.statusBadge, { backgroundColor: f.color }]}>
                      <Text style={styles.statusBadgeText}>{f.label}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.couponHeader}>
                  <Text style={styles.couponCode}>{coupon.coupon_code}</Text>
                  <Text style={styles.discountValue}>
                    {coupon.coupon_type.includes('percent') ? `${coupon.discount_value}%` : `$${coupon.discount_value}`} off
                  </Text>
                </View>
                <Text style={styles.itemNameText}>
                  {ITEM_SPECIFIC_TYPES.includes(coupon.coupon_type)
                    ? coupon.menu_item_id && itemNameById.has(coupon.menu_item_id)
                      ? `🍽️ ${itemNameById.get(coupon.menu_item_id)}`
                      : '⚠️ Menu item no longer exists'
                    : '🎉 Any item'}
                </Text>
                <Text style={styles.expiryText}>Expires {new Date(coupon.expiry_date).toLocaleDateString()}</Text>
                {(coupon.times_used !== undefined || coupon.usage_limit) && (
                  <Text style={styles.usageText}>
                    Used: {coupon.times_used || 0}{coupon.usage_limit ? `/${coupon.usage_limit}` : '/∞'} times
                  </Text>
                )}

                <View style={styles.actionsRow}>
                  {statuses.has('orphaned') && (
                    <TouchableOpacity
                      style={styles.reassignBtn}
                      onPress={() => setExpandedId(expanded ? null : coupon.id)}
                      disabled={busy}
                    >
                      <Text style={styles.reassignBtnText}>{expanded ? 'Cancel' : '↻ Reassign'}</Text>
                    </TouchableOpacity>
                  )}
                  {statuses.has('active') && (
                    <TouchableOpacity
                      style={styles.deactivateBtn}
                      onPress={() => handleDeactivate(coupon.id)}
                      disabled={busy}
                    >
                      <Text style={styles.deactivateBtnText}>⏸ Deactivate</Text>
                    </TouchableOpacity>
                  )}
                  {statuses.has('inactive') && (
                    <TouchableOpacity
                      style={styles.reactivateBtn}
                      onPress={() => handleReactivate(coupon.id)}
                      disabled={busy}
                    >
                      <Text style={styles.reactivateBtnText}>▶ Reactivate</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => router.push(`/restaurant/coupon/${coupon.id}/edit`)}
                    disabled={busy}
                  >
                    <Text style={styles.editBtnText}>✎ Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDelete(coupon.id, coupon.coupon_code)}
                    disabled={busy}
                  >
                    {busy ? <ActivityIndicator size="small" color="#e53e3e" /> : <Text style={styles.deleteBtnText}>🗑️ Delete</Text>}
                  </TouchableOpacity>
                </View>

                {expanded && (
                  <View style={styles.itemPicker}>
                    <Text style={styles.itemPickerLabel}>Pick a current menu item:</Text>
                    {currentItems.length === 0 ? (
                      <Text style={styles.noItemsText}>No current menu items to pick from yet.</Text>
                    ) : (
                      currentItems.map((menuItem) => (
                        <TouchableOpacity
                          key={menuItem.item_id}
                          style={styles.itemOption}
                          onPress={() => handleReassign(coupon.id, menuItem.item_id)}
                          disabled={busy}
                        >
                          <Text style={styles.itemOptionText}>{menuItem.name}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  count: { fontSize: 12, color: '#999' },

  filterHint: {
    fontSize: 14, fontWeight: '700', color: '#1565C0', paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: '#fff',
  },
  filterRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  filterCheckRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingRight: 4 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxMark: { fontSize: 13, fontWeight: '900', color: '#fff', lineHeight: 14 },
  filterCheckLabel: { fontSize: 13, fontWeight: '700' },

  list: { padding: 16 },
  couponCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, elevation: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statusBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  couponHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' },
  couponCode: { fontSize: 16, fontWeight: '800', color: '#222' },
  discountValue: { fontSize: 14, fontWeight: '700', color: '#4CAF50' },
  itemNameText: { fontSize: 12.5, color: '#555', fontWeight: '600', marginBottom: 4 },
  expiryText: { fontSize: 11, color: '#999' },
  usageText: { fontSize: 11, color: '#666', fontWeight: '600', marginTop: 2 },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  editBtn: { backgroundColor: '#4CAF50', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  editBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  deleteBtn: { backgroundColor: '#FFEBEE', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  deleteBtnText: { fontSize: 12, fontWeight: '700', color: '#e53e3e' },
  deactivateBtn: { backgroundColor: '#FFF3E0', borderWidth: 1.5, borderColor: '#E65100', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  deactivateBtnText: { fontSize: 12, fontWeight: '700', color: '#E65100' },
  reactivateBtn: { backgroundColor: '#E8F5E9', borderWidth: 1.5, borderColor: '#4CAF50', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  reactivateBtnText: { fontSize: 12, fontWeight: '700', color: '#2e7d32' },
  reassignBtn: { backgroundColor: '#FFF8E1', borderWidth: 1.5, borderColor: '#FFA500', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  reassignBtnText: { fontSize: 12, fontWeight: '700', color: '#FFA500' },

  itemPicker: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  itemPickerLabel: { fontSize: 12, fontWeight: '700', color: '#666', marginBottom: 8 },
  noItemsText: { fontSize: 12, color: '#999', fontStyle: 'italic' },
  itemOption: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#f6f6f6', borderRadius: 8, marginBottom: 6 },
  itemOptionText: { fontSize: 13, color: '#222', fontWeight: '600' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#222' },
});
