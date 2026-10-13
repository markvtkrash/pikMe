import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import type { LocationOption } from '../../utils/menuLocation';

interface Props {
  visible: boolean;
  title: string;
  options: LocationOption[];
  selected: string;          // the chosen option's value, or '' for All
  allLabel: string;          // e.g. "All regions"
  onSelect: (value: string) => void;
  onClose: () => void;
}

// A modal window to pick one option from a list, with a search box once the list is long. Used for the Region and City filters.
export function OptionPickerModal({ visible, title, options, selected, allLabel, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const total = options.reduce((sum, o) => sum + o.count, 0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {options.length > 8 && (
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Type to narrow the list"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {!q && (
              <TouchableOpacity style={[styles.row, !selected && styles.rowOn]} onPress={() => onSelect('')} accessibilityRole="button">
                <Text style={[styles.rowText, !selected && styles.rowTextOn]}>{allLabel}</Text>
                <Text style={[styles.rowCount, !selected && styles.rowTextOn]}>{total}</Text>
              </TouchableOpacity>
            )}
            {shown.map((o) => {
              const on = o.value === selected.trim().toLowerCase();
              return (
                <TouchableOpacity key={o.value} style={[styles.row, on && styles.rowOn]} onPress={() => onSelect(o.value)} accessibilityRole="button">
                  <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={1}>{o.label}</Text>
                  <Text style={[styles.rowCount, on && styles.rowTextOn]}>{o.count}</Text>
                </TouchableOpacity>
              );
            })}
            {shown.length === 0 && <Text style={styles.empty}>{q ? 'Nothing matches.' : 'Nothing to choose from yet.'}</Text>}
          </ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityRole="button">
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 18, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: '#CFD8DC' },
  title: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 10 },
  search: { paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#222', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8, marginBottom: 8 },
  list: { maxHeight: 340 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8 },
  rowOn: { backgroundColor: '#1565C0' },
  rowText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#222' },
  rowTextOn: { color: '#fff' },
  rowCount: { fontSize: 12, fontWeight: '700', color: '#888' },
  empty: { fontSize: 13, color: '#888', paddingVertical: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  closeBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  closeText: { color: '#666', fontWeight: '700', fontSize: 13 },
});
