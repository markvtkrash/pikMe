import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';

interface Props {
  active: boolean;
  onPress: () => void;
  size?: 'small' | 'large';
}

// Small heart toggle reused on Reports cards and Tools page headers to pin/
// unpin a shortcut in the Dashboard's Favorites section.
export function FavoriteHeart({ active, onPress, size = 'small' }: Props) {
  return (
    <TouchableOpacity
      style={[styles.btn, size === 'large' && styles.btnLarge]}
      onPress={(e: any) => { e?.stopPropagation?.(); onPress(); }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <View>
        <Text style={[styles.icon, size === 'large' && styles.iconLarge]}>
          {active ? '❤️' : '🤍'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 2 },
  btnLarge: { padding: 4 },
  icon: { fontSize: 16 },
  iconLarge: { fontSize: 22 },
});
