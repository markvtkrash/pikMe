import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Alert } from '../../utils/alert';
import { addFranchiseChain } from '../../api/chainMenus';
import { parseAliases, validateNewFranchise } from '../../utils/newFranchise';

// "Add franchise" window on the Franchise Menu Management page (migration 092): puts a new chain on the
// franchise list the customer app matches restaurants against.
export default function AddFranchiseModal({
  visible, onClose, onAdded,
}: { visible: boolean; onClose: () => void; onAdded: (name: string) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [aliases, setAliases] = useState('');
  const [menuUrl, setMenuUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const problem = validateNewFranchise({ name, category, aliases, menuUrl });
  // Nothing is flagged until the first attempt, so an empty form does not open with an error.
  const shownProblem = touched ? problem : null;

  function reset() {
    setName(''); setCategory(''); setAliases(''); setMenuUrl(''); setTouched(false);
  }

  function close() {
    if (saving) return;
    reset();
    onClose();
  }

  async function save() {
    setTouched(true);
    if (problem) return;
    setSaving(true);
    try {
      await addFranchiseChain({ name, category, aliases: parseAliases(aliases), menuUrl });
      const added = name.trim();
      reset();
      onAdded(added);
    } catch (error: any) {
      console.error('[admin-chain-menus] Add franchise error:', error);
      Alert.alert('Could not add it', error?.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Add franchise</Text>
            <Text style={styles.message}>
              Restaurants whose name matches exactly (ignoring store numbers and punctuation) are treated as this
              franchise in the customer app. Add other spellings as aliases.
            </Text>

            <Text style={styles.label}>Name *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Taco Bell"
              placeholderTextColor="#999"
              autoCapitalize="words"
              editable={!saving}
            />

            <Text style={styles.label}>Category</Text>
            <TextInput
              style={styles.input}
              value={category}
              onChangeText={setCategory}
              placeholder="e.g. Mexican (optional)"
              placeholderTextColor="#999"
              editable={!saving}
            />

            <Text style={styles.label}>Aliases</Text>
            <TextInput
              style={styles.input}
              value={aliases}
              onChangeText={setAliases}
              placeholder="Other names, separated by commas (optional)"
              placeholderTextColor="#999"
              autoCapitalize="none"
              editable={!saving}
            />

            <Text style={styles.label}>Built-in menu page</Text>
            <TextInput
              style={styles.input}
              value={menuUrl}
              onChangeText={setMenuUrl}
              placeholder="https://www.example.com/menu (optional)"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving}
            />
            {!!shownProblem && <Text style={styles.warning}>{shownProblem}</Text>}

            <Text style={styles.note}>
              The menu is built later, from a store of this chain seen in customer searches, a menu link entered
              by hand, or the built-in page above.
            </Text>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={close} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, saving && styles.disabled]} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Add franchise</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, maxHeight: '90%' },
  title: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 6 },
  message: { fontSize: 12, color: '#666', lineHeight: 18, marginBottom: 12 },
  label: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, marginTop: 4 },
  input: { backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 6 },
  warning: { fontSize: 12, color: '#c62828', marginTop: 4, fontWeight: '600' },
  note: { fontSize: 11, color: '#999', marginTop: 8, lineHeight: 16 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: '#9aa5ad', backgroundColor: '#fff' },
  cancelText: { fontSize: 13, fontWeight: '700', color: '#455a64' },
  primaryBtn: { backgroundColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, minWidth: 110, alignItems: 'center' },
  primaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  disabled: { opacity: 0.5 },
});
