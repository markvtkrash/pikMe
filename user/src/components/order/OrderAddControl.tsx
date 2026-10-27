import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOrderingInfo } from '../../hooks/useOrderingInfo';
import { useOrderCartStore } from '../../store/orderCartStore';
import { Alert } from '../../utils/alert';
import { MAX_QTY_PER_DISH, formatCents, quantityOf } from '../../utils/orders';
import { useThemedStyles } from '../../theme/useTheme';
import type { MenuItem, Restaurant } from '../../types';

// On a menu card: the dish's price and an Add button (or - / + once it is in the cart). It shows only when the restaurant takes orders
// right now and this dish can be ordered (confirmed, with a price). Every card of one restaurant shares one ordering check.
export function OrderAddControl({ item, restaurant }: { item: MenuItem; restaurant?: Restaurant | null }) {
  const styles = useThemedStyles(baseStyles);
  const placeId = restaurant?.placeId;
  const { data: info } = useOrderingInfo(placeId);
  const cart = useOrderCartStore((s) => s.cart);
  const setDishQuantity = useOrderCartStore((s) => s.setDishQuantity);
  const clear = useOrderCartStore((s) => s.clear);

  const price = item.priceCents;
  if (!restaurant || !placeId || !info?.available || !item.isVerified || typeof price !== 'number' || price <= 0) return null;

  const place = { placeId, restaurantName: restaurant.name };
  const dish = { itemId: item.itemId, name: item.name, priceCents: price };
  const qty = cart.placeId === placeId ? quantityOf(cart, item.itemId) : 0;

  function change(quantity: number) {
    if (setDishQuantity(place, dish, quantity) === 'other_restaurant') {
      Alert.alert('Start a new order?', `Your cart has dishes from ${cart.restaurantName}. Clear it and start an order from ${restaurant!.name}?`, [
        { text: 'Keep my cart', style: 'cancel' },
        { text: 'Start new order', onPress: () => { clear(); setDishQuantity(place, dish, quantity); } },
      ]);
    }
  }

  return (
    <View style={styles.row}>
      <Text style={styles.price}>{formatCents(price)}</Text>
      {qty > 0 ? (
        <View style={styles.stepper}>
          <TouchableOpacity style={styles.stepBtn} onPress={() => change(qty - 1)} accessibilityRole="button" accessibilityLabel={`Less ${item.name}`}>
            <Text style={styles.stepText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.qty}>{qty} in order</Text>
          <TouchableOpacity
            style={[styles.stepBtn, qty >= MAX_QTY_PER_DISH && styles.off]}
            disabled={qty >= MAX_QTY_PER_DISH}
            onPress={() => change(qty + 1)}
            accessibilityRole="button"
            accessibilityLabel={`More ${item.name}`}
          >
            <Text style={styles.stepText}>+</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.addBtn} onPress={() => change(1)} accessibilityRole="button" accessibilityLabel={`Add ${item.name} to your order`}>
          <Text style={styles.addText}>🛒 Add to order</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e6e6e6' },
  price: { fontSize: 16, fontWeight: '800', color: '#1B5E20' },
  addBtn: { backgroundColor: '#2E7D32', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  addText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#E8F5E9', borderWidth: 1.5, borderColor: '#2E7D32', alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 19, fontWeight: '800', color: '#1B5E20', lineHeight: 21 },
  qty: { fontSize: 13, fontWeight: '800', color: '#1B5E20' },
  off: { opacity: 0.4 },
});
