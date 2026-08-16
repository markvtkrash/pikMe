import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingProgress } from '../../src/components/common/OnboardingProgress';
import { useUserProfileStore } from '../../src/store/userProfileStore';
import { aiOnboard } from '../../src/api/functions';

export default function AiProfileScreen() {
  const router = useRouter();
  const { draft, updateDraft } = useUserProfileStore();
  const [displayName, setDisplayName] = useState(draft.displayName);
  const [description, setDescription] = useState(draft.description ?? '');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [nameError, setNameError] = useState('');

  async function handleContinue() {
    setNameError('');
    if (!displayName.trim()) {
      setNameError('Please enter your name to continue.');
      return;
    }

    updateDraft({ displayName: displayName.trim(), description: description.trim() });

    // If user entered a health description, try to extract profile with AI
    if (description.trim().length > 10) {
      setExtracting(true);
      setExtractError('');
      try {
        const extracted = await aiOnboard(description.trim());
        if (extracted && typeof extracted === 'object') {
          updateDraft({
            dietaryRestrictions: (extracted as any).dietaryRestrictions ?? draft.dietaryRestrictions,
            healthGoals: (extracted as any).healthGoals ?? draft.healthGoals,
            allergens: (extracted as any).allergens ?? draft.allergens,
            cuisinePreferences: (extracted as any).cuisinePreferences ?? draft.cuisinePreferences,
          });
        }
      } catch {
        // Silent — still proceed, user can fill in manually
        setExtractError('Could not auto-fill from description. You can set preferences manually.');
      } finally {
        setExtracting(false);
      }
    }

    router.push('/(onboarding)/dietary');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <OnboardingProgress step={1} showBack={false} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Let's get started</Text>
        <Text style={styles.subtitle}>What should we call you?</Text>

        <Text style={styles.label}>Your name *</Text>
        <TextInput
          style={[styles.input, nameError ? styles.inputError : null]}
          placeholder="e.g. Alex"
          placeholderTextColor="#bbb"
          value={displayName}
          onChangeText={(t) => { setDisplayName(t); setNameError(''); }}
          autoFocus
          returnKeyType="next"
        />
        {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}

        <Text style={styles.label}>Health description (optional)</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="e.g. I'm diabetic, trying to lose weight, vegetarian, love Italian food"
          placeholderTextColor="#bbb"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
        <Text style={styles.hint}>
          AI will auto-fill your dietary preferences from this description. You can review and adjust them on the next screens.
        </Text>

        {extractError ? <Text style={styles.warnText}>{extractError}</Text> : null}

        <TouchableOpacity
          style={[styles.button, extracting && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={extracting}
        >
          {extracting ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.buttonText}>Analysing description…</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>Continue →</Text>
          )}
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
  label: { fontSize: 14, fontWeight: '600', color: '#444', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#222',
    marginBottom: 6,
  },
  inputError: { borderColor: '#e53e3e' },
  textarea: { height: 100, paddingTop: 12, marginBottom: 8 },
  hint: { fontSize: 12, color: '#aaa', marginBottom: 8, lineHeight: 18 },
  errorText: { fontSize: 13, color: '#e53e3e', marginBottom: 12 },
  warnText: { fontSize: 13, color: '#e65100', marginBottom: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 16,
    minHeight: 52,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
