import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantCoupons, getRestaurantMenuItems, updateCoupon, deleteCoupon } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';

interface Coupon {
  id: string;
  coupon_type: string;
  discount_value: number;
  coupon_code: string;
  menu_item_id: string | null;
  expiry_date: string;
  is_active: boolean;
}

interface MenuItem {
  id: string;
  item_id: string;
  name: string;
}

const ITEM_SPECIFIC_TYPES = ['item_percent', 'item_fixed'];

export default function OrphanedCouponsScreen() {
  const router = useRouter();
  const { restaurant } = useRestaurantOwnerStore();
  const [orphanedCoupons, setOrphanedCoupons] = useState<Coupon[]>([]);
  const [currentItems, setCurrentItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const [coupons, items] = await Promise.all([
        getRestaurantCoupons(restaurant.id),
        getRestaurantMenuItems(restaurant.name),
      ]);
      setCurrentItems(items);

      const currentItemIds = new Set(items.map((i: MenuItem) => i.item_id));
      const orphaned = (coupons as Coupon[]).filter(
        (c) => ITEM_SPECIFIC_TYPES.includes(c.coupon_type) && c.menu_item_id && !currentItemIds.has(c.menu_item_id)
      );
      setOrphanedCoupons(orphaned);
    } catch (error: any) {
      console.error('[orphaned-coupons] Load error:', error);
      Alert.alert('Error', 'Failed to load coupons');
    } finally {
      setLoading(false);
    }
  }

  async function handleReactivate(couponId: string, newItemId: string) {
    setBusyId(couponId);
    try {
      await updateCoupon(couponId, { menuItemId: newItemId });
      setExpandedId(null);
      await loadData();
      Alert.alert('Success', 'Coupon reactivated with the new menu item');
    } catch (error: any) {
      console.error('[orphaned-coupons] Reactivate error:', error);
      Alert.alert('Error', error.message || 'Failed to reactivate coupon');
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(couponId: string, couponCode: string) {
    const confirmed = confirm(`Delete ${couponCode}? This cannot be undone.`);
    if (!confirmed) return;
    performDelete(couponId);
  }

  async function performDelete(couponId: string) {
    setBusyId(couponId);
    try {
      await deleteCoupon(couponId);
      await loadData();
    } catch (error: any) {
      console.error('[orphaned-coupons] Delete error:', error);
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
          <Text style={styles.title}>Orphaned Coupons</Text>
          <Text style={styles.subtitle}>{orphanedCoupons.length} need attention</Text>
        </View>
      </View>

      {orphanedCoupons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>✓</Text>
          <Text style={styles.emptyText}>All caught up!</Text>
          <Text style={styles.emptySubtext}>No coupons are pointing at missing menu items</Text>
        </View>
      ) : (
        <FlatList
          data={orphanedCoupons}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={styles.explainer}>
              These coupons were tied to specific menu items that no longer exist (usually because the
              restaurant's real menu was added or refreshed). Reassign each one to a current item, or
              delete it.
            </Text>
          }
          renderItem={({ item }) => {
            const expanded = expandedId === item.id;
            const busy = busyId === item.id;
            return (
              <View style={styles.couponCard}>
                <View style={styles.couponHeader}>
                  <Text style={styles.couponCode}>{item.coupon_code}</Text>
                  <Text style={styles.discountValue}>
                    {item.coupon_type.includes('percent') ? `${item.discount_value}%` : `$${item.discount_value}`} off
                  </Text>
                </View>
                <Text style={styles.expiryText}>
                  Expires {new Date(item.expiry_date).toLocaleDateString()}
                </Text>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.reactivateBtn}
                    onPress={() => setExpandedId(expanded ? null : item.id)}
                    disabled={busy}
                  >
                    <Text style={styles.reactivateBtnText}>
                      {expanded ? 'Cancel' : '↻ Reactivate'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDelete(item.id, item.coupon_code)}
                    disabled={busy}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#e53e3e" />
                    ) : (
                      <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
                    )}
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
                          onPress={() => handleReactivate(item.id, menuItem.item_id)}
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
  subtitle: { fontSize: 13, color: '#999' },

  list: { padding: 16 },
  explainer: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },

  couponCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, elevation: 1, borderLeftWidth: 4, borderLeftColor: '#FFA500' },
  couponHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  couponCode: { fontSize: 16, fontWeight: '800', color: '#222' },
  discountValue: { fontSize: 14, fontWeight: '700', color: '#4CAF50' },
  expiryText: { fontSize: 11, color: '#999', marginBottom: 12 },

  actionsRow: { flexDirection: 'row', gap: 8 },
  reactivateBtn: { flex: 1, backgroundColor: '#E8F5E9', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  reactivateBtnText: { fontSize: 13, fontWeight: '700', color: '#2e7d32' },
  deleteBtn: { flex: 1, backgroundColor: '#FFEBEE', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  deleteBtnText: { fontSize: 13, fontWeight: '700', color: '#e53e3e' },

  itemPicker: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  itemPickerLabel: { fontSize: 12, fontWeight: '700', color: '#666', marginBottom: 8 },
  noItemsText: { fontSize: 12, color: '#999', fontStyle: 'italic' },
  itemOption: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#f6f6f6', borderRadius: 8, marginBottom: 6 },
  itemOptionText: { fontSize: 13, color: '#222', fontWeight: '600' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
  emptySubtext: { fontSize: 13, color: '#999', marginTop: 4 },
});
