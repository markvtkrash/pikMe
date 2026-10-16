import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRestaurantStore } from '../../store/restaurantStore';
import { BRAND_COLORS } from '../../constants/brandTheme';
import { useMaxRadiusMiles } from '../../hooks/useMaxRadiusMiles';
import { useThemedStyles } from '../../theme/useTheme';

const METERS_PER_MILE = 1609.34;

// compact: one line that scrolls sideways when the pills do not fit (the Explore header, where height is precious). Default: pills wrap, as before.
export function RadiusSelector({ compact = false }: { compact?: boolean } = {}) {
  const styles = useThemedStyles(baseStyles);
  const searchRadiusMeters = useRestaurantStore((s) => s.searchRadiusMeters);
  const setSearchRadiusMeters = useRestaurantStore((s) => s.setSearchRadiusMeters);
  const selectedMiles = Math.round(searchRadiusMeters / METERS_PER_MILE);
  const { data: maxRadiusMiles = 6 } = useMaxRadiusMiles();
  // 1, 2, ..., maxRadiusMiles — pulled live from app_config so this can
  // never offer a distance the server hasn't actually fetched (see
  // useMaxRadiusMiles.ts).
  const radiusOptionsMiles = Array.from({ length: maxRadiusMiles }, (_, i) => i + 1);

  const pills = radiusOptionsMiles.map((mi) => {
    const active = mi === selectedMiles;
    return (
      <TouchableOpacity
        key={mi}
        style={[styles.pill, compact && styles.pillCompact, active && styles.pillActive]}
        onPress={() => setSearchRadiusMeters(mi * METERS_PER_MILE)}
        activeOpacity={0.85}
      >
        <Text style={[styles.pillText, active && styles.pillTextActive]}>{mi} mi</Text>
      </TouchableOpacity>
    );
  });

  if (compact) {
    return (
      <View style={styles.rowCompact}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsCompact}
          style={styles.scroll}
          accessibilityLabel="Distance"
        >
          {pills}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Text style={styles.label}>Distance</Text>
      <View style={styles.pills}>{pills}</View>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  rowCompact: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingBottom: 6, gap: 8 },
  scroll: { flex: 1 },
  pillsCompact: { flexDirection: 'row', gap: 6, paddingRight: 16 },
  pillCompact: { paddingVertical: 4, paddingHorizontal: 9 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flex: 1,
    gap: 6,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    // a clear blue outline on a white pill, so each distance reads as a button
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: BRAND_COLORS.primary,
  },
  pillActive: {
    backgroundColor: BRAND_COLORS.primary,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: BRAND_COLORS.primary,
  },
  pillTextActive: {
    color: '#fff',
  },
});
