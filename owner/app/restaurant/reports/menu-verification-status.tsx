import { useState, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantMenuItems } from '../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';
import { FavoriteHeart } from '../../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../../src/hooks/useFavoritePages';

interface MenuItem {
  item_id: string;
  name: string;
  is_verified: boolean;
}

export default function MenuVerificationStatusReport() {
  const router = useRouter();
  const { restaurant } = useRestaurantOwnerStore();
  const { favorites, toggleFavorite } = useFavoritePages();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

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
      const data = await getRestaurantMenuItems(restaurant.name);
      setItems(data as MenuItem[]);
    } catch (error) {
      console.error('[menu-verification-status-report] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  }

  const { verified, unverified } = useMemo(() => {
    return {
      verified: items.filter((i) => i.is_verified),
      unverified: items.filter((i) => !i.is_verified),
    };
  }, [items]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  const total = items.length;
  const pctVerified = total > 0 ? Math.round((verified.length / total) * 100) : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>✅ Menu Verification Status</Text>
        <FavoriteHeart
          active={favorites.has('report-menu-verification-status')}
          onPress={() => toggleFavorite('report-menu-verification-status')}
          size="large"
        />
      </View>
      <Text style={styles.subtitle}>How much of your menu has been reviewed and confirmed</Text>

      <View style={styles.snapshotRow}>
        <View style={[styles.snapshotBox, styles.snapshotBoxActive]}>
          <Text style={styles.snapshotNumber}>{verified.length}</Text>
          <Text style={styles.snapshotLabel}>Verified</Text>
        </View>
        <View style={[styles.snapshotBox, styles.snapshotBoxWarn]}>
          <Text style={styles.snapshotNumber}>{unverified.length}</Text>
          <Text style={styles.snapshotLabel}>Unverified</Text>
        </View>
        <View style={styles.snapshotBox}>
          <Text style={styles.snapshotNumber}>{pctVerified}%</Text>
          <Text style={styles.snapshotLabel}>Complete</Text>
        </View>
      </View>

      {unverified.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Still needs review</Text>
          <View style={styles.card}>
            {unverified.map((item) => (
              <TouchableOpacity
                key={item.item_id}
                style={styles.itemRow}
                onPress={() => router.push('/restaurant/menu-items')}
              >
                <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.itemArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {total === 0 && (
        <View style={styles.emptyList}>
          <Text style={styles.emptyListText}>No menu items yet</Text>
          <Text style={styles.emptyListSubtext}>Add your menu from Menu Management</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#1565C0', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  snapshotRow: { flexDirection: 'row', gap: 10 },
  snapshotBox: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', elevation: 1,
  },
  snapshotBoxActive: { backgroundColor: '#E8F5E9' },
  snapshotBoxWarn: { backgroundColor: '#FFF3E0' },
  snapshotNumber: { fontSize: 24, fontWeight: '800', color: '#222' },
  snapshotLabel: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 4 },

  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#222', marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', elevation: 1 },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  itemName: { flex: 1, fontSize: 14, color: '#333', fontWeight: '600' },
  itemArrow: { fontSize: 18, color: '#ccc', fontWeight: '700' },

  emptyList: { alignItems: 'center', paddingVertical: 40 },
  emptyListText: { fontSize: 16, fontWeight: '600', color: '#222' },
  emptyListSubtext: { fontSize: 12, color: '#999', marginTop: 4 },
});
