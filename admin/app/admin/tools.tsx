import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ADMIN_TOOLS } from '../../src/utils/adminTools';

// Admin dashboard -> Tools: one page that links to the admin's behind-the-scenes tools.
// Add a tool in src/utils/adminTools.ts and it appears here.
export default function AdminToolsScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Tools</Text>
      <Text style={styles.subtitle}>Pick a tool</Text>

      <View style={styles.grid}>
        {ADMIN_TOOLS.map((tool) => (
          <TouchableOpacity
            key={tool.key}
            style={[styles.card, { backgroundColor: tool.bg }]}
            onPress={() => router.push(tool.href as any)}
            accessibilityRole="button"
          >
            <Text style={styles.cardIcon}>{tool.icon}</Text>
            <Text style={[styles.cardTitle, { color: tool.color }]}>{tool.title}</Text>
            <Text style={styles.cardSubtitle}>{tool.subtitle}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '48%', minWidth: 160, borderRadius: 14, padding: 16, gap: 6, elevation: 1 },
  cardIcon: { fontSize: 26 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSubtitle: { fontSize: 12, color: '#666', lineHeight: 17 },
});
