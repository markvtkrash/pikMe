import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingProgress } from '../../src/components/common/OnboardingProgress';
import { TopContinue, ContinueBar } from '../../src/components/common/OnboardingActions';
import { useUserProfileStore } from '../../src/store/userProfileStore';
import { CUISINE_OPTIONS } from '../../src/constants/dietaryOptions';
import { useThemedStyles } from '../../src/theme/useTheme';

export default function CuisinePrefsScreen() {
  const styles = useThemedStyles(baseStyles);
  const router = useRouter();
  const { draft, updateDraft } = useUserProfileStore();
  const [selected, setSelected] = useState<string[]>(draft.cuisinePreferences);

  function toggle(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function handleContinue() {
    updateDraft({ cuisinePreferences: selected });
    router.push('/(onboarding)/location-permission');
  }

  return (
    <View style={styles.container}>
      <OnboardingProgress step={4} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Cuisine Preferences</Text>
          <TopContinue onPress={handleContinue} label={selected.length === 0 ? 'Skip →' : 'Next →'} />
        </View>
        <Text style={styles.subtitle}>
          What cuisines do you love?{' '}
          <Text style={styles.optional}>(select any)</Text>
        </Text>

        <View style={styles.grid}>
          {CUISINE_OPTIONS.map((item) => {
            const isSelected = selected.includes(item.value);
            return (
              <TouchableOpacity
                key={item.value}
                style={[styles.card, isSelected && styles.cardSelected]}
                onPress={() => toggle(item.value)}
              >
                <Text style={styles.emoji}>{item.emoji}</Text>
                <Text style={[styles.label, isSelected && styles.labelSelected]}>
                  {item.label}
                </Text>
                {isSelected && <View style={styles.checkDot} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
      <ContinueBar onPress={handleContinue} label={selected.length === 0 ? 'Skip, continue →' : `Continue with ${selected.length} selected →`} />
    </View>
  );
}

const baseStyles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '700', color: '#222', marginBottom: 6, marginTop: 8 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 18 },
  optional: { color: '#aaa', fontStyle: 'italic' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  card: {
    width: '47%',
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
  },
  cardSelected: { borderColor: '#1565C0', backgroundColor: '#f0faf0' },
  emoji: { fontSize: 32 },
  label: { fontSize: 14, fontWeight: '500', color: '#555' },
  labelSelected: { color: '#1565C0', fontWeight: '600' },
  checkDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1565C0',
  },
  button: {
    backgroundColor: '#1565C0',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
