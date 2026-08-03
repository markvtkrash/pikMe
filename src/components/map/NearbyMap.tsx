// Web fallback — react-native-maps does not support web
import { View, Text, FlatList, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { RestaurantCard } from '../restaurant/RestaurantCard';
import { useLocation } from '../../hooks/useLocation';
import { useNearbyRestaurants } from '../../hooks/useNearbyRestaurants';
import { useRestaurantStore } from '../../store/restaurantStore';
import { RadiusSelector } from '../common/RadiusSelector';
import type { Restaurant } from '../../types';

export function NearbyMap() {
  const { location, loading: locationLoading, error: locationError, refresh } = useLocation();
  const searchRadiusMeters = useRestaurantStore((s) => s.searchRadiusMeters);
  const { data: restaurants = [], isLoading, error: fetchError, refetch } = useNearbyRestaurants(location);
  // Fetching always covers the max radius; filter to the selected distance client-side.
  const visibleRestaurants = (restaurants as Restaurant[]).filter(
    (r) => r.distanceMeters <= searchRadiusMeters
  );

  if (locationLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.statusText}>Getting your location…</Text>
      </View>
    );
  }

  if (locationError) {
    return (
      <View style={styles.center}>
        <Text style={styles.icon}>📍</Text>
        <Text style={styles.errorTitle}>Location needed</Text>
        <Text style={styles.errorBody}>{locationError}</Text>
        <TouchableOpacity style={styles.btn} onPress={refresh}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>🗺 Map view is available on the mobile app</Text>
      </View>

      <RadiusSelector />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#4CAF50" />
          <Text style={styles.statusText}>Finding nearby restaurants…</Text>
        </View>
      ) : fetchError ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Could not load restaurants</Text>
          <TouchableOpacity style={styles.btn} onPress={() => refetch()}>
            <Text style={styles.btnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : visibleRestaurants.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.icon}>🍽️</Text>
          <Text style={styles.errorTitle}>No restaurants found</Text>
          <Text style={styles.errorBody}>Try increasing the distance above.</Text>
        </View>
      ) : (
        <FlatList
          data={visibleRestaurants}
          keyExtractor={(item) => item.placeId}
          renderItem={({ item }) => <RestaurantCard restaurant={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            <View style={styles.attribution}>
              <Text style={styles.attributionText}>
                Restaurant information and photos from Google Maps
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  banner: {
    backgroundColor: '#fff8e1',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ffe082',
  },
  bannerText: { fontSize: 13, color: '#f57c00', textAlign: 'center' },
  icon: { fontSize: 48, marginBottom: 12 },
  statusText: { marginTop: 12, fontSize: 14, color: '#888' },
  errorTitle: { fontSize: 17, fontWeight: '600', color: '#333', marginBottom: 6, textAlign: 'center' },
  errorBody: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 20 },
  btn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 28 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  list: { paddingTop: 12, paddingBottom: 32 },

  attribution: { paddingHorizontal: 16, paddingVertical: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  attributionText: { fontSize: 11, color: '#999', textAlign: 'center', lineHeight: 16 },
});
