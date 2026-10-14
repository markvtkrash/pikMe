import { View, Text, Image, StyleSheet } from 'react-native';
import { BRAND_NAME } from '../../constants/brand';

// The logo with the brand name beside it, for the top-left of the owner screens that have no navigation header (sign in, sign up, reset
// password, claim, pending approval). The signed-in pages show the same pair in the blue header (OwnerNavHeader).
export function BrandBar({ style }: { style?: object }) {
  return (
    <View style={[styles.bar, style]} accessibilityRole="header">
      <Image source={require('../../../assets/logo.png')} style={styles.logo} />
      <Text style={styles.name}>{BRAND_NAME}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 18 },
  name: { fontSize: 20, fontWeight: '900', color: '#1565C0', letterSpacing: 0.4 },
});
