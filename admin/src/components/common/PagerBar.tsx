import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// Prev / Next with "Page 2 of 5" and which rows are shown. Nothing is drawn while everything fits on one page.
export function PagerBar({
  page, pageCount, from, to, total, onPage,
}: { page: number; pageCount: number; from: number; to: number; total: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <View style={styles.pager} accessibilityRole="toolbar">
      <TouchableOpacity
        style={[styles.btn, page === 0 && styles.disabled]}
        onPress={() => onPage(page - 1)}
        disabled={page === 0}
        accessibilityRole="button"
        accessibilityLabel="Previous page"
      >
        <Text style={styles.btnText}>‹ Prev</Text>
      </TouchableOpacity>
      <View style={styles.middle}>
        <Text style={styles.label}>Page {page + 1} of {pageCount}</Text>
        <Text style={styles.sub}>{from}-{to} of {total}</Text>
      </View>
      <TouchableOpacity
        style={[styles.btn, page >= pageCount - 1 && styles.disabled]}
        onPress={() => onPage(page + 1)}
        disabled={page >= pageCount - 1}
        accessibilityRole="button"
        accessibilityLabel="Next page"
      >
        <Text style={styles.btnText}>Next ›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 12 },
  btn: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, elevation: 1, borderWidth: 1, borderColor: '#CFD8DC' },
  btnText: { fontSize: 13, fontWeight: '700', color: '#222' },
  disabled: { opacity: 0.4 },
  middle: { alignItems: 'center' },
  label: { fontSize: 13, color: '#444', fontWeight: '700' },
  sub: { fontSize: 11, color: '#888' },
});
