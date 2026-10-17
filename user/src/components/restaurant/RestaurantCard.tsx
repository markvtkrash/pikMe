import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useState, useEffect } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import type { Restaurant } from '../../types';
import { formatDistance } from '../../utils/geo';
import { getHoursDisplay, isRestaurantOpen } from '../../utils/hours';
import { useSavedStore } from '../../store/savedStore';
import { useSaved } from '../../hooks/useSaved';
import { useCustomerConfig } from '../../hooks/useCustomerConfig';
import { describeCategories } from '../../utils/categories';
import { menuBadge } from '../../utils/menuStatus';
import { getActiveCouponsByPlaceId } from '../../api/coupons';
import { useThemedStyles, useThemeColor } from '../../theme/useTheme';

// Generic restaurant/food photos — the app doesn't call Google's Place
// Photos API at all (it's billed per view, not per unique place, so it scales
// with traffic rather than restaurant count). Same restaurant always gets the
// same one (keyed off its name) rather than a random one flickering between
// re-renders.
const PLACEHOLDER_IMAGES = [
  require('../../../assets/placeholders/placeholder-01.jpg'),
  require('../../../assets/placeholders/placeholder-02.jpg'),
  require('../../../assets/placeholders/placeholder-03.jpg'),
  require('../../../assets/placeholders/placeholder-04.jpg'),
  require('../../../assets/placeholders/placeholder-05.jpg'),
  require('../../../assets/placeholders/placeholder-06.jpg'),
  require('../../../assets/placeholders/placeholder-07.jpg'),
  require('../../../assets/placeholders/placeholder-08.jpg'),
  require('../../../assets/placeholders/placeholder-09.jpg'),
  require('../../../assets/placeholders/placeholder-10.jpg'),
  require('../../../assets/placeholders/placeholder-11.jpg'),
  require('../../../assets/placeholders/placeholder-12.jpg'),
  require('../../../assets/placeholders/placeholder-13.jpg'),
  require('../../../assets/placeholders/placeholder-14.jpg'),
  require('../../../assets/placeholders/placeholder-15.jpg'),
  require('../../../assets/placeholders/placeholder-16.jpg'),
];

// Sums every character's code rather than just the first — with 16 images,
// hashing on the first letter alone clusters common starting letters (e.g.
// "The ...") onto the same handful of images instead of spreading evenly.
function placeholderImage(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return PLACEHOLDER_IMAGES[hash % PLACEHOLDER_IMAGES.length];
}

interface Props {
  restaurant: Restaurant;
  selected?: boolean;
  compact?: boolean;
  hideStatus?: boolean;
}

export function RestaurantCard({ restaurant, selected = false, compact = false, hideStatus = false }: Props) {
  const styles = useThemedStyles(baseStyles);
  const { color: tc } = useThemeColor();
  const router = useRouter();
  const isSaved = useSavedStore((s) => s.restaurantIds.has(restaurant.placeId));
  const { toggleRestaurant } = useSaved();
  const hoursDisplay = getHoursDisplay(restaurant.openingHours);
  // open or closed from the weekly schedule and the clock (the stored snapshot only when there is no schedule)
  const isOpen = isRestaurantOpen(restaurant);
  const [couponCount, setCouponCount] = useState(0);
  const badge = menuBadge(restaurant.menuStatus);

  useEffect(() => {
    getActiveCouponsByPlaceId(restaurant.placeId)
      .then((coupons) => setCouponCount(coupons?.length || 0))
      .catch(() => setCouponCount(0));
  }, [restaurant.placeId]);

  const { data: customerConfig } = useCustomerConfig();
  // What the place is and what it serves, from the categories; the earlier text from Google's types when the server sent none.
  const cuisineLabel = describeCategories(restaurant, customerConfig?.categories ?? [], 2) ?? restaurant.cuisineTypes
    .slice(0, 2)
    .map((t) =>
      t.replace(/_restaurant$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    )
    .join(' · ');

  const navigate = () =>
    router.push({ pathname: '/restaurant/[id]', params: { id: restaurant.placeId } });

  if (compact) {
    return (
      <TouchableOpacity style={[styles.compact, selected && styles.compactSelected]} onPress={navigate} activeOpacity={0.88}>
        <View style={styles.compactImgBox}>
          <Image source={placeholderImage(restaurant.name)} style={styles.compactImg} contentFit="cover" />
        </View>
        <View style={styles.compactBody}>
          <Text style={styles.compactName} numberOfLines={1}>{restaurant.name}</Text>
          {!!cuisineLabel && <Text style={styles.compactMeta} numberOfLines={1}>{cuisineLabel}</Text>}
          {restaurant.rating > 0 && <Text style={styles.compactMeta}>⭐ {restaurant.rating.toFixed(1)}</Text>}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={[styles.card, selected && styles.cardSelected]} onPress={navigate} activeOpacity={0.92}>
      {/* Photo */}
      <View style={styles.imgWrap}>
        <Image source={placeholderImage(restaurant.name)} style={styles.img} contentFit="cover" />

        {/* Heart */}
        <TouchableOpacity
          style={[styles.heart, isSaved && styles.heartSaved]}
          onPress={() => toggleRestaurant(restaurant.placeId, restaurant)}
          hitSlop={10}
        >
          <Text style={isSaved ? styles.heartOn : styles.heartOff}>{isSaved ? '♥' : '♡'}</Text>
        </TouchableOpacity>

        {/* Status */}
        {!hideStatus && (
          <View style={styles.statusPill}>
            <View style={[styles.dot, { backgroundColor: isOpen ? '#1565C0' : '#EF5350' }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTxt, { color: tc(isOpen ? '#1565C0' : '#EF5350') }]}>
                {hoursDisplay.todayHours || (isOpen ? 'Open' : 'Closed')}
              </Text>
              {hoursDisplay.timeUntil && (
                <Text style={[styles.statusSubtxt, { color: tc(isOpen ? '#1565C0' : '#EF5350') }]}>
                  {hoursDisplay.timeUntil}
                </Text>
              )}
            </View>
          </View>
        )}
      </View>

      {/* Info row */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <View style={styles.nameBox}>
            <Text style={styles.name} numberOfLines={1}>{restaurant.name}</Text>
          </View>
          {restaurant.rating > 0 && (
            <View style={styles.ratingPill}>
              <Text style={styles.ratingTxt}>⭐ {restaurant.rating.toFixed(1)}</Text>
            </View>
          )}
        </View>
        <View style={styles.metaRow}>
          {!!cuisineLabel && <Text style={styles.meta}>{cuisineLabel}</Text>}
          {!!cuisineLabel && restaurant.distanceMeters > 0 && <Text style={styles.sep}>·</Text>}
          {restaurant.distanceMeters > 0 && <Text style={styles.meta}>{formatDistance(restaurant.distanceMeters)}</Text>}
          {couponCount > 0 && (
            <>
              <Text style={styles.sep}>·</Text>
              <View style={styles.couponBadge}>
                <Text style={styles.couponBadgeText}>🎉 {couponCount}</Text>
              </View>
            </>
          )}
        </View>
        {badge && (
          <View style={[styles.menuBadge, badge.tone === 'confirmed' ? styles.menuBadgeConfirmed : styles.menuBadgeEstimated]}>
            <Text style={[styles.menuBadgeText, badge.tone === 'confirmed' ? styles.menuBadgeTextConfirmed : styles.menuBadgeTextEstimated]}>{badge.label}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const baseStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 18,
    overflow: 'hidden',
    // a clear brand-blue border all round, so each card stands out from the light blue page and from the next card
    borderWidth: 3,
    borderColor: '#1565C0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 14,
    elevation: 4,
  },
  // the card picked on the map: an orange border instead of the blue one
  cardSelected: { borderColor: '#E65100' },

  imgWrap: { height: 170, position: 'relative' },
  img: { width: '100%', height: 170 },

  heart: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#D32F2F',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },

  // saved: filled red circle with a white heart; not saved: white circle with a red outline heart
  heartSaved: { backgroundColor: '#D32F2F' },
  heartOff: { fontSize: 22, lineHeight: 26, color: '#D32F2F', fontWeight: '700' },
  heartOn: { fontSize: 20, lineHeight: 24, color: '#FFFFFF' },

  statusPill: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.93)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 12, fontWeight: '700' },
  statusSubtxt: { fontSize: 10, marginTop: 2, fontWeight: '500' },

  info: { paddingHorizontal: 14, paddingVertical: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  // the restaurant name sits on a light-blue highlight so it stands out from the details under it
  nameBox: { flex: 1, marginRight: 8, backgroundColor: '#DCEBFA', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderLeftWidth: 4, borderLeftColor: '#1565C0' },
  name: { fontSize: 16, fontWeight: '800', color: '#0D47A1' },
  ratingPill: {
    backgroundColor: '#F6F6F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ratingTxt: { fontSize: 12, fontWeight: '600', color: '#444' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  meta: { fontSize: 13, color: '#6B6B6B' },
  sep: { fontSize: 13, color: '#CACACA' },
  // whether the menu is confirmed: green when it is, soft blue (information, not a warning) while it is estimated
  menuBadge: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  menuBadgeConfirmed: { backgroundColor: '#E8F5E9', borderColor: '#2E7D32' },
  menuBadgeEstimated: { backgroundColor: '#E3F2FD', borderColor: '#1565C0' },
  menuBadgeText: { fontSize: 12, fontWeight: '700' },
  menuBadgeTextConfirmed: { color: '#1B5E20' },
  menuBadgeTextEstimated: { color: '#0D47A1' },
  couponBadge: { backgroundColor: '#FFF3E0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  couponBadgeText: { fontSize: 12, fontWeight: '600', color: '#E65100' },

  // Compact
  compact: {
    width: 155,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2.5,
    borderColor: '#1565C0',
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  compactSelected: { borderColor: '#E65100' },
  compactImgBox: { height: 95 },
  compactImg: { width: '100%', height: 95 },
  compactBody: { padding: 10 },
  compactName: { fontSize: 13, fontWeight: '700', color: '#141414', marginBottom: 3 },
  compactMeta: { fontSize: 11, color: '#6B6B6B', marginTop: 2 },
});
