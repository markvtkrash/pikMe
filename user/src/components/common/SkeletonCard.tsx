import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';

function SkeletonBox({ width, height, style }: {
  width: number | string; height: number; style?: object;
}) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={[styles.box, { width: width as any, height, opacity }, style]}
    />
  );
}

export function SkeletonRestaurantCard() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SkeletonBox width="60%" height={16} />
        <SkeletonBox width={40} height={20} style={{ borderRadius: 6 }} />
      </View>
      <View style={[styles.row, { marginTop: 10 }]}>
        <SkeletonBox width={80} height={12} />
        <SkeletonBox width={60} height={12} />
        <SkeletonBox width={100} height={12} />
      </View>
    </View>
  );
}

export function SkeletonMenuCard() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SkeletonBox width={52} height={52} style={{ borderRadius: 26 }} />
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonBox width="70%" height={14} />
          <View style={styles.row}>
            <SkeletonBox width={60} height={12} />
            <SkeletonBox width={40} height={12} />
            <SkeletonBox width={40} height={12} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { backgroundColor: '#e0e0e0', borderRadius: 6 },
});
