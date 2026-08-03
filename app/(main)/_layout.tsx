import { Slot } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AppModeSwitcher } from '../../src/components/common/AppModeSwitcher';

export default function MainLayout() {
  return (
    <View style={styles.container}>
      <AppModeSwitcher />
      <View style={styles.content}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flex: 1 },
});
