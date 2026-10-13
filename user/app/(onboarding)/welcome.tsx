import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { BRAND_NAME } from '../../src/constants/brandTheme';
import { useProfileReminderStore } from '../../src/store/profileReminderStore';

export default function WelcomeScreen() {
  const router = useRouter();
  const dismissReminder = useProfileReminderStore((s) => s.dismiss);

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🍽️</Text>
      <Text style={styles.title}>Welcome to {BRAND_NAME}</Text>
      <Text style={styles.subtitle}>
        Tell us your food preferences so we can recommend the best meals for you. This is optional: you can skip it and come back any time.
      </Text>
      <Text style={styles.steps}>Takes about 2 minutes</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push('/(onboarding)/ai-profile')}
      >
        <Text style={styles.buttonText}>Get Started</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.laterButton} onPress={() => { dismissReminder(); router.replace('/(main)/(tabs)'); }} accessibilityRole="button">
        <Text style={styles.laterText}>Maybe later</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#fff',
  },
  emoji: { fontSize: 72, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#222', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', lineHeight: 24, marginBottom: 8 },
  steps: { fontSize: 13, color: '#999', marginBottom: 48 },
  button: {
    backgroundColor: '#1565C0',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 48,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  laterButton: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 20 },
  laterText: { color: '#666', fontSize: 15, fontWeight: '600' },
});
