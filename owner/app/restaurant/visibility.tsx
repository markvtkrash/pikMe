import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { setRestaurantPaused } from '../../src/api/restaurantAuth';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';

export default function VisibilityScreen() {
  const { restaurant, setRestaurant } = useRestaurantOwnerStore();
  const { favorites, toggleFavorite } = useFavoritePages();
  const [togglingPause, setTogglingPause] = useState(false);

  if (!restaurant) return null;

  async function handleTogglePause() {
    const nextPaused = !restaurant!.is_paused;
    setTogglingPause(true);
    try {
      await setRestaurantPaused(restaurant!.id, nextPaused);
      setRestaurant({ ...restaurant!, is_paused: nextPaused, paused_at: nextPaused ? new Date().toISOString() : null });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update');
    } finally {
      setTogglingPause(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Visible to Customers</Text>
          <FavoriteHeart
            active={favorites.has('tool-visibility')}
            onPress={() => toggleFavorite('tool-visibility')}
            size="large"
          />
        </View>
        <Text style={styles.subtitle}>{restaurant.name}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{restaurant.is_paused ? '⏸ Temporarily Paused' : '▶ Visible to Customers'}</Text>
          <Text style={styles.cardHint}>
            {restaurant.is_paused
              ? 'Your restaurant is hidden from customer search. Resume anytime — no approval needed.'
              : 'Closed for a few days (holiday, emergency)? Pause your listing — it comes right back when you resume.'}
          </Text>
          <TouchableOpacity
            style={[styles.pauseBtn, restaurant.is_paused && styles.resumeBtn]}
            onPress={handleTogglePause}
            disabled={togglingPause}
          >
            {togglingPause ? (
              <ActivityIndicator color={restaurant.is_paused ? '#fff' : '#E65100'} size="small" />
            ) : (
              <Text style={[styles.pauseBtnText, restaurant.is_paused && styles.resumeBtnText]}>
                {restaurant.is_paused ? '▶ Resume Visibility' : '⏸ Pause Temporarily'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center', padding: 16 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 16 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  cardHint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },

  pauseBtn: { marginTop: 4, backgroundColor: '#FFF3E0', borderWidth: 1.5, borderColor: '#E65100', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  pauseBtnText: { color: '#E65100', fontSize: 14, fontWeight: '700' },
  resumeBtn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  resumeBtnText: { color: '#fff' },
});
