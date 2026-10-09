import { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Alert } from '../../utils/alert';
import { getAdminCategories, getRestaurantCategoriesForAdmin, setRestaurantCategoriesAsAdmin } from '../../api/categories';
import {
  AdminCategory, buildRestaurantCategoryArgs, categoriesInGroup, CategoryGroup, GROUP_LABELS, GROUP_ORDER, guessKeys,
  RestaurantCategoriesFromServer, RestaurantCategoryStates, statesFromServer, toggleKey,
} from '../../utils/categories';

// One restaurant's categories: what the place is, how you get the food, what it serves. Each group is either left on Google's guess
// or set by hand (the owner's choice shows here too). Saving a group on "Google's guess" removes any saved choice for it.
export function RestaurantCategoriesModal({
  restaurantId, restaurantName, onClose,
}: { restaurantId: string | null; restaurantName: string; onClose: () => void }) {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [server, setServer] = useState<RestaurantCategoriesFromServer | null>(null);
  const [states, setStates] = useState<RestaurantCategoryStates | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStates(null);
    Promise.all([getAdminCategories(), getRestaurantCategoriesForAdmin(restaurantId)])
      .then(([cats, rest]) => {
        if (cancelled) return;
        setCategories(cats.categories.filter((c) => c.is_active));
        setServer(rest);
        setStates(statesFromServer(rest));
      })
      .catch((e: any) => !cancelled && setError(e?.message || 'Could not load the categories'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [restaurantId]);

  async function save() {
    if (!restaurantId || !states) return;
    const built = buildRestaurantCategoryArgs(states);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setRestaurantCategoriesAsAdmin(restaurantId, built.value);
      Alert.alert('Saved', 'The categories are saved.');
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  function setGroup(grp: CategoryGroup, next: { custom: boolean; keys: string[] }) {
    setStates((s) => (s ? { ...s, [grp]: next } : s));
    setError(null);
  }

  const labelOf = (key: string) => categories.find((c) => c.key === key)?.label ?? key;

  return (
    <Modal visible={!!restaurantId} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Categories</Text>
          <Text style={styles.subtitle}>{restaurantName}</Text>
          {loading || !states || !server ? (
            error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator size="small" color="#1565C0" style={{ marginVertical: 24 }} />
          ) : (
            <ScrollView style={styles.scroll}>
              {server.google_types.length > 0 && (
                <Text style={styles.hint}>Google's types for this place: {server.google_types.join(', ')}</Text>
              )}
              {GROUP_ORDER.map((grp) => {
                const state = states[grp];
                const guess = guessKeys(server, grp);
                return (
                  <View key={grp} style={styles.group}>
                    <Text style={styles.groupTitle}>{GROUP_LABELS[grp]}</Text>
                    <View style={styles.modeRow}>
                      <TouchableOpacity style={[styles.mode, !state.custom && styles.modeOn]} onPress={() => setGroup(grp, { custom: false, keys: [] })} accessibilityRole="button">
                        <Text style={[styles.modeText, !state.custom && styles.modeTextOn]}>Google's guess</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.mode, state.custom && styles.modeOn]} onPress={() => setGroup(grp, { custom: true, keys: state.custom ? state.keys : guess })} accessibilityRole="button">
                        <Text style={[styles.modeText, state.custom && styles.modeTextOn]}>Set by hand</Text>
                      </TouchableOpacity>
                    </View>
                    {!state.custom ? (
                      <Text style={styles.hint}>{guess.length > 0 ? guess.map(labelOf).join(' · ') : 'Nothing found from Google'}</Text>
                    ) : (
                      <View style={styles.chips}>
                        {categoriesInGroup(categories, grp).map((c) => {
                          const on = state.keys.includes(c.key);
                          return (
                            <TouchableOpacity key={c.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setGroup(grp, { custom: true, keys: toggleKey(state.keys, c.key) })} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                              <Text style={[styles.chipText, on && styles.chipTextOn]}>{on ? '✓ ' : ''}{c.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
          {!!error && !!states && <Text style={styles.error}>{error}</Text>}
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancel} onPress={onClose} accessibilityRole="button"><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.save, (saving || !states) && styles.disabled]} onPress={save} disabled={saving || !states} accessibilityRole="button">
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 560, maxHeight: '92%', backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  title: { fontSize: 18, fontWeight: '800', color: '#222' },
  subtitle: { fontSize: 13, color: '#666', marginBottom: 8 },
  scroll: { flexGrow: 0, maxHeight: 460 },
  hint: { fontSize: 12, color: '#888', marginTop: 4, lineHeight: 17 },
  group: { marginTop: 14 },
  groupTitle: { fontSize: 13, fontWeight: '800', color: '#222', marginBottom: 6 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  mode: { borderWidth: 1, borderColor: '#ccc', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  modeOn: { backgroundColor: '#E3F2FD', borderColor: '#1565C0' },
  modeText: { fontSize: 12, fontWeight: '700', color: '#555' },
  modeTextOn: { color: '#1565C0' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#444' },
  chipTextOn: { color: '#fff' },
  error: { fontSize: 12, color: '#c62828', marginTop: 10 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  cancel: { paddingHorizontal: 16, paddingVertical: 10 },
  cancelText: { color: '#666', fontWeight: '700', fontSize: 13 },
  save: { backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  disabled: { opacity: 0.5 },
});
