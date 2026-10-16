import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CategoryFilters, chipCount, cuisineOptions, serviceOptions, toggleFilter, venueOptions, type CategorizedRestaurant, type RestaurantCategory,
} from '../../utils/categories';
import { showResultsLabel } from '../../utils/filterChips';
import { useThemedStyles } from '../../theme/useTheme';

// The earlier single-choice filters (Google's raw types), used only when the server does not send categories.
export interface LegacyFilterProps {
  typeOptions: string[];
  activeType: string;
  onType: (type: string) => void;
  typeLabel: (type: string) => string;
  cuisineOptions: string[];
  activeCuisine: string;
  onCuisine: (cuisine: string) => void;
}

// The filter sheet on the Explore page: it slides up, holds every filter group, scrolls inside itself, and closes with one button that
// shows how many places match. Filters apply as they are tapped, so the page behind is already filtered. Coupons Only and the
// search box stay on the page itself.
export function FilterSheet({
  visible, onClose, restaurants, categories, curated, filters, onChange, onClear, resultCount, legacy,
}: {
  visible: boolean;
  onClose: () => void;
  restaurants: CategorizedRestaurant[];
  categories: RestaurantCategory[];
  curated: boolean;
  filters: CategoryFilters;
  onChange: (next: CategoryFilters) => void;
  onClear: () => void;
  resultCount: number;
  legacy: LegacyFilterProps;
}) {
  const styles = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  const venues = curated ? venueOptions(restaurants, categories) : [];
  const services = curated ? serviceOptions(restaurants, categories) : [];
  const cuisines = curated ? cuisineOptions(restaurants, categories) : [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close filters">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Filters</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close filters">
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {curated ? (
              <>
                {venues.length > 0 && (
                  <Group title="What kind of place" hint="Shows places that are any of these.">
                    {venues.map((c) => (
                      <Chip key={c.key} label={c.label} count={chipCount(restaurants, filters, 'venue', c.key)} on={filters.venues.includes(c.key)} onPress={() => onChange({ ...filters, venues: toggleFilter(filters.venues, c.key) })} />
                    ))}
                  </Group>
                )}
                {services.length > 0 && (
                  <Group title="How you get the food" hint="Shows places that offer all of these.">
                    {services.map((c) => (
                      <Chip key={c.key} label={c.label} check count={chipCount(restaurants, filters, 'service', c.key)} on={filters.services.includes(c.key)} onPress={() => onChange({ ...filters, services: toggleFilter(filters.services, c.key) })} />
                    ))}
                  </Group>
                )}
                {cuisines.length > 0 && (
                  <Group title="Cuisine" hint="Shows places that serve any of these.">
                    {cuisines.map((c) => (
                      <Chip key={c.key} label={c.label} count={chipCount(restaurants, filters, 'cuisine', c.key)} on={filters.cuisines.includes(c.key)} onPress={() => onChange({ ...filters, cuisines: toggleFilter(filters.cuisines, c.key) })} />
                    ))}
                  </Group>
                )}
                {venues.length === 0 && services.length === 0 && cuisines.length === 0 && (
                  <Text style={styles.empty}>No filters are available for the places near you yet.</Text>
                )}
              </>
            ) : (
              <>
                {legacy.typeOptions.length > 1 && (
                  <Group title="What kind of place">
                    {legacy.typeOptions.map((t) => (
                      <Chip key={t} label={legacy.typeLabel(t)} on={legacy.activeType === t} onPress={() => legacy.onType(t)} />
                    ))}
                  </Group>
                )}
                {legacy.cuisineOptions.length > 1 && (
                  <Group title="Cuisine">
                    {legacy.cuisineOptions.map((c) => (
                      <Chip key={c} label={c === 'All' ? 'All Cuisines' : c} on={legacy.activeCuisine === c} onPress={() => legacy.onCuisine(c)} />
                    ))}
                  </Group>
                )}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.clearBtn} onPress={onClear} accessibilityRole="button">
              <Text style={styles.clearText}>Clear all</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.showBtn} onPress={onClose} accessibilityRole="button">
              <Text style={styles.showText}>{showResultsLabel(resultCount)}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {!!hint && <Text style={styles.groupHint}>{hint}</Text>}
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

// count: how many nearby places tapping it would give (see chipCount). A chip with none, that is not switched on, is dimmed and cannot be tapped.
function Chip({ label, on, onPress, check = false, count }: { label: string; on: boolean; onPress: () => void; check?: boolean; count?: number }) {
  const styles = useThemedStyles(baseStyles);
  const empty = count === 0 && !on;
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn, empty && styles.chipEmpty]}
      onPress={onPress}
      disabled={empty}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: empty }}
      accessibilityLabel={count != null ? `${label}, ${count} ${count === 1 ? 'place' : 'places'}` : label}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn, empty && styles.chipTextEmpty]}>
        {check && on ? '✓ ' : ''}{label}{count != null ? ` · ${count}` : ''}
      </Text>
    </TouchableOpacity>
  );
}

const baseStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingTop: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: '800', color: '#141414' },
  close: { fontSize: 18, color: '#666', fontWeight: '700' },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 8 },
  group: { marginBottom: 16 },
  groupTitle: { fontSize: 13, fontWeight: '800', color: '#555', marginBottom: 2 },
  groupHint: { fontSize: 11.5, color: '#888', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#E0E0E0', backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#141414', borderColor: '#141414' },
  chipText: { fontSize: 13, color: '#555', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  chipEmpty: { backgroundColor: '#F6F6F6', borderColor: '#EEE' },
  chipTextEmpty: { color: '#BBB' },
  empty: { fontSize: 13, color: '#888', paddingVertical: 16 },
  footer: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eee' },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 12 },
  clearText: { fontSize: 14, fontWeight: '700', color: '#666' },
  showBtn: { flex: 1, backgroundColor: '#1565C0', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  showText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
