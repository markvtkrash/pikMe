import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingProgress } from '../../src/components/common/OnboardingProgress';
import { useUserProfileStore } from '../../src/store/userProfileStore';
import { HEALTH_GOALS } from '../../src/constants/dietaryOptions';

export default function HealthGoalsScreen() {
  const router = useRouter();
  const { draft, updateDraft } = useUserProfileStore();

  const [selected, setSelected] = useState<string[]>(draft.healthGoals);
  const [showTargets, setShowTargets] = useState(false);
  const [dailyCalories, setDailyCalories] = useState(
    draft.nutritionTargets.dailyCalories?.toString() ?? ''
  );
  const [maxMealCalories, setMaxMealCalories] = useState(
    draft.nutritionTargets.maxMealCalories?.toString() ?? ''
  );

  function toggle(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function handleContinue() {
    updateDraft({
      healthGoals: selected,
      nutritionTargets: {
        ...draft.nutritionTargets,
        dailyCalories: dailyCalories ? parseInt(dailyCalories) : undefined,
        maxMealCalories: maxMealCalories ? parseInt(maxMealCalories) : undefined,
      },
    });
    router.push('/(onboarding)/allergies');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <OnboardingProgress step={3} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Health Goals</Text>
        <Text style={styles.subtitle}>What are you working towards?</Text>

        <View style={styles.list}>
          {HEALTH_GOALS.map((item) => {
            const isSelected = selected.includes(item.value);
            return (
              <TouchableOpacity
                key={item.value}
                style={[styles.row, isSelected && styles.rowSelected]}
                onPress={() => toggle(item.value)}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>
                    {item.label}
                  </Text>
                  <Text style={styles.rowDesc}>{item.description}</Text>
                </View>
                <View style={[styles.check, isSelected && styles.checkSelected]}>
                  {isSelected && <Text style={styles.checkMark}>✓</Text>}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.targetsToggle}
          onPress={() => setShowTargets((v) => !v)}
        >
          <Text style={styles.targetsToggleText}>
            {showTargets ? '▲' : '▼'} Set calorie targets (optional)
          </Text>
        </TouchableOpacity>

        {showTargets && (
          <View style={styles.targetsBox}>
            <Text style={styles.inputLabel}>Daily calories</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2000"
              placeholderTextColor="#bbb"
              keyboardType="numeric"
              value={dailyCalories}
              onChangeText={setDailyCalories}
            />
            <Text style={styles.inputLabel}>Max calories per meal</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 600"
              placeholderTextColor="#bbb"
              keyboardType="numeric"
              value={maxMealCalories}
              onChangeText={setMaxMealCalories}
            />
          </View>
        )}

        <TouchableOpacity style={styles.button} onPress={handleContinue}>
          <Text style={styles.buttonText}>Continue →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '700', color: '#222', marginBottom: 6, marginTop: 8 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 24 },
  list: { gap: 10, marginBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
  },
  rowSelected: { borderColor: '#4CAF50', backgroundColor: '#f0faf0' },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 2 },
  rowLabelSelected: { color: '#2e7d32' },
  rowDesc: { fontSize: 12, color: '#888' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  targetsToggle: { marginBottom: 16 },
  targetsToggleText: { fontSize: 14, color: '#4CAF50', fontWeight: '500' },
  targetsBox: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  inputLabel: { fontSize: 13, color: '#555', marginBottom: 6, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#222',
    marginBottom: 14,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
