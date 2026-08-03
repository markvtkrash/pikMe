import { View, Text, StyleSheet } from 'react-native';

export default function EntertainmentScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🎮</Text>
      <Text style={styles.title}>Entertainment is coming soon</Text>
      <Text style={styles.body}>
        We're working on bringing movies, events, and more into PikMe. Check back soon!
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
    gap: 12,
  },
  icon: { fontSize: 56, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: '#141414', textAlign: 'center' },
  body: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20 },
});
