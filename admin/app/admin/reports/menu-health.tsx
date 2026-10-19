import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import { Alert } from '../../../src/utils/alert';
import { useRouter } from 'expo-router';
import {
  getMenuHealthSnapshot, getMenuHealthByRestaurant, getMenuHealthLocations,
  MenuHealthSnapshot, MenuHealthByRestaurantRow,
} from '../../../src/api/reports';
import { IconText } from '../../../src/components/common/AppIcon';
import { OptionPickerModal } from '../../../src/components/common/OptionPickerModal';
import {
  chosenLabel, cityOptionsFor, filterReady, FRANCHISE_CHOICES, HealthFranchise, HealthLocationRow, HealthSource, menuLinkParams, pageInfo,
  PageInfo, PAGE_SIZE, regionOptions, rowKey, SOURCE_CHOICES, sourceLabel, verifiedPercent,
} from '../../../src/utils/menuHealth';

// Prev/Next for the restaurant list -- shown above AND below the rows, so paging through a
// long list never requires scrolling back up first. Renders nothing on one page.
function Pager({ info, onGo }: { info: PageInfo; onGo: (page: number) => void }) {
  if (info.pages <= 1) return null;
  return (
    <View style={styles.pager}>
      <TouchableOpacity style={[styles.pagerBtn, info.page === 0 && styles.btnDisabled]} disabled={info.page === 0} onPress={() => onGo(info.page - 1)}>
        <Text style={styles.pagerBtnText}>‹ Prev</Text>
      </TouchableOpacity>
      <Text style={styles.pagerLabel}>Page {info.page + 1} of {info.pages}</Text>
      <TouchableOpacity style={[styles.pagerBtn, info.page >= info.pages - 1 && styles.btnDisabled]} disabled={info.page >= info.pages - 1} onPress={() => onGo(info.page + 1)}>
        <Text style={styles.pagerBtnText}>Next ›</Text>
      </TouchableOpacity>
    </View>
  );
}

function healthColor(pct: number): string {
  if (pct >= 80) return '#1565C0';
  if (pct >= 40) return '#E65100';
  return '#c62828';
}
function healthBg(pct: number): string {
  if (pct >= 80) return '#E3F2FD';
  if (pct >= 40) return '#FFF3E0';
  return '#FFEBEE';
}

// Reports -> Menu Data Health. Counts follow each restaurant's own location, the same as Menu Management. The report is filtered on
// the server by region and city and shows nothing until a region is chosen, so it never loads the whole country; the list loads 50
// restaurants at a time. A restaurant's name opens its menu. "0 Menu Items" (migration 152) swaps the list to restaurants with no
// items at all, instead of a separate section -- the same table, just a different server-side filter.
export default function AdminMenuHealthReport() {
  const router = useRouter();
  const [locations, setLocations] = useState<HealthLocationRow[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsFailed, setLocationsFailed] = useState(false);
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [source, setSource] = useState<HealthSource>('');
  const [franchise, setFranchise] = useState<HealthFranchise>('');
  const [noItems, setNoItems] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState<'region' | 'city' | null>(null);

  // Debounced: a server round-trip per keystroke would spam the report, so the typed text only becomes
  // the actual search after a short pause.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [loading, setLoading] = useState(false);
  const [menuHealth, setMenuHealth] = useState<MenuHealthSnapshot | null>(null);
  const [tableRows, setTableRows] = useState<MenuHealthByRestaurantRow[]>([]);
  const [tablePage, setTablePage] = useState(0);

  const regions = useMemo(() => regionOptions(locations), [locations]);
  const cities = useMemo(() => cityOptionsFor(locations, region), [locations, region]);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await getMenuHealthLocations());
      setLocationsFailed(false);
    } catch (error: any) {
      setLocationsFailed(true);
      console.error('[admin-menu-health-report] Locations error:', error);
      Alert.alert('Error', error.message || 'Failed to load the regions. Check that migration 137 is applied.');
    } finally {
      setLocationsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  // The headline numbers and the restaurant list for the chosen region/city/source/franchise/no-items/search filter.
  const loadReport = useCallback(async (
    nextRegion: string, nextCity: string, nextSource: HealthSource, nextFranchise: HealthFranchise, nextNoItems: boolean,
    nextSearch: string
  ) => {
    if (!filterReady(nextRegion)) return;
    setLoading(true);
    try {
      const filter = { state: nextRegion, city: nextCity, source: nextSource, franchise: nextFranchise, noItems: nextNoItems, search: nextSearch };
      const [snapshot, rows] = await Promise.all([
        getMenuHealthSnapshot(filter),
        getMenuHealthByRestaurant(filter, PAGE_SIZE, 0),
      ]);
      setMenuHealth(snapshot);
      setTableRows(rows);
      setTablePage(0);
    } catch (error: any) {
      console.error('[admin-menu-health-report] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport(region, city, source, franchise, noItems, search);
  }, [region, city, source, franchise, noItems, search, loadReport]);

  async function goTablePage(next: number) {
    try {
      setTableRows(await getMenuHealthByRestaurant({ state: region, city, source, franchise, noItems, search }, PAGE_SIZE, next * PAGE_SIZE));
      setTablePage(next);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load that page');
    }
  }

  function chooseRegion(value: string) {
    setRegion(value);
    setCity('');
    setPicker(null);
    if (!filterReady(value)) {
      setMenuHealth(null);
      setTableRows([]);
    }
  }

  function chooseCity(value: string) {
    setCity(value);
    setPicker(null);
  }

  function openMenu(row: { restaurant_name: string; place_id?: string | null; address?: string | null; is_franchise?: boolean | null }) {
    router.push({ pathname: '/admin/menu-view', params: menuLinkParams(row) } as any);
  }

  const ready = filterReady(region);
  const tableTotal = tableRows[0]?.total_count ?? 0;
  const tablePaging = pageInfo(tableTotal, tablePage);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={styles.flex1}>
          <IconText style={styles.title} emoji="🍽️">Menu Data Health</IconText>
          <Text style={styles.subtitle}>Verified vs unverified items, and gaps by restaurant. Choose a region to begin.</Text>
        </View>
        <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/admin/scheduled-builds' as any)} accessibilityRole="button">
          <Text style={styles.linkBtnText}>Scheduled Builds</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/admin/crawl-cities' as any)} accessibilityRole="button">
          <Text style={styles.linkBtnText}>City Imports</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        <View style={styles.filterGroup}>
          <TouchableOpacity style={[styles.pickerBtn, ready && styles.pickerBtnOn]} onPress={() => setPicker('region')} accessibilityRole="button" disabled={locationsLoading}>
            <Text style={[styles.pickerText, ready && styles.pickerTextOn]}>Region: {chosenLabel(regions, region, 'Choose')} ▾</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pickerBtn, !!city && styles.pickerBtnOn, (!ready || cities.length === 0) && styles.pickerBtnOff]}
            onPress={() => setPicker('city')}
            accessibilityRole="button"
            disabled={!ready || cities.length === 0}
          >
            <Text style={[styles.pickerText, !!city && styles.pickerTextOn]}>City: {chosenLabel(cities, city, 'All')} ▾</Text>
          </TouchableOpacity>
          {ready && (
            <TouchableOpacity style={styles.clearBtn} onPress={() => chooseRegion('')} accessibilityRole="button">
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.filterDivider} />

        <View style={styles.filterGroup}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name…"
            placeholderTextColor="#999"
            value={searchInput}
            onChangeText={setSearchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!!searchInput && (
            <TouchableOpacity style={styles.clearBtn} onPress={() => setSearchInput('')} accessibilityRole="button">
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.filterDivider} />

        <View style={styles.filterGroup}>
          <Text style={styles.filterGroupLabel}>Source</Text>
          {SOURCE_CHOICES.map((c) => (
            <TouchableOpacity key={c.value || 'all'} style={[styles.sourceChip, source === c.value && styles.pickerBtnOn]} onPress={() => setSource(c.value)} accessibilityRole="button">
              <Text style={[styles.pickerText, source === c.value && styles.pickerTextOn]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.filterDivider} />

        <View style={styles.filterGroup}>
          <Text style={styles.filterGroupLabel}>Franchise</Text>
          {FRANCHISE_CHOICES.map((c) => (
            <TouchableOpacity key={c.value || 'all-franchise'} style={[styles.sourceChip, franchise === c.value && styles.pickerBtnOn]} onPress={() => setFranchise(c.value)} accessibilityRole="button">
              <Text style={[styles.pickerText, franchise === c.value && styles.pickerTextOn]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.filterDivider} />

        <View style={styles.filterGroup}>
          <TouchableOpacity
            style={[styles.sourceChip, noItems && styles.pickerBtnOn]}
            onPress={() => setNoItems((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ selected: noItems }}
          >
            <Text style={[styles.pickerText, noItems && styles.pickerTextOn]}>0 Menu Items</Text>
          </TouchableOpacity>
        </View>

        {locationsLoading && <ActivityIndicator size="small" color="#1565C0" />}
      </View>

      <OptionPickerModal
        visible={picker === 'region'}
        title="Region (state)"
        options={regions}
        selected={region}
        allLabel="Choose a region"
        onSelect={chooseRegion}
        onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === 'city'}
        title={`City (in ${chosenLabel(regions, region, 'this region')})`}
        options={cities}
        selected={city}
        allLabel="All cities"
        onSelect={chooseCity}
        onClose={() => setPicker(null)}
      />

      {!ready ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>
            {locationsLoading
              ? 'Loading regions...'
              : locationsFailed
                ? 'The regions could not be loaded. Check that migrations 137 and 138 are applied, then reload the page.'
                : regions.length === 0
                  ? 'No restaurants yet.'
                  : 'Pick a region above to see its menu data health. A city narrows it further.'}
          </Text>
        </View>
      ) : loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : (
        <>
          <View style={styles.snapshotRow}>
            <View style={[styles.snapshotBox, styles.snapshotBoxActive]}>
              <Text style={styles.snapshotNumber}>{menuHealth?.verified_count ?? 0}</Text>
              <Text style={styles.snapshotLabel}>Verified Items</Text>
            </View>
            <View style={styles.snapshotBox}>
              <Text style={styles.snapshotNumber}>{menuHealth?.unverified_count ?? 0}</Text>
              <Text style={styles.snapshotLabel}>Unverified Items</Text>
            </View>
            <TouchableOpacity
              style={[styles.snapshotBox, styles.snapshotBoxOrphaned]}
              onPress={() => setNoItems(true)}
              accessibilityRole="button"
              accessibilityLabel="Filter the list below to restaurants with no menu items"
            >
              <Text style={styles.snapshotNumber}>{menuHealth?.restaurants_with_no_items_count ?? 0}</Text>
              <Text style={styles.snapshotLabel}>No Menu Items</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.scopeText}>{menuHealth?.restaurant_count ?? 0} restaurants in this selection</Text>

          <Text style={styles.subsectionTitle}>By restaurant</Text>
          <View style={styles.card}>
            {tableRows.length === 0 ? (
              <Text style={styles.emptyText}>
                {noItems ? 'Every restaurant here has at least one menu item' : 'No menu items on any restaurant here yet'}
              </Text>
            ) : (
              <>
                <Text style={styles.rangeText}>Showing {tablePaging.first}-{tablePaging.last} of {tableTotal}</Text>
                <Pager info={tablePaging} onGo={goTablePage} />
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Restaurant</Text>
                  <Text style={styles.tableHeaderCell}>Verified</Text>
                  <Text style={styles.tableHeaderCell}>Unverified</Text>
                  <Text style={styles.tableHeaderCell}>% Verified</Text>
                </View>
                {tableRows.map((r) => {
                  const pct = verifiedPercent(r.verified_count, r.unverified_count);
                  return (
                    <View key={rowKey(r)} style={[styles.tableRow, styles.healthRow, { borderLeftColor: healthColor(pct) }]}>
                      <TouchableOpacity style={{ flex: 2 }} onPress={() => openMenu(r)} accessibilityRole="link" accessibilityLabel={`Open the menu of ${r.restaurant_name}`}>
                        <Text style={styles.linkText}>{r.restaurant_name}</Text>
                        {!!r.address && <Text style={styles.addressText} numberOfLines={1}>{r.address}</Text>}
                        <Text style={[styles.sourceBadge, r.source === 'city' && styles.sourceBadgeCity]}>{sourceLabel(r.source)}</Text>
                      </TouchableOpacity>
                      <Text style={[styles.tableCell, styles.verifiedCell]}>{r.verified_count}</Text>
                      <Text style={[styles.tableCell, styles.unverifiedCell]}>{r.unverified_count}</Text>
                      <View style={styles.pctCol}>
                        <View style={[styles.pctBadge, { backgroundColor: healthBg(pct) }]}>
                          <Text style={[styles.pctBadgeText, { color: healthColor(pct) }]}>{pct}%</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
                <Pager info={tablePaging} onGo={goTablePage} />
              </>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center', paddingBottom: 32 },
  headerRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap' },
  flex1: { flex: 1, minWidth: 220 },
  title: { fontSize: 20, fontWeight: '800', color: '#8E24AA', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888' },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#ECEFF1', borderWidth: 1.5, borderColor: '#1565C0' },
  linkBtnText: { fontSize: 13, fontWeight: '800', color: '#1565C0' },

  filterRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 },
  filterGroup: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  filterGroupLabel: { fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.3 },
  filterDivider: { width: 1, height: 22, backgroundColor: '#D8DCE1' },
  pickerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5' },
  searchInput: { minWidth: 160, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', fontSize: 13, color: '#222' },
  pickerBtnOn: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  pickerBtnOff: { opacity: 0.45 },
  pickerText: { fontSize: 12, fontWeight: '700', color: '#444' },
  pickerTextOn: { color: '#fff' },
  sourceChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5' },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  clearText: { fontSize: 12, fontWeight: '700', color: '#666' },

  subsectionTitle: { fontSize: 12, fontWeight: '700', color: '#888', paddingTop: 16, paddingBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, elevation: 1, borderWidth: 1, borderColor: '#CFD8DC' },
  emptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },
  loadingBox: { paddingVertical: 40, alignItems: 'center' },

  snapshotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  snapshotBox: {
    flex: 1, minWidth: 90, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', elevation: 1,
  },
  snapshotBoxActive: { backgroundColor: '#E3F2FD' },
  snapshotBoxOrphaned: { backgroundColor: '#FFF3E0' },
  snapshotNumber: { fontSize: 22, fontWeight: '800', color: '#222' },
  snapshotLabel: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },
  scopeText: { fontSize: 11, color: '#888', marginTop: 6 },

  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8, marginBottom: 4 },
  tableHeaderCell: { flex: 1, fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingVertical: 6, alignItems: 'center' },
  tableCell: { flex: 1, fontSize: 13, color: '#333', fontWeight: '600' },
  linkText: { fontSize: 13, color: '#1565C0', fontWeight: '700', textDecorationLine: 'underline' },
  addressText: { fontSize: 11, color: '#888', marginTop: 1 },
  sourceBadge: { alignSelf: 'flex-start', marginTop: 3, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, color: '#2e7d32', backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  sourceBadgeCity: { color: '#EF6C00', backgroundColor: '#FFF3E0' },

  healthRow: { alignItems: 'center', borderLeftWidth: 3, paddingLeft: 8 },
  verifiedCell: { color: '#1565C0' },
  unverifiedCell: { color: '#c62828' },
  pctCol: { flex: 1 },
  pctBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pctBadgeText: { fontSize: 12, fontWeight: '800' },

  rangeText: { fontSize: 11, color: '#888', paddingTop: 8 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 10 },
  pagerBtn: { backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  pagerBtnText: { fontSize: 13, fontWeight: '700', color: '#222' },
  pagerLabel: { fontSize: 13, color: '#666', fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },
});
