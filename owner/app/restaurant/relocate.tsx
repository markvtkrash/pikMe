import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import {
  geocodeLocation, searchRestaurantByName,
  getRelocationEligibility, requestRestaurantRelocation,
} from '../../src/api/restaurantAuth';
import { fetchNearbyRestaurants } from '../../src/api/functions';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { supabase } from '../../src/api/supabase';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';
import { formatDistance } from '../../src/utils/geo';
import { normalizeForSearch } from '../../src/utils/textMatch';
import { OWNER_SEARCH_RADIUS_METERS } from '../../src/constants/searchRadius';
import type { Restaurant } from '../../src/types';

const OWNER_SEARCH_RADIUS_KM = OWNER_SEARCH_RADIUS_METERS / 1000;
const MILES_TO_METERS = 1609.34;

export default function RelocateRestaurantScreen() {
  const router = useRouter();
  const { restaurant } = useRestaurantOwnerStore();
  const { favorites, toggleFavorite } = useFavoritePages();
  const [checkingEligibility, setCheckingEligibility] = useState(true);
  const [blockedReason, setBlockedReason] = useState<{ reason: string; retryAfter: string | null } | null>(null);

  const [locationQuery, setLocationQuery] = useState('');
  const [businessNameQuery, setBusinessNameQuery] = useState('');
  const [radiusMiles, setRadiusMiles] = useState('10');
  const [nameFilter, setNameFilter] = useState('');
  const [geocodedAddress, setGeocodedAddress] = useState<string | null>(null);
  const [results, setResults] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [claimedElsewhere, setClaimedElsewhere] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  // Checked once up front — the whole point is to gate access to the search
  // UI itself (each search below is a billable Google call), not to police
  // individual searches within one visit.
  useEffect(() => {
    if (!restaurant) {
      router.replace('/restaurant/dashboard');
      return;
    }
    getRelocationEligibility(restaurant.id)
      .then((result) => {
        if (result && !result.eligible) {
          setBlockedReason({ reason: result.reason || 'unknown', retryAfter: result.retry_after });
        }
      })
      .catch((error: any) => {
        Alert.alert('Error', error.message || 'Failed to check relocation eligibility');
      })
      .finally(() => setCheckingEligibility(false));
  }, [restaurant?.id]);

  useEffect(() => {
    async function loadClaimed() {
      try {
        const { data, error } = await supabase.from('restaurants').select('google_place_id');
        if (!error && data) {
          setClaimedElsewhere(new Set(data.map((r) => r.google_place_id)));
        }
      } catch (err) {
        console.error('[relocate] Failed to load claimed restaurants:', err);
      }
    }
    loadClaimed();
  }, []);

  const filteredResults = useMemo(() => {
    if (!nameFilter.trim()) return results;
    const target = normalizeForSearch(nameFilter);
    return results.filter((r) => normalizeForSearch(r.name).includes(target));
  }, [results, nameFilter]);

  async function searchNear(latitude: number, longitude: number) {
    const name = businessNameQuery.trim();
    if (name) {
      const radiusMeters = (Number(radiusMiles) || 10) * MILES_TO_METERS;
      const found = await searchRestaurantByName(name, latitude, longitude, radiusMeters);
      setResults(found);
    } else {
      const nearby = await fetchNearbyRestaurants(latitude, longitude, OWNER_SEARCH_RADIUS_METERS);
      setResults(nearby);
    }
  }

  async function handleLocationSearch() {
    if (!locationQuery.trim()) return;
    setLoading(true);
    setHasSearched(true);
    setResults([]);
    setGeocodedAddress(null);
    try {
      const geo = await geocodeLocation(locationQuery.trim());
      setGeocodedAddress(geo.formattedAddress);
      await searchNear(geo.latitude, geo.longitude);
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
      await searchNear(pos.coords.latitude, pos.coords.longitude);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to get your current location');
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRelocation(newPlace: Restaurant) {
    if (!restaurant) return;
    setSubmittingId(newPlace.placeId);
    try {
      await requestRestaurantRelocation({
        restaurantId: restaurant.id,
        newGooglePlaceId: newPlace.placeId,
        newName: newPlace.name,
        newAddress: newPlace.location.address,
      });
      setSubmitted(true);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit relocation request');
    } finally {
      setSubmittingId(null);
    }
  }

  if (!restaurant) return null;

  if (checkingEligibility) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  if (submitted) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.doneIcon}>✅</Text>
        <Text style={styles.doneTitle}>Relocation request submitted</Text>
        <Text style={styles.doneBody}>
          An admin will review the new location and approve it before your listing updates.
        </Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/restaurant/dashboard')}>
          <Text style={styles.doneBtnText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (blockedReason) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.doneIcon}>⏳</Text>
        <Text style={styles.doneTitle}>
          {blockedReason.reason === 'pending_request' ? 'Request already pending' : 'Please wait before requesting again'}
        </Text>
        <Text style={styles.doneBody}>
          {blockedReason.reason === 'pending_request'
            ? "You already have a relocation request awaiting admin review. You'll be notified once it's decided."
            : `You can submit another relocation request after ${blockedReason.retryAfter ? new Date(blockedReason.retryAfter).toLocaleDateString() : 'your cooldown ends'}.`}
        </Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/restaurant/dashboard')}>
          <Text style={styles.doneBtnText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>My Restaurant Moved</Text>
          <FavoriteHeart
            active={favorites.has('tool-relocate')}
            onPress={() => toggleFavorite('tool-relocate')}
            size="large"
          />
        </View>
        <Text style={styles.subtitle}>Find your new location, then submit it for admin review</Text>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>⏳</Text>
        <Text style={styles.infoText}>
          Currently listed as: {restaurant.name} — {restaurant.address}. Submitting a request won't change
          anything until an admin approves it.
        </Text>
      </View>

      <View style={styles.infoBoxBlue}>
        <Text style={styles.infoIcon}>📍</Text>
        <Text style={styles.infoTextBlue}>
          Before you search: make sure your restaurant's Google Business listing already shows the new
          address — we search Google's own data, so if Google doesn't have it yet, we won't find it either.
          If you haven't updated it there, do that first and check back once it appears when you search your
          business name on Google.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.currentLocationBtn, loading && styles.searchBtnDisabled]}
        onPress={handleUseCurrentLocation}
        disabled={loading}
      >
        <Text style={styles.currentLocationBtnText}>📍 Use my current location</Text>
      </TouchableOpacity>

      <Text style={styles.orDivider}>or</Text>

      <Text style={styles.businessNameLabel}>Know the exact name? Search for it directly:</Text>
      <View style={styles.businessNameRow}>
        <TextInput
          style={[styles.searchInput, styles.businessNameInput]}
          placeholder="Business name (optional)"
          placeholderTextColor="#999"
          value={businessNameQuery}
          onChangeText={setBusinessNameQuery}
          onSubmitEditing={handleLocationSearch}
        />
        <TextInput
          style={[styles.searchInput, styles.radiusInput]}
          placeholder="Miles"
          placeholderTextColor="#999"
          keyboardType="number-pad"
          value={radiusMiles}
          onChangeText={setRadiusMiles}
        />
      </View>

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
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.searchBtnText}>🔍</Text>}
        </TouchableOpacity>
      </View>

      {geocodedAddress && (
        <View style={styles.radiusBanner}>
          <Text style={styles.radiusBannerText}>
            {businessNameQuery.trim()
              ? `📍 Showing matches for "${businessNameQuery.trim()}" within ${radiusMiles || 10} miles of ${geocodedAddress}.`
              : `📍 Showing restaurants within ${OWNER_SEARCH_RADIUS_KM}km of ${geocodedAddress}.`}
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
          const isSamePlace = item.placeId === restaurant.google_place_id;
          const isClaimedByOther = claimedElsewhere.has(item.placeId) && !isSamePlace;
          return (
            <View style={[styles.resultCard, isClaimedByOther && styles.resultCardClaimed]}>
              <View style={styles.resultInfo}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultName}>{item.name}</Text>
                  {isSamePlace && <Text style={styles.currentBadge}>Current listing</Text>}
                  {isClaimedByOther && <Text style={styles.claimedBadge}>✓ Already claimed</Text>}
                </View>
                <Text style={styles.resultAddress}>{item.location.address}</Text>
                <Text style={styles.resultDistance}>{formatDistance(item.distanceMeters)} away</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.claimBtn,
                  (isClaimedByOther || isSamePlace) && styles.claimBtnClaimed,
                  submittingId === item.placeId && styles.claimBtnDisabled,
                ]}
                onPress={() => handleRequestRelocation(item)}
                disabled={isClaimedByOther || isSamePlace || submittingId === item.placeId}
              >
                {submittingId === item.placeId ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.claimBtnText}>This is it</Text>
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
            <Text style={styles.emptyText}>
              {businessNameQuery.trim()
                ? `No match for "${businessNameQuery.trim()}" within ${radiusMiles || 10} miles of that location`
                : `No restaurants found within ${OWNER_SEARCH_RADIUS_KM}km of that location`}
            </Text>
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
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6', padding: 28, gap: 12 },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666' },
  infoBox: { backgroundColor: '#FFF3E0', marginHorizontal: 16, marginBottom: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#E65100', flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoIcon: { fontSize: 20, marginTop: 2 },
  infoText: { flex: 1, fontSize: 13, fontWeight: '500', color: '#E65100', lineHeight: 18 },
  infoBoxBlue: { backgroundColor: '#E3F2FD', marginHorizontal: 16, marginBottom: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#1565C0', flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoTextBlue: { flex: 1, fontSize: 13, fontWeight: '500', color: '#1565C0', lineHeight: 18 },
  currentLocationBtn: { backgroundColor: '#4CAF50', marginHorizontal: 16, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  currentLocationBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  orDivider: { textAlign: 'center', fontSize: 12, color: '#999', marginVertical: 10 },
  businessNameLabel: { fontSize: 13, fontWeight: '700', color: '#222', marginHorizontal: 16, marginBottom: 8 },
  businessNameRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  businessNameInput: { flex: 3, marginBottom: 0 },
  radiusInput: { flex: 1, marginBottom: 0, textAlign: 'center' },
  searchBox: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#222' },
  searchBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#4CAF50', alignItems: 'center', justifyContent: 'center' },
  searchBtnDisabled: { opacity: 0.6 },
  searchBtnText: { fontSize: 20 },
  radiusBanner: { backgroundColor: '#E8F5E9', marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  radiusBannerText: { fontSize: 12, color: '#2e7d32', fontWeight: '600', lineHeight: 17 },
  filterBox: { paddingHorizontal: 16, paddingBottom: 12 },
  filterInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#222', backgroundColor: '#fff' },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  resultCard: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, alignItems: 'center', gap: 12, elevation: 2 },
  resultCardClaimed: { backgroundColor: '#f0f0f0' },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  resultInfo: { flex: 1, minWidth: 0 },
  resultName: { fontSize: 15, fontWeight: '700', color: '#222' },
  resultAddress: { fontSize: 12, color: '#666' },
  resultDistance: { fontSize: 11, color: '#999', marginTop: 2 },
  currentBadge: { fontSize: 11, fontWeight: '700', color: '#1565C0', backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  claimedBadge: { fontSize: 11, fontWeight: '700', color: '#4CAF50', backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  claimBtn: { backgroundColor: '#4CAF50', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  claimBtnClaimed: { backgroundColor: '#ccc' },
  claimBtnDisabled: { opacity: 0.6 },
  claimBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 40 },

  doneIcon: { fontSize: 48 },
  doneTitle: { fontSize: 18, fontWeight: '800', color: '#222', textAlign: 'center' },
  doneBody: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  doneBtn: { marginTop: 12, backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
  doneBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
