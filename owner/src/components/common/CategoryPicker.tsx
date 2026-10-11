import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  CategoryChoice, CategoryGroup, categoriesByGroup, GROUP_TITLES, RestaurantCategory, toggleKey,
} from '../../utils/categories';
import { IconText } from './AppIcon';

const FIELD: Record<CategoryGroup, keyof CategoryChoice> = { venue: 'venueTypes', service: 'services', cuisine: 'cuisines' };

// One colour and icon per group, so the three sections are easy to tell apart.
const LOOK: Record<CategoryGroup, { color: string; tint: string; icon: string }> = {
  venue: { color: '#1565C0', tint: '#E3F2FD', icon: '🏪' },
  service: { color: '#E65100', tint: '#FFF3E0', icon: '🧾' },
  cuisine: { color: '#7B1FA2', tint: '#F3E5F5', icon: '🍽️' },
};

// The three groups an owner fills in to tell customers about their place: what it is, how customers get the food, and what it
// serves. Each group is its own box with a coloured heading band, a short hint and its choices, and shows how many are chosen.
// The list of categories comes from the server. Controlled: the parent holds the value.
export function CategoryPicker({
  categories, value, onChange, disabled = false,
}: { categories: RestaurantCategory[]; value: CategoryChoice; onChange: (next: CategoryChoice) => void; disabled?: boolean }) {
  const by = categoriesByGroup(categories);
  const groups: CategoryGroup[] = ['venue', 'service', 'cuisine'];

  return (
    <View style={styles.wrap}>
      {groups.map((grp) => {
        const look = LOOK[grp];
        const chosen = value[FIELD[grp]].length;
        return (
          <View key={grp} style={[styles.box, { borderColor: look.color }]}>
            <View style={[styles.band, { backgroundColor: look.tint, borderBottomColor: look.color }]}>
              <IconText style={[styles.title, { color: look.color }]} emoji={look.icon} iconColor={look.color}>
                {GROUP_TITLES[grp].title}
              </IconText>
              {chosen > 0 && (
                <View style={[styles.count, { backgroundColor: look.color }]}>
                  <Text style={styles.countText}>{chosen} chosen</Text>
                </View>
              )}
            </View>
            <View style={styles.body}>
              <Text style={styles.hint}>{GROUP_TITLES[grp].hint}</Text>
              {by[grp].length === 0 && <Text style={styles.hint}>No choices are set up yet. Please tell us if you see this.</Text>}
              <View style={styles.chips}>
                {by[grp].map((c) => {
                  const on = value[FIELD[grp]].includes(c.key);
                  return (
                    <TouchableOpacity
                      key={c.key}
                      style={[styles.chip, on && { backgroundColor: look.color, borderColor: look.color }, disabled && styles.disabled]}
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
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  box: { flexBasis: 250, flexGrow: 1, flexShrink: 1, borderWidth: 1.5, borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff' },
  band: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1.5 },
  title: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
  count: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  body: { padding: 8, gap: 6 },
  hint: { fontSize: 11, color: '#546E7A' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1.5, borderColor: '#CFD8DC', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: '#FAFBFC' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#37474F' },
  chipTextOn: { color: '#fff', fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
