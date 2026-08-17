import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { createSupportTicket, getMyTickets, SupportTicket, TicketStatus } from '../../src/api/supportTickets';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';

const STATUS_COLORS: Record<TicketStatus, { bg: string; text: string; label: string }> = {
  open: { bg: '#E3F2FD', text: '#1976D2', label: 'Open' },
  in_progress: { bg: '#FFF3E0', text: '#E65100', label: 'In Progress' },
  resolved: { bg: '#E8F5E9', text: '#2e7d32', label: 'Resolved' },
  closed: { bg: '#f0f0f0', text: '#666', label: 'Closed' },
};

export default function SupportScreen() {
  const router = useRouter();
  const { owner, restaurant } = useRestaurantOwnerStore();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadTickets();
    }, [])
  );

  async function loadTickets() {
    try {
      const data = await getMyTickets();
      setTickets(data);
    } catch (error: any) {
      console.error('[support] Load error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!restaurant || !owner) return;
    if (!subject.trim() || !message.trim()) {
      Alert.alert('Error', 'Please fill in both subject and message');
      return;
    }

    setSubmitting(true);
    try {
      await createSupportTicket({
        restaurantId: restaurant.id,
        ownerId: owner.id,
        subject: subject.trim(),
        message: message.trim(),
      });
      setSubject('');
      setMessage('');
      await loadTickets();
      Alert.alert('Success', 'Support ticket submitted! We\'ll get back to you soon.');
    } catch (error: any) {
      console.error('[support] Submit error:', error);
      Alert.alert('Error', error.message || 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  }

  if (!owner || !restaurant) return null;

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Support</Text>
          <Text style={styles.subtitle}>Have an issue? Send us a message.</Text>
        </View>
      </View>

      <FlatList
        data={tickets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>New Ticket</Text>
            <TextInput
              style={styles.input}
              placeholder="Subject"
              placeholderTextColor="#999"
              value={subject}
              onChangeText={setSubject}
              editable={!submitting}
            />
            <TextInput
              style={[styles.input, styles.messageInput]}
              placeholder="Describe your issue..."
              placeholderTextColor="#999"
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={4}
              editable={!submitting}
            />
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>Submit Ticket</Text>}
            </TouchableOpacity>

            <Text style={styles.historyTitle}>Your Tickets</Text>
            {loading && <ActivityIndicator color="#4CAF50" style={{ marginTop: 12 }} />}
            {!loading && tickets.length === 0 && (
              <Text style={styles.emptyText}>No support tickets yet</Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const statusInfo = STATUS_COLORS[item.status];
          const expanded = expandedId === item.id;
          return (
            <TouchableOpacity
              style={styles.ticketCard}
              onPress={() => setExpandedId(expanded ? null : item.id)}
            >
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketSubject} numberOfLines={expanded ? undefined : 1}>
                  {item.subject}
                </Text>
                <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                  <Text style={[styles.statusText, { color: statusInfo.text }]}>{statusInfo.label}</Text>
                </View>
              </View>
              <Text style={styles.ticketDate}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>
              {expanded && (
                <View style={styles.expandedContent}>
                  <Text style={styles.ticketMessage}>{item.message}</Text>
                  {item.resolution && (
                    <View style={styles.resolutionBox}>
                      <Text style={styles.resolutionLabel}>Resolution</Text>
                      <Text style={styles.resolutionText}>{item.resolution}</Text>
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666' },

  list: { padding: 16 },
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, elevation: 1 },
  formTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 12 },
  input: {
    backgroundColor: '#f6f6f6', borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#222', marginBottom: 10,
  },
  messageInput: { minHeight: 90, textAlignVertical: 'top' },
  submitBtn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  historyTitle: { fontSize: 14, fontWeight: '800', color: '#222', marginTop: 20, marginBottom: 4 },
  emptyText: { fontSize: 13, color: '#999', marginTop: 8 },

  ticketCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, elevation: 1 },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  ticketSubject: { flex: 1, fontSize: 14, fontWeight: '700', color: '#222' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  ticketDate: { fontSize: 11, color: '#999', marginTop: 4 },

  expandedContent: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  ticketMessage: { fontSize: 13, color: '#444', lineHeight: 19 },
  resolutionBox: { backgroundColor: '#E8F5E9', borderRadius: 8, padding: 10, marginTop: 10 },
  resolutionLabel: { fontSize: 11, fontWeight: '800', color: '#2e7d32', textTransform: 'uppercase', marginBottom: 4 },
  resolutionText: { fontSize: 13, color: '#2e7d32', lineHeight: 18 },
});
