import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_COLORS } from '../../constants/brandTheme';
import { CUSTOMER_HOME_PATH } from '../../utils/customerRouting';
import { useThemedStyles } from '../../theme/useTheme';

// Back goes to the screen before, and to the app's home when there is none: coming back from Stripe's payment page lands straight on
// the order page with nothing before it, and a Back button that does nothing would leave the person stuck.
export function goBackOrHome(router: { canGoBack: () => boolean; back: () => void; replace: (href: any) => void }) {
  if (router.canGoBack()) router.back();
  else router.replace(CUSTOMER_HOME_PATH as any);
}

// The top of the ordering screens: a Back button, the title and an optional line under it. It leaves room above for the app's pinned logo.
// closeable is for the pages shown as a popup (OrderModalFrame): an X on the right instead of Back, like the restaurant's menu page.
export function OrderHeader({ title, subtitle, closeable }: { title: string; subtitle?: string; closeable?: boolean }) {
  const styles = useThemedStyles(baseStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWide = useWindowDimensions().width > 760;
  const top = closeable && isWide ? 16 : insets.top + 46;
  return (
    <View style={[styles.header, { paddingTop: top }]}>
      {!closeable && (
        <TouchableOpacity style={styles.backBtn} onPress={() => goBackOrHome(router)} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
      )}
      <View style={styles.flex1}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {closeable && (
        <TouchableOpacity style={styles.closeBtn} onPress={() => goBackOrHome(router)} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  flex1: { flex: 1 },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: BRAND_COLORS.background.overlay, marginTop: 4 },
  backBtnText: { fontSize: 13, fontWeight: '600', color: BRAND_COLORS.error },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: BRAND_COLORS.background.overlay, alignItems: 'center', justifyContent: 'center' },
  closeIcon: { fontSize: 16, fontWeight: '700', color: BRAND_COLORS.text.primary },
  title: { fontSize: 22, fontWeight: '800', color: BRAND_COLORS.text.primary },
  subtitle: { fontSize: 13, color: BRAND_COLORS.text.tertiary, marginTop: 2 },
});
