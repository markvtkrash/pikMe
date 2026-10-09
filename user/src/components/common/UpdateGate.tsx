import { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useCustomerConfig } from '../../hooks/useCustomerConfig';
import { isVersionBelow } from '../../utils/customerConfig';
import { BRAND_NAME } from '../../constants/brandTheme';

// Blocks the app behind an "update required" screen when this app version is older than the admin's minimum
// (app_config 'minAppVersion', migration 127). It never blocks while the setting is loading or if it cannot be read, so a
// network problem cannot lock anyone out. Because installed apps do not all update on their own, this is the way to retire a
// version that can no longer work; raise the minimum only then.
export function UpdateGate({ children }: { children: ReactNode }) {
  const { data } = useCustomerConfig();
  const current = Constants.expoConfig?.version;

  if (data && isVersionBelow(current, data.minAppVersion)) {
    return <UpdateRequiredScreen />;
  }
  return <>{children}</>;
}

function UpdateRequiredScreen() {
  // The store listing is opened from the device's store app; until the app has a published listing this just asks the
  // person to update from the store.
  function openStore() {
    const url = Platform.OS === 'ios' ? 'itms-apps://apps.apple.com' : 'market://search?q=' + encodeURIComponent(BRAND_NAME);
    Linking.openURL(url).catch(() => {});
  }
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.icon}>⬆️</Text>
      <Text style={styles.title}>Please update {BRAND_NAME}</Text>
      <Text style={styles.body}>This version is out of date. Update to the latest version from the app store to keep using the app.</Text>
      <TouchableOpacity style={styles.button} onPress={openStore} accessibilityRole="button">
        <Text style={styles.buttonText}>Open the app store</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  icon: { fontSize: 32, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#333', marginBottom: 8, textAlign: 'center' },
  body: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 28, lineHeight: 20 },
  button: { backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
