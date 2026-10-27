import { Text, Pressable, StyleSheet } from 'react-native';

export const ORDER_BANNER_HEIGHT = 30;

// A thin, colorful bar across the top of the app while any order is in progress. It says nothing about any one order (there may be
// several); tapping it opens the page with all of the person's orders and where each one is.
// topInset is the phone's top inset (the bar sits under the status bar); on the web it is 0.
export function ActiveOrderBanner({ label, topInset, onPress }: { label: string; topInset: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.bar, { paddingTop: topInset, height: ORDER_BANNER_HEIGHT + topInset }]}
    >
      <Text style={styles.text} numberOfLines={1}>🛒 {label}  ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { width: '100%', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, backgroundColor: '#E91E63' },
  text: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
