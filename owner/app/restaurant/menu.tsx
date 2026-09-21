import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { getRestaurantMenuItems, getRestaurantCoupons, verifyMenuItem } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';

interface MenuItem {
  id: string;
  name: string;
  calories: number | null;
  protein_g: number | null;
  item_id: string;
  is_verified: boolean;
}

interface Coupon {
  id: string;
  menu_item_id?: string;
  is_active: boolean;
  coupon_code: string;
  expiry_date: string;
  usage_limit: number | null;
  times_used: number;
}

export default function RestaurantMenuScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ addCoupon?: string }>();
  const isAddingCoupon = params?.addCoupon === 'true';
  const { owner, restaurant, session } = useRestaurantOwnerStore();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [verifyModalItem, setVerifyModalItem] = useState<MenuItem | null>(null);
  const [verifyModalName, setVerifyModalName] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!owner || !restaurant) {
      router.replace('/restaurant/auth/login');
      return;
    }
    loadMenuItems();
  }, [owner, restaurant]);

  async function loadMenuItems() {
    if (!restaurant) return;
    try {
      const [items, allCoupons] = await Promise.all([
        getRestaurantMenuItems(restaurant.name),
        getRestaurantCoupons(restaurant.id),
      ]);
      setMenuItems(items);
      console.log('[menu] Loaded menu items:', items.length);
      console.log('[menu] Menu item IDs:', JSON.stringify(items.map(i => ({ name: i.name, item_id: i.item_id })), null, 2));

      // Filter for active and unexpired coupons only
      const now = new Date();
      const activeCoupons = allCoupons.filter(c => {
        const isActive = c.is_active;
        const isNotExpired = new Date(c.expiry_date) > now;
        return isActive && isNotExpired;
      });
      console.log('[menu] All coupons:', allCoupons.length, 'Active/non-expired:', activeCoupons.length);
      console.log('[menu] Active coupons detail:', JSON.stringify(activeCoupons.map(c => ({ code: c.coupon_code, type: c.coupon_type, menu_item_id: c.menu_item_id })), null, 2));

      // Check for matching coupons
      const matchingCoupons = activeCoupons.filter(c => c.menu_item_id && items.some(i => i.item_id === c.menu_item_id));
      console.log('[menu] Matching coupons:', matchingCoupons.length, 'out of', activeCoupons.length);

      setCoupons(activeCoupons);
    } catch (error) {
      console.error('[menu] Load error:', error);
      Alert.alert('Error', 'Failed to load menu items');
    } finally {
      setLoading(false);
    }
  }

  const filteredItems = menuItems.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function openVerifyModal(item: MenuItem) {
    setVerifyModalItem(item);
    setVerifyModalName(item.name);
  }

  async function confirmVerify() {
    if (!verifyModalItem) return;
    const itemId = verifyModalItem.item_id;
    const trimmedName = verifyModalName.trim();
    if (!trimmedName) return;
    setVerifying(true);
    try {
      const nameChanged = trimmedName !== verifyModalItem.name;
      await verifyMenuItem(itemId, nameChanged ? trimmedName : undefined);
      setMenuItems((prev) =>
        prev.map((i) => (i.item_id === itemId ? { ...i, name: trimmedName, is_verified: true } : i))
      );
      setVerifyModalItem(null);
    } catch (error: any) {
      console.error('[menu] Verify error:', error);
      Alert.alert('Error', error.message || 'Failed to verify item');
    } finally {
      setVerifying(false);
    }
  }

  if (!owner || !restaurant) return null;

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
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
          >
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Add Coupons</Text>
            <Text style={styles.subtitle}>{restaurant.name}</Text>
            <Text style={styles.addCouponHint}>Click on an item to add or edit coupon</Text>
          </View>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtonsRow}>
        <TouchableOpacity
          style={styles.expiredBtn}
          onPress={() => router.push('/restaurant/expired')}
        >
          <Text style={styles.expiredBtnText}>📭 Expired</Text>
        </TouchableOpacity>
      </View>


      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search menu items..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Menu Items List */}
      {menuItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>No menu items yet</Text>
          <Text style={styles.emptySubtext}>Add items from Menu Management</Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const existingCoupon = coupons.find(c => c.menu_item_id === item.item_id);
            // An unconfirmed item might be a hallucinated AI guess — no
            // coupon should ever get tied to a dish that might not actually
            // exist. Editing an already-existing coupon is still allowed
            // even if the item was unconfirmed afterward; only creating a
            // brand-new one is blocked.
            const canAddCoupon = item.is_verified || !!existingCoupon;
            const handlePress = () => {
              if (existingCoupon) {
                // Edit existing coupon
                router.push(`/restaurant/coupon/${existingCoupon.id}/edit`);
              } else {
                // Create new coupon
                router.push({
                  pathname: '/restaurant/coupon/new',
                  params: { menuItemId: item.item_id, menuItemName: item.name },
                });
              }
            };

            const cardContent = (
              <>
                <View style={styles.itemInfo}>
                  <View style={styles.itemNameRow}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    {existingCoupon && <Text style={styles.couponIcon}>🎟️</Text>}
                  </View>
                  <Text style={styles.itemNutrition}>
                    {item.calories ? `${Math.round(item.calories)} cal` : 'N/A'} •{' '}
                    {item.protein_g ? `${item.protein_g}g protein` : 'N/A'}
                  </Text>
                  {!item.is_verified && (
                    <Text style={styles.unverifiedLabel}>⚠️ Unconfirmed — review in Menu Items</Text>
                  )}
                  {existingCoupon && (
                    <View style={styles.couponDetailsBox}>
                      <View style={styles.couponHeader}>
                        <Text style={styles.couponTicketIcon}>🎫</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.couponCode}>{existingCoupon.coupon_code}</Text>
                          <Text style={styles.couponExpiry}>
                            Expires: {new Date(existingCoupon.expiry_date).toLocaleDateString()}
                          </Text>
                          <Text style={styles.couponUsage}>
                            Used {existingCoupon.times_used}/{existingCoupon.usage_limit ?? '∞'} times
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
                {canAddCoupon ? (
                  <Text style={styles.actionText}>{existingCoupon ? '✎ Edit' : '🎟️ Add'}</Text>
                ) : (
                  <TouchableOpacity
                    style={styles.verifyToAddBtn}
                    onPress={() => openVerifyModal(item)}
                  >
                    <Text style={styles.verifyToAddBtnText}>Verify to Add Coupon</Text>
                  </TouchableOpacity>
                )}
              </>
            );

            if (!canAddCoupon) {
              return <View style={[styles.itemCard, styles.itemCardDisabled]}>{cardContent}</View>;
            }
            return (
              <TouchableOpacity
                style={[styles.itemCard, existingCoupon && styles.itemCardWithCoupon]}
                onPress={handlePress}
              >
                {cardContent}
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.noResultsText}>No items match "{searchQuery}"</Text>
          }
        />
      )}
    </View>

    <Modal
      visible={!!verifyModalItem}
      transparent
      animationType="fade"
      onRequestClose={() => setVerifyModalItem(null)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Verify Menu Item</Text>
          <Text style={styles.modalHint}>
            Confirm this is really on your menu — fix the name here first if it's not quite right.
          </Text>
          <TextInput
            style={styles.modalInput}
            placeholder="Item name"
            placeholderTextColor="#999"
            value={verifyModalName}
            onChangeText={setVerifyModalName}
            autoFocus
            onSubmitEditing={confirmVerify}
            returnKeyType="done"
          />
          <View style={styles.modalBtnRow}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setVerifyModalItem(null)}
            >
              <Text style={styles.modalBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnConfirm, !verifyModalName.trim() && styles.modalBtnDisabled]}
              onPress={confirmVerify}
              disabled={!verifyModalName.trim() || verifying}
            >
              {verifying ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.modalBtnConfirmText}>Confirm</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2 },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666' },
  addCouponHint: { fontSize: 12, color: '#FFA500', fontWeight: '600', marginTop: 4 },

  actionButtonsRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 12 },
  expiredBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e53e3e',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  expiredBtnText: { color: '#e53e3e', fontSize: 14, fontWeight: '700' },

  searchContainer: { paddingHorizontal: 16, paddingVertical: 12 },
  searchInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#222',
  },

  list: { paddingHorizontal: 16, paddingBottom: 20 },
  itemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
  },
  itemCardWithCoupon: { backgroundColor: '#F0F8FF', borderLeftWidth: 4, borderLeftColor: '#4CAF50' },
  itemCardDisabled: { backgroundColor: '#FAFAFA' },
  itemInfo: { flex: 1, minWidth: 0 },
  itemNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemName: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 4 },
  couponIcon: { fontSize: 16 },
  itemNutrition: { fontSize: 12, color: '#666', marginBottom: 6 },
  unverifiedLabel: { fontSize: 11, color: '#E65100', fontWeight: '700', marginBottom: 6 },
  couponDetailsBox: { backgroundColor: '#F0F8FF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#4CAF50', marginTop: 8 },
  couponHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  couponTicketIcon: { fontSize: 24 },
  couponCode: { fontSize: 12, fontWeight: '800', color: '#2e7d32' },
  couponExpiry: { fontSize: 10, color: '#999', marginTop: 3 },
  couponUsage: { fontSize: 10, color: '#666', fontWeight: '600', marginTop: 2 },
  actionText: { fontSize: 13, fontWeight: '600', color: '#4CAF50', flexShrink: 0 },
  verifyToAddBtn: {
    backgroundColor: '#FFF3E0', borderWidth: 1.5, borderColor: '#E65100',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, flexShrink: 0,
  },
  verifyToAddBtnText: { fontSize: 11, fontWeight: '800', color: '#E65100', textAlign: 'center' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#222', marginBottom: 4 },
  emptySubtext: { fontSize: 13, color: '#666', textAlign: 'center' },

  noResultsText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 20 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 420, elevation: 4,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#222', marginBottom: 4 },
  modalHint: { fontSize: 13, color: '#888', marginBottom: 14, lineHeight: 18 },
  modalInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: '#222', marginBottom: 16,
  },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalBtnDisabled: { opacity: 0.6 },
  modalBtnCancel: { backgroundColor: '#f0f0f0' },
  modalBtnCancelText: { fontSize: 14, fontWeight: '700', color: '#555' },
  modalBtnConfirm: { backgroundColor: '#4CAF50' },
  modalBtnConfirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
