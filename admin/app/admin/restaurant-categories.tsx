import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Switch } from 'react-native';
import { Alert } from '../../src/utils/alert';
import { getAdminCategories, saveAdminCategory, setCategoryMapping } from '../../src/api/categories';
import {
  AdminCategory, buildCategoryInput, categoriesInGroup, cleanGoogleType, CategoryGroup, CategoryMapping, GROUP_LABELS,
  GROUP_ORDER, mappedTypes,
} from '../../src/utils/categories';

// Tools -> Restaurant Categories: the categories customers filter on and owners choose from (what a place is, ways to get the food,
// cuisine), and which Google place types count as each. A change reaches the apps within a few minutes. A category that restaurants
// use is switched off rather than deleted, so nobody's choice is erased.
export default function RestaurantCategoriesScreen() {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [mappings, setMappings] = useState<CategoryMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // new category form
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newGroup, setNewGroup] = useState<CategoryGroup | ''>('');
  const [newError, setNewError] = useState<string | null>(null);
  // edits in progress, by category key
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const data = await getAdminCategories();
      setCategories(data.categories);
      setMappings(data.mappings);
      setLabels(Object.fromEntries(data.categories.map((c) => [c.key, c.label])));
      setOrders(Object.fromEntries(data.categories.map((c) => [c.key, String(c.sort_order)])));
      setFailed(false);
    } catch (e: any) {
      console.warn('[admin-categories] load failed:', e?.message);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(id: string, action: () => Promise<void>) {
    setBusy(id);
    try {
      await action();
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  function saveCategory(c: AdminCategory, over: Partial<{ label: string; order: string; isActive: boolean }> = {}) {
    const built = buildCategoryInput({
      key: c.key, grp: c.grp, label: over.label ?? labels[c.key] ?? c.label, sortOrder: over.order ?? orders[c.key] ?? String(c.sort_order),
      isActive: over.isActive ?? c.is_active, isNew: false,
    });
    if (!built.ok) {
      Alert.alert('Check this', built.error);
      return;
    }
    run(`cat:${c.key}`, () => saveAdminCategory(built.value));
  }

  function addCategory() {
    const built = buildCategoryInput({ key: newKey, grp: newGroup, label: newLabel, sortOrder: '', isActive: true, isNew: true });
    if (!built.ok) {
      setNewError(built.error);
      return;
    }
    if (categories.some((c) => c.key === built.value.key)) {
      setNewError('A category with that key already exists.');
      return;
    }
    setNewError(null);
    run('new', async () => {
      await saveAdminCategory(built.value);
      setNewKey('');
      setNewLabel('');
      setNewGroup('');
    });
  }

  function addMapping(c: AdminCategory) {
    const type = cleanGoogleType(typed[c.key] ?? '');
    if (!type) {
      Alert.alert('Check this', 'A Google place type looks like cafe or italian_restaurant.');
      return;
    }
    run(`map:${c.key}`, async () => {
      await setCategoryMapping(type, c.key, true);
      setTyped((t) => ({ ...t, [c.key]: '' }));
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Restaurant Categories</Text>
      <Text style={styles.subtitle}>
        What customers filter on and owners choose from. A change reaches the apps within a few minutes. Switch a category off instead
        of deleting it, so no owner's choice is lost.
      </Text>

      {loading && <ActivityIndicator size="small" color="#1565C0" style={{ alignSelf: 'flex-start' }} />}
      {failed && <Text style={styles.error}>The categories could not be loaded. Check that migration 129 is applied.</Text>}

      {!loading && !failed && GROUP_ORDER.map((grp) => (
        <View key={grp} style={styles.section}>
          <Text style={styles.sectionTitle}>{GROUP_LABELS[grp]}</Text>
          {categoriesInGroup(categories, grp).map((c) => (
            <View key={c.key} style={[styles.card, !c.is_active && styles.cardOff]}>
              <View style={styles.row}>
                <TextInput style={[styles.input, styles.flex1]} value={labels[c.key] ?? c.label} onChangeText={(v) => setLabels((l) => ({ ...l, [c.key]: v }))} placeholder="Name people see" placeholderTextColor="#999" />
                <TextInput style={[styles.input, styles.order]} value={orders[c.key] ?? String(c.sort_order)} onChangeText={(v) => setOrders((o) => ({ ...o, [c.key]: v }))} placeholder="Order" placeholderTextColor="#999" keyboardType="number-pad" />
              </View>
              <View style={styles.row}>
                <Text style={styles.meta}>{c.key} · {c.restaurants} restaurant{c.restaurants === 1 ? '' : 's'}</Text>
                <View style={styles.row}>
                  <Text style={styles.meta}>{c.is_active ? 'On' : 'Off'}</Text>
                  <Switch value={c.is_active} disabled={busy === `cat:${c.key}`} onValueChange={(v) => saveCategory(c, { isActive: v })} />
                  <TouchableOpacity style={styles.saveBtn} disabled={busy === `cat:${c.key}`} onPress={() => saveCategory(c)} accessibilityRole="button">
                    <Text style={styles.saveText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.label}>Google place types that count as this</Text>
              <View style={styles.chips}>
                {mappedTypes(mappings, c.key).map((t) => (
                  <TouchableOpacity key={t} style={styles.chip} disabled={busy === `map:${c.key}`} onPress={() => run(`map:${c.key}`, () => setCategoryMapping(t, c.key, false))} accessibilityRole="button" accessibilityLabel={`Remove ${t}`}>
                    <Text style={styles.chipText}>{t}  ✕</Text>
                  </TouchableOpacity>
                ))}
                {mappedTypes(mappings, c.key).length === 0 && <Text style={styles.meta}>None</Text>}
              </View>
              <View style={styles.row}>
                <TextInput style={[styles.input, styles.flex1]} value={typed[c.key] ?? ''} onChangeText={(v) => setTyped((t) => ({ ...t, [c.key]: v }))} placeholder="Add a Google type, e.g. coffee_shop" placeholderTextColor="#999" autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => addMapping(c)} />
                <TouchableOpacity style={styles.addBtn} onPress={() => addMapping(c)} accessibilityRole="button"><Text style={styles.saveText}>Add</Text></TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      ))}

      {!loading && !failed && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add a category</Text>
          <View style={styles.card}>
            <View style={styles.chips}>
              {GROUP_ORDER.map((g) => (
                <TouchableOpacity key={g} style={[styles.groupChip, newGroup === g && styles.groupChipOn]} onPress={() => setNewGroup(g)} accessibilityRole="button">
                  <Text style={[styles.chipText, newGroup === g && styles.groupChipTextOn]}>{GROUP_LABELS[g]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.row}>
              <TextInput style={[styles.input, styles.flex1]} value={newKey} onChangeText={setNewKey} placeholder="Key, e.g. food_hall" placeholderTextColor="#999" autoCapitalize="none" autoCorrect={false} />
              <TextInput style={[styles.input, styles.flex1]} value={newLabel} onChangeText={setNewLabel} placeholder="Name, e.g. Food hall" placeholderTextColor="#999" onSubmitEditing={addCategory} />
            </View>
            {!!newError && <Text style={styles.error}>{newError}</Text>}
            <TouchableOpacity style={[styles.addBtn, styles.addWide, busy === 'new' && styles.disabled]} onPress={addCategory} disabled={busy === 'new'} accessibilityRole="button">
              <Text style={styles.saveText}>Add category</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 820, alignSelf: 'center', paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 14, lineHeight: 18 },
  section: { marginTop: 8, marginBottom: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#222', marginBottom: 8, marginTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e6e6e6', padding: 12, marginBottom: 10 },
  cardOff: { opacity: 0.6 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 },
  flex1: { flex: 1, minWidth: 150 },
  order: { width: 70 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: '#222', backgroundColor: '#fff' },
  meta: { fontSize: 11, color: '#888' },
  label: { fontSize: 11, fontWeight: '700', color: '#666', marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#fafafa' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#444' },
  groupChip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  groupChipOn: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  groupChipTextOn: { color: '#fff' },
  saveBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  addBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  addWide: { alignSelf: 'flex-start', marginTop: 10 },
  saveText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  error: { fontSize: 12, color: '#c62828', marginTop: 8 },
  disabled: { opacity: 0.5 },
});
