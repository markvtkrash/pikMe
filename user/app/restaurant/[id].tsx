import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator, ListRenderItem, TextInput, ScrollView, Linking,
} from 'react-native';
import { useState, useEffect } from 'react';
import { Image } from 'expo-image';
import { BRAND_COLORS } from '../../src/constants/brandTheme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRestaurantStore } from '../../src/store/restaurantStore';
import { formatDistance } from '../../src/utils/geo';
import { useMenuRecommendations } from '../../src/hooks/useMenuRecommendations';
import { MenuItemCardSwipeable } from '../../src/components/menu/MenuItemCardSwipeable';
import { MenuItemSkeleton } from '../../src/components/menu/MenuItemSkeleton';
import { useSavedStore } from '../../src/store/savedStore';
import { useSaved } from '../../src/hooks/useSaved';
import { getActiveCouponsByPlaceId } from '../../src/api/coupons';
import { useCouponActivation } from '../../src/hooks/useCouponActivation';
import { CouponActivationModal } from '../../src/components/coupon/CouponActivationModal';
import { CouponConfirmModal } from '../../src/components/coupon/CouponConfirmModal';
import { NutritionDisclaimerModal } from '../../src/components/restaurant/NutritionDisclaimerModal';
import { supabase } from '../../src/api/supabase';
import { useUIStore } from '../../src/store/uiStore';
import type { Recommendation, Coupon } from '../../src/types';

const LOADING_EMOJIS = ['🍽️', '🥗', '🍲', '🥘', '🍳'];

const PLACEHOLDER_BG = ['#E8F5E9', '#E3F2FD', '#FFF3E0', '#F3E5F5', '#FCE4EC'];
function placeholderBg(name: string) {
  return PLACEHOLDER_BG[name.charCodeAt(0) % PLACEHOLDER_BG.length];
}

// Generic restaurant/food photos shown when a real photo is missing or its
// Google photo_reference has expired — same restaurant always gets the same
// one (keyed off its name, like placeholderBg above) rather than a random one
// flickering between re-renders.
const PLACEHOLDER_IMAGES = [
  require('../../assets/placeholders/restaurant-1.jpg'),
  require('../../assets/placeholders/restaurant-2.jpg'),
  require('../../assets/placeholders/food-1.jpg'),
  require('../../assets/placeholders/food-2.png'),
];

function placeholderImage(name: string) {
  return PLACEHOLDER_IMAGES[name.charCodeAt(0) % PLACEHOLDER_IMAGES.length];
}

const LOADING_STATES = [
  { emoji: '📊', text: 'Analyzing nutrition', bg: '#E8F5E9' },
  { emoji: '🎯', text: 'Matching goals', bg: '#E3F2FD' },
  { emoji: '🔍', text: 'Filtering allergens', bg: '#FFF3E0' },
  { emoji: '❤️', text: 'Finding favorites', bg: '#FCE4EC' },
  { emoji: '⚡', text: 'Personalizing menu', bg: '#F3E5F5' },
  { emoji: '🥗', text: 'Scanning nutrients', bg: '#E0F2F1' },
];

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const restaurants = useRestaurantStore((s) => s.restaurants);
  const restaurant = restaurants.find((r) => r.placeId === id) ?? null;
  const isSaved = useSavedStore((s) => s.restaurantIds.has(id ?? ''));
  const { toggleRestaurant } = useSaved();
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [loadingEmojiIndex, setLoadingEmojiIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [couponsOnly, setCouponsOnly] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(true);
  const [imgFailed, setImgFailed] = useState(false);

  const hasSeenNutritionDisclaimer = useUIStore((s) => s.hasSeenNutritionDisclaimer);
  const setHasSeenNutritionDisclaimer = useUIStore((s) => s.setHasSeenNutritionDisclaimer);
  const [showNutritionDisclaimer, setShowNutritionDisclaimer] = useState(!hasSeenNutritionDisclaimer);

  const { data: recommendations, isLoading, error } = useMenuRecommendations(restaurant);

  const removeCouponFromList = (couponId: string) =>
    setCoupons((prev) => prev.filter((c) => c.id !== couponId));
  const genericCouponActivation = useCouponActivation({ onClosed: removeCouponFromList });

  // Google's photo_reference tokens can expire independent of our own cache
  // TTL — reset the failure flag whenever the URL itself changes so a fresh
  // reference gets a fresh chance to load.
  useEffect(() => {
    setImgFailed(false);
  }, [restaurant?.photoUrl]);

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
    { label: 'Veg', color: '#E8F5E9', textColor: '#2e7d32', keywords: ['veg', 'vegetable', 'salad', 'bean', 'lentil', 'tofu'] },
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

  const imgUri = !imgFailed ? restaurant.photoUrl ?? null : null;

  const cuisineDisplay = restaurant.cuisineTypes
    .slice(0, 4)
    .map((t) => t.replace(/_restaurant$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' · ');

  const genericCoupons = coupons.filter((c) => !c.menu_item_id);
  const itemCouponCount = coupons.filter((c) => c.menu_item_id).length;

  const renderItem: ListRenderItem<Recommendation | { _skeleton: true }> = ({ item }) => {
    if ('_skeleton' in item) {
      return <MenuItemSkeleton />;
    }
    const itemCoupons = coupons.filter(c => c.menu_item_id === item.menuItem.itemId);
    return (
      <MenuItemCardSwipeable
        recommendation={item}
        itemCoupons={itemCoupons}
        onCouponClosed={removeCouponFromList}
      />
    );
  };

  const displayData = isLoading ? Array(5).fill({ _skeleton: true }) : filteredRecommendations ?? [];

  return (
    <>
    <FlatList
      data={displayData}
      keyExtractor={(r, idx) => ('_skeleton' in r ? `skeleton-${idx}` : r.menuItem.itemId)}
      renderItem={renderItem}
      style={styles.list}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <>
          {/* Hero image */}
          <View style={styles.hero}>
            {imgUri
              ? <Image
                  source={{ uri: imgUri }}
                  style={styles.heroImg}
                  contentFit="cover"
                  transition={300}
                  placeholder={{ color: placeholderBg(restaurant.name) }}
                  onError={() => setImgFailed(true)}
                />
              : <Image source={placeholderImage(restaurant.name)} style={styles.heroImg} contentFit="cover" />
            }

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

          {/* Info card with disclaimer */}
          <View style={styles.infoCardContainer}>
            <View style={styles.infoCard}>
              <Text style={styles.restaurantName}>{restaurant.name}</Text>

              <View style={styles.metaRow}>
                {!restaurant.openNow
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
              </View>

              {cuisineDisplay ? <Text style={styles.cuisine}>{cuisineDisplay}</Text> : null}
              {restaurant.location.address ? (
                <>
                  <Text style={styles.address}>{restaurant.location.address}</Text>
                  <TouchableOpacity
                    style={styles.directionsLink}
                    hitSlop={6}
                    onPress={() => {
                      const { latitude, longitude } = restaurant.location;
                      Linking.openURL(
                        `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&destination_place_id=${restaurant.placeId}`
                      );
                    }}
                  >
                    <Text style={styles.directionsLinkText}>🧭 Get Directions</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>

            {/* Disclaimer box */}
            <View style={styles.disclaimerBox}>
              <Text style={styles.disclaimerIcon}>⚠️</Text>
              <Text style={styles.disclaimerText}>Nutrition are approximations. Allergens & dietary practices may have changed. Always verify what matters to you.</Text>
            </View>
          </View>

          {/* Coupons Section */}
          {!couponsLoading && (genericCoupons.length > 0 || itemCouponCount > 0) && (
            <View style={styles.couponsSection}>
              <Text style={styles.couponsSectionTitle}>
                {genericCoupons.length > 0 ? '🎉 Deals on Any Item' : '🎉 Menu Item Deals'}
              </Text>
              {genericCoupons.map((coupon) => (
                <TouchableOpacity
                  key={coupon.id}
                  style={styles.couponCard}
                  onPress={() => genericCouponActivation.handlePress(coupon)}
                  activeOpacity={0.85}
                >
                  <View style={styles.couponInfo}>
                    <Text style={styles.couponCode}>🎉 Use: {coupon.coupon_code}</Text>
                    <Text style={styles.couponDiscount}>
                      {coupon.discount_value}{coupon.coupon_type.includes('percent') ? '%' : '$'} off • Any Item
                    </Text>
                    <Text style={styles.couponTapHint}>
                      {coupon.activated_at ? '⏱ Active — tap to view' : 'Tap to activate'}
                    </Text>
                  </View>
                  <View style={styles.couponBadgeRight}>
                    <Text style={styles.couponValue}>
                      {coupon.discount_value}{coupon.coupon_type.includes('percent') ? '%' : '$'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              {itemCouponCount > 0 && (
                <Text style={styles.couponItemNote}>
                  👇 {genericCoupons.length > 0 ? 'Plus ' : ''}{itemCouponCount} item-specific{' '}
                  {itemCouponCount === 1 ? 'deal' : 'deals'} on dishes below
                </Text>
              )}
            </View>
          )}

          {/* Menu header */}
          <View style={styles.menuHeader}>
            <Text style={styles.menuTitle}>
              📋 Top {isLoading ? LOADING_EMOJIS[loadingEmojiIndex] : recommendations?.length ?? 0} Menu Items For You
            </Text>
            <Text style={styles.menuSub}>Curated based on your dietary preferences, health goals & allergies</Text>
          </View>

          {/* Search bar */}
          {!isLoading && (recommendations?.length ?? 0) > 0 && (
            <View>
              <View style={styles.searchContainer}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search menu items..."
                  placeholderTextColor="#ccc"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery ? (
                  <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={10}>
                    <Text style={styles.clearButton}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Keyword filters */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.keywordScroll}
                contentContainerStyle={styles.keywordContainer}
              >
                {itemCouponCount > 0 && (
                  <TouchableOpacity
                    onPress={() => setCouponsOnly((prev) => !prev)}
                    style={[
                      styles.keywordButton,
                      {
                        backgroundColor: '#FFF3E0',
                        borderColor: '#E65100',
                        borderWidth: couponsOnly ? 2 : 1,
                        opacity: couponsOnly ? 1 : 0.6,
                      },
                    ]}
                  >
                    <Text style={[styles.keywordText, { color: '#E65100' }]}>
                      {couponsOnly ? '✓ ' : ''}🎟️ Coupons only
                    </Text>
                  </TouchableOpacity>
                )}
                {KEYWORD_FILTERS.map((filter) => {
                  const isSelected = selectedKeywords.includes(filter.label);
                  return (
                    <TouchableOpacity
                      key={filter.label}
                      onPress={() => {
                        setSelectedKeywords((prev) =>
                          prev.includes(filter.label)
                            ? prev.filter((k) => k !== filter.label)
                            : [...prev, filter.label]
                        );
                      }}
                      style={[
                        styles.keywordButton,
                        {
                          backgroundColor: filter.color,
                          borderColor: filter.textColor,
                          borderWidth: isSelected ? 2 : 1,
                          opacity: isSelected ? 1 : 0.6,
                        },
                      ]}
                    >
                      <Text style={[styles.keywordText, { color: filter.textColor }]}>
                        {isSelected ? '✓ ' : ''}{filter.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Results count */}
          {(searchQuery || selectedKeywords.length > 0 || couponsOnly) && !isLoading && (
            <Text style={styles.resultsCount}>
              {displayData.length} {displayData.length === 1 ? 'item' : 'items'} found
            </Text>
          )}

          {isLoading && (
            <View style={[styles.loadingBox, { backgroundColor: LOADING_STATES[loadingMessageIndex].bg }]}>
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
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No nutrition data available</Text>
              <Text style={styles.emptyBody}>
                Nutrition info is available for major chain restaurants.
              </Text>
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

    {/* Sticky back buttons — stay fixed on screen regardless of scroll position,
        placed at three heights so one is always within thumb's reach. */}
    <TouchableOpacity
      style={[styles.backBtn, styles.backBtnSticky, { top: insets.top + 12 }]}
      onPress={() => router.back()}
    >
      <Text style={styles.backIcon}>‹</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.backBtn, styles.backBtnSticky, styles.backBtnMiddle]}
      onPress={() => router.back()}
    >
      <Text style={styles.backIcon}>‹</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.backBtn, styles.backBtnSticky, { bottom: insets.bottom + 16 }]}
      onPress={() => router.back()}
    >
      <Text style={styles.backIcon}>‹</Text>
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
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#F6F6F6' },
  content: { paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#F6F6F6' },
  bigIcon: { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 17, fontWeight: '700', color: '#333', marginBottom: 10 },
  backLinkBtn: { marginTop: 8 },
  backLink: { fontSize: 15, color: '#4CAF50', fontWeight: '600' },

  hero: { height: 260, position: 'relative' },
  heroImg: { width: '100%', height: 260 },
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
  backBtnMiddle: { top: '50%', marginTop: -19 },
  backIcon: { fontSize: 24, color: '#141414', lineHeight: 28, marginLeft: -2 },
  heroHeart: {
    position: 'absolute',
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },

  infoCardContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: -20,
    marginBottom: 16,
    gap: 12,
    alignItems: 'flex-start',
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    elevation: 5,
  },
  restaurantName: { fontSize: 22, fontWeight: '800', color: '#141414', marginBottom: 10, letterSpacing: -0.3 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  statusOpen: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4CAF50' },
  statusOpenTxt: { fontSize: 12, color: '#2e7d32', fontWeight: '700' },
  statusClosed: { backgroundColor: '#FFEBEE', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusClosedTxt: { fontSize: 12, color: '#C62828', fontWeight: '700' },
  metaPill: { backgroundColor: '#F6F6F6', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  metaPillTxt: { fontSize: 12, color: '#444', fontWeight: '600' },
  cuisine: { fontSize: 13, color: '#6B6B6B', marginBottom: 5 },
  address: { fontSize: 13, color: '#888' },
  directionsLink: { alignSelf: 'flex-start', marginTop: 4 },
  directionsLinkText: { fontSize: 13, fontWeight: '700', color: BRAND_COLORS.primary },

  menuHeader: { paddingHorizontal: 16, paddingBottom: 8 },
  menuTitle: { fontSize: 18, fontWeight: '800', color: '#141414' },
  menuSub: { fontSize: 12, color: '#888', marginTop: 2 },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#F9F9F9',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  searchIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    paddingVertical: 4,
  },
  clearButton: {
    fontSize: 16,
    color: '#ccc',
    padding: 4,
  },
  keywordScroll: {
    marginBottom: 8,
  },
  keywordContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  keywordButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keywordText: {
    fontSize: 12,
    fontWeight: '600',
  },
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
    backgroundColor: '#4CAF50',
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
    backgroundColor: '#4CAF50',
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

  couponsSection: { paddingHorizontal: 16, paddingVertical: 16, backgroundColor: '#FFECB3', marginHorizontal: 16, borderRadius: 14, marginBottom: 16, borderWidth: 2, borderColor: '#FF9800' },
  couponsSectionTitle: { fontSize: 16, fontWeight: '800', color: '#D84315', marginBottom: 12 },
  couponItemNote: { fontSize: 13, fontWeight: '700', color: '#E65100', marginTop: 2 },
  couponCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF9C4', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, marginBottom: 10, borderWidth: 2, borderColor: '#FFB74D', elevation: 2 },
  couponInfo: { flex: 1 },
  couponCode: { fontSize: 15, fontWeight: '900', color: '#D84315', marginBottom: 3 },
  couponDiscount: { fontSize: 13, color: '#E65100', fontWeight: '700' },
  couponTapHint: { fontSize: 10.5, color: '#D84315', fontWeight: '700', marginTop: 3 },
  couponBadgeRight: { backgroundColor: '#FF6F00', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center', elevation: 2 },
  couponValue: { fontSize: 18, fontWeight: '900', color: '#fff' },

  disclaimerBox: {
    backgroundColor: '#FFF9E6',
    borderWidth: 2,
    borderColor: '#FF6B35',
    borderRadius: 12,
    padding: 14,
    width: 130,
    minHeight: 100,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 3,
  },
  disclaimerIcon: { fontSize: 22 },
  disclaimerText: { fontSize: 10, color: '#D84315', lineHeight: 13, fontWeight: '600', textAlign: 'center' },
});
