import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_COLORS } from '../../constants/brandTheme';

export function AppModeSwitcher() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();

  // segments under this layout look like ['(main)', '(tabs)', ...] or ['(main)', 'entertainment']
  const isEntertainment = (segments as string[])[1] === 'entertainment';

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      <View style={styles.pillContainer}>
        <TouchableOpacity
          style={[styles.pill, !isEntertainment && styles.pillActive]}
          onPress={() => router.replace('/(main)/(tabs)')}
          activeOpacity={0.85}
        >
          <Text style={[styles.pillText, !isEntertainment && styles.pillTextActive]}>🍽️ Food</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, isEntertainment && styles.pillActive]}
          onPress={() => router.replace('/(main)/entertainment')}
          activeOpacity={0.85}
        >
          <Text style={[styles.pillText, isEntertainment && styles.pillTextActive]}>🎮 Entertainment</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
    paddingBottom: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  pillContainer: {
    flexDirection: 'row',
    backgroundColor: '#F6F6F6',
    borderRadius: 20,
    padding: 4,
    gap: 4,
  },
  pill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: BRAND_COLORS.primary,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B6B6B',
  },
  pillTextActive: {
    color: '#fff',
  },
});
