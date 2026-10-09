import { View, Text, StyleSheet, ScrollView } from 'react-native';
import ScheduledBuildsPanel from '../../src/components/common/ScheduledBuildsPanel';

// Admin dashboard -> Tools -> Scheduled Builds: how menus are built on a schedule, kept apart for franchises
// (one shared menu each) and independent restaurants (one menu per restaurant a customer opened).
export default function AdminScheduledBuildsScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Scheduled Builds</Text>
      <Text style={styles.subtitle}>
        Menus are built automatically every 30 minutes. Set how many each run builds, or start a build right now.
      </Text>
      <View>
        <ScheduledBuildsPanel standalone />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16, lineHeight: 18 },
});
