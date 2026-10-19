import { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, RefreshControl, Platform, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocation } from '../../../src/hooks/useLocation';
import { useNearbyRestaurants } from '../../../src/hooks/useNearbyRestaurants';
import { useCouponPlaceIds } from '../../../src/hooks/useCouponPlaceIds';
import { useCustomerConfig } from '../../../src/hooks/useCustomerConfig';
import { useRegionAccess } from '../../../src/hooks/useRegionAccess';
import { useVoiceSearch } from '../../../src/hooks/useVoiceSearch';
import { Alert } from '../../../src/utils/alert';
import { ComingSoon } from '../../../src/components/region/ComingSoon';
import { isBlocked } from '../../../src/utils/regionAccess';
import {
  anyCategoryFilter, isCurated, matchesCategoryFilters, NO_CATEGORY_FILTERS, type CategoryFilters,
} from '../../../src/utils/categories';
import { FilterSheet } from '../../../src/components/common/FilterSheet';
import { activeChips, filtersButtonLabel, removeChip, splitChips, type ActiveChip } from '../../../src/utils/filterChips';
import { RestaurantCard } from '../../../src/components/restaurant/RestaurantCard';
import { SkeletonRestaurantCard } from '../../../src/components/common/SkeletonCard';
import { RadiusSelector } from '../../../src/components/common/RadiusSelector';
import { useRestaurantStore } from '../../../src/store/restaurantStore';
import { normalizeForSearch } from '../../../src/utils/textMatch';
import { CUISINE_FILTERS } from '../../../src/constants/cuisines';
import { BRAND_COLORS, BRAND_NAME } from '../../../src/constants/brandTheme';
import type { Restaurant } from '../../../src/types';
import { sortByDistanceAndMenu } from '../../../src/utils/menuStatus';
import { trackEvent } from '../../../src/api/analytics';
import { useRememberedFiltersStore } from '../../../src/store/rememberedFiltersStore';
import { readyToRestore } from '../../../src/utils/rememberedFilters';
import { planStartFilters, profileSignature } from '../../../src/utils/profilePlaces';
import { useUserProfile } from '../../../src/hooks/useUserProfile';
import { useThemedStyles } from '../../../src/theme/useTheme';

const ALL = 'All';
// Clears the floating brand logo pinned top-left on every screen (app/_layout.tsx's FloatingLogo,
// top: insets.top + 8, ~34px tall) so this screen's own header never renders underneath it.
const TOP_CLEARANCE = 50;

function matchesCuisine(r: Restaurant, cuisine: (typeof CUISINE_FILTERS)[number]): boolean {
  if (r.cuisineTypes.some((t) => cuisine.types.includes(t))) return true;
  const name = r.name.toLowerCase();
  return cuisine.keywords.some((kw) => name.includes(kw));
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function ExploreScreen() {
  const styles = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  const { location, loading: locationLoading, error: locationError, canAskAgain, refresh } = useLocation();
  const searchRadiusMeters = useRestaurantStore((s) => s.searchRadiusMeters);
  const { data: restaurants = [], isLoading, error: fetchError, refetch, isRefetching } =
    useNearbyRestaurants(location);
  // Region launch control: in a state that is not open yet, a "Coming soon" screen replaces the restaurants (Region Management, migration 142).
  const region = useRegionAccess(location);

  const [search, setSearch] = useState('');
  // The microphone button in the search box (only where the phone's build has speech recognition): the words heard go into the box as they come.
  const voice = useVoiceSearch(setSearch);
  useEffect(() => {
    if (voice.error) {
      Alert.alert('Voice search', voice.error);
      voice.clearError();
    }
  }, [voice.error]);
  const [activeType, setActiveType] = useState(ALL);
  const [activeCuisine, setActiveCuisine] = useState(ALL);
  // the filter sheet (what kind of place, how you get the food, cuisine); the page itself keeps search, Coupons Only and the chosen chips
  const [sheetOpen, setSheetOpen] = useState(false);
  const [couponsOnly, setCouponsOnly] = useState(false);
  const { data: couponPlaceIds } = useCouponPlaceIds();
  // The categories an admin manages (what a place is, how you get the food, what it serves). When the server sends them, the
  // filters below use them; otherwise the earlier filters on Google's raw types are used.
  const { data: customerConfig } = useCustomerConfig();
  const categories = customerConfig?.categories ?? [];
  const [filters, setFilters] = useState<CategoryFilters>(NO_CATEGORY_FILTERS);
  // "Remember my filters": every change the person makes is kept on the device, and Explore starts with the last ones (decided once per launch, when
  // the restaurants and the saved choice are both in). See utils/rememberedFilters.ts.
  const rememberedHydrated = useRememberedFiltersStore((s) => s.hydrated);
  const remembered = useRememberedFiltersStore((s) => s.filters);
  const seededFrom = useRememberedFiltersStore((s) => s.seededFrom);
  const remember = useRememberedFiltersStore((s) => s.remember);
  const seedFilters = useRememberedFiltersStore((s) => s.seed);
  // The profile's choices (kind of place, how you get the food, cuisine) are the same categories as these filters. When they have changed since
  // Explore last started from them, it starts from them again. decidedFor is the profile state the decision was made for (null: not decided yet).
  const { data: profile, isLoading: profileLoading } = useUserProfile();
  const profileSig = profileSignature(profile);
  const decidedFor = useRef<string | null>(null);
  function updateFilters(next: CategoryFilters) {
    setFilters(next);
    remember(next);
  }

  // Fetching always covers the max radius (see useNearbyRestaurants); the
  // distance picker just filters that same data client-side, no refetch.
  const withinRadius = useMemo(
    () => (restaurants as Restaurant[]).filter((r) => r.distanceMeters <= searchRadiusMeters),
    [restaurants, searchRadiusMeters]
  );

  const curated = useMemo(() => isCurated(withinRadius, categories), [withinRadius, categories]);

  // What to start with, decided once per launch and again whenever the profile's choices change: the profile's choices when they are new, otherwise
  // the filters the person used last time. It waits for the restaurants, the category list, the profile and the saved choice, and never replaces a
  // choice the person made before it was decided. If nothing here matches, Explore starts unfiltered. See planStartFilters.
  useEffect(() => {
    if (!customerConfig || profileLoading) return;
    const firstDecision = decidedFor.current === null;
    if (!readyToRestore({
      hydrated: rememberedHydrated,
      restaurantCount: withinRadius.length,
      alreadyDecided: decidedFor.current === profileSig,
      currentlyFiltered: firstDecision && anyCategoryFilter(filters),
    })) return;
    decidedFor.current = profileSig;
    const start = planStartFilters({ remembered, seededFrom, profile, restaurants: withinRadius, categories });
    if (!start.plan.applied) return;
    setFilters(start.plan.filters);
    if (start.source === 'profile' && start.seededFrom !== null) seedFilters(start.plan.filters, start.seededFrom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerConfig, profileLoading, rememberedHydrated, withinRadius, profileSig]);

  // anonymous usage count: someone searched (once per launch; what they typed is never sent)
  useEffect(() => {
    if (search.trim().length >= 2) trackEvent('search');
  }, [search]);

  const typeOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    withinRadius.forEach((r) =>
      r.cuisineTypes.forEach((t) => { counts[t] = (counts[t] ?? 0) + 1; })
    );
    return [ALL, ...Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)];
  }, [withinRadius]);

  // Curated cuisine filter, separate from the dynamic venue-type chips above —
  // only show a cuisine chip if at least one nearby restaurant actually
  // matches it, same UX rule as typeOptions.
  const cuisineOptions = useMemo(() => {
    const present = CUISINE_FILTERS.filter((c) => withinRadius.some((r) => matchesCuisine(r, c)));
    return [ALL, ...present.map((c) => c.label)];
  }, [withinRadius]);

  // Nearest first; among restaurants about the same distance away, a confirmed menu comes before an estimated or missing one.
  const filtered = useMemo(() =>
    sortByDistanceAndMenu(withinRadius
      .filter((r) => {
        const matchSearch = normalizeForSearch(r.name).includes(normalizeForSearch(search));
        const matchType = activeType === ALL || r.cuisineTypes.includes(activeType);
        const cuisine = CUISINE_FILTERS.find((c) => c.label === activeCuisine);
        const matchCuisine = activeCuisine === ALL || (!!cuisine && matchesCuisine(r, cuisine));
        const matchCoupon = !couponsOnly || !!couponPlaceIds?.has(r.placeId);
        const matchCategories = !curated || matchesCategoryFilters(r, filters);
        return matchSearch && matchType && matchCuisine && matchCoupon && matchCategories;
      })),
    [withinRadius, search, activeType, activeCuisine, couponsOnly, couponPlaceIds, curated, filters]
  );

  const hasActiveFilters = search !== '' || activeType !== ALL || activeCuisine !== ALL || couponsOnly || (curated && anyCategoryFilter(filters));

  function resetFilters() {
    setSearch('');
    setActiveType(ALL);
    setActiveCuisine(ALL);
    updateFilters(NO_CATEGORY_FILTERS);
    setCouponsOnly(false);
  }

  // The chosen filters as small removable chips on the page, and the count on the Filters button.
  const chips = useMemo(
    () => activeChips(
      filters,
      categories,
      curated ? null : { type: activeType === ALL ? null : activeType, cuisine: activeCuisine === ALL ? null : activeCuisine, typeLabel: chipLabel },
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, categories, curated, activeType, activeCuisine]
  );
  const { shown: shownChips, more: moreChips } = splitChips(chips, 4);

  function removeActiveChip(chip: ActiveChip) {
    if (chip.kind === 'legacyType') setActiveType(ALL);
    else if (chip.kind === 'legacyCuisine') setActiveCuisine(ALL);
    else updateFilters(removeChip(filters, chip));
  }

  // "Clear all" in the sheet clears the filters in it; search and Coupons Only are left as they are.
  function clearSheetFilters() {
    updateFilters(NO_CATEGORY_FILTERS);
    setActiveType(ALL);
    setActiveCuisine(ALL);
  }

  function chipLabel(type: string) {
    if (type === ALL) return 'All';
    if (type === 'cafe') return 'Cafe/Coffee';
    return type.replace(/_restaurant$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  if (locationLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + TOP_CLEARANCE }]}>
        <View style={styles.staticHeader}>
          <Text style={styles.greeting}>{greeting()} 👋</Text>
          <Text style={styles.subGreeting}>Finding your location…</Text>
        </View>
        <FlatList
          data={[1, 2, 3, 4]}
          keyExtractor={(i) => String(i)}
          renderItem={() => <SkeletonRestaurantCard />}
          contentContainerStyle={styles.list}
          scrollEnabled={false}
        />
      </View>
    );
  }

  if (locationError) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + TOP_CLEARANCE }]}>
        <View style={styles.staticHeader}>
          <Text style={styles.greeting}>Location needed</Text>
          <Text style={styles.subGreeting}>{BRAND_NAME} needs your location to find nearby restaurants</Text>
        </View>
        <View style={styles.errorCard}>
          <Text style={styles.errorIcon}>📍</Text>
          <Text style={styles.errorBody}>{locationError}</Text>
          {!canAskAgain && Platform.OS !== 'web' ? (
            <TouchableOpacity style={styles.btn} onPress={() => Linking.openSettings()}>
              <Text style={styles.btnText}>Open Settings</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.btn} onPress={refresh}>
              <Text style={styles.btnText}>Enable Location</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  if (isBlocked(region.data)) {
    return <ComingSoon access={region.data!} onCheckAgain={() => { refresh(); region.refetch(); }} checking={region.isFetching} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + TOP_CLEARANCE }]}>
      {/* Sticky header */}
      <View style={styles.header}>
        <View style={styles.greetingRow}>
          <Text style={styles.greeting}>{greeting()} 👋</Text>
          <View style={styles.locationBadge}>
            <Text style={styles.locationText}>📍 Near you</Text>
          </View>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search restaurants…"
            placeholderTextColor="#6B6B6B"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {voice.available && (
            <TouchableOpacity
              onPress={voice.listening ? voice.stop : voice.start}
              style={[styles.micButton, voice.listening && styles.micButtonOn]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={voice.listening ? 'Stop listening' : 'Search by voice'}
            >
              <Text style={styles.micIcon}>{voice.listening ? '⏹' : '🎤'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* More Filters toggle */}
        <View style={styles.moreFiltersRow}>
          <TouchableOpacity
            style={[styles.moreFiltersPill, chips.length > 0 && styles.moreFiltersPillActive]}
            onPress={() => setSheetOpen(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={filtersButtonLabel(chips.length)}
          >
            <Text style={[styles.moreFiltersText, chips.length > 0 && styles.moreFiltersTextActive]}>
              ⚙️ {filtersButtonLabel(chips.length)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.couponsPill, couponsOnly && styles.couponsPillActive]}
            onPress={() => setCouponsOnly((prev) => !prev)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: couponsOnly }}
            accessibilityLabel="Coupons only"
          >
            <Text style={[styles.couponsText, couponsOnly && styles.moreFiltersTextActive]}>
              🎉 Coupons
            </Text>
          </TouchableOpacity>

          {hasActiveFilters && (
            <TouchableOpacity
              style={styles.resetFiltersPill}
              onPress={resetFilters}
              activeOpacity={0.8}
              accessibilityLabel="Reset filters"
            >
              <Text style={styles.resetFiltersText}>✕ Reset</Text>
            </TouchableOpacity>
          )}
        </View>

        <RadiusSelector compact />

        {/* What is switched on, as small chips: tap one to remove it */}
        {chips.length > 0 && (
          <View style={styles.activeChips}>
            {shownChips.map((chip) => (
              <TouchableOpacity key={chip.id} style={styles.activeChip} onPress={() => removeActiveChip(chip)} accessibilityRole="button" accessibilityLabel={`Remove ${chip.label}`}>
                <Text style={styles.activeChipText}>{chip.label}  ✕</Text>
              </TouchableOpacity>
            ))}
            {moreChips > 0 && (
              <TouchableOpacity style={styles.activeChipMore} onPress={() => setSheetOpen(true)} accessibilityRole="button">
                <Text style={styles.activeChipMoreText}>+{moreChips} more</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* List */}
      {isLoading ? (
        <FlatList
          data={[1, 2, 3, 4]}
          keyExtractor={(i) => String(i)}
          renderItem={() => <SkeletonRestaurantCard />}
          contentContainerStyle={styles.list}
          scrollEnabled={false}
        />
      ) : fetchError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Could not load restaurants</Text>
          <Text style={styles.errorBody}>Check your connection and Edge Function setup.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => refetch()}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.placeId}
          renderItem={({ item }) => <RestaurantCard restaurant={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            !isLoading && !fetchError && filtered.length > 0 ? (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Nearby Restaurants</Text>
                <Text style={styles.sectionCount}>{filtered.length}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🍽️</Text>
              <Text style={styles.emptyTitle}>
                {hasActiveFilters ? (couponsOnly ? 'No coupon restaurants nearby' : 'No matches') : 'No restaurants found'}
              </Text>
              <Text style={styles.emptyBody}>
                {hasActiveFilters
                  ? 'Try a different search or filter'
                  : 'Try increasing the distance above'}
              </Text>
            </View>
          }
          ListFooterComponent={
            <View style={styles.attribution}>
              <Text style={styles.attributionText}>
                Restaurant information from Google Maps
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#1565C0" />
          }
        />
      )}

      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        restaurants={withinRadius}
        categories={categories}
        curated={curated}
        filters={filters}
        onChange={updateFilters}
        onClear={clearSheetFilters}
        resultCount={filtered.length}
        legacy={{
          typeOptions,
          activeType,
          onType: (t) => { setActiveType(t); setActiveCuisine(ALL); },
          typeLabel: chipLabel,
          cuisineOptions,
          activeCuisine,
          onCuisine: (c) => { setActiveCuisine(c); setActiveType(ALL); },
        }}
      />
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND_COLORS.background.page },

  header: {
    backgroundColor: BRAND_COLORS.background.page,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    paddingBottom: 0,
  },
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  greeting: { fontSize: 19, fontWeight: '800', color: '#141414', letterSpacing: -0.3 },
  subGreeting: { fontSize: 13, color: '#6B6B6B', marginTop: 2 },
  locationBadge: {
    backgroundColor: '#F0FAF0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BBDEFB',
  },
  locationText: { fontSize: 12, color: '#1565C0', fontWeight: '600' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    // white with a 2px blue border, so the search box stands out from the light blue page
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#1565C0',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    // no padding on the box itself: the text field fills all of it, so there is no smaller box inside the box
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
    gap: 0,
  },
  searchIcon: { fontSize: 17, paddingLeft: 12 },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
    color: '#141414',
    paddingHorizontal: 10,
    paddingVertical: 0,
    backgroundColor: 'transparent',
    // on the web the browser draws its own outline round the field when it is tapped: the blue box is the outline already
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as any) : {}),
  },
  micButton: { marginRight: 8, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E3F2FD' },
  micButtonOn: { backgroundColor: '#FFCDD2' },
  micIcon: { fontSize: 13 },

  moreFiltersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  resetFiltersPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 50,
    backgroundColor: '#FFEBEE',
    borderWidth: 1.5,
    borderColor: '#E57373',
  },
  resetFiltersText: { fontSize: 13, color: '#C62828', fontWeight: '700' },
  moreFiltersPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 50,
    backgroundColor: '#E3F2FD',
    borderWidth: 1.5,
    borderColor: '#1565C0',
  },
  moreFiltersPillActive: {
    backgroundColor: '#1565C0',
    borderColor: '#1565C0',
  },
  couponsPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 50,
    backgroundColor: '#FFF3E0',
    borderWidth: 1.5,
    borderColor: '#E65100',
  },
  couponsPillActive: { backgroundColor: '#E65100' },
  couponsText: { fontSize: 13, color: '#E65100', fontWeight: '700' },
  moreFiltersText: { fontSize: 13, color: '#1565C0', fontWeight: '700' },
  moreFiltersChevron: { fontSize: 13, color: '#1565C0', fontWeight: '700' },
  moreFiltersTextActive: { color: '#fff' },

  activeChips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingBottom: 6, gap: 6 },
  activeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#141414' },
  activeChipText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  activeChipMore: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#ccc' },
  activeChipMoreText: { fontSize: 12, color: '#555', fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 50,
    backgroundColor: '#F6F6F6',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
  },
  chipActive: { backgroundColor: '#141414', borderColor: '#141414' },
  chipText: { fontSize: 13, color: '#555', fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#141414' },
  sectionCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1565C0',
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },

  list: { paddingBottom: 36 },

  staticHeader: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },

  errorCard: { margin: 20, backgroundColor: '#fff', borderRadius: 16, padding: 28, alignItems: 'center', gap: 10 },
  errorIcon: { fontSize: 40 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#141414' },
  errorBody: { fontSize: 13, color: '#6B6B6B', textAlign: 'center', lineHeight: 20 },
  btn: { marginTop: 6, backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  emptyBox: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40, gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  emptyBody: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 20 },

  attribution: { paddingHorizontal: 16, paddingVertical: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#E8E8E8' },
  attributionText: { fontSize: 11, color: '#999', textAlign: 'center', lineHeight: 16 },
});
