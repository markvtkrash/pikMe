import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getCouponStatusSnapshot, CouponStatusSnapshot } from '../../../src/api/reports';

export default function AdminCouponStatusReport() {
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<CouponStatusSnapshot | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      const data = await getCouponStatusSnapshot();
      setSnapshot(data);
    } catch (error: any) {
      console.error('[admin-coupon-status-report] Load error:', error);
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
      <Text style={styles.title}>🎟️ Coupon Status</Text>
      <Text style={styles.subtitle}>Active, inactive, expired, and orphaned right now — across all restaurants</Text>

      <View style={styles.snapshotRow}>
        <View style={[styles.snapshotBox, styles.snapshotBoxActive]}>
          <Text style={styles.snapshotNumber}>{snapshot?.active_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Active</Text>
        </View>
        <View style={styles.snapshotBox}>
          <Text style={styles.snapshotNumber}>{snapshot?.inactive_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Inactive</Text>
        </View>
        <View style={styles.snapshotBox}>
          <Text style={styles.snapshotNumber}>{snapshot?.expired_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Expired</Text>
        </View>
        <View style={[styles.snapshotBox, styles.snapshotBoxOrphaned]}>
          <Text style={styles.snapshotNumber}>{snapshot?.orphaned_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Orphaned</Text>
        </View>
      </View>
      <Text style={styles.hint}>A coupon can be in more than one of these at once (e.g. active and orphaned).</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#E65100', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  snapshotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  snapshotBox: {
    flex: 1, minWidth: 90, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', elevation: 1,
  },
  snapshotBoxActive: { backgroundColor: '#E8F5E9' },
  snapshotBoxOrphaned: { backgroundColor: '#FFF3E0' },
  snapshotNumber: { fontSize: 24, fontWeight: '800', color: '#222' },
  snapshotLabel: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 4 },

  hint: { fontSize: 11, color: '#999', marginTop: 10 },
});
