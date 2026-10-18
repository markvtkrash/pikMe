import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Alert } from '../../../src/utils/alert';
import { getAllAgreements, AgreementRow } from '../../../src/api/reports';
import { PagerBar } from '../../../src/components/common/PagerBar';
import { usePaging } from '../../../src/hooks/usePaging';

type TypeFilter = 'all' | 'privacy_policy' | 'terms_of_service' | 'food_disclaimer' | 'menu_nutrition_disclaimer';
const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'terms_of_service', label: 'Terms of Service' },
  { value: 'privacy_policy', label: 'Privacy Policy' },
  { value: 'food_disclaimer', label: 'Food Disclaimer' },
  { value: 'menu_nutrition_disclaimer', label: 'Menu Nutrition' },
];
const TYPE_LABEL: Record<string, string> = {
  privacy_policy: 'Privacy Policy',
  terms_of_service: 'Terms of Service',
  food_disclaimer: 'Food Disclaimer',
  menu_nutrition_disclaimer: 'Menu Nutrition Disclaimer',
};

function formatAgreedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Every signup/consent agreement ever recorded (migration 005 + 150), paginated. One row per
// (user, document, version) — a signup produces 3 rows (Terms, Privacy, Food Disclaimer); a
// nutrition-disclaimer popup elsewhere in the app can add a 4th kind later for a given user.
export default function AdminAgreementsReportScreen() {
  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  useEffect(() => {
    loadRows();
  }, []);

  async function loadRows() {
    setLoading(true);
    try {
      setRows(await getAllAgreements());
    } catch (error: any) {
      console.error('[admin-agreements] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load agreements');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.agreement_type !== typeFilter) return false;
      if (!q) return true;
      return r.email.toLowerCase().includes(q);
    });
  }, [rows, search, typeFilter]);

  // 50 rows to a page; back to page 1 on a new search or filter; the list scrolls to the top when the page changes
  const listRef = useRef<FlatList<any>>(null);
  const paging = usePaging(filtered, `${search}|${typeFilter}`, () => listRef.current?.scrollToOffset({ offset: 0, animated: false }));

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
        <View style={styles.header}>
          <Text style={styles.title}>Signup Agreements</Text>
          <Text style={styles.count}>{rows.length}</Text>
        </View>
        <Text style={styles.hint}>
          Every consent a person has recorded, newest first — who agreed, to what, which version, and when.
        </Text>

        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by email..."
            placeholderTextColor="#999"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
          <View style={styles.filterRow}>
            {TYPE_FILTERS.map((f) => (
              <TouchableOpacity
                key={f.value}
                style={[styles.filterChip, typeFilter === f.value && styles.filterChipActive]}
                onPress={() => setTypeFilter(f.value)}
              >
                <Text style={[styles.filterChipText, typeFilter === f.value && styles.filterChipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Text style={styles.rangeText}>
          {filtered.length === 0 ? '0 results' : `Showing ${paging.from}–${paging.to} of ${paging.total}`}
        </Text>

        {filtered.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No agreements found</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={paging.pageItems}
            keyExtractor={(item) => `${item.user_id}-${item.agreement_type}-${item.version}`}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{TYPE_LABEL[item.agreement_type] ?? item.agreement_type}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  v{item.version} · {formatAgreedAt(item.agreed_at)}
                  {item.ip_address ? ` · ${item.ip_address}` : ''}
                </Text>
              </View>
            )}
            contentContainerStyle={styles.list}
            ListFooterComponent={<PagerBar page={paging.page} pageCount={paging.pageCount} from={paging.from} to={paging.to} total={paging.total} onPage={paging.goTo} />}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#222' },
  count: { fontSize: 18, fontWeight: '800', color: '#1565C0', backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  hint: { fontSize: 12, color: '#666', backgroundColor: '#fff', paddingHorizontal: 16, paddingBottom: 12 },

  searchContainer: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 10 },
  searchInput: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  filterRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f0f0f0' },
  filterChipActive: { backgroundColor: '#1565C0' },
  filterChipText: { fontSize: 12, fontWeight: '700', color: '#555' },
  filterChipTextActive: { color: '#fff' },
  rangeText: { fontSize: 12, color: '#888', paddingHorizontal: 16, paddingTop: 10 },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  row: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, elevation: 1, borderWidth: 1, borderColor: '#CFD8DC' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  email: { flex: 1, fontSize: 14, fontWeight: '700', color: '#222' },
  typeBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, flexShrink: 0 },
  typeBadgeText: { fontSize: 10, fontWeight: '800', color: '#2e7d32', textTransform: 'uppercase', letterSpacing: 0.4 },
  meta: { fontSize: 12, color: '#888', marginTop: 4 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
});
