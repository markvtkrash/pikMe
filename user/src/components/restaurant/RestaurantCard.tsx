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

const PLACEHOLDER_BG = ['#E8F5E9', '#E3F2FD', '#FFF3E0', '#F3E5F5', '#FCE4EC', '#E0F7FA'];

function placeholderBg(name: string) {
  return PLACEHOLDER_BG[name.charCodeAt(0) % PLACEHOLDER_BG.length];
}

// Generic restaurant/food photos shown when a real photo is missing or its
// Google photo_reference has expired — same restaurant always gets the same
// one (keyed off its name, like placeholderBg above) rather than a random one
// flickering between re-renders.
const PLACEHOLDER_IMAGES = [
  require('../../../assets/placeholders/restaurant-1.jpg'),
  require('../../../assets/placeholders/restaurant-2.jpg'),
  require('../../../assets/placeholders/food-1.jpg'),
  require('../../../assets/placeholders/food-2.png'),
];

function placeholderImage(name: string) {
  return PLACEHOLDER_IMAGES[name.charCodeAt(0) % PLACEHOLDER_IMAGES.length];
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
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    getActiveCouponsByPlaceId(restaurant.placeId)
      .then((coupons) => setCouponCount(coupons?.length || 0))
      .catch(() => setCouponCount(0));
  }, [restaurant.placeId]);

  // Google's photo_reference tokens can expire independent of our own cache
  // TTL — reset the failure flag whenever the URL itself changes so a fresh
  // reference gets a fresh chance to load.
  useEffect(() => {
    setImgFailed(false);
  }, [restaurant.photoUrl]);

  const cuisineLabel = restaurant.cuisineTypes
    .slice(0, 2)
    .map((t) =>
      t.replace(/_restaurant$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    )
    .join(' · ');

  // photoUrl is generated server-side by Edge Function
  // Attribution: Photos from Google Maps are credited in explore.tsx and NearbyMap.tsx
  const imgUri = !imgFailed ? restaurant.photoUrl ?? null : null;

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
          {imgUri
            ? <Image source={{ uri: imgUri }} style={styles.compactImg} contentFit="cover" transition={250} onError={() => setImgFailed(true)} />
            : <Image source={placeholderImage(restaurant.name)} style={styles.compactImg} contentFit="cover" />
          }
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
        {imgUri
          ? <Image
              source={{ uri: imgUri }}
              style={styles.img}
              contentFit="cover"
              transition={300}
              placeholder={{ color: placeholderBg(restaurant.name) }}
              onError={() => setImgFailed(true)}
            />
          : <Image source={placeholderImage(restaurant.name)} style={styles.img} contentFit="cover" />
        }

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
