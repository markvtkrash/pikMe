import { useRef, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  StyleSheet, TouchableOpacity, Dimensions,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocation } from '../../hooks/useLocation';
import { useNearbyRestaurants } from '../../hooks/useNearbyRestaurants';
import { useRestaurantStore } from '../../store/restaurantStore';
import { RestaurantCard } from '../restaurant/RestaurantCard';
import { RadiusSelector } from '../common/RadiusSelector';
import type { Restaurant } from '../../types';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.75;

export function NearbyMap() {
  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const { location, loading: locationLoading, error: locationError, refresh } = useLocation();
  const { selectedRestaurantId, setSelectedRestaurantId, searchRadiusMeters } = useRestaurantStore();
  const { data: restaurants = [], isLoading, error: fetchError, refetch } = useNearbyRestaurants(location);
  // Fetching always covers the max radius; filter to the selected distance client-side.
  const visibleRestaurants = (restaurants as Restaurant[]).filter(
    (r) => r.distanceMeters <= searchRadiusMeters
  );

  function selectRestaurant(restaurant: Restaurant) {
    setSelectedRestaurantId(restaurant.placeId);

    // Animate map camera to the restaurant
    mapRef.current?.animateToRegion({
      latitude: restaurant.location.latitude,
      longitude: restaurant.location.longitude,
      latitudeDelta: 0.008,
      longitudeDelta: 0.008,
    }, 400);

    // Scroll card strip to the tapped restaurant
    const idx = visibleRestaurants.findIndex((r) => r.placeId === restaurant.placeId);
    if (idx >= 0) {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    }
  }

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
          <Text style={styles.btnText}>Enable Location</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {location && (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_DEFAULT}
          initialRegion={{
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }}
          showsUserLocation
          showsMyLocationButton
        >
          {visibleRestaurants.map((restaurant) => (
            <Marker
              key={restaurant.placeId}
              coordinate={{
                latitude: restaurant.location.latitude,
                longitude: restaurant.location.longitude,
              }}
              onPress={() => selectRestaurant(restaurant)}
            >
              <View
                style={[
                  styles.markerBubble,
                  selectedRestaurantId === restaurant.placeId && styles.markerSelected,
                ]}
              >
                <Text style={styles.markerText} numberOfLines={1}>{restaurant.name}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      )}

      {/* Radius selector overlay */}
      <View style={[styles.radiusOverlay, { top: insets.top + 8 }]}>
        <RadiusSelector />
      </View>

      {/* Bottom card strip */}
      <View style={styles.cardStrip}>
        {isLoading ? (
          <View style={styles.stripLoading}>
            <ActivityIndicator color="#4CAF50" />
            <Text style={styles.statusText}>Finding restaurants…</Text>
          </View>
        ) : fetchError ? (
          <View style={styles.stripLoading}>
            <Text style={styles.errorBody}>Could not load restaurants</Text>
            <TouchableOpacity onPress={() => refetch()}>
              <Text style={styles.retryLink}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : visibleRestaurants.length === 0 ? (
          <View style={styles.stripLoading}>
            <Text style={styles.errorBody}>No restaurants found nearby</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={visibleRestaurants}
            keyExtractor={(item) => item.placeId}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_WIDTH + 12}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingVertical: 8 }}
            renderItem={({ item }) => (
              <View style={{ width: CARD_WIDTH }}>
                <RestaurantCard
                  restaurant={item}
                  compact
                  selected={selectedRestaurantId === item.placeId}
                />
              </View>
            )}
            onScrollToIndexFailed={() => {}}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eee' },
  radiusOverlay: {
    position: 'absolute',
    left: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  icon: { fontSize: 48, marginBottom: 12 },
  statusText: { marginTop: 10, fontSize: 14, color: '#888' },
  errorTitle: { fontSize: 17, fontWeight: '600', color: '#333', marginBottom: 6, textAlign: 'center' },
  errorBody: { fontSize: 14, color: '#888', textAlign: 'center' },
  btn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 28, marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  retryLink: { color: '#4CAF50', fontWeight: '600', fontSize: 14, marginTop: 8 },
  markerBubble: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    maxWidth: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
  },
  markerSelected: { borderColor: '#4CAF50', backgroundColor: '#f0faf0' },
  markerText: { fontSize: 11, fontWeight: '600', color: '#1a1a1a' },
  cardStrip: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    height: 110,
  },
  stripLoading: {
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    marginHorizontal: 16,
    borderRadius: 14,
  },
});
