import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import type { Restaurant } from '../../types';
import { formatDistance } from '../../utils/geo';
import { getHoursDisplay } from '../../utils/hours';
import { useSavedStore } from '../../store/savedStore';
import { useSaved } from '../../hooks/useSaved';
import { getActiveCouponsByPlaceId } from '../../api/coupons';

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
  const router = useRouter();
  const isSaved = useSavedStore((s) => s.restaurantIds.has(restaurant.placeId));
  const { toggleRestaurant } = useSaved();
  const hoursDisplay = getHoursDisplay(restaurant.openingHours);
  const [couponCount, setCouponCount] = useState(0);

  useEffect(() => {
    getActiveCouponsByPlaceId(restaurant.placeId)
      .then((coupons) => setCouponCount(coupons?.length || 0))
      .catch(() => setCouponCount(0));
  }, [restaurant.placeId]);

  const cuisineLabel = restaurant.cuisineTypes
    .slice(0, 2)
    .map((t) =>
      t.replace(/_restaurant$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    )
    .join(' · ');

  const navigate = () =>
    router.push({ pathname: '/restaurant/[id]', params: { id: restaurant.placeId } });

  const showDebugInfo = () => {
    Alert.alert(
      `🧪 ${restaurant.name}`,
      `Opening Hours: ${JSON.stringify(restaurant.openingHours, null, 2)}\n\nDisplay: ${JSON.stringify(hoursDisplay, null, 2)}`,
      [{ text: 'Close' }]
    );
  };

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
    <TouchableOpacity style={[styles.card, selected && styles.cardSelected]} onPress={navigate} onLongPress={showDebugInfo} activeOpacity={0.92}>
      {/* Photo */}
      <View style={styles.imgWrap}>
        <Image source={placeholderImage(restaurant.name)} style={styles.img} contentFit="cover" />

        {/* Heart */}
        <TouchableOpacity
          style={styles.heart}
          onPress={() => toggleRestaurant(restaurant.placeId, restaurant)}
          hitSlop={10}
        >
          <Text style={{ fontSize: 17 }}>{isSaved ? '❤️' : '🤍'}</Text>
        </TouchableOpacity>

        {/* Status */}
        {!hideStatus && (
          <View style={styles.statusPill}>
            <View style={[styles.dot, { backgroundColor: hoursDisplay.isOpen ? '#4CAF50' : '#EF5350' }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTxt, { color: hoursDisplay.isOpen ? '#4CAF50' : '#EF5350' }]}>
                {hoursDisplay.todayHours || (hoursDisplay.isOpen ? 'Open' : 'Closed')}
              </Text>
              {hoursDisplay.timeUntil && (
                <Text style={[styles.statusSubtxt, { color: hoursDisplay.isOpen ? '#4CAF50' : '#EF5350' }]}>
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
          <Text style={styles.name} numberOfLines={1}>{restaurant.name}</Text>
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
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 14,
    elevation: 4,
  },
  cardSelected: { borderWidth: 2.5, borderColor: '#4CAF50' },

  imgWrap: { height: 170, position: 'relative' },
  img: { width: '100%', height: 170 },

  heart: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.93)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },

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
  name: { fontSize: 16, fontWeight: '700', color: '#141414', flex: 1, marginRight: 8 },
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
  couponBadge: { backgroundColor: '#FFF3E0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  couponBadgeText: { fontSize: 12, fontWeight: '600', color: '#E65100' },

  // Compact
  compact: {
    width: 155,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  compactSelected: { borderWidth: 2, borderColor: '#4CAF50' },
  compactImgBox: { height: 95 },
  compactImg: { width: '100%', height: 95 },
  compactBody: { padding: 10 },
  compactName: { fontSize: 13, fontWeight: '700', color: '#141414', marginBottom: 3 },
  compactMeta: { fontSize: 11, color: '#6B6B6B', marginTop: 2 },
});
