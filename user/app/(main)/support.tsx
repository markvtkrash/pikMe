import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createSupportTicket, getMyTickets, SupportTicket, TicketStatus } from '../../src/api/supportTickets';
import { useUserProfile } from '../../src/hooks/useUserProfile';
import { BRAND_COLORS } from '../../src/constants/brandTheme';

const STATUS_COLORS: Record<TicketStatus, { bg: string; text: string; label: string }> = {
  open: { bg: '#E3F2FD', text: '#1976D2', label: 'Open' },
  in_progress: { bg: '#FFF3E0', text: BRAND_COLORS.warning, label: 'In Progress' },
  resolved: { bg: BRAND_COLORS.primaryLight, text: BRAND_COLORS.primary, label: 'Resolved' },
  closed: { bg: '#f0f0f0', text: '#666', label: 'Closed' },
};

export default function SupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: profile } = useUserProfile();
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
    if (!profile) return;
    if (!subject.trim() || !message.trim()) {
      Alert.alert('Error', 'Please fill in both subject and message');
      return;
    }

    setSubmitting(true);
    try {
      await createSupportTicket({
        consumerId: profile.id,
        subject: subject.trim(),
        message: message.trim(),
      });
      setSubject('');
      setMessage('');
      await loadTickets();
      Alert.alert('Success', "Support ticket submitted! We'll get back to you soon.");
    } catch (error: any) {
      console.error('[support] Submit error:', error);
      Alert.alert('Error', error.message || 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
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
            {loading && <ActivityIndicator color={BRAND_COLORS.primary} style={{ marginTop: 12 }} />}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND_COLORS.background.surface },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: BRAND_COLORS.background.overlay },
  backBtnText: { fontSize: 13, fontWeight: '600', color: BRAND_COLORS.error },
  title: { fontSize: 24, fontWeight: '800', color: BRAND_COLORS.text.primary, marginBottom: 2 },
  subtitle: { fontSize: 14, color: BRAND_COLORS.text.tertiary },

  list: { padding: 16 },
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, elevation: 1 },
  formTitle: { fontSize: 16, fontWeight: '800', color: BRAND_COLORS.text.primary, marginBottom: 12 },
  input: {
    backgroundColor: BRAND_COLORS.background.surface, borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: BRAND_COLORS.text.primary, marginBottom: 10,
  },
  messageInput: { minHeight: 90, textAlignVertical: 'top' },
  submitBtn: { backgroundColor: BRAND_COLORS.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  historyTitle: { fontSize: 14, fontWeight: '800', color: BRAND_COLORS.text.primary, marginTop: 20, marginBottom: 4 },
  emptyText: { fontSize: 13, color: BRAND_COLORS.text.tertiary, marginTop: 8 },

  ticketCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, elevation: 1 },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  ticketSubject: { flex: 1, fontSize: 14, fontWeight: '700', color: BRAND_COLORS.text.primary },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  ticketDate: { fontSize: 11, color: BRAND_COLORS.text.tertiary, marginTop: 4 },

  expandedContent: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: BRAND_COLORS.background.overlay },
  ticketMessage: { fontSize: 13, color: BRAND_COLORS.text.secondary, lineHeight: 19 },
  resolutionBox: { backgroundColor: BRAND_COLORS.primaryLight, borderRadius: 8, padding: 10, marginTop: 10 },
  resolutionLabel: { fontSize: 11, fontWeight: '800', color: BRAND_COLORS.primary, textTransform: 'uppercase', marginBottom: 4 },
  resolutionText: { fontSize: 13, color: BRAND_COLORS.primary, lineHeight: 18 },
});
