import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Alert } from '../../utils/alert';
import { setChainPlaceId } from '../../api/chainMenus';
import { geocodeLocation, searchRestaurantByName } from '../../api/restaurantAuth';
import {
  ChainMenuSource, DEFAULT_STORE_SEARCH_MILES, MAX_STORE_SEARCH_MILES, parseSearchMiles, validatePlaceIdInput,
} from '../../utils/chainMenuSources';
import type { Restaurant } from '../../types';

const MILES_TO_METERS = 1609.34;
const MAX_RESULTS = 8;

// "Store for Google lookup" part of the Manage window (migration 096). The lookup asks Google about one real
// store of the chain, identified by its place ID. Customer searches fill this in over time; here an admin can
// find a store (same Google search as Create Owner) or paste a place ID for a chain nobody has searched near.
// Collapsed by default to keep the window short.
export default function ChainStoreSection({
  source, disabled, onChanged,
}: { source: ChainMenuSource; disabled: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [placeId, setPlaceId] = useState(source.source_place_id ?? '');
  const [pickedName, setPickedName] = useState('');
  // The business name searched for is the chain's own name on the franchise list, shown but not editable
  // (the list matches stores to a chain by that name and its aliases).
  const businessName = source.chain_name;
  const [where, setWhere] = useState('');
  const [miles, setMiles] = useState(String(DEFAULT_STORE_SEARCH_MILES));
  const [results, setResults] = useState<Restaurant[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const problem = validatePlaceIdInput(placeId);
  const hadStore = !!source.source_place_id;
  const changed = placeId.trim() !== (source.source_place_id ?? '');
  const removing = hadStore && placeId.trim() === '';
  const canSave = !disabled && !saving && changed && problem === null;

  const canSearch = !!where.trim() && !searching && !saving;

  async function search() {
    if (!canSearch) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const radius = parseSearchMiles(miles);
      setMiles(String(radius));
      const name = businessName.trim();
      const geo = await geocodeLocation(where.trim());
      const found = await searchRestaurantByName(name, geo.latitude, geo.longitude, radius * MILES_TO_METERS);
      setResults(found.slice(0, MAX_RESULTS));
      if (found.length === 0) setSearchError(`No "${name}" found within ${radius} miles of that place. Try a bigger distance or another city or ZIP.`);
    } catch (error: any) {
      setSearchError(error?.message || 'The search failed');
    } finally {
      setSearching(false);
    }
  }

  function pick(r: Restaurant) {
    setPlaceId(r.placeId);
    setPickedName(r.name);
    setResults([]);
  }

  async function save() {
    setSaving(true);
    try {
      const result = await setChainPlaceId(source.chain_id, placeId, pickedName);
      const text = result.removed
        ? 'The stored store was removed. A store seen in a customer search can still be used.'
        : 'Store saved. The chain is marked for a fresh lookup on its next visit (or the next scheduled build).';
      Alert.alert('Done', result.warning ? `${text}\n\n⚠ ${result.warning}` : text);
      onChanged();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not save the store');
    } finally {
      setSaving(false);
    }
  }

  const summary = source.source_place_id ? 'store saved' : source.has_store ? 'a store has been seen' : 'no store seen yet';

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.header} onPress={() => setOpen((v) => !v)} accessibilityRole="button">
        <Text style={styles.title}>{open ? '▾' : '▸'} Store for Google lookup</Text>
        <Text style={[styles.summary, source.has_store === false && styles.summaryWarn]}>{summary}</Text>
      </TouchableOpacity>

      {open && (
        <View>
          <Text style={styles.note}>
            The lookup asks Google about one real store of this chain; the menu is then built for the whole chain.
            Find a store near a city, or paste its Google place ID.
          </Text>

          <Text style={styles.label}>Find a store</Text>
          <TextInput
            style={[styles.input, styles.inputReadOnly]}
            value={businessName}
            editable={false}
            selectTextOnFocus={false}
            accessibilityLabel="Business name searched for (read only)"
          />
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.input, styles.searchInput]}
              value={where}
              onChangeText={setWhere}
              placeholder="City or ZIP, e.g. Austin, TX"
              placeholderTextColor="#999"
              editable={!searching && !saving}
              onSubmitEditing={search}
              accessibilityLabel="City or ZIP code"
            />
            <TextInput
              style={[styles.input, styles.milesInput]}
              value={miles}
              onChangeText={setMiles}
              placeholder="mi"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              maxLength={2}
              editable={!searching && !saving}
              onSubmitEditing={search}
              accessibilityLabel="Search distance in miles"
            />
            <Text style={styles.milesLabel}>miles</Text>
            <TouchableOpacity
              style={[styles.searchBtn, !canSearch && styles.disabled]}
              disabled={!canSearch}
              onPress={search}
              accessibilityRole="button"
            >
              {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.searchBtnText}>Search</Text>}
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Distance from the city or ZIP, up to {MAX_STORE_SEARCH_MILES} miles.</Text>
          {!!searchError && <Text style={styles.warning}>{searchError}</Text>}
          {results.map((r) => (
            <TouchableOpacity key={r.placeId} style={styles.result} onPress={() => pick(r)} accessibilityRole="button">
              <Text style={styles.resultName}>{r.name}</Text>
              <Text style={styles.resultAddress} numberOfLines={1}>{r.location?.address}</Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.label}>Google place ID</Text>
          <TextInput
            style={styles.input}
            value={placeId}
            onChangeText={(t) => { setPlaceId(t); setPickedName(''); }}
            placeholder="e.g. ChIJ… (blank removes it)"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving && !disabled}
          />
          {!!pickedName && <Text style={styles.picked}>Picked: {pickedName}</Text>}
          {!!problem && <Text style={styles.warning}>{problem}</Text>}
          <TouchableOpacity
            style={[styles.saveBtn, removing && styles.removeBtn, !canSave && styles.disabled]}
            disabled={!canSave}
            onPress={save}
            accessibilityRole="button"
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>{removing ? 'Remove store' : 'Save store'}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 12, fontWeight: '800', color: '#333', flex: 1 },
  summary: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  summaryWarn: { color: '#E65100' },
  note: { fontSize: 11, color: '#999', marginTop: 6, lineHeight: 16 },
  label: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, marginTop: 10 },
  input: { backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 6 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  inputReadOnly: { color: '#666', backgroundColor: '#e8e8e8' },
  searchInput: { flex: 1 },
  milesInput: { width: 56, textAlign: 'center' },
  milesLabel: { fontSize: 12, color: '#666', paddingTop: 12 },
  hint: { fontSize: 11, color: '#999', marginBottom: 4 },
  searchBtn: { backgroundColor: '#37474F', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11, minWidth: 74, alignItems: 'center' },
  searchBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  result: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 9, marginBottom: 6 },
  resultName: { fontSize: 13, fontWeight: '700', color: '#222' },
  resultAddress: { fontSize: 11, color: '#777' },
  picked: { fontSize: 11, color: '#2E7D32', fontWeight: '700', marginBottom: 4 },
  warning: { fontSize: 12, color: '#c62828', marginTop: 2, marginBottom: 4, fontWeight: '600' },
  saveBtn: { marginTop: 4, alignSelf: 'flex-start', backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9, elevation: 2 },
  removeBtn: { backgroundColor: '#c62828' },
  saveText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  disabled: { opacity: 0.5 },
});
