import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  CategoryChoice, CategoryGroup, categoriesByGroup, GROUP_TITLES, RestaurantCategory, toggleKey,
} from '../../utils/categories';

const FIELD: Record<CategoryGroup, keyof CategoryChoice> = { venue: 'venueTypes', service: 'services', cuisine: 'cuisines' };

// The three groups an owner fills in to tell customers about their place: what it is, how customers get the food, and what it
// serves. Each group allows several choices; the list of categories comes from the server. Controlled: the parent holds the value.
export function CategoryPicker({
  categories, value, onChange, disabled = false,
}: { categories: RestaurantCategory[]; value: CategoryChoice; onChange: (next: CategoryChoice) => void; disabled?: boolean }) {
  const by = categoriesByGroup(categories);
  const groups: CategoryGroup[] = ['venue', 'service', 'cuisine'];

  return (
    <View>
      {groups.map((grp) => (
        <View key={grp} style={styles.group}>
          <Text style={styles.title}>
            {GROUP_TITLES[grp].title} <Text style={styles.hint}>{GROUP_TITLES[grp].hint}</Text>
          </Text>
          {by[grp].length === 0 && <Text style={styles.hint}>No choices are set up yet. Please tell us if you see this.</Text>}
          <View style={styles.chips}>
            {by[grp].map((c) => {
              const on = value[FIELD[grp]].includes(c.key);
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.chip, on && styles.chipOn, disabled && styles.disabled]}
                  onPress={() => onChange({ ...value, [FIELD[grp]]: toggleKey(value[FIELD[grp]], c.key) })}
                  disabled={disabled}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={c.label}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{on ? '✓ ' : ''}{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: 8 },
  title: { fontSize: 13, fontWeight: '800', color: '#222', marginBottom: 5 },
  hint: { fontSize: 11, fontWeight: '400', color: '#888' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#444' },
  chipTextOn: { color: '#fff' },
  disabled: { opacity: 0.5 },
});
