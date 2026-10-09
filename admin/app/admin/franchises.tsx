import { useState, useCallback, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/api/supabase';

interface FranchiseRow {
  id: string;
  name: string;
  aliases: string[];
  category: string | null;
  is_active: boolean;
}

// Read-only lookup of the known franchise/chain names the consumer app
// matches restaurants against (franchise_chains, migration 062). New chains are
// added from the Franchise Menu Management page; entries can't be edited or
// deactivated yet.
export default function AdminFranchiseLookupScreen() {
  const [rows, setRows] = useState<FranchiseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
      console.error('[admin-franchise-lookup] Load error:', error);
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

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <Text style={styles.hint}>
          Restaurants whose name exactly matches an entry here (or one of its aliases) are treated as
          franchises: the consumer app also shows AI-estimated menu items for them. Everything else only
          shows items the restaurant confirmed. Matching ignores case, punctuation, store numbers and a
          trailing "- location". This list is read-only.
        </Text>

        <FlatList
          data={filtered}
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
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{search ? 'No matches' : 'No franchises yet'}</Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  hint: { fontSize: 12, color: '#666', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  list: { paddingHorizontal: 16, paddingVertical: 12 },

  search: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 12 },

  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, elevation: 1, gap: 3 },
  rowInactive: { opacity: 0.55 },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  rowName: { fontSize: 14, fontWeight: '700', color: '#222' },
  rowCategory: { fontSize: 11, color: '#1565C0', fontWeight: '600' },
  inactiveBadge: { fontSize: 10, fontWeight: '800', color: '#c62828', backgroundColor: '#FFEBEE', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  rowAliases: { fontSize: 11, color: '#999' },

  emptyContainer: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#999' },
});
