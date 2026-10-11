import { TouchableOpacity, StyleSheet } from 'react-native';
import { Heart } from 'lucide-react-native';

interface Props {
  active: boolean;
  onPress: () => void;
  size?: 'small' | 'large';
}

// Small heart toggle reused on cards and page headers to pin/unpin a shortcut in Favorites. Pinned: a solid red heart. Not pinned:
// a white heart with a clear dark-red outline, so it is easy to see against any card colour.
export function FavoriteHeart({ active, onPress, size = 'small' }: Props) {
  const px = size === 'large' ? 26 : 20;
  return (
    <TouchableOpacity
      style={[styles.btn, size === 'large' && styles.btnLarge]}
      onPress={(e: any) => { e?.stopPropagation?.(); onPress(); }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Heart size={px} color="#B71C1C" strokeWidth={2.4} fill={active ? '#E53935' : '#FFFFFF'} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 2 },
  btnLarge: { padding: 4 },
});
