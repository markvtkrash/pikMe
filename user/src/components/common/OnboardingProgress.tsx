import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  step: number;
  total?: number;
  showBack?: boolean;
}

export function OnboardingProgress({ step, total = 6, showBack = true }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 44 }]}>
      {showBack ? (
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.backBtn} />
      )}

      <View style={styles.dotsRow}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < step ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>

      <Text style={styles.label}>{step}/{total}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#fff',
  },
  backBtn: { width: 60 },
  backText: { fontSize: 17, color: '#1565C0', fontWeight: '500' },
  dotsRow: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: '#1565C0' },
  dotInactive: { backgroundColor: '#e0e0e0' },
  label: { width: 60, textAlign: 'right', fontSize: 12, color: '#999' },
});
