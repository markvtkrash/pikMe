import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { getTicketById, adminUpdateTicket, AdminSupportTicket, TicketStatus } from '../../../src/api/supportTickets';

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export default function AdminTicketDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ticket, setTicket] = useState<AdminSupportTicket | null>(null);
  const [status, setStatus] = useState<TicketStatus>('open');
  const [resolution, setResolution] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTicket();
  }, [id]);

  async function loadTicket() {
    if (!id) return;
    try {
      const data = await getTicketById(id);
      if (data) {
        setTicket(data);
        setStatus(data.status);
        setResolution(data.resolution || '');
      }
    } catch (error: any) {
      console.error('[admin-ticket-detail] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!ticket) return;
    setSaving(true);
    try {
      await adminUpdateTicket(ticket.id, status, resolution.trim());
      Alert.alert('Success', 'Ticket updated');
      router.push('/admin/tickets');
    } catch (error: any) {
      console.error('[admin-ticket-detail] Save error:', error);
      Alert.alert('Error', error.message || 'Failed to update ticket');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !ticket) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/admin/tickets')}>
          <Text style={styles.backBtnText}>← Back to Tickets</Text>
        </TouchableOpacity>

        <View style={[styles.typeBadge, ticket.ticket_type === 'owner' ? styles.typeBadgeOwner : styles.typeBadgeConsumer]}>
          <Text style={[styles.typeBadgeText, ticket.ticket_type === 'owner' ? styles.typeBadgeTextOwner : styles.typeBadgeTextConsumer]}>
            {ticket.ticket_type === 'owner' ? '🍽️ Owner Ticket' : '🙋 Consumer Ticket'}
          </Text>
        </View>

        <Text style={styles.title}>{ticket.subject}</Text>
        {ticket.ticket_type === 'owner' ? (
          <>
            <Text style={styles.meta}>
              {ticket.restaurant_owners?.business_name || 'Unknown owner'} ({ticket.restaurant_owners?.email || 'no email'})
            </Text>
            <Text style={styles.meta}>{ticket.restaurants?.name || 'Unknown restaurant'}</Text>
          </>
        ) : (
          <Text style={styles.meta}>{ticket.user_profiles?.display_name || 'Unknown consumer'}</Text>
        )}
        <Text style={styles.date}>
          Submitted {new Date(ticket.created_at).toLocaleString()}
        </Text>

        <View style={styles.messageBox}>
          <Text style={styles.messageLabel}>Message</Text>
          <Text style={styles.messageText}>{ticket.message}</Text>
        </View>

        <Text style={styles.label}>Status</Text>
        <View style={styles.statusGrid}>
          {STATUS_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.statusBtn, status === option.value && styles.statusBtnActive]}
              onPress={() => setStatus(option.value)}
            >
              <Text style={[styles.statusBtnText, status === option.value && styles.statusBtnTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Resolution</Text>
        <TextInput
          style={styles.resolutionInput}
          placeholder="Describe how this was resolved..."
          placeholderTextColor="#999"
          value={resolution}
          onChangeText={setResolution}
          multiline
          numberOfLines={6}
          editable={!saving}
        />
        <Text style={styles.hint}>
          The owner will see this on their dashboard once you set the status to Resolved.
        </Text>

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' },

  backBtn: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, backgroundColor: '#E3F2FD', marginBottom: 16 },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#1565C0' },

  typeBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginBottom: 10 },
  typeBadgeOwner: { backgroundColor: '#F3E5F5' },
  typeBadgeConsumer: { backgroundColor: '#E1F5FE' },
  typeBadgeText: { fontSize: 11, fontWeight: '800' },
  typeBadgeTextOwner: { color: '#8E24AA' },
  typeBadgeTextConsumer: { color: '#0277BD' },

  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 6 },
  meta: { fontSize: 13, color: '#666', marginBottom: 2 },
  date: { fontSize: 12, color: '#999', marginTop: 4, marginBottom: 16 },

  messageBox: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#e0e0e0' },
  messageLabel: { fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  messageText: { fontSize: 14, color: '#222', lineHeight: 20 },

  label: { fontSize: 14, fontWeight: '700', color: '#222', marginBottom: 8, marginTop: 4 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  statusBtn: {
    flex: 1, minWidth: '46%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8,
    borderWidth: 2, borderColor: '#ddd', backgroundColor: '#fff', alignItems: 'center',
  },
  statusBtnActive: { borderColor: '#1565C0', backgroundColor: '#E3F2FD' },
  statusBtnText: { fontSize: 13, fontWeight: '600', color: '#666' },
  statusBtnTextActive: { color: '#1565C0' },

  resolutionInput: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#222',
    minHeight: 120, textAlignVertical: 'top', marginBottom: 8,
  },
  hint: { fontSize: 12, color: '#999', marginBottom: 20 },

  saveBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
