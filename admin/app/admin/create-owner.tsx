import { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import {
  adminCreateRestaurantOwner, geocodeLocation, searchRestaurantByName,
} from '../../src/api/restaurantAuth';
import { fetchNearbyRestaurants } from '../../src/api/functions';
import { formatDistance } from '../../src/utils/geo';
import { normalizeForSearch } from '../../src/utils/textMatch';
import { getOwnerSearchRadiusMeters } from '../../src/constants/searchRadius';
import type { Restaurant } from '../../src/types';

const MILES_TO_METERS = 1609.34;

interface Credentials {
  email: string;
  password: string;
  restaurantName: string;
}

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const special = '!@#$%^&*';
  const all = upper + lower + nums + special;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  // Guarantee one of each required class, then fill to 12 chars
  const chars = [pick(upper), pick(lower), pick(nums), pick(special)];
  for (let i = chars.length; i < 12; i++) chars.push(pick(all));
  // Shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function copyToClipboard(text: string) {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      Alert.alert('Copied', 'Copied to clipboard');
    }
  } catch {
    // Silent fail — text is still selectable on screen
  }
}

export default function AdminCreateOwnerScreen() {
  const router = useRouter();
  const ownerSearchRadiusMeters = getOwnerSearchRadiusMeters();
  const ownerSearchRadiusMiles = (ownerSearchRadiusMeters / 1609.34).toFixed(1);

  const [locationQuery, setLocationQuery] = useState('');
  const [businessNameQuery, setBusinessNameQuery] = useState('');
  const [radiusMiles, setRadiusMiles] = useState('10');
  const [nameFilter, setNameFilter] = useState('');
  const [geocodedAddress, setGeocodedAddress] = useState<string | null>(null);
  const [results, setResults] = useState<Restaurant[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [claimedPlaceIds, setClaimedPlaceIds] = useState<Set<string>>(new Set());

  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [submitting, setSubmitting] = useState(false);

  const [errors, setErrors] = useState<{ email?: string; businessName?: string; password?: string }>({});

  const [credentials, setCredentials] = useState<Credentials | null>(null);

  // react-native-web's Alert.alert() is a no-op (empty function body) — it
  // never renders anything on web, which is this app's primary platform, so
  // Alert.alert('Error', ...) silently swallowed every error here (search
  // failures and, notably, the backend's duplicate-email 409). Shown inline
  // instead so it's actually visible.
  const [searchError, setSearchError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Filtering happens client-side over whatever's already been fetched for
  // the searched location — same pattern as claim.tsx and the customer
  // Explore screen, no extra network call per keystroke.
  const filteredResults = useMemo(() => {
    if (!nameFilter.trim()) return results;
    const target = normalizeForSearch(nameFilter);
    return results.filter((r) => normalizeForSearch(r.name).includes(target));
  }, [results, nameFilter]);

  // Shared by both search entry points below — if a business name was
  // typed, uses location-biased Text Search (name-matching, finds real but
  // less-reviewed local places Nearby Search's prominence ranking can miss);
  // otherwise falls back to the existing prominence-ranked nearby browse.
  // Mirrors owner claim.tsx's searchNear() exactly, so Admin can find
  // anything an owner could find when claiming.
  async function searchNear(latitude: number, longitude: number) {
    const name = businessNameQuery.trim();
    if (name) {
      const radiusMeters = (Number(radiusMiles) || 10) * MILES_TO_METERS;
      const found = await searchRestaurantByName(name, latitude, longitude, radiusMeters);
      setResults(found);
    } else {
      const nearby = await fetchNearbyRestaurants(latitude, longitude, ownerSearchRadiusMeters);
      setResults(nearby);
    }
  }

  async function handleSearch() {
    if (!locationQuery.trim()) return;
    setSearching(true);
    setHasSearched(true);
    setResults([]);
    setGeocodedAddress(null);
    setSearchError(null);
    try {
      const [geo] = await Promise.all([
        geocodeLocation(locationQuery.trim()),
        loadClaimedPlaceIds(),
      ]);
      setGeocodedAddress(geo.formattedAddress);
      await searchNear(geo.latitude, geo.longitude);
    } catch (error: any) {
      setSearchError(error.message || 'Failed to find restaurants near that location');
    } finally {
      setSearching(false);
    }
  }

  // So an existing owner isn't accidentally duplicated — same badge claim.tsx
  // shows, just surfaced here before creating a second owner account.
  async function loadClaimedPlaceIds() {
    try {
      const { data, error } = await supabase.from('restaurants').select('google_place_id');
      if (!error && data) {
        setClaimedPlaceIds(new Set(data.map((r) => r.google_place_id)));
      }
    } catch (err) {
      console.error('[create-owner] Failed to load claimed restaurants:', err);
    }
  }

  function handleSelect(result: Restaurant) {
    setSelected(result);
    setBusinessName(result.name);
    setEmail('');
    setPassword(generatePassword());
    setErrors({});
    setSubmitError(null);
  }

  function validate() {
    const next: { email?: string; businessName?: string; password?: string } = {};
    const emailValue = email.trim();
    if (!emailValue) {
      next.email = 'Owner email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      next.email = 'Enter a valid email address';
    }
    if (!businessName.trim()) {
      next.businessName = 'Business name is required';
    }
    if (!password) {
      next.password = 'Temporary password is required';
    } else if (password.length < 8) {
      next.password = 'Password must be at least 8 characters';
    }
    return next;
  }

  async function handleCreate() {
    if (!selected) return;

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setSubmitError(null);

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error('Admin session expired. Please log in again.');
      }

      const result = await adminCreateRestaurantOwner({
        email: email.trim(),
        password,
        businessName: businessName.trim(),
        googlePlaceId: selected.placeId,
        restaurantName: selected.name,
        address: selected.location.address,
        accessToken,
      });

      setCredentials({
        email: result.credentials.email,
        password: result.credentials.password,
        restaurantName: selected.name,
      });
    } catch (error: any) {
      setSubmitError(error.message || 'Failed to create owner account');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForNext() {
    setCredentials(null);
    setSelected(null);
    setEmail('');
    setBusinessName('');
    setPassword(generatePassword());
    setResults([]);
    setLocationQuery('');
    setBusinessNameQuery('');
    setNameFilter('');
    setGeocodedAddress(null);
    setHasSearched(false);
  }

  // ── Success: show shareable credentials ──────────────────────────────
  if (credentials) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.successContent}>
        <Text style={styles.successIcon}>✅</Text>
        <Text style={styles.successTitle}>Owner Account Created</Text>
        <Text style={styles.successSubtitle}>
          {credentials.restaurantName} is approved. Share these credentials with the owner in
          person. They will be required to change the password on first login.
        </Text>

        <View style={styles.credCard}>
          <Text style={styles.credLabel}>Email / User ID</Text>
          <View style={styles.credRow}>
            <Text style={styles.credValue} selectable>{credentials.email}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={() => copyToClipboard(credentials.email)}>
              <Text style={styles.copyBtnText}>Copy</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.credLabel, { marginTop: 16 }]}>Temporary Password</Text>
          <View style={styles.credRow}>
            <Text style={styles.credValue} selectable>{credentials.password}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={() => copyToClipboard(credentials.password)}>
              <Text style={styles.copyBtnText}>Copy</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={resetForNext}>
          <Text style={styles.primaryBtnText}>Create Another</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/admin')}>
          <Text style={styles.secondaryBtnText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Form: restaurant selected ────────────────────────────────────────
  if (selected) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.formContent}>
        <Text style={styles.sectionTitle}>Owner Details</Text>

        <View style={styles.selectedCard}>
          <Text style={styles.selectedName}>{selected.name}</Text>
          <Text style={styles.selectedAddress}>{selected.location.address}</Text>
        </View>

        <Text style={styles.label}>Owner Email <Text style={styles.required}>*</Text></Text>
        <TextInput
          style={[styles.input, !!errors.email && styles.inputError]}
          placeholder="owner@example.com"
          placeholderTextColor="#999"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={(t) => { setEmail(t); if (errors.email) setErrors((e) => ({ ...e, email: undefined })); }}
          editable={!submitting}
        />
        {!!errors.email && <Text style={styles.errorText}>{errors.email}</Text>}

        <Text style={styles.label}>Business Name</Text>
        {/* Comes from the Google listing chosen above, so it is shown but not editable. */}
        <TextInput
          style={[styles.input, styles.inputReadOnly]}
          value={businessName}
          editable={false}
          selectTextOnFocus={false}
        />
        {!!errors.businessName && <Text style={styles.errorText}>{errors.businessName}</Text>}

        <Text style={styles.label}>Temporary Password <Text style={styles.required}>*</Text></Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput, !!errors.password && styles.inputError]}
            placeholderTextColor="#999"
            value={password}
            onChangeText={(t) => { setPassword(t); if (errors.password) setErrors((e) => ({ ...e, password: undefined })); }}
            autoCapitalize="none"
            editable={!submitting}
          />
          <TouchableOpacity
            style={styles.regenBtn}
            onPress={() => { setPassword(generatePassword()); if (errors.password) setErrors((e) => ({ ...e, password: undefined })); }}
            disabled={submitting}
          >
            <Text style={styles.regenBtnText}>🔄</Text>
          </TouchableOpacity>
        </View>
        {!!errors.password
          ? <Text style={styles.errorText}>{errors.password}</Text>
          : <Text style={styles.hint}>The owner must change this on first login.</Text>}

        {submitError && (
          <View style={[styles.errorBanner, styles.errorBannerNoIndent]}>
            <Text style={styles.errorBannerText}>{submitError}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, submitting && styles.btnDisabled]}
          onPress={handleCreate}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>Create & Approve</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => setSelected(null)}
          disabled={submitting}
        >
          <Text style={styles.secondaryBtnText}>← Back to Search</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Search ───────────────────────────────────────────────────────────
  // Mirrors owner claim.tsx's search UI exactly (location + optional
  // business-name/radius refinement over the same fetchNearbyRestaurants /
  // searchRestaurantByName calls) so Admin can find anything an owner could
  // find when claiming — the previous single free-text box called an edge
  // function that had since been repurposed into a geocoder and never
  // actually returned restaurant results.
  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Create Restaurant Owner</Text>
        <Text style={styles.headerSubtitle}>
          Enter a zip code or city to find the restaurant, then provision an owner account for it.
        </Text>
      </View>

      <Text style={styles.businessNameLabel}>Know the exact name? Search for it directly:</Text>
      <Text style={styles.businessNameHint}>
        Finds the restaurant by name instead of just browsing what's nearby — helpful if it doesn't
        show up in the browse list below (a real place can still be missed by that if it has fewer reviews).
      </Text>
      <View style={styles.businessNameRow}>
        <TextInput
          style={[styles.searchInput, styles.businessNameInput]}
          placeholder="Business name (optional), e.g. Mocha Point Coffee"
          placeholderTextColor="#999"
          value={businessNameQuery}
          onChangeText={setBusinessNameQuery}
          onSubmitEditing={handleSearch}
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
          onSubmitEditing={handleSearch}
        />
        <TouchableOpacity
          style={[styles.searchBtn, searching && styles.btnDisabled]}
          onPress={handleSearch}
          disabled={searching}
        >
          {searching
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.searchBtnText}>🔍</Text>}
        </TouchableOpacity>
      </View>

      {searchError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{searchError}</Text>
        </View>
      )}

      {geocodedAddress && (
        <View style={styles.radiusBanner}>
          <Text style={styles.radiusBannerText}>
            {businessNameQuery.trim()
              ? `📍 Showing matches for "${businessNameQuery.trim()}" within ${radiusMiles || 10} miles of ${geocodedAddress}.`
              : `📍 Showing restaurants within ${ownerSearchRadiusMiles}mi of ${geocodedAddress}.`}
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
          const isClaimed = claimedPlaceIds.has(item.placeId);
          return (
            <TouchableOpacity
              style={[styles.resultCard, isClaimed && styles.resultCardClaimed]}
              onPress={() => handleSelect(item)}
            >
              <View style={styles.resultInfo}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultName}>{item.name}</Text>
                  {isClaimed && <Text style={styles.claimedBadge}>Already has an owner</Text>}
                </View>
                <Text style={styles.resultAddress}>{item.location.address}</Text>
                <Text style={styles.resultDistance}>{formatDistance(item.distanceMeters)} away</Text>
              </View>
              <Text style={styles.resultArrow}>›</Text>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !hasSearched ? (
            <Text style={styles.emptyText}>Enter a zip code or city to see nearby restaurants</Text>
          ) : searching ? null : results.length === 0 ? (
            <Text style={styles.emptyText}>
              {businessNameQuery.trim()
                ? `No match for "${businessNameQuery.trim()}" within ${radiusMiles || 10} miles of that location`
                : `No restaurants found within ${ownerSearchRadiusMiles}mi of that location`}
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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  headerSubtitle: { fontSize: 13, color: '#666' },

  businessNameLabel: { fontSize: 13, fontWeight: '700', color: '#222', marginHorizontal: 16, marginBottom: 2 },
  businessNameHint: { fontSize: 11.5, color: '#888', lineHeight: 16, marginHorizontal: 16, marginBottom: 8 },
  businessNameRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  businessNameInput: { flex: 3 },
  radiusInput: { flex: 1, textAlign: 'center' },

  searchBox: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  searchInput: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#222', backgroundColor: '#fff',
  },
  searchBtn: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: '#1565C0',
    alignItems: 'center', justifyContent: 'center',
  },
  searchBtnText: { fontSize: 20 },

  radiusBanner: { backgroundColor: '#E3F2FD', marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  radiusBannerText: { fontSize: 12, color: '#0D47A1', fontWeight: '600', lineHeight: 17 },
  filterBox: { paddingHorizontal: 16, paddingBottom: 12 },
  filterInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 14, color: '#222', backgroundColor: '#fff',
  },

  list: { paddingHorizontal: 16, paddingBottom: 20 },
  resultCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 10, alignItems: 'center', gap: 12, elevation: 1,
  },
  resultCardClaimed: { backgroundColor: '#f0f0f0' },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 15, fontWeight: '700', color: '#222' },
  resultAddress: { fontSize: 12, color: '#666' },
  resultDistance: { fontSize: 11, color: '#999', marginTop: 2 },
  claimedBadge: { fontSize: 11, fontWeight: '700', color: '#c62828', backgroundColor: '#FFEBEE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  resultArrow: { fontSize: 24, color: '#1565C0', fontWeight: '800' },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 40 },

  formContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40, width: '100%', maxWidth: 480, alignSelf: 'center' },
  selectedCard: {
    backgroundColor: '#E3F2FD', borderRadius: 12, padding: 14, marginBottom: 20,
    borderLeftWidth: 4, borderLeftColor: '#1565C0',
  },
  selectedName: { fontSize: 16, fontWeight: '800', color: '#0D47A1', marginBottom: 2 },
  selectedAddress: { fontSize: 12, color: '#1565C0' },

  label: { fontSize: 13, fontWeight: '700', color: '#333', marginBottom: 6, marginTop: 4 },
  required: { color: '#e53e3e', fontWeight: '800' },
  input: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#222', borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 12,
  },
  inputError: { borderColor: '#e53e3e', borderWidth: 1.5 },
  inputReadOnly: { backgroundColor: '#f0f0f0', color: '#666' },
  errorText: { fontSize: 12, fontWeight: '600', color: '#e53e3e', marginTop: -6, marginBottom: 12 },
  errorBanner: {
    backgroundColor: '#FFEBEE', borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#e53e3e',
    paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 16, marginBottom: 12,
  },
  // formContent (the Owner Details form) already has its own paddingHorizontal
  // — the plain errorBanner's marginHorizontal would double-indent it there.
  errorBannerNoIndent: { marginHorizontal: 0 },
  errorBannerText: { fontSize: 13, fontWeight: '600', color: '#c62828', lineHeight: 18 },
  passwordRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  passwordInput: { flex: 1 },
  regenBtn: {
    width: 48, height: 48, borderRadius: 10, backgroundColor: '#E3F2FD',
    alignItems: 'center', justifyContent: 'center',
  },
  regenBtnText: { fontSize: 20 },
  hint: { fontSize: 12, color: '#999', marginBottom: 20 },

  primaryBtn: {
    backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', marginTop: 8, minHeight: 50, justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  secondaryBtnText: { color: '#1565C0', fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },

  successContent: { paddingHorizontal: 16, paddingTop: 40, paddingBottom: 40, alignItems: 'center', width: '100%', maxWidth: 480, alignSelf: 'center' },
  successIcon: { fontSize: 56, marginBottom: 12 },
  successTitle: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 8 },
  successSubtitle: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 24, lineHeight: 19 },
  credCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 18, width: '100%',
    borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 24,
  },
  credLabel: { fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  credRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  credValue: { flex: 1, fontSize: 15, fontWeight: '700', color: '#222' },
  copyBtn: { backgroundColor: '#E3F2FD', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  copyBtnText: { fontSize: 13, fontWeight: '700', color: '#1565C0' },
});
