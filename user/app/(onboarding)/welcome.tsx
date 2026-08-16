import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🍽️</Text>
      <Text style={styles.title}>Welcome to PikMe</Text>
      <Text style={styles.subtitle}>
        Let's set up your health profile so we can recommend the best meals for you.
      </Text>
      <Text style={styles.steps}>Takes about 2 minutes</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push('/(onboarding)/ai-profile')}
      >
        <Text style={styles.buttonText}>Get Started</Text>
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
    backgroundColor: '#4CAF50',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 48,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
