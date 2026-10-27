import type { ReactNode } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { goBackOrHome } from './OrderHeader';

// The popup the order pages sit in, made like the restaurant's menu page: a dimmed backdrop (tap it to close) with the page in a sheet
// on top, full screen on a phone and a rounded card on a wide screen. The page inside puts an X in its header (OrderHeader closeable).
export function OrderModalFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isWide = useWindowDimensions().width > 760;
  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => goBackOrHome(router)} accessibilityLabel="Close" />
      <View style={[styles.sheet, isWide && styles.sheetWide]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center' },
  sheet: { flex: 1, width: '100%', overflow: 'hidden' },
  sheetWide: { maxWidth: 720, marginVertical: 24, borderRadius: 20 },
});
