import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert, ScrollView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { adminCreateRestaurantOwner } from '../../src/api/restaurantAuth';

interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address: string;
}

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

  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<PlaceResult | null>(null);
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [submitting, setSubmitting] = useState(false);

  const [errors, setErrors] = useState<{ email?: string; businessName?: string; password?: string }>({});

  const [credentials, setCredentials] = useState<Credentials | null>(null);

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
      const response = await fetch(`${supabaseUrl}/functions/v1/restaurant-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResults(data.results || []);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to search restaurants');
    } finally {
      setSearching(false);
    }
  }

  function handleSelect(result: PlaceResult) {
    setSelected(result);
    setBusinessName(result.name);
    setEmail('');
    setPassword(generatePassword());
    setErrors({});
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
        googlePlaceId: selected.place_id,
        restaurantName: selected.name,
        address: selected.formatted_address,
        accessToken,
      });

      setCredentials({
        email: result.credentials.email,
        password: result.credentials.password,
        restaurantName: selected.name,
      });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create owner account');
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
    setSearchQuery('');
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
          <Text style={styles.selectedAddress}>{selected.formatted_address}</Text>
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

        <Text style={styles.label}>Business Name <Text style={styles.required}>*</Text></Text>
        <TextInput
          style={[styles.input, !!errors.businessName && styles.inputError]}
          placeholder="Business name"
          placeholderTextColor="#999"
          value={businessName}
          onChangeText={(t) => { setBusinessName(t); if (errors.businessName) setErrors((e) => ({ ...e, businessName: undefined })); }}
          editable={!submitting}
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
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Create Restaurant Owner</Text>
        <Text style={styles.headerSubtitle}>
          Search for a restaurant, then provision an owner account for it.
        </Text>
      </View>

      <View style={styles.searchBox}>
        <TextInput
          style={styles.searchInput}
          placeholder="Restaurant name or address..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
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

      <FlatList
        data={results}
        keyExtractor={(item) => item.place_id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.resultCard} onPress={() => handleSelect(item)}>
            <View style={styles.resultInfo}>
              <Text style={styles.resultName}>{item.name}</Text>
              <Text style={styles.resultAddress}>{item.formatted_address}</Text>
            </View>
            <Text style={styles.resultArrow}>›</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {searchQuery ? 'No restaurants found' : 'Search for a restaurant to begin'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  headerSubtitle: { fontSize: 13, color: '#666' },

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

  list: { paddingHorizontal: 16, paddingBottom: 20 },
  resultCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 10, alignItems: 'center', gap: 12, elevation: 1,
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 2 },
  resultAddress: { fontSize: 12, color: '#666' },
  resultArrow: { fontSize: 24, color: '#1565C0', fontWeight: '800' },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 40 },

  formContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40 },
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
  errorText: { fontSize: 12, fontWeight: '600', color: '#e53e3e', marginTop: -6, marginBottom: 12 },
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

  successContent: { paddingHorizontal: 16, paddingTop: 40, paddingBottom: 40, alignItems: 'center' },
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
