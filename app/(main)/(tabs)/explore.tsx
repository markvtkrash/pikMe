import { useState, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocation } from '../../../src/hooks/useLocation';
import { useNearbyRestaurants } from '../../../src/hooks/useNearbyRestaurants';
import { RestaurantCard } from '../../../src/components/restaurant/RestaurantCard';
import { SkeletonRestaurantCard } from '../../../src/components/common/SkeletonCard';
import { RadiusSelector } from '../../../src/components/common/RadiusSelector';
import { useRestaurantStore } from '../../../src/store/restaurantStore';
import { normalizeForSearch } from '../../../src/utils/textMatch';
import type { Restaurant } from '../../../src/types';

const ALL = 'All';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const { location, loading: locationLoading, error: locationError, refresh } = useLocation();
  const searchRadiusMeters = useRestaurantStore((s) => s.searchRadiusMeters);
  const { data: restaurants = [], isLoading, error: fetchError, refetch, isRefetching } =
    useNearbyRestaurants(location);

  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState(ALL);

  // Fetching always covers the max radius (see useNearbyRestaurants); the
  // distance picker just filters that same data client-side, no refetch.
  const withinRadius = useMemo(
    () => (restaurants as Restaurant[]).filter((r) => r.distanceMeters <= searchRadiusMeters),
    [restaurants, searchRadiusMeters]
  );

  const typeOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    withinRadius.forEach((r) =>
      r.cuisineTypes.forEach((t) => { counts[t] = (counts[t] ?? 0) + 1; })
    );
    return [ALL, ...Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)];
  }, [withinRadius]);

  const filtered = useMemo(() =>
    withinRadius
      .filter((r) => {
        const matchSearch = normalizeForSearch(r.name).includes(normalizeForSearch(search));
        const matchType = activeType === ALL || r.cuisineTypes.includes(activeType);
        return matchSearch && matchType;
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters),
    [withinRadius, search, activeType]
  );

  function chipLabel(type: string) {
    if (type === ALL) return 'All';
    return type.replace(/_restaurant$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  if (locationLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.staticHeader}>
          <Text style={styles.greeting}>{greeting()} 👋</Text>
          <Text style={styles.subGreeting}>Finding your location…</Text>
        </View>
        <FlatList
          data={[1, 2, 3, 4]}
          keyExtractor={(i) => String(i)}
          renderItem={() => <SkeletonRestaurantCard />}
          contentContainerStyle={styles.list}
          scrollEnabled={false}
        />
      </View>
    );
  }

  if (locationError) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.staticHeader}>
          <Text style={styles.greeting}>Location needed</Text>
          <Text style={styles.subGreeting}>PikMe needs your location to find nearby restaurants</Text>
        </View>
        <View style={styles.errorCard}>
          <Text style={styles.errorIcon}>📍</Text>
          <Text style={styles.errorBody}>{locationError}</Text>
          <TouchableOpacity style={styles.btn} onPress={refresh}>
            <Text style={styles.btnText}>Enable Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Sticky header */}
      <View style={styles.header}>
        <View style={styles.greetingRow}>
          <View>
            <Text style={styles.greeting}>{greeting()} 👋</Text>
            <Text style={styles.subGreeting}>Discover food near you</Text>
          </View>
          <View style={styles.locationBadge}>
            <Text style={styles.locationText}>📍 Near you</Text>
          </View>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search restaurants…"
            placeholderTextColor="#AEAEB2"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        <RadiusSelector />

        {/* Cuisine chips */}
        {typeOptions.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {typeOptions.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.chip, activeType === type && styles.chipActive]}
                onPress={() => setActiveType(type)}
              >
                <Text style={[styles.chipText, activeType === type && styles.chipTextActive]}>
                  {chipLabel(type)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* List */}
      {isLoading ? (
        <FlatList
          data={[1, 2, 3, 4]}
          keyExtractor={(i) => String(i)}
          renderItem={() => <SkeletonRestaurantCard />}
          contentContainerStyle={styles.list}
          scrollEnabled={false}
        />
      ) : fetchError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Could not load restaurants</Text>
          <Text style={styles.errorBody}>Check your connection and Edge Function setup.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => refetch()}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.placeId}
          renderItem={({ item }) => <RestaurantCard restaurant={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            !isLoading && !fetchError && filtered.length > 0 ? (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Nearby Restaurants</Text>
                <Text style={styles.sectionCount}>{filtered.length}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🍽️</Text>
              <Text style={styles.emptyTitle}>
                {search || activeType !== ALL ? 'No matches' : 'No restaurants found'}
              </Text>
              <Text style={styles.emptyBody}>
                {search || activeType !== ALL
                  ? 'Try a different search or filter'
                  : 'Try increasing the distance above'}
              </Text>
            </View>
          }
          ListFooterComponent={
            <View style={styles.attribution}>
              <Text style={styles.attributionText}>
                Restaurant information and photos from Google Maps
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#4CAF50" />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F6F6' },

  header: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    paddingBottom: 4,
  },
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
  },
  greeting: { fontSize: 22, fontWeight: '800', color: '#141414', letterSpacing: -0.3 },
  subGreeting: { fontSize: 13, color: '#6B6B6B', marginTop: 2 },
  locationBadge: {
    backgroundColor: '#F0FAF0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  locationText: { fontSize: 12, color: '#2e7d32', fontWeight: '600' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F6F6F6',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 15, color: '#141414', padding: 0 },

  chips: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 50,
    backgroundColor: '#F6F6F6',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
  },
  chipActive: { backgroundColor: '#141414', borderColor: '#141414' },
  chipText: { fontSize: 13, color: '#555', fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#141414' },
  sectionCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4CAF50',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },

  list: { paddingBottom: 36 },

  staticHeader: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },

  errorCard: { margin: 20, backgroundColor: '#fff', borderRadius: 16, padding: 28, alignItems: 'center', gap: 10 },
  errorIcon: { fontSize: 40 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#141414' },
  errorBody: { fontSize: 13, color: '#6B6B6B', textAlign: 'center', lineHeight: 20 },
  btn: { marginTop: 6, backgroundColor: '#4CAF50', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  emptyBox: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40, gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  emptyBody: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 20 },

  attribution: { paddingHorizontal: 16, paddingVertical: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#E8E8E8' },
  attributionText: { fontSize: 11, color: '#999', textAlign: 'center', lineHeight: 16 },
});
