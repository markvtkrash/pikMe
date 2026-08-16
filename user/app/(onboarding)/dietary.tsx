import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingProgress } from '../../src/components/common/OnboardingProgress';
import { useUserProfileStore } from '../../src/store/userProfileStore';
import { DIETARY_RESTRICTIONS } from '../../src/constants/dietaryOptions';

export default function DietaryScreen() {
  const router = useRouter();
  const { draft, updateDraft } = useUserProfileStore();
  const [selected, setSelected] = useState<string[]>(draft.dietaryRestrictions);

  function toggle(value: string) {
    if (value === 'none') {
      setSelected(['none']);
      return;
    }
    setSelected((prev) => {
      const without = prev.filter((v) => v !== 'none');
      return without.includes(value)
        ? without.filter((v) => v !== value)
        : [...without, value];
    });
  }

  function handleContinue() {
    updateDraft({ dietaryRestrictions: selected });
    router.push('/(onboarding)/health-goals');
  }

  return (
    <View style={styles.container}>
      <OnboardingProgress step={2} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Dietary Restrictions</Text>
        <Text style={styles.subtitle}>Select all that apply</Text>

        <View style={styles.grid}>
          {DIETARY_RESTRICTIONS.map((item) => {
            const isSelected = selected.includes(item.value);
            return (
              <TouchableOpacity
                key={item.value}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => toggle(item.value)}
              >
                <Text style={styles.chipEmoji}>{item.icon}</Text>
                <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.button} onPress={handleContinue}>
          <Text style={styles.buttonText}>Continue →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '700', color: '#222', marginBottom: 6, marginTop: 8 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 36 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  chipSelected: { borderColor: '#4CAF50', backgroundColor: '#f0faf0' },
  chipEmoji: { fontSize: 18 },
  chipLabel: { fontSize: 14, color: '#555', fontWeight: '500' },
  chipLabelSelected: { color: '#2e7d32', fontWeight: '600' },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
