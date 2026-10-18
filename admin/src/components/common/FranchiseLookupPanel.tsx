import { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Alert } from '../../utils/alert';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../api/supabase';
import { PagerBar } from './PagerBar';
import { usePaging } from '../../hooks/usePaging';
import AddFranchiseModal from './AddFranchiseModal';
import { IconText } from './AppIcon';

interface FranchiseRow {
  id: string;
  name: string;
  aliases: string[];
  category: string | null;
  is_active: boolean;
}

// The franchise/chain list (franchise_chains, migration 062) the consumer app matches
// restaurants against — "Add franchise" puts a new chain on it (same AddFranchiseModal
// used on Franchise Menu Management). Entries can't be edited or deactivated from here
// yet. Shared by the Franchise Lookup page and the "View Franchise List" popup on
// Franchise Menu Management, so both stay in sync automatically.
export function FranchiseLookupPanel({ onClose }: { onClose?: () => void }) {
  const [rows, setRows] = useState<FranchiseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadRows();
    }, [])
  );

  async function loadRows() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('franchise_chains')
        .select('id, name, aliases, category, is_active')
        .order('name', { ascending: true })
        .limit(5000);
      if (error) throw error;
      setRows(data ?? []);
    } catch (error: any) {
      console.error('[franchise-lookup] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load franchise lookup');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.category ?? '').toLowerCase().includes(q) ||
        r.aliases.some((a) => a.toLowerCase().includes(q))
    );
  }, [rows, search]);

  // 50 rows to a page; back to page 1 on a new search; the list scrolls to the top when the page changes
  const listRef = useRef<FlatList<any>>(null);
  const paging = usePaging(filtered, search, () => listRef.current?.scrollToOffset({ offset: 0, animated: false }));

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!!onClose && (
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>Franchise Lookup</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button">
            <Text style={styles.closeText}>Close ✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.hint}>
        Restaurants whose name exactly matches an entry here (or one of its aliases) are treated as
        franchises: the consumer app also shows AI-estimated menu items for them. Everything else only
        shows items the restaurant confirmed. Matching ignores case, punctuation, store numbers and a
        trailing "- location". Entries can't be edited or deactivated from here yet.
      </Text>

      <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)} accessibilityRole="button">
        <IconText style={styles.addBtnText} emoji="➕">Add franchise</IconText>
      </TouchableOpacity>

      <FlatList
        ref={listRef}
        data={paging.pageItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        initialNumToRender={20}
        ListHeaderComponent={
          <TextInput
            style={styles.search}
            placeholder={`Search ${rows.length} franchises…`}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
        }
        renderItem={({ item }) => (
          <View style={[styles.row, !item.is_active && styles.rowInactive]}>
            <View style={styles.rowTop}>
              <Text style={styles.rowName}>{item.name}</Text>
              {!!item.category && <Text style={styles.rowCategory}>{item.category}</Text>}
              {!item.is_active && <Text style={styles.inactiveBadge}>Inactive</Text>}
            </View>
            {item.aliases.length > 0 && (
              <Text style={styles.rowAliases} numberOfLines={2}>
                Also: {item.aliases.join(', ')}
              </Text>
            )}
          </View>
        )}
        ListFooterComponent={<PagerBar page={paging.page} pageCount={paging.pageCount} from={paging.from} to={paging.to} total={paging.total} onPage={paging.goTo} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{search ? 'No matches' : 'No franchises yet'}</Text>
          </View>
        }
      />

      <AddFranchiseModal
        visible={adding}
        onClose={() => setAdding(false)}
        onAdded={(added) => {
          setAdding(false);
          Alert.alert('Franchise added', `${added} is now on the franchise list.`);
          loadRows();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14 },
  modalHeaderTitle: { fontSize: 18, fontWeight: '800', color: '#222' },
  closeText: { fontSize: 14, fontWeight: '700', color: '#1565C0' },

  hint: { fontSize: 12, color: '#666', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  addBtn: { alignSelf: 'flex-start', backgroundColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 16, marginTop: 4, marginBottom: 4, elevation: 2 },
  addBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  list: { paddingHorizontal: 16, paddingVertical: 12 },

  search: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 12, borderWidth: 1, borderColor: '#CFD8DC' },

  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, elevation: 1, gap: 3, borderWidth: 1, borderColor: '#CFD8DC' },
  rowInactive: { opacity: 0.55 },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  rowName: { fontSize: 14, fontWeight: '700', color: '#222' },
  rowCategory: { fontSize: 11, color: '#1565C0', fontWeight: '600' },
  inactiveBadge: { fontSize: 10, fontWeight: '800', color: '#c62828', backgroundColor: '#FFEBEE', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  rowAliases: { fontSize: 11, color: '#999' },

  emptyContainer: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#999' },
});
