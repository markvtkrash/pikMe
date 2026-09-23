import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getOwnerStatusSnapshot, getOwnersNeedingAttention,
  OwnerStatusSnapshot, OwnerNeedingAttention,
} from '../../../src/api/reports';

export default function AdminOwnerEngagementReport() {
  const [loading, setLoading] = useState(true);
  const [ownerSnapshot, setOwnerSnapshot] = useState<OwnerStatusSnapshot | null>(null);
  const [needingAttention, setNeedingAttention] = useState<OwnerNeedingAttention[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      const [ownerStat, attention] = await Promise.all([
        getOwnerStatusSnapshot(),
        getOwnersNeedingAttention(),
      ]);
      setOwnerSnapshot(ownerStat);
      setNeedingAttention(attention);
    } catch (error: any) {
      console.error('[admin-owner-engagement-report] Load error:', error);
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
      <Text style={styles.title}>👤 Owner Engagement</Text>
      <Text style={styles.subtitle}>Active/deactivated owners, plus who still needs a nudge</Text>

      <Text style={styles.sectionTitle}>Owner Status</Text>
      <View style={styles.snapshotRow}>
        <View style={[styles.snapshotBox, styles.snapshotBoxActive]}>
          <Text style={styles.snapshotNumber}>{ownerSnapshot?.active_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Active</Text>
        </View>
        <View style={styles.snapshotBox}>
          <Text style={styles.snapshotNumber}>{ownerSnapshot?.inactive_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Deactivated</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Owners Needing Attention</Text>
      <Text style={styles.hint}>Approved, but zero coupons and/or zero verified menu items.</Text>
      <View style={styles.card}>
        {needingAttention.length === 0 ? (
          <Text style={styles.emptyText}>Every approved owner has coupons and verified items</Text>
        ) : (
          needingAttention.map((o) => (
            <View key={o.owner_id} style={styles.attentionRow}>
              <View style={styles.attentionInfo}>
                <Text style={styles.attentionRestaurant}>{o.restaurant_name}</Text>
                <Text style={styles.attentionOwner}>{o.business_name} · {o.email}</Text>
              </View>
              <View style={styles.attentionFlags}>
                {o.zero_coupons && (
                  <View style={styles.attentionBadge}>
                    <Text style={styles.attentionBadgeText}>0 coupons</Text>
                  </View>
                )}
                {o.zero_verified_items && (
                  <View style={styles.attentionBadge}>
                    <Text style={styles.attentionBadgeText}>0 verified items</Text>
                  </View>
                )}
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
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center', paddingBottom: 32 },
  title: { fontSize: 20, fontWeight: '800', color: '#8E24AA', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#222', paddingTop: 20, paddingBottom: 8 },
  hint: { fontSize: 11, color: '#999', marginTop: -4, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, elevation: 1 },
  emptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },

  snapshotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  snapshotBox: {
    flex: 1, minWidth: 90, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', elevation: 1,
  },
  snapshotBoxActive: { backgroundColor: '#E8F5E9' },
  snapshotNumber: { fontSize: 22, fontWeight: '800', color: '#222' },
  snapshotLabel: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },

  attentionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 10,
  },
  attentionInfo: { flex: 1, minWidth: 0 },
  attentionRestaurant: { fontSize: 14, fontWeight: '800', color: '#222' },
  attentionOwner: { fontSize: 12, color: '#888', marginTop: 2 },
  attentionFlags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  attentionBadge: { backgroundColor: '#FFF3E0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  attentionBadgeText: { fontSize: 11, fontWeight: '700', color: '#E65100' },
});
