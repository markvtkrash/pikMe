import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingProgress } from '../../src/components/common/OnboardingProgress';
import { useUserProfileStore } from '../../src/store/userProfileStore';

const COMMON_ALLERGENS = [
  'Shellfish', 'Peanuts', 'Tree Nuts', 'Dairy', 'Eggs', 'Soy', 'Wheat', 'Fish',
];

export default function AllergiesScreen() {
  const router = useRouter();
  const { draft, updateDraft } = useUserProfileStore();
  const [allergens, setAllergens] = useState<string[]>(draft.allergens);
  const [inputValue, setInputValue] = useState('');

  function addAllergen(value: string) {
    const trimmed = value.trim();
    if (!trimmed || allergens.map((a) => a.toLowerCase()).includes(trimmed.toLowerCase())) return;
    setAllergens((prev) => [...prev, trimmed]);
    setInputValue('');
  }

  function removeAllergen(value: string) {
    setAllergens((prev) => prev.filter((a) => a !== value));
  }

  function toggleCommon(value: string) {
    if (allergens.map((a) => a.toLowerCase()).includes(value.toLowerCase())) {
      setAllergens((prev) => prev.filter((a) => a.toLowerCase() !== value.toLowerCase()));
    } else {
      setAllergens((prev) => [...prev, value]);
    }
  }

  function handleContinue() {
    updateDraft({ allergens });
    router.push('/(onboarding)/cuisine-prefs');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <OnboardingProgress step={4} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Allergies & Intolerances</Text>
        <Text style={styles.subtitle}>We'll always filter these out for you</Text>

        <Text style={styles.sectionLabel}>Common allergens</Text>
        <View style={styles.commonRow}>
          {COMMON_ALLERGENS.map((allergen) => {
            const isSelected = allergens.map((a) => a.toLowerCase()).includes(allergen.toLowerCase());
            return (
              <TouchableOpacity
                key={allergen}
                style={[styles.commonChip, isSelected && styles.commonChipSelected]}
                onPress={() => toggleCommon(allergen)}
              >
                <Text style={[styles.commonChipText, isSelected && styles.commonChipTextSelected]}>
                  {allergen}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Add custom allergen</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="e.g. Sesame, Mustard..."
            placeholderTextColor="#bbb"
            value={inputValue}
            onChangeText={setInputValue}
            onSubmitEditing={() => addAllergen(inputValue)}
            returnKeyType="done"
          />
          <TouchableOpacity style={styles.addBtn} onPress={() => addAllergen(inputValue)}>
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        {allergens.length > 0 && (
          <View style={styles.selectedBox}>
            <Text style={styles.sectionLabel}>Your allergens ({allergens.length})</Text>
            <View style={styles.tagRow}>
              {allergens.map((allergen) => (
                <TouchableOpacity
                  key={allergen}
                  style={styles.tag}
                  onPress={() => removeAllergen(allergen)}
                >
                  <Text style={styles.tagText}>{allergen}</Text>
                  <Text style={styles.tagRemove}> ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, { marginTop: allergens.length > 0 ? 16 : 32 }]}
          onPress={handleContinue}
        >
          <Text style={styles.buttonText}>
            {allergens.length === 0 ? 'No allergies, continue →' : 'Continue →'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '700', color: '#222', marginBottom: 6, marginTop: 8 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 28 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  commonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 28 },
  commonChip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
  },
  commonChipSelected: { borderColor: '#e53e3e', backgroundColor: '#fff5f5' },
  commonChipText: { fontSize: 13, color: '#555', fontWeight: '500' },
  commonChipTextSelected: { color: '#c53030', fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: '#222',
  },
  addBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  selectedBox: { backgroundColor: '#fafafa', borderRadius: 12, padding: 14, marginBottom: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff0f0',
    borderRadius: 50,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  tagText: { fontSize: 13, color: '#c53030', fontWeight: '500' },
  tagRemove: { fontSize: 11, color: '#c53030' },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
