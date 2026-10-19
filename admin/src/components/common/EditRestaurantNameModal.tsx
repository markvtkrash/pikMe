import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Alert } from '../../utils/alert';
import { adminUpdateRestaurantName } from '../../api/restaurantAuth';

// A claimed restaurant's name has no edit path anywhere else (not the owner app, not this
// admin app) -- every other write to public.restaurants (status, categories, pause) has its
// own action, but a typo in the name itself was previously stuck forever.
export function EditRestaurantNameModal({
  restaurantId, restaurantName, onClose, onSaved,
}: { restaurantId: string | null; restaurantName: string; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState(restaurantName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (restaurantId) {
      setName(restaurantName);
      setError(null);
    }
  }, [restaurantId, restaurantName]);

  async function save() {
    if (!restaurantId) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminUpdateRestaurantName(restaurantId, trimmed);
      onSaved(trimmed);
      Alert.alert('Saved', 'The restaurant name is updated.');
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={!!restaurantId} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Edit Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(t) => { setName(t); setError(null); }}
            placeholder="Restaurant name"
            placeholderTextColor="#999"
            autoFocus
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancel} onPress={onClose} accessibilityRole="button"><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.save, saving && styles.disabled]} onPress={save} disabled={saving} accessibilityRole="button">
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  title: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#222' },
  error: { fontSize: 12, color: '#c62828', marginTop: 10 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  cancel: { paddingHorizontal: 16, paddingVertical: 10 },
  cancelText: { color: '#666', fontWeight: '700', fontSize: 13 },
  save: { backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  disabled: { opacity: 0.5 },
});
