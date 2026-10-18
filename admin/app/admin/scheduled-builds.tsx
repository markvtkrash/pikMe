import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import ScheduledBuildsPanel from '../../src/components/common/ScheduledBuildsPanel';

// Admin dashboard -> Tools -> Scheduled Builds: how menus are built on a schedule, kept apart for franchises
// (one shared menu each) and independent restaurants (one menu per restaurant a customer opened).
export default function AdminScheduledBuildsScreen() {
  const router = useRouter();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={styles.flex1}>
          <Text style={styles.title}>Scheduled Builds</Text>
          <Text style={styles.subtitle}>
            Menus are built automatically every 30 minutes. Set how many each run builds, or start a build right now.
          </Text>
        </View>
        <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/admin/reports/menu-health' as any)} accessibilityRole="button">
          <Text style={styles.linkBtnText}>Menu Data Health</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/admin/crawl-cities' as any)} accessibilityRole="button">
          <Text style={styles.linkBtnText}>City Imports</Text>
        </TouchableOpacity>
      </View>
      <View>
        <ScheduledBuildsPanel standalone />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap' },
  flex1: { flex: 1, minWidth: 240 },
  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', lineHeight: 18 },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#ECEFF1', borderWidth: 1.5, borderColor: '#1565C0' },
  linkBtnText: { fontSize: 13, fontWeight: '800', color: '#1565C0' },
});
