import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemedStyles } from '../../theme/useTheme';

// The Continue button of a setup screen, shown twice so nobody has to scroll for it: a small one beside the title, and a bar pinned to the
// bottom of the screen (outside the scrolling list).
export function TopContinue({ onPress, label = 'Next →' }: { onPress: () => void; label?: string }) {
  const styles = useThemedStyles(baseStyles);
  return (
    <TouchableOpacity style={styles.top} onPress={onPress} accessibilityRole="button" accessibilityLabel="Continue">
      <Text style={styles.topText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ContinueBar({ onPress, label }: { onPress: () => void; label: string }) {
  const styles = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <TouchableOpacity style={styles.button} onPress={onPress} accessibilityRole="button">
        <Text style={styles.buttonText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  top: { backgroundColor: '#1565C0', borderRadius: 20, paddingVertical: 7, paddingHorizontal: 16, alignSelf: 'center' },
  topText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  bar: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10, paddingHorizontal: 24 },
  button: { backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
