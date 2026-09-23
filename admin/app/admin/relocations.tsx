import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import {
  adminListRelocationRequests, adminApproveRelocationRequest, adminRejectRelocationRequest,
  RelocationRequest,
} from '../../src/api/restaurantAuth';

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Admin session expired. Please log in again.');
  return token;
}

export default function AdminRelocationsScreen() {
  const [requests, setRequests] = useState<RelocationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RelocationRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadRequests();
    }, [])
  );

  async function loadRequests() {
    try {
      const data = await adminListRelocationRequests();
      setRequests(data);
    } catch (error: any) {
      console.error('[admin-relocations] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load relocation requests');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(request: RelocationRequest) {
    setBusyId(request.id);
    try {
      const accessToken = await getAccessToken();
      await adminApproveRelocationRequest({ requestId: request.id, accessToken });
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
      Alert.alert('Success', `${request.business_name}'s new location approved ✓`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to approve');
    } finally {
      setBusyId(null);
    }
  }

  function openReject(request: RelocationRequest) {
    setRejectTarget(request);
    setRejectNote('');
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      await adminRejectRelocationRequest(rejectTarget.id, rejectNote.trim() || undefined);
      setRequests((prev) => prev.filter((r) => r.id !== rejectTarget.id));
      setRejectTarget(null);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to reject');
    } finally {
      setRejecting(false);
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
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <View style={styles.header}>
          <Text style={styles.title}>Relocation Requests</Text>
          <Text style={styles.count}>{requests.length}</Text>
        </View>

        {requests.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={styles.emptyText}>All caught up!</Text>
            <Text style={styles.emptySubtext}>No pending relocation requests</Text>
          </View>
        ) : (
          <FlatList
            data={requests}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isBusy = busyId === item.id;
              return (
                <View style={styles.card}>
                  <Text style={styles.restaurantName}>{item.business_name}</Text>
                  <Text style={styles.ownerEmail}>{item.owner_email}</Text>

                  <View style={styles.addressRow}>
                    <View style={styles.addressCol}>
                      <Text style={styles.addressLabel}>Current</Text>
                      <Text style={styles.addressName}>{item.old_name}</Text>
                      <Text style={styles.addressText}>{item.old_address}</Text>
                    </View>
                    <Text style={styles.arrow}>→</Text>
                    <View style={styles.addressCol}>
                      <Text style={[styles.addressLabel, styles.addressLabelNew]}>New</Text>
                      <Text style={styles.addressName}>{item.new_name}</Text>
                      <Text style={styles.addressText}>{item.new_address}</Text>
                    </View>
                  </View>

                  <Text style={styles.requestedDate}>
                    Requested: {new Date(item.requested_at).toLocaleDateString()}
                  </Text>

                  <View style={styles.buttonGroup}>
                    <TouchableOpacity
                      style={[styles.rejectBtn, isBusy && styles.buttonDisabled]}
                      onPress={() => openReject(item)}
                      disabled={isBusy}
                    >
                      <Text style={styles.rejectBtnText}>✕ Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.approveBtn, isBusy && styles.buttonDisabled]}
                      onPress={() => handleApprove(item)}
                      disabled={isBusy}
                    >
                      {isBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.approveBtnText}>✓ Approve</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
            contentContainerStyle={styles.list}
          />
        )}
      </View>

      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject relocation request?</Text>
            <Text style={styles.modalHint}>{rejectTarget?.business_name} will stay at its current listing.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Reason (optional, shown to no one automatically yet)"
              placeholderTextColor="#999"
              value={rejectNote}
              onChangeText={setRejectNote}
              multiline
              editable={!rejecting}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setRejectTarget(null)} disabled={rejecting}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalRejectBtn} onPress={handleReject} disabled={rejecting}>
                {rejecting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalRejectBtnText}>Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 2 },
  title: { fontSize: 24, fontWeight: '800', color: '#222' },
  count: { fontSize: 18, fontWeight: '800', color: '#1565C0', backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, elevation: 1 },
  restaurantName: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 2 },
  ownerEmail: { fontSize: 12, color: '#999', marginBottom: 10 },

  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addressCol: { flex: 1, minWidth: 0 },
  addressLabel: { fontSize: 10, fontWeight: '800', color: '#999', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  addressLabelNew: { color: '#2e7d32' },
  addressName: { fontSize: 13, fontWeight: '700', color: '#222' },
  addressText: { fontSize: 12, color: '#666', marginTop: 1 },
  arrow: { fontSize: 18, color: '#999', fontWeight: '800' },

  requestedDate: { fontSize: 11, color: '#999', fontStyle: 'italic', marginTop: 10 },

  buttonGroup: { flexDirection: 'row', gap: 8, marginTop: 12 },
  rejectBtn: { flex: 1, backgroundColor: '#FFEBEE', borderWidth: 1, borderColor: '#c62828', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  approveBtn: { flex: 1, backgroundColor: '#4CAF50', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  rejectBtnText: { color: '#c62828', fontWeight: '700', fontSize: 13 },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  buttonDisabled: { opacity: 0.6 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
  emptySubtext: { fontSize: 13, color: '#999', marginTop: 4 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#222', marginBottom: 6 },
  modalHint: { fontSize: 13, color: '#888', marginBottom: 14 },
  modalInput: {
    backgroundColor: '#fafafa', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, color: '#222', borderWidth: 1, borderColor: '#e0e0e0', minHeight: 70, textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#F5F5F5' },
  modalCancelBtnText: { fontSize: 14, fontWeight: '700', color: '#666' },
  modalRejectBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#e53e3e' },
  modalRejectBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
