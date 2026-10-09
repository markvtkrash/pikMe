import { View, Text, StyleSheet } from 'react-native';
import {
  DATA_SOURCES_FOOTER, DATA_SOURCES_POINTS, DATA_SOURCES_TITLE, GOOGLE_RESULTS_ATTRIBUTION,
} from '../../utils/dataSourcesText';

// Tells an owner where their restaurant's information comes from. 'full' is the box on the sign-up screen;
// 'google' is the one-line "Powered by Google" caption shown with search results on the claim screen.
export function DataSourcesNotice({ variant = 'full' }: { variant?: 'full' | 'google' }) {
  if (variant === 'google') {
    return <Text style={styles.caption}>{GOOGLE_RESULTS_ATTRIBUTION}</Text>;
  }
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{DATA_SOURCES_TITLE}</Text>
      {DATA_SOURCES_POINTS.map((p) => (
        <Text key={p} style={styles.point}>• {p}</Text>
      ))}
      <Text style={styles.footer}>{DATA_SOURCES_FOOTER}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#F5F7FA', borderRadius: 10, padding: 12, marginTop: 16, borderWidth: 1, borderColor: '#E1E6EC' },
  title: { fontSize: 13, fontWeight: '800', color: '#333', marginBottom: 6 },
  point: { fontSize: 12, color: '#555', lineHeight: 17, marginBottom: 4 },
  footer: { fontSize: 11, color: '#888', marginTop: 4 },
  caption: { fontSize: 11, color: '#888', lineHeight: 15, marginHorizontal: 16, marginBottom: 6 },
});
