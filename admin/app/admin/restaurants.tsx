import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAllRestaurants, AdminRestaurant, RestaurantStatus } from '../../src/api/restaurants';

type StatusFilter = 'all' | RestaurantStatus;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_COLORS: Record<RestaurantStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: '#FFF3E0', text: '#E65100', label: 'Pending' },
  approved: { bg: '#E8F5E9', text: '#2e7d32', label: 'Approved' },
  rejected: { bg: '#FFEBEE', text: '#c62828', label: 'Rejected' },
};

export default function AdminRestaurantsScreen() {
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<StatusFilter>('all');

  useFocusEffect(
    useCallback(() => {
      loadRestaurants();
    }, [])
  );

  async function loadRestaurants() {
    try {
      const data = await getAllRestaurants();
      setRestaurants(data);
    } catch (error: any) {
      console.error('[admin-restaurants] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load restaurants');
    } finally {
      setLoading(false);
    }
  }

  const filteredRestaurants = restaurants.filter((r) => {
    const matchesTab = activeTab === 'all' || r.status === activeTab;
    if (!matchesTab) return false;

    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      r.name?.toLowerCase().includes(query) ||
      r.address?.toLowerCase().includes(query) ||
      r.restaurant_owners?.business_name?.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <Text style={styles.title}>Restaurants</Text>
        <Text style={styles.count}>{restaurants.length}</Text>
      </View>

      <View style={styles.tabsContainer}>
        {STATUS_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, address, or owner..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {filteredRestaurants.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🍽️</Text>
          <Text style={styles.emptyText}>No restaurants found</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRestaurants}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const statusInfo = STATUS_COLORS[item.status];
            return (
              <View style={styles.restaurantRow}>
                <View style={styles.restaurantInfo}>
                  <Text style={styles.restaurantName}>{item.name}</Text>
                  <Text style={styles.restaurantAddress}>{item.address}</Text>
                  <Text style={styles.restaurantOwner}>
                    Owner: {item.restaurant_owners?.business_name || 'Unknown'}
                    {item.restaurant_owners?.email ? ` (${item.restaurant_owners.email})` : ''}
                  </Text>
                  <Text style={styles.restaurantDate}>
                    Claimed {new Date(item.claimed_at).toLocaleDateString()}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                  <Text style={[styles.statusText, { color: statusInfo.text }]}>{statusInfo.label}</Text>
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.list}
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
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 2 },
  title: { fontSize: 24, fontWeight: '800', color: '#222' },
  count: { fontSize: 18, fontWeight: '800', color: '#1565C0', backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },

  tabsContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e0e0e0', backgroundColor: '#fff' },
  tab: { paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#1565C0' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#999' },
  tabTextActive: { color: '#1565C0' },

  searchContainer: { backgroundColor: '#fff', paddingHorizontal: 16, paddingBottom: 12 },
  searchInput: { backgroundColor: '#f0f0f0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#222' },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  restaurantRow: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, elevation: 1 },
  restaurantInfo: { flex: 1 },
  restaurantName: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 2 },
  restaurantAddress: { fontSize: 12, color: '#666', marginBottom: 4 },
  restaurantOwner: { fontSize: 12, color: '#1565C0', fontWeight: '600', marginBottom: 2 },
  restaurantDate: { fontSize: 11, color: '#999' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
});
