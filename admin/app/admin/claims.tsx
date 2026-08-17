import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../../src/api/supabase';

interface PendingClaim {
  restaurant_id: string;
  google_place_id: string;
  name: string;
  address: string;
  owner_email: string;
  business_name: string;
  claimed_at: string;
  status: string;
}

export default function AdminClaimsScreen() {
  const router = useRouter();
  const [claims, setClaims] = useState<PendingClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadClaims();
    }, [])
  );

  async function loadClaims() {
    try {
      // TEMP DEBUG — remove once the "Only admins can view claims" session
      // mismatch is diagnosed. Shows exactly who the client thinks is signed
      // in right before the RPC call that's rejecting them.
      const { data: authData, error: authError } = await supabase.auth.getUser();
      console.log('[admin-claims] [debug] current session user:', authData?.user?.id, authData?.user?.email, 'authError:', authError);

      const { data, error } = await supabase.rpc('get_pending_claims');
      if (error) throw error;
      setClaims(data || []);
    } catch (error: any) {
      console.error('[admin-claims] Load error:', error);
      Alert.alert('Error', 'Failed to load claims');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(restaurantId: string, restaurantName: string) {
    setApproving(restaurantId);
    try {
      console.log('[admin-claims] Approving restaurant:', restaurantId);
      const { data, error } = await supabase.rpc('approve_restaurant_claim', {
        p_restaurant_id: restaurantId,
      });

      if (error) {
        console.error('[admin-claims] Approve error:', error);
        throw error;
      }

      console.log('[admin-claims] Approved successfully:', data);

      // Remove from list immediately for better UX
      setClaims(claims.filter(c => c.restaurant_id !== restaurantId));

      Alert.alert('Success', `${restaurantName} approved! ✓`);
    } catch (error: any) {
      console.error('[admin-claims] Approve catch:', error);
      Alert.alert('Error', error.message || 'Failed to approve');
      // Reload to ensure fresh state
      loadClaims();
    } finally {
      setApproving(null);
    }
  }

  async function handleReject(restaurantId: string, restaurantName: string) {
    Alert.alert(
      'Reject Claim?',
      `Are you sure you want to reject ${restaurantName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log('[admin-claims] Rejecting restaurant:', restaurantId);
              const { data, error } = await supabase.rpc('reject_restaurant_claim', {
                p_restaurant_id: restaurantId,
              });
              if (error) {
                console.error('[admin-claims] Reject error:', error);
                throw error;
              }

              console.log('[admin-claims] Rejected successfully:', data);

              // Remove from list immediately
              setClaims(claims.filter(c => c.restaurant_id !== restaurantId));

              Alert.alert('Rejected', `${restaurantName} rejected ✕`);
            } catch (error: any) {
              console.error('[admin-claims] Reject catch:', error);
              Alert.alert('Error', error.message || 'Failed to reject');
              loadClaims();
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <Text style={styles.title}>Pending Claims</Text>
        <Text style={styles.count}>{claims.length}</Text>
      </View>

      {claims.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>✓</Text>
          <Text style={styles.emptyText}>All caught up!</Text>
          <Text style={styles.emptySubtext}>No pending claims</Text>
        </View>
      ) : (
        <FlatList
          data={claims}
          keyExtractor={(item) => item.restaurant_id}
          renderItem={({ item }) => (
            <View style={styles.claimCard}>
              <View style={styles.claimInfo}>
                <Text style={styles.restaurantName}>{item.name}</Text>
                <Text style={styles.address}>{item.address}</Text>
                <View style={styles.ownerInfo}>
                  <Text style={styles.ownerLabel}>Owner:</Text>
                  <Text style={styles.ownerName}>{item.business_name}</Text>
                  <Text style={styles.ownerEmail}>({item.owner_email})</Text>
                </View>
                <Text style={styles.claimedDate}>
                  Claimed: {new Date(item.claimed_at).toLocaleDateString()}
                </Text>
              </View>

              <View style={styles.buttonGroup}>
                <TouchableOpacity
                  style={[styles.rejectBtn, approving === item.restaurant_id && styles.buttonDisabled]}
                  onPress={() => handleReject(item.restaurant_id, item.name)}
                  disabled={approving === item.restaurant_id}
                >
                  <Text style={styles.rejectBtnText}>✕ Reject</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.approveBtn, approving === item.restaurant_id && styles.buttonDisabled]}
                  onPress={() => handleApprove(item.restaurant_id, item.name)}
                  disabled={approving === item.restaurant_id}
                >
                  {approving === item.restaurant_id ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.approveBtnText}>✓ Approve</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 2 },
  title: { fontSize: 24, fontWeight: '800', color: '#222' },
  count: { fontSize: 18, fontWeight: '800', color: '#4CAF50', backgroundColor: '#E8F5E9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  claimCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, elevation: 1 },
  claimInfo: { marginBottom: 12 },
  restaurantName: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 4 },
  address: { fontSize: 13, color: '#666', marginBottom: 8 },
  ownerInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  ownerLabel: { fontSize: 12, fontWeight: '600', color: '#999' },
  ownerName: { fontSize: 12, fontWeight: '700', color: '#222' },
  ownerEmail: { fontSize: 11, color: '#999' },
  claimedDate: { fontSize: 11, color: '#999', fontStyle: 'italic' },

  buttonGroup: { flexDirection: 'row', gap: 8 },
  rejectBtn: { flex: 1, backgroundColor: '#FFEBEE', borderWidth: 1, borderColor: '#c62828', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  approveBtn: { flex: 1, backgroundColor: '#4CAF50', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  rejectBtnText: { color: '#c62828', fontWeight: '700', fontSize: 13 },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  buttonDisabled: { opacity: 0.6 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
  emptySubtext: { fontSize: 13, color: '#999', marginTop: 4 },
});
