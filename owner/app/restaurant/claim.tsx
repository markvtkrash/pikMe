import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { claimRestaurant, geocodeLocation } from '../../src/api/restaurantAuth';
import { fetchNearbyRestaurants } from '../../src/api/functions';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { supabase } from '../../src/api/supabase';
import { formatDistance } from '../../src/utils/geo';
import { normalizeForSearch } from '../../src/utils/textMatch';
import { OWNER_SEARCH_RADIUS_METERS } from '../../src/constants/searchRadius';
import type { Restaurant } from '../../src/types';

const OWNER_SEARCH_RADIUS_KM = OWNER_SEARCH_RADIUS_METERS / 1000;

export default function ClaimRestaurantScreen() {
  const router = useRouter();
  const { session, setRestaurant } = useRestaurantOwnerStore();
  const [locationQuery, setLocationQuery] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [geocodedAddress, setGeocodedAddress] = useState<string | null>(null);
  const [results, setResults] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimedRestaurants, setClaimedRestaurants] = useState<Set<string>>(new Set());

  // Load all claimed restaurants
  useEffect(() => {
    async function loadClaimed() {
      try {
        const { data, error } = await supabase
          .from('restaurants')
          .select('google_place_id');
        if (!error && data) {
          setClaimedRestaurants(new Set(data.map(r => r.google_place_id)));
        }
      } catch (err) {
        console.error('[claim] Failed to load claimed restaurants:', err);
      }
    }
    loadClaimed();
  }, []);

  // Filtering happens client-side over whatever's already been fetched for
  // the searched location — same pattern as the customer Explore screen, and
  // no extra network call per keystroke.
  const filteredResults = useMemo(() => {
    if (!nameFilter.trim()) return results;
    const target = normalizeForSearch(nameFilter);
    return results.filter((r) => normalizeForSearch(r.name).includes(target));
  }, [results, nameFilter]);

  async function handleLocationSearch() {
    if (!locationQuery.trim()) return;

    setLoading(true);
    setHasSearched(true);
    setResults([]);
    setGeocodedAddress(null);
    try {
      // Geocode the entered zip/city, then reuse the EXACT same nearby-search
      // customers use (same radius, same function) — so an owner only ever
      // sees restaurants a real customer at that location could also find.
      const geo = await geocodeLocation(locationQuery.trim());
      setGeocodedAddress(geo.formattedAddress);
      const nearby = await fetchNearbyRestaurants(geo.latitude, geo.longitude, OWNER_SEARCH_RADIUS_METERS);
      setResults(nearby);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to find restaurants near that location');
    } finally {
      setLoading(false);
    }
  }

  async function handleUseCurrentLocation() {
    setLoading(true);
    setHasSearched(true);
    setResults([]);
    setGeocodedAddress(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Enable location access, or search by zip code instead.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGeocodedAddress('your current location');
      const nearby = await fetchNearbyRestaurants(pos.coords.latitude, pos.coords.longitude, OWNER_SEARCH_RADIUS_METERS);
      setResults(nearby);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to get your current location');
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim(restaurant: Restaurant) {
    console.log('[claim] handleClaim called for:', restaurant.placeId);

    if (!session?.access_token) {
      console.error('[claim] No session token');
      Alert.alert('Error', 'Session not found');
      return;
    }

    setClaimingId(restaurant.placeId);
    console.log('[claim] Set claiming ID, about to call claimRestaurant');

    try {
      console.log('[claim] Claiming restaurant:', restaurant.placeId, restaurant.name);
      console.log('[claim] Using access token:', session.access_token ? 'present' : 'missing');

      const claimResult = await claimRestaurant(
        restaurant.placeId,
        restaurant.name,
        restaurant.location.address,
        session.access_token
      );

      console.log('[claim] Claim result received:', JSON.stringify(claimResult, null, 2));
      console.log('[claim] Claim result type:', typeof claimResult, 'keys:', Object.keys(claimResult || {}));

      if (claimResult?.restaurant) {
        console.log('[claim] Restaurant claimed successfully, setting in store');
        setRestaurant(claimResult.restaurant);
        Alert.alert('Success', 'Restaurant claimed! 🎉', [
          { text: 'OK', onPress: () => {
            console.log('[claim] Navigating to dashboard');
            router.replace('/restaurant/dashboard');
          }},
        ]);
      } else if (claimResult?.message === 'You already own this restaurant') {
        console.log('[claim] Already owns restaurant');
        Alert.alert('Info', claimResult.message, [
          { text: 'OK', onPress: () => router.replace('/restaurant/dashboard') },
        ]);
      } else {
        console.warn('[claim] Unexpected response:', JSON.stringify(claimResult, null, 2));
        Alert.alert('Info', claimResult?.message || 'Restaurant claimed');
      }
    } catch (err: any) {
      console.error('[claim] Catch block - Error:', err);
      console.error('[claim] Error stringified:', JSON.stringify(err, null, 2));
      console.error('[claim] Error message:', err.message);
      Alert.alert('Error', err.message || 'Failed to claim restaurant');
    } finally {
      console.log('[claim] Finally block - clearing claiming ID');
      setClaimingId(null);
    }
  }

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <Text style={styles.title}>Claim Your Restaurant</Text>
        <Text style={styles.subtitle}>Use your current location or enter a zip code to find it nearby</Text>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>⏳</Text>
        <Text style={styles.infoText}>Your restaurant claim is awaiting admin approval. You'll receive a notification once it's approved.</Text>
      </View>

      <TouchableOpacity
        style={[styles.currentLocationBtn, loading && styles.searchBtnDisabled]}
        onPress={handleUseCurrentLocation}
        disabled={loading}
      >
        <Text style={styles.currentLocationBtnText}>📍 Use my current location</Text>
      </TouchableOpacity>

      <Text style={styles.orDivider}>or</Text>

      <View style={styles.searchBox}>
        <TextInput
          style={styles.searchInput}
          placeholder="Zip code or city..."
          placeholderTextColor="#999"
          value={locationQuery}
          onChangeText={setLocationQuery}
          onSubmitEditing={handleLocationSearch}
        />
        <TouchableOpacity
          style={[styles.searchBtn, loading && styles.searchBtnDisabled]}
          onPress={handleLocationSearch}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.searchBtnText}>🔍</Text>
          )}
        </TouchableOpacity>
      </View>

      {geocodedAddress && (
        <View style={styles.radiusBanner}>
          <Text style={styles.radiusBannerText}>
            📍 Showing restaurants within {OWNER_SEARCH_RADIUS_KM}km of {geocodedAddress}.
          </Text>
        </View>
      )}

      {results.length > 0 && (
        <View style={styles.filterBox}>
          <TextInput
            style={styles.filterInput}
            placeholder="Filter by restaurant name..."
            placeholderTextColor="#999"
            value={nameFilter}
            onChangeText={setNameFilter}
          />
        </View>
      )}

      <FlatList
        data={filteredResults}
        keyExtractor={(item) => item.placeId}
        renderItem={({ item }) => {
          const isClaimed = claimedRestaurants.has(item.placeId);
          return (
            <View style={[styles.resultCard, isClaimed && styles.resultCardClaimed]}>
              <View style={styles.resultInfo}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultName}>{item.name}</Text>
                  {isClaimed && <Text style={styles.claimedBadge}>✓ Claimed</Text>}
                </View>
                <Text style={styles.resultAddress}>{item.location.address}</Text>
                <Text style={styles.resultDistance}>{formatDistance(item.distanceMeters)} away</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.claimBtn,
                  isClaimed && styles.claimBtnClaimed,
                  (claimingId === item.placeId || isClaimed) && styles.claimBtnDisabled
                ]}
                onPress={() => handleClaim(item)}
                disabled={claimingId === item.placeId || isClaimed}
              >
                {claimingId === item.placeId ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : isClaimed ? (
                  <Text style={styles.claimBtnText}>✓</Text>
                ) : (
                  <Text style={styles.claimBtnText}>Claim</Text>
                )}
              </TouchableOpacity>
            </View>
          );
        }}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !hasSearched ? (
            <Text style={styles.emptyText}>Enter your zip code or city to see nearby restaurants</Text>
          ) : loading ? null : results.length === 0 ? (
            <Text style={styles.emptyText}>No restaurants found within {OWNER_SEARCH_RADIUS_KM}km of that location</Text>
          ) : (
            <Text style={styles.emptyText}>No matches for "{nameFilter}"</Text>
          )
        }
      />
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666' },
  infoBox: { backgroundColor: '#FFF3E0', marginHorizontal: 16, marginBottom: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#E65100', flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoIcon: { fontSize: 20, marginTop: 2 },
  infoText: { flex: 1, fontSize: 13, fontWeight: '500', color: '#E65100', lineHeight: 18 },
  currentLocationBtn: {
    backgroundColor: '#4CAF50',
    marginHorizontal: 16,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  currentLocationBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  orDivider: { textAlign: 'center', fontSize: 12, color: '#999', marginVertical: 10 },
  searchBox: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#222',
  },
  searchBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnDisabled: { opacity: 0.6 },
  searchBtnText: { fontSize: 20 },
  radiusBanner: {
    backgroundColor: '#E8F5E9',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  radiusBannerText: { fontSize: 12, color: '#2e7d32', fontWeight: '600', lineHeight: 17 },
  filterBox: { paddingHorizontal: 16, paddingBottom: 12 },
  filterInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#222',
    backgroundColor: '#fff',
  },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  resultCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
    gap: 12,
    elevation: 2,
  },
  resultCardClaimed: { backgroundColor: '#f0f0f0' },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 15, fontWeight: '700', color: '#222' },
  resultAddress: { fontSize: 12, color: '#666' },
  resultDistance: { fontSize: 11, color: '#999', marginTop: 2 },
  claimedBadge: { fontSize: 11, fontWeight: '700', color: '#4CAF50', backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  claimBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  claimBtnClaimed: { backgroundColor: '#ccc' },
  claimBtnDisabled: { opacity: 0.6 },
  claimBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 40 },
});
