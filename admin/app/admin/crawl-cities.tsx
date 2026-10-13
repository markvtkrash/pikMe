import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Alert, confirmDialog } from '../../src/utils/alert';
import { deleteCrawlCity, listCrawlCities, listCrawlCityPlaces, runCrawlCityAgain, saveCrawlCity } from '../../src/api/crawlCities';
import {
  buildCityInput, callsLine, canRunAgain, canViewMenu, CityForm, CityPlaceRow, CrawlCityRow, deleteQuestion, describePlace, describeStatus,
  describeStop, dishesLine, EMPTY_CITY_FORM, formFromRow, MAX_RESTAURANTS_MAX, menuViewParams, placesHeading, progressLine, readingLine,
  runAgainQuestion, skippedLine,
} from '../../src/utils/crawlCities';
import { useEnterChain } from '../../src/hooks/useEnterChain';

const TONES = {
  good: { bg: '#E8F5E9', fg: '#2E7D32' },
  warn: { bg: '#FFF3E0', fg: '#E65100' },
  info: { bg: '#E3F2FD', fg: '#1565C0' },
  neutral: { bg: '#ECEFF1', fg: '#546E7A' },
} as const;

// Tools -> City Imports: add a city and how many independent restaurants to find in it. A program on the server (run by cron)
// searches Google for them, leaves out franchises, closed places and places with no website, and queues each remaining
// restaurant's website for the menu crawler, which reads the menu the same way it does for an owner's link. No owner is needed.
export default function CityImportsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<CrawlCityRow[]>([]);
  const [listCity, setListCity] = useState<CrawlCityRow | null>(null);
  const [places, setPlaces] = useState<CityPlaceRow[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CityForm>(EMPTY_CITY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listCrawlCities());
      setFailed(false);
    } catch (e: any) {
      console.warn('[admin-city-imports] list failed:', e?.message);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chain = useEnterChain(3, () => save());

  function openAdd() {
    setForm(EMPTY_CITY_FORM);
    setEditingId(null);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(row: CrawlCityRow) {
    setForm(formFromRow(row));
    setEditingId(row.id);
    setError(null);
    setFormOpen(true);
  }

  async function save() {
    const built = buildCityInput(form);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await saveCrawlCity(editingId, built.value);
      setFormOpen(false);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not save the city');
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: () => Promise<void>, doneMessage?: string) {
    setBusyId(id);
    try {
      await action();
      await load();
      if (doneMessage) Alert.alert('Done', doneMessage);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'That did not work');
    } finally {
      setBusyId(null);
    }
  }

  async function openPlaces(row: CrawlCityRow) {
    setListCity(row);
    setPlaces([]);
    setPlacesError(null);
    setPlacesLoading(true);
    try {
      setPlaces(await listCrawlCityPlaces(row.id));
    } catch (e: any) {
      setPlacesError(e?.message || 'The restaurants could not be loaded. Check that migration 135 is applied.');
    } finally {
      setPlacesLoading(false);
    }
  }

  function viewMenu(place: CityPlaceRow) {
    setListCity(null);
    router.push({ pathname: '/admin/menu-view', params: menuViewParams(place) } as any);
  }

  async function togglePaused(row: CrawlCityRow) {
    await act(row.id, async () => {
      await saveCrawlCity(row.id, { name: row.name, region: row.region, max: row.max_restaurants, enabled: !row.enabled });
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <View style={styles.flex1}>
          <Text style={styles.title}>City Imports</Text>
          <Text style={styles.subtitle}>
            Add a city and how many independent restaurants to find. A program on the server finds them on Google, leaves out franchises,
            closed places and places with no website, and the menu crawler then reads each restaurant's website. No owner is needed.
          </Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd} accessibilityRole="button">
          <Text style={styles.addBtnText}>+ Add city</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="small" color="#1565C0" style={{ alignSelf: 'flex-start' }} />}
      {failed && <Text style={styles.error}>The list could not be loaded. Check that migration 134 is applied.</Text>}
      {!loading && !failed && rows.length === 0 && <Text style={styles.hint}>No cities yet. Add one to start.</Text>}

      {rows.map((r) => {
        const status = describeStatus(r);
        const tone = TONES[status.tone];
        const reading = readingLine(r);
        const skipped = skippedLine(r);
        const stop = r.status === 'crawling' || r.status === 'done' ? describeStop(r.stop_reason) : null;
        return (
          <View key={r.id} style={styles.item}>
            <View style={styles.itemTop}>
              <Text style={styles.itemTitle} numberOfLines={1}>{r.region ? `${r.name}, ${r.region}` : r.name}</Text>
              <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>{status.label}</Text>
            </View>
            <Text style={styles.progress}>{progressLine(r)}</Text>
            {!!reading && <Text style={styles.itemMeta}>{reading}</Text>}
            {!!skipped && <Text style={styles.itemMeta}>{skipped}</Text>}
            <Text style={styles.itemMeta}>{callsLine(r)}</Text>
            {!!stop && <Text style={styles.itemMeta}>{stop}</Text>}
            {!!r.last_detail && (r.status === 'error' || r.status === 'needs_attention') && <Text style={styles.error}>{r.last_detail}</Text>}
            <View style={styles.row}>
              {r.places_found > 0 && (
                <TouchableOpacity onPress={() => openPlaces(r)} accessibilityRole="button">
                  <Text style={styles.action}>Restaurants ({r.places_found})</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity disabled={busyId === r.id} onPress={() => openEdit(r)} accessibilityRole="button">
                <Text style={styles.action}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={busyId === r.id} onPress={() => togglePaused(r)} accessibilityRole="button">
                <Text style={styles.action}>{r.enabled ? 'Pause' : 'Resume'}</Text>
              </TouchableOpacity>
              {canRunAgain(r) && (
                <TouchableOpacity
                  disabled={busyId === r.id}
                  onPress={async () => {
                    if (await confirmDialog('Run again?', runAgainQuestion(r), { confirmText: 'Run again' })) {
                      act(r.id, () => runCrawlCityAgain(r.id), 'It is back in line and starts at the next run.');
                    }
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.action}>Run again</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                disabled={busyId === r.id}
                onPress={async () => {
                  if (await confirmDialog('Remove city?', deleteQuestion(r), { confirmText: 'Remove', destructive: true })) {
                    act(r.id, () => deleteCrawlCity(r.id), 'The city was removed.');
                  }
                }}
                accessibilityRole="button"
              >
                <Text style={[styles.action, styles.danger]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <Text style={styles.footnote}>
        The Google request counts are what this program sent. Google's own billing page is the number you are charged by.
      </Text>

      {/* The restaurants a city found */}
      <Modal visible={!!listCity} transparent animationType="fade" onRequestClose={() => setListCity(null)}>
        <View style={styles.overlay}>
          <View style={[styles.modalCard, styles.listCard]}>
            <Text style={styles.modalTitle}>{listCity ? placesHeading(listCity, places.length || listCity.places_found) : ''}</Text>
            <Text style={styles.hint}>Restaurants with imported dishes can be opened with View Menu.</Text>
            {placesLoading && <ActivityIndicator size="small" color="#1565C0" style={{ alignSelf: 'flex-start', marginTop: 10 }} />}
            {!!placesError && <Text style={styles.error}>{placesError}</Text>}
            <ScrollView style={styles.placeScroll}>
              {places.map((p) => {
                const state = describePlace(p);
                const tone = TONES[state.tone];
                const dishes = dishesLine(p);
                return (
                  <View key={p.place_id} style={styles.placeRow}>
                    <View style={styles.placeTop}>
                      <Text style={styles.placeName} numberOfLines={1}>{p.name}</Text>
                      <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>{state.label}</Text>
                    </View>
                    {!!p.address && <Text style={styles.itemMeta} numberOfLines={1}>{p.address}</Text>}
                    {!!p.website && <Text style={styles.itemMeta} numberOfLines={1}>{p.website}</Text>}
                    {!!dishes && <Text style={styles.itemMeta}>{dishes}</Text>}
                    {!!p.crawl_detail && p.outcome === 'queued' && p.crawl_status !== 'done' && <Text style={styles.itemMeta} numberOfLines={2}>{p.crawl_detail}</Text>}
                    {canViewMenu(p) && (
                      <TouchableOpacity onPress={() => viewMenu(p)} accessibilityRole="button" style={styles.viewBtn}>
                        <Text style={styles.action}>View Menu</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setListCity(null)} accessibilityRole="button">
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add / edit a city */}
      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingId ? 'Edit city' : 'Add city'}</Text>

            <Text style={styles.label}>City</Text>
            <TextInput {...chain(0)} style={styles.input} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Austin" placeholderTextColor="#999" autoFocus />

            <Text style={styles.label}>State or country (recommended, so the right city is searched)</Text>
            <TextInput {...chain(1)} style={styles.input} value={form.region} onChangeText={(v) => setForm((f) => ({ ...f, region: v }))} placeholder="TX" placeholderTextColor="#999" />

            <Text style={styles.label}>Independent restaurants to find (1 to {MAX_RESTAURANTS_MAX})</Text>
            <TextInput {...chain(2)} style={styles.input} value={form.max} onChangeText={(v) => setForm((f) => ({ ...f, max: v }))} keyboardType="number-pad" placeholder="100" placeholderTextColor="#999" />
            <Text style={styles.hint}>A bigger number means more Google requests (each page of 20 results is one request).</Text>

            {!!error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setFormOpen(false)} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, saving && styles.disabled]} onPress={save} disabled={saving} accessibilityRole="button">
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>{editingId ? 'Save' : 'Add city'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: 40 },
  headerRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap' },
  flex1: { flex: 1, minWidth: 240 },
  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', lineHeight: 18 },
  addBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  hint: { fontSize: 11, color: '#888', marginTop: 4 },
  row: { flexDirection: 'row', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 },
  item: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e6e6e6', padding: 12, marginBottom: 10 },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  itemTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#222' },
  badge: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  progress: { fontSize: 13, fontWeight: '700', color: '#333', marginTop: 4 },
  itemMeta: { fontSize: 11, color: '#777', marginTop: 3, lineHeight: 16 },
  action: { fontSize: 12, fontWeight: '800', color: '#1565C0', paddingVertical: 4 },
  danger: { color: '#c62828' },
  error: { fontSize: 12, color: '#c62828', marginTop: 8 },
  footnote: { fontSize: 11, color: '#999', marginTop: 8, lineHeight: 16 },
  disabled: { opacity: 0.5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 460, borderWidth: 1, borderColor: '#CFD8DC' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#222' },
  listCard: { maxWidth: 640, maxHeight: '85%' },
  placeScroll: { marginTop: 10, flexGrow: 0 },
  placeRow: { borderTopWidth: 1, borderTopColor: '#eee', paddingVertical: 8 },
  placeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  placeName: { flex: 1, fontSize: 13, fontWeight: '800', color: '#222' },
  viewBtn: { alignSelf: 'flex-start', marginTop: 2 },
  label: { fontSize: 11, fontWeight: '700', color: '#666', marginTop: 12, marginBottom: 5 },
  input: { paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { color: '#666', fontWeight: '700', fontSize: 13 },
  saveBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 22, paddingVertical: 10, minWidth: 90, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
