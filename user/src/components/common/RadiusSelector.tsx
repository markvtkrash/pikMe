import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRestaurantStore } from '../../store/restaurantStore';
import { BRAND_COLORS } from '../../constants/brandTheme';
import { useMaxRadiusMiles } from '../../hooks/useMaxRadiusMiles';

const METERS_PER_MILE = 1609.34;

export function RadiusSelector() {
  const searchRadiusMeters = useRestaurantStore((s) => s.searchRadiusMeters);
  const setSearchRadiusMeters = useRestaurantStore((s) => s.setSearchRadiusMeters);
  const selectedMiles = Math.round(searchRadiusMeters / METERS_PER_MILE);
  const { data: maxRadiusMiles = 6 } = useMaxRadiusMiles();
  // 1, 2, ..., maxRadiusMiles — pulled live from app_config so this can
  // never offer a distance the server hasn't actually fetched (see
  // useMaxRadiusMiles.ts).
  const radiusOptionsMiles = Array.from({ length: maxRadiusMiles }, (_, i) => i + 1);

  return (
    <View style={styles.row}>
      <Text style={styles.label}>Distance</Text>
      <View style={styles.pills}>
        {radiusOptionsMiles.map((mi) => {
          const active = mi === selectedMiles;
          return (
            <TouchableOpacity
              key={mi}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => setSearchRadiusMeters(mi * METERS_PER_MILE)}
              activeOpacity={0.85}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{mi} mi</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
  },
  pills: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F6F6F6',
  },
  pillActive: {
    backgroundColor: BRAND_COLORS.primary,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B6B6B',
  },
  pillTextActive: {
    color: '#fff',
  },
});
