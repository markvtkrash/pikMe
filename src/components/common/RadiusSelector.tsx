import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRestaurantStore } from '../../store/restaurantStore';
import { BRAND_COLORS } from '../../constants/brandTheme';
import { RADIUS_OPTIONS_KM } from '../../constants/searchRadius';

export function RadiusSelector() {
  const searchRadiusMeters = useRestaurantStore((s) => s.searchRadiusMeters);
  const setSearchRadiusMeters = useRestaurantStore((s) => s.setSearchRadiusMeters);
  const selectedKm = searchRadiusMeters / 1000;

  return (
    <View style={styles.row}>
      <Text style={styles.label}>Distance</Text>
      <View style={styles.pills}>
        {RADIUS_OPTIONS_KM.map((km) => {
          const active = km === selectedKm;
          return (
            <TouchableOpacity
              key={km}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => setSearchRadiusMeters(km * 1000)}
              activeOpacity={0.85}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{km} km</Text>
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
