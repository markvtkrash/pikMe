import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ADMIN_TOOLS } from '../../src/utils/adminTools';
import { AppIcon } from '../../src/components/common/AppIcon';

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
            style={[styles.card, { backgroundColor: tool.bg, borderColor: tool.color }]}
            onPress={() => router.push(tool.href as any)}
            accessibilityRole="button"
          >
            <View style={styles.cardTop}>
              <View style={[styles.badge, { backgroundColor: tool.color }]}>
                <AppIcon emoji={tool.icon} size={16} color="#fff" />
              </View>
              <Text style={[styles.cardTitle, { color: tool.color }]} numberOfLines={2}>{tool.title}</Text>
            </View>
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
  subtitle: { fontSize: 13, color: '#546E7A', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: '48.8%', minWidth: 240, minHeight: 92, borderRadius: 12, borderWidth: 2, padding: 12, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  cardSubtitle: { fontSize: 12, color: '#37474F', lineHeight: 16 },
});
