import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getAllTickets, AdminSupportTicket, TicketStatus } from '../../src/api/supportTickets';

type StatusFilter = 'all' | TicketStatus;

const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
];

const STATUS_COLORS: Record<TicketStatus, { bg: string; text: string; label: string }> = {
  open: { bg: '#E3F2FD', text: '#1976D2', label: 'Open' },
  in_progress: { bg: '#FFF3E0', text: '#E65100', label: 'In Progress' },
  resolved: { bg: '#E8F5E9', text: '#2e7d32', label: 'Resolved' },
  closed: { bg: '#f0f0f0', text: '#666', label: 'Closed' },
};

export default function AdminTicketsScreen() {
  const router = useRouter();
  const { status } = useLocalSearchParams<{ status?: string }>();
  const validKeys = FILTER_TABS.map((t) => t.key);
  const initialTab = validKeys.includes(status as StatusFilter) ? (status as StatusFilter) : 'all';
  const [activeTab, setActiveTab] = useState<StatusFilter>(initialTab);
  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadTickets();
    }, [])
  );

  async function loadTickets() {
    try {
      const data = await getAllTickets();
      setTickets(data);
    } catch (error: any) {
      console.error('[admin-tickets] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }

  const filteredTickets = tickets.filter((t) => activeTab === 'all' || t.status === activeTab);

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
        <Text style={styles.title}>Support Tickets</Text>
        <Text style={styles.count}>{tickets.length}</Text>
      </View>

      <View style={styles.tabsContainer}>
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filteredTickets.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>No tickets found</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTickets}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const statusInfo = STATUS_COLORS[item.status];
            return (
              <TouchableOpacity
                style={styles.ticketRow}
                onPress={() => router.push(`/admin/tickets/${item.id}`)}
              >
                <View style={styles.ticketInfo}>
                  <Text style={styles.ticketSubject} numberOfLines={1}>{item.subject}</Text>
                  <Text style={styles.ticketMeta}>
                    {item.restaurant_owners?.business_name || 'Unknown'} · {item.restaurants?.name || 'Unknown restaurant'}
                  </Text>
                  <Text style={styles.ticketDate}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                  <Text style={[styles.statusText, { color: statusInfo.text }]}>{statusInfo.label}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
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
  count: { fontSize: 18, fontWeight: '800', color: '#1565C0', backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },

  tabsContainer: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e0e0e0', backgroundColor: '#fff' },
  tab: { paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#1565C0' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#999' },
  tabTextActive: { color: '#1565C0' },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  ticketRow: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, elevation: 1 },
  ticketInfo: { flex: 1 },
  ticketSubject: { fontSize: 14, fontWeight: '700', color: '#222', marginBottom: 2 },
  ticketMeta: { fontSize: 12, color: '#1565C0', fontWeight: '600', marginBottom: 2 },
  ticketDate: { fontSize: 11, color: '#999' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
});
