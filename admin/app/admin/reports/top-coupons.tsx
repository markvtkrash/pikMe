import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getTopCoupons, TopCouponRow } from '../../../src/api/reports';

export default function AdminTopCouponsReport() {
  const [loading, setLoading] = useState(true);
  const [topCoupons, setTopCoupons] = useState<TopCouponRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      const data = await getTopCoupons(10);
      setTopCoupons(data);
    } catch (error: any) {
      console.error('[admin-top-coupons-report] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>🏆 Top Coupons</Text>
      <Text style={styles.subtitle}>Ranked by redemption count, across all restaurants</Text>

      <View style={styles.card}>
        {topCoupons.length === 0 ? (
          <Text style={styles.emptyText}>No coupons yet</Text>
        ) : (
          topCoupons.map((c) => (
            <View key={c.coupon_id} style={styles.topCouponRow}>
              <View style={styles.topCouponInfo}>
                <Text style={styles.topCouponCode}>{c.coupon_code}</Text>
                <Text style={styles.topCouponRestaurant}>{c.restaurant_name}</Text>
                <Text style={styles.topCouponUsage}>
                  Used {c.times_used}{c.usage_limit ? `/${c.usage_limit}` : ' (no limit)'}
                </Text>
              </View>
              <View style={styles.topCouponStats}>
                <Text style={styles.topCouponRedemptions}>{c.redemption_count}</Text>
                <Text style={styles.topCouponRedemptionsLabel}>redemptions</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#2e7d32', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, elevation: 1 },
  emptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },

  topCouponRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  topCouponInfo: { flex: 1, minWidth: 0 },
  topCouponCode: { fontSize: 14, fontWeight: '800', color: '#222' },
  topCouponRestaurant: { fontSize: 12, color: '#888', marginTop: 2 },
  topCouponUsage: { fontSize: 11, color: '#aaa', marginTop: 2 },
  topCouponStats: { alignItems: 'flex-end' },
  topCouponRedemptions: { fontSize: 16, fontWeight: '800', color: '#1565C0' },
  topCouponRedemptionsLabel: { fontSize: 10, color: '#999' },
});
