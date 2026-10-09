import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dismissMenuImportAlert, getMenuImportAlert } from '../../api/menuImport';
import { MENU_IMPORT_ALERT_TITLE, menuImportAlertMessage } from '../../utils/menuImportText';
import { Alert } from '../../utils/alert';

export const MENU_IMPORT_ALERT_KEY = ['menuImportAlert'];

// A bar with a bell at the very top of every owner page (it sits in the shared header). It appears when the daily read of the
// owner's menu link got no menu items: it says the import was not successful with the link they gave and points them to
// "Import Menu from Photo". It goes away when they dismiss it, change the link, or add real menu items. Shows nothing otherwise
// (and nothing at all if the lookup fails).
export function MenuImportAlertBar({ onOpenPhotoImport }: { onOpenPhotoImport: () => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: MENU_IMPORT_ALERT_KEY,
    queryFn: getMenuImportAlert,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (!data) return null;

  async function handleDismiss() {
    try {
      await dismissMenuImportAlert();
      queryClient.setQueryData(MENU_IMPORT_ALERT_KEY, null);
    } catch (error: any) {
      console.error('[menu-import-alert] Dismiss error:', error);
      Alert.alert('Error', error?.message || 'Could not hide this message. Please try again.');
    }
  }

  return (
    <View style={styles.bar} accessibilityRole="alert">
      <Text style={styles.bell}>🔔</Text>
      <View style={styles.body}>
        <Text style={styles.title}>{MENU_IMPORT_ALERT_TITLE}</Text>
        <Text style={styles.message}>{menuImportAlertMessage(data.status, data.link)}</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.primary} onPress={onOpenPhotoImport} accessibilityRole="button">
            <Text style={styles.primaryText}>📷 Import Menu from Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={handleDismiss} accessibilityRole="button">
            <Text style={styles.secondaryText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#FFF3E0',
    borderBottomWidth: 1, borderBottomColor: '#FFCC80', paddingHorizontal: 14, paddingVertical: 10,
  },
  bell: { fontSize: 20, marginTop: 1 },
  body: { flex: 1 },
  title: { fontSize: 13, fontWeight: '800', color: '#BF360C', marginBottom: 2 },
  message: { fontSize: 12.5, color: '#5D4037', lineHeight: 17 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  primary: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  primaryText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  secondary: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  secondaryText: { color: '#8D6E63', fontSize: 12, fontWeight: '700' },
});
