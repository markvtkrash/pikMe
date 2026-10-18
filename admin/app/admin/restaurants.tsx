import { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, Modal,
} from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useFocusEffect } from 'expo-router';
import { getRestaurantsWithMenuCounts, RestaurantMenuSummary } from '../../src/api/menuAdmin';
import { adminSetRestaurantStatus, adminDeleteRestaurant } from '../../src/api/restaurantAuth';
import { deleteCachedRestaurants } from '../../src/api/reports';
import { buildDeleteMessage } from '../../src/utils/restaurantDelete';
import { RestaurantCategoriesModal } from '../../src/components/common/RestaurantCategoriesModal';
import { IconText } from '../../src/components/common/AppIcon';
import { OptionPickerModal } from '../../src/components/common/OptionPickerModal';
import {
  buildCityOptions, buildStateOptions, countWithoutLocation, filterButtonLabel, matchesLocation, validCity,
} from '../../src/utils/menuLocation';
import { FRANCHISE_FILTERS, FranchiseFilter, matchesFranchiseFilter } from '../../src/utils/menuFranchiseFilter';
import { PagerBar } from '../../src/components/common/PagerBar';
import { usePaging } from '../../src/hooks/usePaging';

type SourceFilter = 'all' | 'claimed' | 'cached' | 'city';
const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'cached', label: 'Cached' },
  { value: 'city', label: 'City imports' },
];
const SOURCE_BADGE_LABEL: Record<string, string> = { claimed: 'Claimed', cached: 'Cached', city: 'City import' };

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: '#FFF3E0', text: '#E65100', label: 'Pending' },
  approved: { bg: '#E3F2FD', text: '#1565C0', label: 'Approved' },
  rejected: { bg: '#FFEBEE', text: '#c62828', label: 'Rejected' },
  closed: { bg: '#e53e3e', text: '#fff', label: 'Closed' },
};

function rowKey(item: RestaurantMenuSummary): string {
  return `${item.source}-${item.restaurant_id ?? item.place_id ?? item.restaurant_name}`;
}

// Admin's Manage Restaurants: every restaurant regardless of claim status — claimed,
// cached (Google-sourced, unclaimed), and city-import — with the lifecycle actions that
// apply to each: Categories editing and Close/Reopen/Delete for claimed restaurants,
// and Delete for a single unclaimed cached location. Menu CONTENT (view/edit items) is
// Menu Management's job, not this screen's.
export default function AdminRestaurantsScreen() {
  const [rows, setRows] = useState<RestaurantMenuSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [franchiseFilter, setFranchiseFilter] = useState<FranchiseFilter>('all');
  const [stateFilter, setStateFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [picker, setPicker] = useState<'state' | 'city' | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingCategories, setEditingCategories] = useState<{ id: string; name: string } | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    destructive: boolean;
    onConfirm: () => void;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadRestaurants();
    }, [])
  );

  async function loadRestaurants() {
    try {
      setRows(await getRestaurantsWithMenuCounts());
    } catch (error: any) {
      console.error('[admin-restaurants] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load restaurants');
    } finally {
      setLoading(false);
    }
  }

  const stateOptions = buildStateOptions(rows);
  const cityOptions = buildCityOptions(rows, stateFilter);
  const hiddenByLocation = stateFilter || cityFilter ? countWithoutLocation(rows) : 0;

  function chooseState(value: string) {
    setStateFilter(value);
    setCityFilter(validCity(rows, value, cityFilter));
    setPicker(null);
  }

  function chooseCity(value: string) {
    setCityFilter(value);
    setPicker(null);
  }

  // Close/Reopen only makes sense once a claim has actually been decided — a pending or
  // rejected restaurant has no "open" state to toggle (admin_set_restaurant_status would
  // just raise).
  function canToggleStatus(item: RestaurantMenuSummary) {
    return item.source === 'claimed' && (item.status === 'approved' || item.status === 'closed');
  }

  function handleToggleStatus(item: RestaurantMenuSummary) {
    if (!item.restaurant_id || !item.status) return;
    const restaurantId = item.restaurant_id;
    const nextStatus = item.status === 'closed' ? 'approved' : 'closed';
    setConfirmAction({
      title: nextStatus === 'closed' ? 'Mark restaurant closed?' : 'Reopen restaurant?',
      message: nextStatus === 'closed'
        ? `${item.restaurant_name} will be hidden from customer search. Menu and coupon history is kept for auditing.`
        : `${item.restaurant_name} will be visible to customers again.`,
      confirmLabel: nextStatus === 'closed' ? 'Mark Closed' : 'Reopen',
      destructive: nextStatus === 'closed',
      onConfirm: async () => {
        setBusyKey(rowKey(item));
        try {
          await adminSetRestaurantStatus(restaurantId, nextStatus);
          setRows((prev) => prev.map((r) => (r.restaurant_id === restaurantId ? { ...r, status: nextStatus } : r)));
        } catch (error: any) {
          Alert.alert('Error', error.message || 'Failed to update restaurant');
        } finally {
          setBusyKey(null);
        }
      },
    });
  }

  // Permanent delete of a closed, claimed restaurant (migration 091). A dry run first, so
  // the confirm window can say exactly what will be removed.
  async function handleDeleteClaimed(item: RestaurantMenuSummary) {
    if (!item.restaurant_id || item.status !== 'closed') return;
    const restaurantId = item.restaurant_id;
    setBusyKey(rowKey(item));
    let counts;
    try {
      counts = await adminDeleteRestaurant(restaurantId, true);
    } catch (error: any) {
      setBusyKey(null);
      Alert.alert('Error', error.message || 'Could not check what would be deleted');
      return;
    }
    setBusyKey(null);
    setConfirmAction({
      title: 'Delete restaurant permanently?',
      message: buildDeleteMessage(counts),
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        setBusyKey(rowKey(item));
        try {
          await adminDeleteRestaurant(restaurantId, false);
          setRows((prev) => prev.filter((r) => r.restaurant_id !== restaurantId));
        } catch (error: any) {
          Alert.alert('Error', error.message || 'Failed to delete restaurant');
        } finally {
          setBusyKey(null);
        }
      },
    });
  }

  // Unclaimed, single-location cached restaurant (migration 064). A franchise's grouped
  // row has no single place ID (represents many locations sharing one menu) and a 'city'
  // row has no cached_restaurants row yet — neither is offered a delete action.
  function handleDeleteCached(item: RestaurantMenuSummary) {
    if (!item.place_id) return;
    const placeId = item.place_id;
    setConfirmAction({
      title: `Delete ${item.restaurant_name}?`,
      message:
        "This permanently removes it from the cache, along with any customers' saved-restaurant entries and " +
        "all of its menu items (including verified ones, and customers' saved copies of them).\n\n" +
        'It will reappear the next time someone searches near it. This does not affect any restaurant claimed by an owner.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        setBusyKey(rowKey(item));
        try {
          const result = await deleteCachedRestaurants([placeId]);
          setRows((prev) => prev.filter((r) => !(r.source === 'cached' && r.place_id === placeId)));
          Alert.alert(
            'Deleted',
            [
              `${result.deletedRestaurants} restaurant${result.deletedRestaurants === 1 ? '' : 's'} deleted`,
              `${result.deletedMenuItems} menu item${result.deletedMenuItems === 1 ? '' : 's'} removed` +
                (result.deletedVerifiedMenuItems > 0 ? ` (${result.deletedVerifiedMenuItems} verified)` : ''),
            ].join('\n')
          );
        } catch (error: any) {
          Alert.alert('Error', error.message || 'Failed to delete restaurant');
        } finally {
          setBusyKey(null);
        }
      },
    });
  }

  const filtered = rows.filter((r) => {
    if (filter !== 'all' && r.source !== filter) return false;
    if (!matchesFranchiseFilter(r, franchiseFilter)) return false;
    if (!matchesLocation(r, stateFilter, cityFilter)) return false;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      r.restaurant_name.toLowerCase().includes(query) ||
      (r.address ?? '').toLowerCase().includes(query) ||
      (r.owner_business_name ?? '').toLowerCase().includes(query) ||
      (r.owner_email ?? '').toLowerCase().includes(query)
    );
  });

  // 50 rows to a page; back to page 1 on a new search or filter; the list scrolls to the top when the page changes
  const listRef = useRef<FlatList<any>>(null);
  const paging = usePaging(
    filtered,
    `${searchQuery}|${filter}|${franchiseFilter}|${stateFilter}|${cityFilter}`,
    () => listRef.current?.scrollToOffset({ offset: 0, animated: false })
  );

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
        <Text style={styles.title}>Manage Restaurants</Text>
        <Text style={styles.count}>{rows.length}</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, address, owner, or login email..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <View style={styles.filterRow}>
          {SOURCE_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.value}
              style={[styles.filterChip, filter === f.value && styles.filterChipActive]}
              onPress={() => setFilter(f.value)}
            >
              <Text style={[styles.filterChipText, filter === f.value && styles.filterChipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.filterChip, styles.pickerChip, !!stateFilter && styles.filterChipActive]}
            onPress={() => setPicker('state')}
            accessibilityRole="button"
          >
            <Text style={[styles.filterChipText, !!stateFilter && styles.filterChipTextActive]}>{filterButtonLabel('Region', stateFilter, stateOptions)} ▾</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, styles.pickerChip, !!cityFilter && styles.filterChipActive]}
            onPress={() => setPicker('city')}
            accessibilityRole="button"
          >
            <Text style={[styles.filterChipText, !!cityFilter && styles.filterChipTextActive]}>{filterButtonLabel('City', cityFilter, cityOptions)} ▾</Text>
          </TouchableOpacity>
          {!!(stateFilter || cityFilter) && (
            <TouchableOpacity style={styles.filterChip} onPress={() => { setStateFilter(''); setCityFilter(''); }} accessibilityRole="button">
              <Text style={styles.filterChipText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.filterRow}>
          {FRANCHISE_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.value}
              style={[styles.filterChip, franchiseFilter === f.value && styles.filterChipActive]}
              onPress={() => setFranchiseFilter(f.value)}
            >
              <Text style={[styles.filterChipText, franchiseFilter === f.value && styles.filterChipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={styles.rangeText}>
        {filtered.length === 0 ? '0 results' : `Showing ${paging.from}–${paging.to} of ${paging.total}`}
        {hiddenByLocation > 0 ? ` · ${hiddenByLocation} without a city or state are hidden (franchises and unreadable addresses)` : ''}
      </Text>

      <OptionPickerModal
        visible={picker === 'state'}
        title="Region (state)"
        options={stateOptions}
        selected={stateFilter}
        allLabel="All regions"
        onSelect={chooseState}
        onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === 'city'}
        title={stateFilter ? `City (in ${stateOptions.find((o) => o.value === stateFilter.trim().toLowerCase())?.label ?? stateFilter})` : 'City'}
        options={cityOptions}
        selected={cityFilter}
        allLabel="All cities"
        onSelect={chooseCity}
        onClose={() => setPicker(null)}
      />

      {filtered.length === 0 ? (
        <View style={styles.emptyContainer}>
          <IconText style={styles.emptyIcon} emoji="🍽️" />
          <Text style={styles.emptyText}>No restaurants found</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={paging.pageItems}
          keyExtractor={rowKey}
          renderItem={({ item }) => {
            const claimed = item.source === 'claimed';
            const isClosed = item.status === 'closed';
            const statusInfo = item.status ? STATUS_COLORS[item.status] : undefined;
            const isBusy = busyKey === rowKey(item);
            return (
              <View style={[styles.restaurantRow, claimed && isClosed && styles.restaurantRowClosed]}>
                <View style={styles.restaurantInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.restaurantName}>{item.restaurant_name}</Text>
                    <View style={[styles.sourceBadge, claimed ? styles.sourceClaimed : styles.sourceCached]}>
                      <Text style={[styles.sourceBadgeText, claimed ? styles.sourceClaimedText : styles.sourceCachedText]}>
                        {SOURCE_BADGE_LABEL[item.source] ?? 'Cached'}
                      </Text>
                    </View>
                    {claimed && statusInfo && (
                      <View style={[styles.sourceBadge, { backgroundColor: statusInfo.bg }]}>
                        <Text style={[styles.sourceBadgeText, { color: statusInfo.text }]}>{statusInfo.label}</Text>
                      </View>
                    )}
                  </View>
                  {!!item.address && <Text style={styles.restaurantAddress}>{item.address}</Text>}
                  {claimed ? (
                    <Text style={styles.restaurantOwner}>
                      Owner: {item.owner_business_name || 'Unknown'}
                      {item.owner_email ? ` (${item.owner_email})` : ''}
                    </Text>
                  ) : (
                    <>
                      {item.location_count > 1 && (
                        <Text style={styles.restaurantOwner}>{item.location_count} cached locations</Text>
                      )}
                      {item.shares_menu_with_claimed && (
                        <Text style={styles.sharedNote}>Menu shared with a claimed location of the same name</Text>
                      )}
                    </>
                  )}

                  <View style={styles.actionsRow}>
                    {claimed && (
                      <TouchableOpacity
                        onPress={() => item.restaurant_id && setEditingCategories({ id: item.restaurant_id, name: item.restaurant_name })}
                        disabled={isBusy}
                        accessibilityRole="button"
                      >
                        <IconText style={styles.categoriesLink} emoji="🏷️">Categories</IconText>
                      </TouchableOpacity>
                    )}
                    {canToggleStatus(item) && (
                      <TouchableOpacity
                        style={[styles.actionBtn, isClosed ? styles.actionBtnOk : styles.actionBtnWarn]}
                        onPress={() => handleToggleStatus(item)}
                        disabled={isBusy}
                      >
                        {isBusy ? (
                          <ActivityIndicator size="small" color={isClosed ? '#1565C0' : '#c62828'} />
                        ) : (
                          <Text style={[styles.actionBtnText, isClosed ? styles.actionBtnOkText : styles.actionBtnWarnText]}>
                            {isClosed ? '🔓 Reopen' : '🔒 Mark Closed'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                    {claimed && isClosed && (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionBtnWarn]}
                        onPress={() => handleDeleteClaimed(item)}
                        disabled={isBusy}
                      >
                        <IconText style={[styles.actionBtnText, styles.actionBtnWarnText]} emoji="🗑">Delete</IconText>
                      </TouchableOpacity>
                    )}
                    {item.source === 'cached' && !!item.place_id && (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionBtnWarn]}
                        onPress={() => handleDeleteCached(item)}
                        disabled={isBusy}
                      >
                        {isBusy ? (
                          <ActivityIndicator size="small" color="#c62828" />
                        ) : (
                          <IconText style={[styles.actionBtnText, styles.actionBtnWarnText]} emoji="🗑">Delete</IconText>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.list}
          ListFooterComponent={<PagerBar page={paging.page} pageCount={paging.pageCount} from={paging.from} to={paging.to} total={paging.total} onPage={paging.goTo} />}
        />
      )}

      <RestaurantCategoriesModal
        restaurantId={editingCategories?.id ?? null}
        restaurantName={editingCategories?.name ?? ''}
        onClose={() => setEditingCategories(null)}
      />

      {/* Confirm modal — used instead of Alert.alert, which is unreliable on React Native Web */}
      <Modal visible={!!confirmAction} transparent animationType="fade" onRequestClose={() => setConfirmAction(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{confirmAction?.title}</Text>
            <Text style={styles.hint}>{confirmAction?.message}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setConfirmAction(null)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, confirmAction?.destructive && styles.modalSaveBtnDestructive]}
                onPress={() => {
                  confirmAction?.onConfirm();
                  setConfirmAction(null);
                }}
              >
                <Text style={styles.modalSaveBtnText}>{confirmAction?.confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 2 },
  title: { fontSize: 24, fontWeight: '800', color: '#222' },
  count: { fontSize: 18, fontWeight: '800', color: '#1565C0', backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },

  searchContainer: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10 },
  searchInput: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  filterRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pickerChip: { borderWidth: 1, borderColor: '#B0BEC5' },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f0f0f0' },
  filterChipActive: { backgroundColor: '#1565C0' },
  filterChipText: { fontSize: 12, fontWeight: '700', color: '#555' },
  filterChipTextActive: { color: '#fff' },
  rangeText: { fontSize: 12, color: '#888', paddingHorizontal: 16, paddingTop: 10 },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  restaurantRow: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, elevation: 1, borderWidth: 1, borderColor: '#CFD8DC' },
  restaurantRowClosed: { backgroundColor: '#FFF5F5', borderWidth: 1.5, borderColor: '#e53e3e' },
  restaurantInfo: {},
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  restaurantName: { fontSize: 15, fontWeight: '700', color: '#222' },
  sourceBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  sourceBadgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  sourceClaimed: { backgroundColor: '#E8F5E9' },
  sourceClaimedText: { color: '#2e7d32' },
  sourceCached: { backgroundColor: '#ECEFF1' },
  sourceCachedText: { color: '#546E7A' },
  restaurantAddress: { fontSize: 12, color: '#666', marginBottom: 4 },
  restaurantOwner: { fontSize: 12, color: '#1565C0', fontWeight: '600' },
  sharedNote: { fontSize: 11, color: '#E65100', fontWeight: '600', marginTop: 2 },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  categoriesLink: { fontSize: 12, fontWeight: '800', color: '#1565C0' },
  actionBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#F5F5F5' },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: '#333' },
  actionBtnWarn: { backgroundColor: '#FFEBEE' },
  actionBtnWarnText: { color: '#c62828' },
  actionBtnOk: { backgroundColor: '#E3F2FD' },
  actionBtnOkText: { color: '#1565C0' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 440 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 12 },
  hint: { fontSize: 12, color: '#888', lineHeight: 18, marginBottom: 14 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#F5F5F5' },
  modalCancelBtnText: { fontSize: 14, fontWeight: '700', color: '#666' },
  modalSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#1565C0' },
  modalSaveBtnDestructive: { backgroundColor: '#e53e3e' },
  modalSaveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
