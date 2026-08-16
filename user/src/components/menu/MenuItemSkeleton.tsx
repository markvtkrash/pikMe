import { View, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';

export function MenuItemSkeleton() {
  const shimmerOpacity = useSharedValue(0.5);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: shimmerOpacity.value,
  }));

  useEffect(() => {
    shimmerOpacity.value = withRepeat(
      withTiming(1, { duration: 800 }),
      -1,
      true
    );
  }, [shimmerOpacity]);

  return (
    <View style={styles.card}>
      {/* Header skeleton */}
      <View style={styles.headerRow}>
        <Animated.View style={[styles.scoreBadgeSkeleton, shimmerStyle]} />
        <View style={{ flex: 1, gap: 8 }}>
          <Animated.View style={[styles.lineSkeleton, { height: 16 }, shimmerStyle]} />
          <Animated.View style={[styles.lineSkeleton, { height: 12, width: '70%' }, shimmerStyle]} />
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Macros skeleton */}
      <View style={styles.macroRow}>
        <Animated.View style={[styles.caloriesSkeleton, shimmerStyle]} />
        <View style={styles.macroDivider} />
        <View style={{ flex: 1, gap: 8 }}>
          {[1, 2, 3, 4].map((i) => (
            <Animated.View key={i} style={[styles.lineSkeleton, { height: 12 }, shimmerStyle]} />
          ))}
        </View>
      </View>

      {/* Chips skeleton */}
      <View style={styles.chipRowSkeleton}>
        <Animated.View style={[styles.chipSkeleton, shimmerStyle]} />
        <Animated.View style={[styles.chipSkeleton, shimmerStyle]} />
      </View>

      {/* Button skeleton */}
      <Animated.View style={[styles.buttonSkeleton, shimmerStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    elevation: 3,
  },
  headerRow: { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' },
  scoreBadgeSkeleton: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#E8E8E8',
    flexShrink: 0,
  },
  lineSkeleton: {
    backgroundColor: '#E8E8E8',
    borderRadius: 6,
  },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 12 },
  macroRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  caloriesSkeleton: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#E8E8E8',
  },
  macroDivider: { width: 1, backgroundColor: '#F0F0F0' },
  chipRowSkeleton: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chipSkeleton: {
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E8E8E8',
    flex: 1,
  },
  buttonSkeleton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#E8E8E8',
  },
});
