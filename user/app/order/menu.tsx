import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { getOrderableDishes } from '../../src/api/orders';
import { useOrderingInfo } from '../../src/hooks/useOrderingInfo';
import { useOrderCartStore } from '../../src/store/orderCartStore';
import { OrderHeader } from '../../src/components/order/OrderHeader';
import { Alert } from '../../src/utils/alert';
import { cartCount, cartSubtotalCents, formatCents, quantityOf, MAX_QTY_PER_DISH, type Dish } from '../../src/utils/orders';
import { BRAND_COLORS } from '../../src/constants/brandTheme';
import { useThemedStyles } from '../../src/theme/useTheme';

// Order for pickup, step 1: every dish the restaurant sells online, with a + and - for each, and a bar to go on to checkout.
export default function OrderMenuScreen() {
  const styles = useThemedStyles(baseStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ placeId?: string; name?: string }>();
  const placeId = Array.isArray(params.placeId) ? params.placeId[0] : params.placeId;
  const name = (Array.isArray(params.name) ? params.name[0] : params.name) ?? 'Restaurant';

  const { data: info, isLoading: infoLoading } = useOrderingInfo(placeId);
  const dishesQuery = useQuery({
    queryKey: ['orderableDishes', placeId],
    queryFn: () => getOrderableDishes(placeId as string, name),
    enabled: !!placeId,
    staleTime: 30 * 1000,
  });

  const cart = useOrderCartStore((s) => s.cart);
  const setDishQuantity = useOrderCartStore((s) => s.setDishQuantity);
  const clear = useOrderCartStore((s) => s.clear);
  const place = { placeId: placeId ?? '', restaurantName: name };
  const mine = cart.placeId === placeId;   // the cart holds this restaurant's dishes
  const count = mine ? cartCount(cart) : 0;

  function change(dish: Dish, quantity: number) {
    const result = setDishQuantity(place, dish, quantity);
    if (result === 'other_restaurant') {
      Alert.alert('Start a new order?', `Your cart has dishes from ${cart.restaurantName}. Clear it and start an order from ${name}?`, [
        { text: 'Keep my cart', style: 'cancel' },
        { text: 'Start new order', onPress: () => { clear(); setDishQuantity(place, dish, quantity); } },
      ]);
    }
  }

  if (!placeId) {
    return (
      <View style={styles.container}>
        <OrderHeader title="Order for pickup" />
        <Text style={styles.empty}>We couldn't tell which restaurant to order from.</Text>
      </View>
    );
  }

  const closed = !infoLoading && info && !info.available;
  const dishes = dishesQuery.data ?? [];

  return (
    <View style={styles.container}>
      <OrderHeader title={name} subtitle={info?.available ? `Order for pickup. Ready in about ${info.prepMinutes} minutes.` : 'Order for pickup'} />

      {(infoLoading || dishesQuery.isLoading) && <ActivityIndicator style={styles.spinner} color={BRAND_COLORS.primary} />}

      {!!closed && (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Not taking orders right now</Text>
          <Text style={styles.noticeBody}>This restaurant can't take pickup orders at the moment. Please check back later.</Text>
        </View>
      )}

      {!closed && dishesQuery.isError && <Text style={styles.empty}>The menu could not be loaded. Please try again.</Text>}
      {!closed && !dishesQuery.isLoading && !dishesQuery.isError && dishes.length === 0 && (
        <Text style={styles.empty}>There are no dishes to order here right now.</Text>
      )}

      {!closed && (
        <FlatList
          data={dishes}
          keyExtractor={(d) => d.itemId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const qty = mine ? quantityOf(cart, item.itemId) : 0;
            return (
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <Text style={styles.dishName}>{item.name}</Text>
                  <Text style={styles.price}>{formatCents(item.priceCents)}</Text>
                </View>
                {qty > 0 ? (
                  <View style={styles.stepper}>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => change(item, qty - 1)} accessibilityRole="button" accessibilityLabel={`Less ${item.name}`}>
                      <Text style={styles.stepText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.qty}>{qty}</Text>
                    <TouchableOpacity
                      style={[styles.stepBtn, qty >= MAX_QTY_PER_DISH && styles.off]}
                      disabled={qty >= MAX_QTY_PER_DISH}
                      onPress={() => change(item, qty + 1)}
                      accessibilityRole="button"
                      accessibilityLabel={`More ${item.name}`}
                    >
                      <Text style={styles.stepText}>+</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.addBtn} onPress={() => change(item, 1)} accessibilityRole="button" accessibilityLabel={`Add ${item.name}`}>
                    <Text style={styles.addText}>Add</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}

      {count > 0 && !closed && (
        <TouchableOpacity
          style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}
          onPress={() => router.push('/order/checkout' as any)}
          accessibilityRole="button"
          accessibilityLabel={`View your order: ${count} item${count === 1 ? '' : 's'}`}
        >
          <Text style={styles.barText}>{count} item{count === 1 ? '' : 's'}  ·  {formatCents(cartSubtotalCents(cart))}</Text>
          <View style={styles.cartIconBadge}>
            <Text style={styles.cartIcon}>🛒</Text>
            <View style={styles.cartCount}><Text style={styles.cartCountTxt}>{count}</Text></View>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND_COLORS.background.surface },
  flex1: { flex: 1 },
  spinner: { marginTop: 24 },
  empty: { fontSize: 14, color: BRAND_COLORS.text.tertiary, textAlign: 'center', margin: 24 },
  notice: { margin: 16, backgroundColor: '#FFF3E0', borderRadius: 12, borderWidth: 1.5, borderColor: '#E65100', padding: 16 },
  noticeTitle: { fontSize: 16, fontWeight: '800', color: '#7A3300' },
  noticeBody: { fontSize: 14, color: '#7A3300', marginTop: 4, lineHeight: 20 },
  list: { padding: 12, paddingBottom: 100, gap: 8, maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e6e6e6' },
  dishName: { fontSize: 15, fontWeight: '700', color: BRAND_COLORS.text.primary },
  price: { fontSize: 14, color: BRAND_COLORS.text.tertiary, marginTop: 2, fontWeight: '600' },
  addBtn: { backgroundColor: BRAND_COLORS.primary, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 },
  addText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND_COLORS.primaryLight, borderWidth: 1.5, borderColor: BRAND_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 20, fontWeight: '800', color: BRAND_COLORS.primary, lineHeight: 22 },
  qty: { fontSize: 16, fontWeight: '800', color: BRAND_COLORS.text.primary, minWidth: 22, textAlign: 'center' },
  off: { opacity: 0.4 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: BRAND_COLORS.primary, paddingTop: 14, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cartIconBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cartIcon: { fontSize: 22 },
  cartCount: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#E65100', borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  cartCountTxt: { color: '#fff', fontSize: 10, fontWeight: '900' },
  barAction: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
