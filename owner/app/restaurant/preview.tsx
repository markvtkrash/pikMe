import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getRestaurantCoupons, getRestaurantMenuItems } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';

interface Coupon {
  id: string;
  coupon_code: string;
  coupon_type: string;
  discount_value: number;
  expiry_date: string;
  is_active: boolean;
  menu_item_id?: string | null;
  usage_limit?: number | null;
  times_used?: number;
}

interface MenuItem {
  item_id: string;
  name: string;
  calories: number | null;
  protein_g: number | null;
  is_verified: boolean;
}

const ITEM_SPECIFIC_TYPES = ['item_percent', 'item_fixed'];

// A read-only approximation of what a customer actually sees on the
// restaurant page -- same active-coupon filter get_active_coupons_for_
// restaurant applies (minus the per-customer usage piece, since there's no
// "current customer" in an owner's own preview). Lets an owner catch a
// confusing listing (bad coupon, unverified item) before a real customer does.
export default function PreviewAsCustomerScreen() {
  const { restaurant } = useRestaurantOwnerStore();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { favorites, toggleFavorite } = useFavoritePages();

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [restaurant])
  );

  async function loadData() {
    if (!restaurant) {
      setLoading(false);
      return;
    }
    try {
      const [couponsData, itemsData] = await Promise.all([
        getRestaurantCoupons(restaurant.id),
        getRestaurantMenuItems(restaurant.name),
      ]);
      setCoupons(couponsData as Coupon[]);
      setMenuItems(itemsData as MenuItem[]);
    } catch (error) {
      console.error('[preview] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  if (!restaurant) return null;

  const now = new Date();
  const activeCoupons = coupons.filter((c) =>
    c.is_active && new Date(c.expiry_date) > now &&
    (c.usage_limit == null || (c.times_used ?? 0) < c.usage_limit)
  );
  const genericCoupons = activeCoupons.filter((c) => !c.menu_item_id);
  const itemCouponByItemId = new Map(
    activeCoupons.filter((c) => c.menu_item_id).map((c) => [c.menu_item_id as string, c])
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.pageHeaderRow}>
        <Text style={styles.pageHeaderTitle}>👀 Preview as a Customer</Text>
        <FavoriteHeart
          active={favorites.has('tool-preview')}
          onPress={() => toggleFavorite('tool-preview')}
          size="large"
        />
      </View>

      <View style={styles.previewBanner}>
        <Text style={styles.previewBannerText}>
          This is an approximation of what customers see — not pixel-identical to the consumer app.
        </Text>
      </View>

      <Text style={styles.restaurantName}>{restaurant.name}</Text>
      <Text style={styles.restaurantAddress}>{restaurant.address}</Text>

      {genericCoupons.length > 0 && (
        <View style={styles.couponsSection}>
          <Text style={styles.couponsSectionTitle}>🎉 Deals on Any Item</Text>
          {genericCoupons.map((c) => (
            <View key={c.id} style={styles.couponCard}>
              <Text style={styles.couponCode}>Use: {c.coupon_code}</Text>
              <Text style={styles.couponDiscount}>
                {c.discount_value}{c.coupon_type.includes('percent') ? '%' : '$'} off • Any Item
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.menuTitle}>Menu</Text>
      {menuItems.length === 0 ? (
        <Text style={styles.emptyText}>No menu items yet</Text>
      ) : (
        menuItems.map((item) => {
          const coupon = itemCouponByItemId.get(item.item_id);
          return (
            <View key={item.item_id} style={styles.itemCard}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemNutrition}>
                  {item.calories ? `${Math.round(item.calories)} cal` : 'N/A'} •{' '}
                  {item.protein_g ? `${item.protein_g}g protein` : 'N/A'}
                </Text>
                {!item.is_verified && <Text style={styles.unverifiedTag}>⚠️ Not yet verified</Text>}
              </View>
              {coupon && (
                <View style={styles.itemCouponBadge}>
                  <Text style={styles.itemCouponBadgeText}>
                    {coupon.discount_value}{coupon.coupon_type.includes('percent') ? '%' : '$'} off
                  </Text>
                </View>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 700, alignSelf: 'center', paddingBottom: 40 },

  pageHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  pageHeaderTitle: { fontSize: 18, fontWeight: '800', color: '#222' },
  previewBanner: { backgroundColor: '#E3F2FD', borderRadius: 10, padding: 12, marginBottom: 16 },
  previewBannerText: { fontSize: 12.5, color: '#1565C0', fontWeight: '600', textAlign: 'center' },

  restaurantName: { fontSize: 22, fontWeight: '800', color: '#222' },
  restaurantAddress: { fontSize: 13, color: '#888', marginTop: 2, marginBottom: 16 },

  couponsSection: { backgroundColor: '#FFECB3', borderRadius: 14, borderWidth: 2, borderColor: '#FF9800', padding: 14, marginBottom: 20 },
  couponsSectionTitle: { fontSize: 15, fontWeight: '800', color: '#D84315', marginBottom: 10 },
  couponCard: { backgroundColor: '#FFF9C4', borderRadius: 10, borderWidth: 1.5, borderColor: '#FFB74D', padding: 12, marginBottom: 8 },
  couponCode: { fontSize: 14, fontWeight: '900', color: '#D84315' },
  couponDiscount: { fontSize: 12, color: '#E65100', fontWeight: '700', marginTop: 2 },

  menuTitle: { fontSize: 17, fontWeight: '800', color: '#222', marginBottom: 10 },
  emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },

  itemCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, elevation: 1,
  },
  itemInfo: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 14, fontWeight: '700', color: '#222' },
  itemNutrition: { fontSize: 12, color: '#666', marginTop: 2 },
  unverifiedTag: { fontSize: 11, color: '#E65100', fontWeight: '700', marginTop: 3 },
  itemCouponBadge: { backgroundColor: '#E8F5E9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginLeft: 10 },
  itemCouponBadgeText: { fontSize: 12, fontWeight: '800', color: '#2e7d32' },
});
