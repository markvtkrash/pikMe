import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator, ListRenderItem, TextInput, ScrollView, Linking, Modal,
  Pressable, useWindowDimensions,
} from 'react-native';
import { useState, useEffect, useMemo } from 'react';
import { Image } from 'expo-image';
import { BRAND_COLORS } from '../../src/constants/brandTheme';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRestaurantStore } from '../../src/store/restaurantStore';
import { formatDistance } from '../../src/utils/geo';
import { useMenuRecommendations } from '../../src/hooks/useMenuRecommendations';
import { MenuItemCardSwipeable } from '../../src/components/menu/MenuItemCardSwipeable';
import { MenuItemCard } from '../../src/components/menu/MenuItemCard';
import { useMenuLayoutStore } from '../../src/store/menuLayoutStore';
import { resolveLayout, withGridSpacer, type Spacer } from '../../src/utils/menuLayout';
import { unverifiedListNote, INGREDIENT_BANNER, FILTER_CAPTION } from '../../src/utils/menuItemNotices';
import { trackEvent } from '../../src/api/analytics';
import { useShare } from '../../src/hooks/useShare';
import { isRestaurantOpen } from '../../src/utils/hours';
import { useUserProfile } from '../../src/hooks/useUserProfile';
import { activeDiets, DIET_FILTER_CAPTION, DIET_FILTER_LABEL, keywordConflictsWithDiet, matchesDiet } from '../../src/utils/dietFilter';
import { restaurantShareMessage } from '../../src/utils/shareText';
import { menuComingSoonNote, MENU_SOON_LINE, MENU_EMPTY_TITLE, MENU_EMPTY_BODY } from '../../src/utils/menuStatus';
import { MenuItemSkeleton } from '../../src/components/menu/MenuItemSkeleton';
import { useSavedStore } from '../../src/store/savedStore';
import { useSaved } from '../../src/hooks/useSaved';
import { getActiveCouponsByPlaceId } from '../../src/api/coupons';
import { useCouponActivation } from '../../src/hooks/useCouponActivation';
import { CouponActivationModal } from '../../src/components/coupon/CouponActivationModal';
import { CouponConfirmModal } from '../../src/components/coupon/CouponConfirmModal';
import { NutritionDisclaimerModal } from '../../src/components/restaurant/NutritionDisclaimerModal';
import { remainingPersonalUses, remainingTotalUses, isLowStock } from '../../src/utils/couponDisplay';
import { reachableCouponCount } from '../../src/utils/couponVisibility';
import { useCustomerConfig } from '../../src/hooks/useCustomerConfig';
import { describeCategories } from '../../src/utils/categories';
import { supabase } from '../../src/api/supabase';
import { useUIStore } from '../../src/store/uiStore';
import type { Recommendation, Coupon } from '../../src/types';
import { useThemedStyles, useThemeColor } from '../../src/theme/useTheme';

const LOADING_EMOJIS = ['🍽️', '🥗', '🍲', '🥘', '🍳'];

// Generic restaurant/food photos — the app doesn't call Google's Place
// Photos API at all (it's billed per view, not per unique place, so it scales
// with traffic rather than restaurant count). Same restaurant always gets the
// same one (keyed off its name) rather than a random one flickering between
// re-renders.
const PLACEHOLDER_IMAGES = [
  require('../../assets/placeholders/placeholder-01.jpg'),
  require('../../assets/placeholders/placeholder-02.jpg'),
  require('../../assets/placeholders/placeholder-03.jpg'),
  require('../../assets/placeholders/placeholder-04.jpg'),
  require('../../assets/placeholders/placeholder-05.jpg'),
  require('../../assets/placeholders/placeholder-06.jpg'),
  require('../../assets/placeholders/placeholder-07.jpg'),
  require('../../assets/placeholders/placeholder-08.jpg'),
  require('../../assets/placeholders/placeholder-09.jpg'),
  require('../../assets/placeholders/placeholder-10.jpg'),
  require('../../assets/placeholders/placeholder-11.jpg'),
  require('../../assets/placeholders/placeholder-12.jpg'),
  require('../../assets/placeholders/placeholder-13.jpg'),
  require('../../assets/placeholders/placeholder-14.jpg'),
  require('../../assets/placeholders/placeholder-15.jpg'),
  require('../../assets/placeholders/placeholder-16.jpg'),
];

// Sums every character's code rather than just the first — with 16 images,
// hashing on the first letter alone clusters common starting letters (e.g.
// "The ...") onto the same handful of images instead of spreading evenly.
function placeholderImage(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return PLACEHOLDER_IMAGES[hash % PLACEHOLDER_IMAGES.length];
}

const LOADING_STATES = [
  { emoji: '📊', text: 'Analyzing nutrition', bg: '#E3F2FD' },
  { emoji: '🎯', text: 'Matching goals', bg: '#E3F2FD' },
  { emoji: '🔍', text: 'Filtering allergens', bg: '#FFF3E0' },
  { emoji: '❤️', text: 'Finding favorites', bg: '#FCE4EC' },
  { emoji: '⚡', text: 'Personalizing menu', bg: '#F3E5F5' },
  { emoji: '🥗', text: 'Scanning nutrients', bg: '#E0F2F1' },
];

export default function RestaurantDetailScreen() {
  const styles = useThemedStyles(baseStyles);
  const { dark, color: tc } = useThemeColor();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWide = useWindowDimensions().width > 760;
  // List (one compact card per row) or grid (two tiles per row: the name, with a dropdown for the details). Remembered on this device; the
  // grid is the default on a wide screen and the list on a phone.
  const savedLayout = useMenuLayoutStore((s) => s.layout);
  const setSavedLayout = useMenuLayoutStore((s) => s.setLayout);
  const layout = resolveLayout(savedLayout);
  const isGrid = layout === 'grid';
  const restaurants = useRestaurantStore((s) => s.restaurants);
  const restaurant = restaurants.find((r) => r.placeId === id) ?? null;
  const isSaved = useSavedStore((s) => s.restaurantIds.has(id ?? ''));
  const { toggleRestaurant } = useSaved();
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [loadingEmojiIndex, setLoadingEmojiIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [soonOpen, setSoonOpen] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  // "Matches my diet": on by default for a person who set a diet in their profile, and one tap to turn off. It hides dishes whose NAMES suggest something
  // outside the diet (see utils/dietFilter.ts); a dish that stays is not confirmed to fit.
  const { data: userProfile } = useUserProfile();
  const diets = activeDiets(userProfile?.dietaryRestrictions);
  const [dietChoice, setDietChoice] = useState<boolean | null>(null);   // null: follow the default (on)
  const dietFilterOn = diets.length > 0 && (dietChoice ?? true);
  const [couponsOnly, setCouponsOnly] = useState(false);
  const { data: customerConfig } = useCustomerConfig();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(true);
  const [couponsModalVisible, setCouponsModalVisible] = useState(false);

  const hasSeenNutritionDisclaimer = useUIStore((s) => s.hasSeenNutritionDisclaimer);
  const setHasSeenNutritionDisclaimer = useUIStore((s) => s.setHasSeenNutritionDisclaimer);
  const [showNutritionDisclaimer, setShowNutritionDisclaimer] = useState(!hasSeenNutritionDisclaimer);

  // Item-specific coupon ids for this restaurant — any of these that
  // personalized ranking would otherwise cut off past the cap (30 with confirmed items, else 20) still need
  // to show up (appended at the end), so a real deal never silently
  // disappears from the page.
  const couponItemIds = useMemo(
    () => new Set(coupons.filter((c) => c.menu_item_id).map((c) => c.menu_item_id as string)),
    [coupons]
  );
  const { data: recommendations, isLoading, error } = useMenuRecommendations(restaurant, couponItemIds);

  const removeCouponFromList = (couponId: string) =>
    setCoupons((prev) => prev.filter((c) => c.id !== couponId));
  const genericCouponActivation = useCouponActivation({ onClosed: removeCouponFromList });

  const share = useShare();

  // anonymous usage counts: a restaurant was opened, and its menu showed items (each once per restaurant per launch)
  useEffect(() => {
    if (id) trackEvent('restaurant_view', undefined, id);
  }, [id]);
  const menuItemCount = recommendations?.length ?? 0;
  useEffect(() => {
    if (id && menuItemCount > 0) trackEvent('menu_view', undefined, id);
  }, [id, menuItemCount]);

  useEffect(() => {
    if (!id) {
      setCouponsLoading(false);
      return;
    }
    getActiveCouponsByPlaceId(id)
      .then((data) => setCoupons(data || []))
      .catch(() => setCoupons([]))
      .finally(() => setCouponsLoading(false));
  }, [id]);

  // Keyword filters with colors
  const KEYWORD_FILTERS = [
    { label: 'Veg', color: '#E3F2FD', textColor: '#1565C0', keywords: ['veg', 'vegetable', 'salad', 'bean', 'lentil', 'tofu'] },
    { label: 'Fish', color: '#E3F2FD', textColor: '#1565C0', keywords: ['fish', 'salmon', 'tuna', 'cod', 'trout', 'seafood'] },
    { label: 'Chicken', color: '#FFF3E0', textColor: '#E65100', keywords: ['chicken', 'poultry', 'wing', 'nugget'] },
    { label: 'Beef', color: '#FFEBEE', textColor: '#C62828', keywords: ['beef', 'steak', 'burger', 'brisket', 'ribeye', 'meatball'] },
    { label: 'Pork', color: '#FCE4EC', textColor: '#AD1457', keywords: ['pork', 'bacon', 'ham', 'sausage', 'ribs', 'carnitas'] },
    { label: 'Ham', color: '#F3E5F5', textColor: '#6A1B9A', keywords: ['ham', 'prosciutto'] },
  ];

  // Filter recommendations based on search query and keywords
  const filteredRecommendations = recommendations?.filter(r => {
    const name = r.menuItem.name.toLowerCase();

    // Check search query
    if (searchQuery.trim() !== '' && !name.includes(searchQuery.toLowerCase())) {
      return false;
    }

    // Matches my diet: the name gives no sign of conflicting with the person's diet
    if (dietFilterOn && !matchesDiet(r.menuItem, diets)) return false;

    // Check keyword filters
    if (selectedKeywords.length > 0) {
      const hasKeyword = selectedKeywords.some(keyword => {
        const filter = KEYWORD_FILTERS.find(f => f.label === keyword);
        return filter?.keywords.some(k => name.includes(k));
      });
      if (!hasKeyword) return false;
    }

    // Coupons-only filter: keep items that have their own coupon
    if (couponsOnly && !coupons.some(c => c.menu_item_id === r.menuItem.itemId)) {
      return false;
    }

    return true;
  }) ?? [];

  // Cycle through loading messages
  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_STATES.length);
    }, 1500);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Cycle through loading emojis for menu title
  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setLoadingEmojiIndex((prev) => (prev + 1) % LOADING_EMOJIS.length);
    }, 400);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Opened with no restaurant at all (no id in the address): nothing to show, so go to the app's home rather than a "not found" page.
  if (!id || id === '[id]') {
    return <Redirect href="/(main)/(tabs)" />;
  }

  if (!restaurant) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigIcon}>🍽️</Text>
        <Text style={styles.errorTitle}>Restaurant not found</Text>
        <TouchableOpacity onPress={() => router.push('/explore')} style={styles.backLinkBtn}>
          <Text style={styles.backLink}>← Go to Explore</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // What the place is and what it serves, from the categories; Google's types as before when the server sent none.
  const cuisineDisplay = describeCategories(restaurant, customerConfig?.categories ?? [], 4) ?? restaurant.cuisineTypes
    .slice(0, 4)
    .map((t) => t.replace(/_restaurant$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' · ');

  const genericCoupons = coupons.filter((c) => !c.menu_item_id);
  // Only coupons the customer can reach: an item coupon counts when its item is on the menu they see (an unconfirmed item
  // that is hidden does not), so the button never shows a count that "Coupons only" cannot match.
  const shownItemIds = new Set((recommendations ?? []).map((r) => r.menuItem.itemId));
  const totalCouponCount = reachableCouponCount(coupons, shownItemIds);
  const itemCouponCount = totalCouponCount - genericCoupons.length;

  // Any-item coupons have no menu item to attach to, so they're only ever
  // viewable/activatable through this button's modal — tapping it filters
  // the menu list directly (old "Coupons only" behavior) only when there's
  // nothing else that needs a modal to be seen.
  function handleCouponsButtonPress() {
    if (genericCoupons.length > 0) {
      setCouponsModalVisible(true);
    } else {
      setCouponsOnly((prev) => !prev);
    }
  }

  const renderItem: ListRenderItem<Recommendation | { _skeleton: true } | Spacer> = ({ item }) => {
    if ('_spacer' in item) {
      return <View style={styles.gridCell} />;
    }
    if ('_skeleton' in item) {
      return isGrid ? <View style={styles.gridCell}><MenuItemSkeleton /></View> : <MenuItemSkeleton />;
    }
    const itemCoupons = coupons.filter(c => c.menu_item_id === item.menuItem.itemId);
    if (isGrid) {
      return (
        <View style={styles.gridCell}>
          <MenuItemCard variant="tile" recommendation={item} itemCoupons={itemCoupons} onCouponClosed={removeCouponFromList} />
        </View>
      );
    }
    return (
      <MenuItemCardSwipeable
        recommendation={item}
        itemCoupons={itemCoupons}
        onCouponClosed={removeCouponFromList}
      />
    );
  };

  const displayData = isLoading ? Array(5).fill({ _skeleton: true }) : filteredRecommendations ?? [];
  // In the grid an odd last tile gets a spacer, so it keeps its half width.
  const listData: (Recommendation | { _skeleton: true } | Spacer)[] = isGrid ? withGridSpacer(displayData, 2) : displayData;

  return (
    <View style={styles.backdrop}>
    {/* Tapping the dimmed area outside the sheet closes the modal. */}
    <Pressable style={StyleSheet.absoluteFill} onPress={() => router.back()} />
    <View style={[styles.sheet, isWide && styles.sheetWide]}>
    <FlatList
      key={layout}
      data={listData}
      numColumns={isGrid ? 2 : 1}
      columnWrapperStyle={isGrid ? styles.gridRow : undefined}
      keyExtractor={(r, idx) => ('_spacer' in r ? `spacer-${idx}` : '_skeleton' in r ? `skeleton-${idx}` : r.menuItem.itemId)}
      renderItem={renderItem}
      style={styles.list}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <>
          {/* Hero image */}
          <View style={styles.hero}>
            <Image source={placeholderImage(restaurant.name)} style={styles.heroImg} contentFit="cover" />

            {/* Overlay gradient strip */}
            <View style={styles.heroOverlay} />

            {/* Heart button */}
            <TouchableOpacity
              style={[styles.heroHeart, { top: insets.top + 12 }]}
              onPress={() => toggleRestaurant(restaurant.placeId, restaurant)}
              hitSlop={8}
            >
              <Text style={{ fontSize: 18 }}>{isSaved ? '❤️' : '🤍'}</Text>
            </TouchableOpacity>
          </View>

          {/* Info card */}
          <View style={styles.infoCardContainer}>
            <View style={styles.infoCard}>
              {/* The name, and Share set apart at the far end of the same line as one solid, outlined button */}
              <View style={styles.nameShareRow}>
                <Text style={[styles.restaurantName, { flex: 1 }]} numberOfLines={1}>{restaurant.name}</Text>
                <TouchableOpacity
                  style={styles.sharePill}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Share this restaurant"
                  onPress={() => share(restaurantShareMessage({ name: restaurant.name, address: restaurant.location.address, cuisine: cuisineDisplay, placeId: restaurant.placeId }), 'restaurant', restaurant.placeId)}
                >
                  <Text style={styles.sharePillTxt}><Text style={styles.shareArrow}>➦</Text> Share</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.metaRow}>
                {!isRestaurantOpen(restaurant)
                  ? <View style={styles.statusClosed}><Text style={styles.statusClosedTxt}>Closed</Text></View>
                  : <View style={styles.statusOpen}><View style={styles.openDot} /><Text style={styles.statusOpenTxt}>Open now</Text></View>
                }
                {restaurant.rating > 0 && (
                  <View style={styles.metaPill}>
                    <Text style={styles.metaPillTxt}>⭐ {restaurant.rating.toFixed(1)}</Text>
                  </View>
                )}
                {restaurant.distanceMeters > 0 && (
                  <View style={styles.metaPill}>
                    <Text style={styles.metaPillTxt}>📍 {formatDistance(restaurant.distanceMeters)}</Text>
                  </View>
                )}
                {restaurant.location.address ? (
                  <TouchableOpacity
                    style={styles.directionsPill}
                    hitSlop={6}
                    onPress={() => {
                      const { latitude, longitude } = restaurant.location;
                      Linking.openURL(
                        `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&destination_place_id=${restaurant.placeId}`
                      );
                    }}
                  >
                    <Text style={styles.directionsPillTxt}>🧭 Directions</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {(restaurant.location.address || cuisineDisplay) ? (
                <Text style={styles.addressLine} numberOfLines={1} ellipsizeMode="tail">
                  {[restaurant.location.address, cuisineDisplay].filter(Boolean).join('  ·  ')}
                </Text>
              ) : null}

              {/* Disclaimer — a single left-to-right line (icon then text)
                  instead of a separate padded box beside the card, to save
                  vertical space. */}
              <View style={styles.disclaimerRow}>
                <Text style={styles.disclaimerIcon}>⚠️</Text>
                <Text style={styles.disclaimerText}>Nutrition are approximations. Allergens & dietary practices may have changed. Always verify what matters to you.</Text>
              </View>
            </View>
          </View>

          {/* Menu header: the title and the List / Grid choice on one line (they wrap on a very narrow screen) */}
          <View style={styles.menuHeader}>
            <View style={styles.menuTitleRow}>
              <Text style={styles.menuTitle}>
                Top {isLoading ? LOADING_EMOJIS[loadingEmojiIndex] : recommendations?.length ?? 0} menu items for you
              </Text>
              {!isLoading && (recommendations?.length ?? 0) > 0 && (
                <View style={styles.layoutToggle}>
                  {(['list', 'grid'] as const).map((mode) => (
                    <TouchableOpacity
                      key={mode}
                      style={[styles.layoutChip, layout === mode && styles.layoutChipActive]}
                      onPress={() => setSavedLayout(mode)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: layout === mode }}
                      accessibilityLabel={mode === 'list' ? 'Detailed view: one dish per row, with all the details' : 'Quick view: two dishes per row, less scrolling'}
                    >
                      <Text style={[styles.layoutChipText, layout === mode && styles.layoutChipTextActive]}>
                        {mode === 'list' ? '📃 Detailed' : '⚡ Quick view'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* Search bar, with the coupons button beside it */}
          {!isLoading && (recommendations?.length ?? 0) > 0 && (
            <View>
              <View style={styles.searchRow}>
                {!couponsLoading && !isLoading && totalCouponCount > 0 && (
                  <TouchableOpacity
                    style={[styles.couponsButton, couponsOnly && styles.couponsButtonActive]}
                    onPress={handleCouponsButtonPress}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Coupons only"
                  >
                    <Text style={styles.couponsButtonIcon}>🎟️</Text>
                    <Text style={[styles.couponsButtonText, couponsOnly && styles.couponsButtonTextActive]}>
                      {couponsOnly ? '✓ ' : ''}Coupons
                    </Text>
                    <View style={styles.couponsCountBadge}>
                      <Text style={styles.couponsCountBadgeText}>{totalCouponCount}</Text>
                    </View>
                  </TouchableOpacity>
                )}

                <View style={styles.searchContainer}>
                  <Text style={styles.searchIcon}>🔍</Text>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search menu items..."
                    placeholderTextColor="#777"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                  {searchQuery ? (
                    <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={10}>
                      <Text style={styles.clearButton}>✕</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {/* Keyword filters */}
              <View style={styles.keywordContainer}>
                {diets.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      const turningOn = !dietFilterOn;
                      setDietChoice(turningOn);
                      // a Fish, Chicken... chip the diet rules out would only give an empty list: it is deselected when the diet chip is turned on
                      if (turningOn) {
                        setSelectedKeywords((prev) => prev.filter((label) => !keywordConflictsWithDiet(KEYWORD_FILTERS.find((f) => f.label === label)?.keywords ?? [], diets)));
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: dietFilterOn }}
                    style={[
                      styles.keywordButton,
                      dietFilterOn
                        ? { backgroundColor: '#2E7D32', borderColor: '#2E7D32', borderWidth: 2 }
                        : { backgroundColor: tc('#fff', 'backgroundColor'), borderColor: '#2E7D32', borderWidth: 1.5 },
                    ]}
                  >
                    <Text style={[styles.keywordText, { color: dietFilterOn ? '#fff' : tc('#1B5E20') }]}>
                      {dietFilterOn ? '✓ ' : ''}{DIET_FILTER_LABEL}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setSelectedKeywords([])}
                  style={[
                    styles.keywordButton,
                    selectedKeywords.length === 0
                      ? { backgroundColor: dark ? '#ededed' : '#141414', borderColor: dark ? '#ededed' : '#141414', borderWidth: 2 }
                      : { backgroundColor: tc('#fff', 'backgroundColor'), borderColor: tc('#141414'), borderWidth: 1.5 },
                  ]}
                >
                  <Text style={[styles.keywordText, { color: selectedKeywords.length === 0 ? (dark ? '#141414' : '#fff') : tc('#141414') }]}>
                    {selectedKeywords.length === 0 ? '✓ ' : ''}All
                  </Text>
                </TouchableOpacity>
                {KEYWORD_FILTERS.map((filter) => {
                  const isSelected = selectedKeywords.includes(filter.label);
                  return (
                    <TouchableOpacity
                      key={filter.label}
                      onPress={() => {
                        // choosing a chip the diet rules out (Chicken for a vegetarian) turns "Matches my diet" off, so the list is not empty
                        if (!isSelected && dietFilterOn && keywordConflictsWithDiet(filter.keywords, diets)) setDietChoice(false);
                        setSelectedKeywords((prev) =>
                          prev.includes(filter.label)
                            ? prev.filter((k) => k !== filter.label)
                            : [...prev, filter.label]
                        );
                      }}
                      style={[
                        styles.keywordButton,
                        isSelected
                          ? { backgroundColor: filter.textColor, borderColor: filter.textColor, borderWidth: 2 }
                          : { backgroundColor: tc('#fff', 'backgroundColor'), borderColor: tc(filter.textColor), borderWidth: 1.5 },
                      ]}
                    >
                      <Text style={[styles.keywordText, { color: isSelected ? '#fff' : tc(filter.textColor) }]}>
                        {isSelected ? '✓ ' : ''}{filter.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.filterCaption}>{dietFilterOn ? DIET_FILTER_CAPTION : FILTER_CAPTION}</Text>
            </View>
          )}

          {/* Results count */}
          {(searchQuery || selectedKeywords.length > 0 || couponsOnly || dietFilterOn) && !isLoading && (
            <Text style={styles.resultsCount}>
              {displayData.length} {displayData.length === 1 ? 'item' : 'items'} found
            </Text>
          )}

          {/* While no item is confirmed yet: a short line; tapping it opens the full wording */}
          {!isLoading && !error && menuComingSoonNote((recommendations ?? []).map((r) => r.menuItem)) && (
            <TouchableOpacity style={styles.soonNote} onPress={() => setSoonOpen(true)} activeOpacity={0.8} accessibilityRole="button" accessibilityHint="Opens the details">
              <Text style={styles.soonNoteText}>🕒 {MENU_SOON_LINE}</Text>
              <Text style={styles.soonNoteMore}>Details ›</Text>
            </TouchableOpacity>
          )}
          <Modal visible={soonOpen} transparent animationType="fade" onRequestClose={() => setSoonOpen(false)}>
            <Pressable style={styles.soonBackdrop} onPress={() => setSoonOpen(false)}>
              <View style={styles.soonCard}>
                <Text style={styles.soonTitle}>Estimated menu</Text>
                <Text style={styles.soonBody}>{menuComingSoonNote([{ isVerified: false }])}</Text>
              </View>
            </Pressable>
          </Modal>

          {/* One line explaining the Unconfirmed / AI-estimated tags on the cards below */}
          {!isLoading && !menuComingSoonNote((recommendations ?? []).map((r) => r.menuItem)) && unverifiedListNote((recommendations ?? []).map((r) => r.menuItem)) && (
            <Text style={styles.tagNote}>{unverifiedListNote((recommendations ?? []).map((r) => r.menuItem))}</Text>
          )}

          {isLoading && (
            <View style={[styles.loadingBox, { backgroundColor: tc(LOADING_STATES[loadingMessageIndex].bg, 'backgroundColor') }]}>
              <View style={styles.loadingContent}>
                <Text style={styles.loadingEmoji}>{LOADING_STATES[loadingMessageIndex].emoji}</Text>
                <Text style={styles.loadingText}>{LOADING_STATES[loadingMessageIndex].text}</Text>
              </View>

              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${((loadingMessageIndex + 1) / LOADING_STATES.length) * 100}%` }]} />
                </View>
                <Text style={styles.progressText}>{loadingMessageIndex + 1} of {LOADING_STATES.length}</Text>
              </View>

              <View style={styles.loadingSteps}>
                {LOADING_STATES.map((_, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.step,
                      idx <= loadingMessageIndex && styles.stepActive,
                    ]}
                  >
                    <Text style={styles.stepEmoji}>{LOADING_STATES[idx].emoji}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {!isLoading && error && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>⚠️</Text>
              <Text style={styles.emptyTitle}>Couldn't load menu</Text>
              <Text style={styles.emptyBody}>{(error as Error).message ?? 'Check your connection.'}</Text>
            </View>
          )}

          {!isLoading && !error && (recommendations?.length ?? 0) === 0 && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🕒</Text>
              <Text style={styles.emptyTitle}>{MENU_EMPTY_TITLE}</Text>
              <Text style={styles.emptyBody}>{MENU_EMPTY_BODY}</Text>
            </View>
          )}
        </>
      }
      ListFooterComponent={
        (recommendations?.length ?? 0) > 0 ? (
          <View style={styles.footer}>
            <Text style={styles.footerTxt}>👆 Top {recommendations!.length} items curated for your profile</Text>
          </View>
        ) : null
      }
    />

    {/* For everyone: a dish name does not show every ingredient. Pinned to the bottom of the sheet, outside the scrolling list, so it is
        always visible however far the menu is scrolled. */}
    <View style={[styles.stickyNotice, { paddingBottom: Math.max(insets.bottom, 7) }]}>
      <Text style={styles.stickyNoticeText}>⚠️ {INGREDIENT_BANNER}</Text>
    </View>

    {/* Sticky close button — stays fixed on screen regardless of scroll position. */}
    <TouchableOpacity
      style={[styles.closeBtn, { top: insets.top + 12 }]}
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Close"
    >
      <Text style={styles.closeIcon}>✕</Text>
    </TouchableOpacity>

    <CouponActivationModal
      visible={!!genericCouponActivation.activeCoupon}
      coupon={genericCouponActivation.activeCoupon}
      expiresAt={genericCouponActivation.expiresAt}
      onDone={genericCouponActivation.handleDone}
    />
    <CouponConfirmModal
      visible={!!genericCouponActivation.pendingCoupon}
      onCancel={genericCouponActivation.cancelActivate}
      onConfirm={genericCouponActivation.confirmActivate}
    />

    {/* Any-item coupons have no menu item to render a banner in, so this is
        their only view/activate surface — opened from the Coupons button
        above the category filters whenever there's at least one. */}
    <Modal
      visible={couponsModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setCouponsModalVisible(false)}
    >
      <View style={styles.couponsModalOverlay}>
        <View style={styles.couponsModalCard}>
          <View style={styles.couponsModalHeader}>
            <Text style={styles.couponsModalTitle}>🎉 Available Deals</Text>
            <TouchableOpacity onPress={() => setCouponsModalVisible(false)} hitSlop={10}>
              <Text style={styles.couponsModalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          {genericCoupons.length > 0 && (
            <View style={styles.couponChipRow}>
              {genericCoupons.map((coupon) => (
                <TouchableOpacity
                  key={coupon.id}
                  style={styles.couponChip}
                  onPress={() => {
                    setCouponsModalVisible(false);
                    genericCouponActivation.handlePress(coupon);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.couponChipValue}>
                    {coupon.discount_value}{coupon.coupon_type.includes('percent') ? '%' : '$'} OFF
                  </Text>
                  <Text style={styles.couponChipCode} numberOfLines={1}>{coupon.coupon_code}</Text>
                  <Text style={styles.couponChipHint} numberOfLines={1}>
                    {coupon.activated_at
                      ? '⏱ Active — tap to view'
                      : isLowStock(coupon)
                      ? `🔥 ${remainingTotalUses(coupon)} left`
                      : `👉 ${remainingPersonalUses(coupon)} ${remainingPersonalUses(coupon) === 1 ? 'use' : 'uses'} left`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {itemCouponCount > 0 && (
            <TouchableOpacity
              style={styles.couponsModalItemBtn}
              onPress={() => {
                setCouponsOnly(true);
                setCouponsModalVisible(false);
              }}
            >
              <Text style={styles.couponsModalItemBtnText}>
                👇 {itemCouponCount} item-specific {itemCouponCount === 1 ? 'deal' : 'deals'} — Show them in the menu
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>

    <NutritionDisclaimerModal
      visible={showNutritionDisclaimer}
      onDismiss={() => {
        setShowNutritionDisclaimer(false);
        setHasSeenNutritionDisclaimer(true);
        // Best-effort, like the other agreement recordings in this app —
        // never block the user if this write fails. record_user_agreement
        // upserts on (user_id, agreement_type, version), so this keeps
        // agreed_at as the most recent time they acknowledged this popup
        // rather than piling up a row per session.
        supabase
          .rpc('record_user_agreement', { p_agreement_type: 'menu_nutrition_disclaimer', p_version: '1.0' })
          .then(({ error }) => {
            if (error) console.warn('[PikMe] Failed to record nutrition disclaimer agreement:', error);
          });
      }}
    />
    </View>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center' },
  sheet: { flex: 1, width: '100%', backgroundColor: '#F6F6F6', overflow: 'hidden' },
  sheetWide: { maxWidth: 720, marginVertical: 24, borderRadius: 20 },
  closeBtn: {
    position: 'absolute',
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  closeIcon: { fontSize: 16, color: '#141414', fontWeight: '700' },
  list: { flex: 1, backgroundColor: '#F6F6F6' },
  content: { paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#F6F6F6' },
  bigIcon: { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 17, fontWeight: '700', color: '#333', marginBottom: 10 },
  backLinkBtn: { marginTop: 8 },
  backLink: { fontSize: 15, color: '#1565C0', fontWeight: '600' },

  // Shrunk from 260 — this is always a generic placeholder photo (never the
  // real restaurant), so it's pure decoration competing for scroll distance
  // against the "Top N Menu Items For You" section below, not information.
  hero: { height: 80, position: 'relative' },
  heroImg: { width: '100%', height: 80 },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  backBtnSticky: {
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  backIcon: { fontSize: 24, color: '#141414', lineHeight: 28, marginLeft: -2 },
  heroHeart: {
    position: 'absolute',
    right: 62,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },

  infoCardContainer: { marginHorizontal: 16, marginTop: -16, marginBottom: 8 },
  infoCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 12,
    elevation: 5,
  },
  // flexWrap so a long name + address never squeeze each other down to
  // illegible widths on a narrow phone — the address box drops to its own
  // line below the name instead of getting clipped mid-word.
  restaurantName: { fontSize: 19, fontWeight: '800', color: '#141414', letterSpacing: -0.3, marginBottom: 4 },
  // The row of pills under the name (open, rating, distance, Directions, Share): bigger, bolder and outlined so each one reads as a button or a fact
  // at a glance. Share is the one solid blue pill.
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  statusOpen: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#E3F2FD', paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: '#1565C0' },
  openDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1565C0' },
  statusOpenTxt: { fontSize: 14, color: '#0D47A1', fontWeight: '800' },
  statusClosed: { backgroundColor: '#FFEBEE', paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: '#C62828' },
  statusClosedTxt: { fontSize: 14, color: '#C62828', fontWeight: '800' },
  metaPill: { backgroundColor: '#FFF8E1', paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: '#FFB300' },
  metaPillTxt: { fontSize: 14, color: '#5D4037', fontWeight: '800' },
  addressLine: { fontSize: 11.5, color: '#6B6B6B' },
  directionsPill: { backgroundColor: '#E3F2FD', paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: '#1565C0' },
  directionsPillTxt: { fontSize: 14, fontWeight: '800', color: BRAND_COLORS.primary },
  // Share sits at the right end of the name line, with a gap from the name, as the one solid blue button with a white ring and a shadow so it is in focus
  nameShareRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  sharePill: {
    backgroundColor: '#1565C0', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 22, borderWidth: 2, borderColor: '#fff',
    shadowColor: '#0D47A1', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  sharePillTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
  // a fat, curved arrow
  shareArrow: { fontSize: 20, fontWeight: '900', color: '#fff' },
  disclaimerRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },

  menuHeader: { paddingHorizontal: 16, paddingBottom: 12 },
  menuTitle: { fontSize: 15, fontWeight: '800', color: '#141414', flexShrink: 1 },
  menuTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  layoutToggle: { flexDirection: 'row', gap: 6 },
  layoutChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: '#f0f0f0' },
  layoutChipActive: { backgroundColor: '#1565C0' },
  layoutChipText: { fontSize: 10.5, fontWeight: '700', color: '#555' },
  layoutChipTextActive: { color: '#fff' },
  gridRow: { paddingHorizontal: 12, gap: 8, alignItems: 'stretch' },
  gridCell: { flex: 1, marginBottom: 8 },

  searchContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 2, borderColor: '#1565C0' },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginHorizontal: 16, marginBottom: 8 },
  searchIcon: { fontSize: 15, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13.5, color: '#141414', paddingVertical: 3 },
  clearButton: {
    fontSize: 16,
    color: '#ccc',
    padding: 4,
  },

  couponsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, alignSelf: 'stretch', backgroundColor: '#FFF9C4', borderRadius: 10, borderWidth: 1.5, borderColor: '#FFB74D', paddingHorizontal: 8, position: 'relative' },
  couponsButtonActive: { backgroundColor: '#E65100', borderColor: '#E65100' },
  couponsButtonIcon: { fontSize: 13 },
  couponsButtonText: { fontSize: 11.5, fontWeight: '800', color: '#D84315' },
  couponsButtonTextActive: { color: '#fff' },
  // Overlaps the button's top-right corner like a notification badge,
  // instead of sitting inline with the label — separates "how many" from
  // the button's own text at a glance.
  couponsCountBadge: { position: 'absolute', top: -6, right: -6, backgroundColor: '#FF6F00', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#fff', elevation: 3 },
  couponsCountBadgeText: { fontSize: 10, fontWeight: '900', color: '#fff' },

  // the filter chips wrap onto as many lines as the screen needs
  keywordContainer: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginBottom: 2, gap: 4 },
  keywordButton: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  keywordText: { fontSize: 11, fontWeight: '700' },
  // pinned at the bottom of the sheet, below the scrolling list
  stickyNotice: { backgroundColor: '#E65100', paddingHorizontal: 12, paddingTop: 7, alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.2, shadowRadius: 4 },
  stickyNoticeText: { fontSize: 12, fontWeight: '800', color: '#fff', lineHeight: 16, textAlign: 'center' },
  filterCaption: { fontSize: 10.5, color: '#888', marginHorizontal: 16, marginTop: 0, marginBottom: 4 },
  soonNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF3E0', borderWidth: 1, borderColor: '#E65100', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginHorizontal: 16, marginBottom: 6 },
  soonNoteText: { fontSize: 12.5, fontWeight: '700', color: '#7A3300', flexShrink: 1 },
  soonNoteMore: { fontSize: 12, fontWeight: '800', color: '#BF360C', marginLeft: 8 },
  soonBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  soonCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18, maxWidth: 360, width: '100%', borderWidth: 2, borderColor: '#E65100' },
  soonTitle: { fontSize: 16, fontWeight: '800', color: '#7A3300', marginBottom: 8 },
  soonBody: { fontSize: 14, color: '#333', lineHeight: 20 },
  tagNote: { fontSize: 11, color: '#7A4A00', backgroundColor: '#FFF8E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginHorizontal: 16, marginBottom: 6, lineHeight: 15 },
  resultsCount: {
    fontSize: 12,
    color: '#888',
    marginHorizontal: 16,
    marginBottom: 8,
    fontStyle: 'italic',
  },

  loadingBox: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    marginHorizontal: 16,
    borderRadius: 20,
    marginVertical: 20,
    gap: 24,
  },
  loadingContent: {
    alignItems: 'center',
    gap: 12,
  },
  loadingEmoji: {
    fontSize: 72,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  loadingSubtext: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
  },
  progressContainer: {
    width: '100%',
    gap: 8,
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1565C0',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
  },
  loadingSteps: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  step: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  stepActive: {
    backgroundColor: '#1565C0',
    opacity: 1,
  },
  stepEmoji: {
    fontSize: 24,
  },

  emptyBox: {
    margin: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyIcon: { fontSize: 36 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  emptyBody: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 20 },

  footer: { paddingVertical: 20, alignItems: 'center' },
  footerTxt: { fontSize: 12, color: '#AEAEB2' },

  couponsModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  couponsModalCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, width: '100%', maxWidth: 420, elevation: 6,
  },
  couponsModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  couponsModalTitle: { fontSize: 17, fontWeight: '800', color: '#D84315' },
  couponsModalClose: { fontSize: 18, color: '#999', fontWeight: '700', padding: 4 },
  couponsModalItemBtn: {
    backgroundColor: '#FFF3E0', borderRadius: 12, borderWidth: 1.5, borderColor: '#E65100',
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 14,
  },
  couponsModalItemBtnText: { fontSize: 13, fontWeight: '800', color: '#E65100', textAlign: 'center' },
  couponChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  couponChip: {
    backgroundColor: '#FFF9C4', borderRadius: 12, borderWidth: 2, borderColor: '#FFB74D',
    paddingHorizontal: 14, paddingVertical: 10, minWidth: 128, alignItems: 'center', elevation: 2,
  },
  couponChipValue: { fontSize: 16, fontWeight: '900', color: '#D84315' },
  couponChipCode: { fontSize: 12, fontWeight: '800', color: '#E65100', marginTop: 2 },
  couponChipHint: { fontSize: 10.5, fontWeight: '700', color: '#1565C0', marginTop: 4 },

  disclaimerIcon: { fontSize: 13, lineHeight: 16 },
  disclaimerText: { flex: 1, fontSize: 10.5, color: '#8A5A00', lineHeight: 14, fontWeight: '600' },
});
