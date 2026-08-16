import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSaved } from '../../../src/hooks/useSaved';
import { RestaurantCard } from '../../../src/components/restaurant/RestaurantCard';
import type { MenuItem } from '../../../src/types';

type Tab = 'restaurants' | 'items';

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const { savedRestaurants, savedMenuItems, isLoaded, load, toggleMenuItem } = useSaved();
  const [activeTab, setActiveTab] = useState<Tab>('restaurants');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const rCount = savedRestaurants.length;
  const mCount = savedMenuItems.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Saved</Text>
      </View>

      {/* Segment control */}
      <View style={styles.segmentRow}>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'restaurants' && styles.segmentActive]}
          onPress={() => setActiveTab('restaurants')}
        >
          <Text style={[styles.segmentText, activeTab === 'restaurants' && styles.segmentTextActive]}>
            Restaurants {rCount > 0 ? `(${rCount})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'items' && styles.segmentActive]}
          onPress={() => setActiveTab('items')}
        >
          <Text style={[styles.segmentText, activeTab === 'items' && styles.segmentTextActive]}>
            Menu Items {mCount > 0 ? `(${mCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Loading state */}
      {!isLoaded ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Loading saved items…</Text>
        </View>
      ) : activeTab === 'restaurants' ? (
        <FlatList
          data={savedRestaurants}
          keyExtractor={(r) => r.placeId}
          renderItem={({ item }) => <RestaurantCard restaurant={item} hideStatus />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#4CAF50" />
          }
          ListEmptyComponent={
            <EmptyState
              icon="🍽️"
              title="No saved restaurants yet"
              body="Heart a restaurant from the Explore or Map tab to save it here."
            />
          }
        />
      ) : (
        <FlatList
          data={savedMenuItems}
          keyExtractor={(m) => m.itemId}
          renderItem={({ item }) => (
            <SavedMenuItemCard item={item} onUnsave={() => toggleMenuItem(item.itemId, item)} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#4CAF50" />
          }
          ListEmptyComponent={
            <EmptyState
              icon="🥗"
              title="No saved menu items yet"
              body='Tap "Should I get this?" on a menu item, then heart it to save.'
            />
          }
        />
      )}
    </View>
  );
}

function SavedMenuItemCard({ item, onUnsave }: { item: MenuItem; onUnsave: () => void }) {
  const n = item.nutrition;
  return (
    <View style={styles.itemCard}>
      <View style={styles.itemMain}>
        <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.itemRestaurant}>{item.restaurantName}</Text>
        <View style={styles.itemMacroRow}>
          <Text style={styles.itemCal}>{n.calories} cal</Text>
          <Text style={styles.itemMacro}>{Math.round(n.protein_g)}g protein</Text>
          <Text style={styles.itemMacro}>{Math.round(n.totalCarbs_g)}g carbs</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onUnsave} style={styles.heartBtn} hitSlop={8}>
        <Text style={styles.heartFilled}>❤️</Text>
      </TouchableOpacity>
    </View>
  );
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  title: { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },

  segmentRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  segmentActive: { backgroundColor: '#f0faf0' },
  segmentText: { fontSize: 13, fontWeight: '600', color: '#888' },
  segmentTextActive: { color: '#2e7d32' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: '#888' },
  list: { paddingTop: 12, paddingBottom: 40 },

  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  itemMain: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginBottom: 3 },
  itemRestaurant: { fontSize: 12, color: '#888', marginBottom: 6 },
  itemMacroRow: { flexDirection: 'row', gap: 10 },
  itemCal: { fontSize: 13, fontWeight: '700', color: '#333' },
  itemMacro: { fontSize: 12, color: '#666' },
  heartBtn: { paddingLeft: 12 },
  heartFilled: { fontSize: 22 },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#333', marginBottom: 8, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 21 },
});
