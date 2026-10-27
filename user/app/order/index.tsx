import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getMyOrders } from '../../src/api/orders';
import { OrderHeader } from '../../src/components/order/OrderHeader';
import { OrderModalFrame } from '../../src/components/order/OrderModalFrame';
import { formatCents, isPlacedOrder, statusLabel } from '../../src/utils/orders';
import { BRAND_COLORS } from '../../src/constants/brandTheme';
import { useThemedStyles } from '../../src/theme/useTheme';

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Profile -> My orders: the person's recent pickup orders, newest first.
export default function MyOrdersScreen() {
  return (
    <OrderModalFrame>
      <MyOrdersContent />
    </OrderModalFrame>
  );
}

function MyOrdersContent() {
  const styles = useThemedStyles(baseStyles);
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['myOrders'],
    // an order that was never paid was not placed, so it is not listed
    queryFn: async () => (await getMyOrders(30)).filter(isPlacedOrder),
    staleTime: 0,
  });

  return (
    <View style={styles.container}>
      <OrderHeader title="My orders" closeable />
      {isLoading && <ActivityIndicator style={styles.spinner} color={BRAND_COLORS.primary} />}
      {isError && (
        <TouchableOpacity onPress={() => refetch()} accessibilityRole="button">
          <Text style={styles.empty}>Your orders could not be loaded. Tap to try again.</Text>
        </TouchableOpacity>
      )}
      {!isLoading && !isError && (data ?? []).length === 0 && <Text style={styles.empty}>You haven't ordered anything yet.</Text>}
      <FlatList
        data={data ?? []}
        keyExtractor={(o) => o.order_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/order/${item.order_id}` as any)} accessibilityRole="button">
            <View style={styles.flex1}>
              <Text style={styles.name} numberOfLines={1}>{item.restaurant_name}</Text>
              <Text style={styles.meta}>{when(item.created_at)}  ·  {item.item_count} item{item.item_count === 1 ? '' : 's'}</Text>
              <Text style={styles.status}>{statusLabel(item.status)}</Text>
            </View>
            <Text style={styles.total}>{formatCents(item.total_cents)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND_COLORS.background.surface },
  flex1: { flex: 1 },
  spinner: { marginTop: 24 },
  empty: { fontSize: 14, color: BRAND_COLORS.text.tertiary, textAlign: 'center', margin: 24 },
  list: { padding: 12, gap: 8, maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e6e6e6' },
  name: { fontSize: 15, fontWeight: '700', color: BRAND_COLORS.text.primary },
  meta: { fontSize: 12, color: BRAND_COLORS.text.tertiary, marginTop: 2 },
  status: { fontSize: 13, fontWeight: '700', color: BRAND_COLORS.primary, marginTop: 2 },
  total: { fontSize: 15, fontWeight: '800', color: BRAND_COLORS.text.primary },
});
