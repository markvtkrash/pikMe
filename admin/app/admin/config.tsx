import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Modal,
} from 'react-native';
import { Alert, confirmDialog } from '../../src/utils/alert';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { isBooleanValue, nextBooleanValue, switchQuestion } from '../../src/utils/configValues';

interface ConfigRow {
  key: string;
  value: string;
  description: string | null;
  env_var_name: string | null;
  updated_at: string;
}

export default function AdminConfigScreen() {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const [addingKey, setAddingKey] = useState('');
  const [addingValue, setAddingValue] = useState('');
  const [addingDescription, setAddingDescription] = useState('');
  const [addingEnvVarName, setAddingEnvVarName] = useState('');
  const [adding, setAdding] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ConfigRow | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadRows();
    }, [])
  );

  async function loadRows() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('app_config')
        .select('key, value, description, env_var_name, updated_at')
        .order('key', { ascending: true });
      if (error) throw error;
      setRows(data ?? []);
      setDrafts(Object.fromEntries((data ?? []).map((r) => [r.key, r.value])));
    } catch (error: any) {
      console.error('[admin-config] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load config values');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(row: ConfigRow) {
    const nextValue = (drafts[row.key] ?? '').trim();
    if (!nextValue) {
      Alert.alert('Error', 'Value cannot be empty');
      return;
    }
    if (nextValue === row.value) return;

    setSavingKey(row.key);
    try {
      const { error } = await supabase
        .from('app_config')
        .update({ value: nextValue, updated_at: new Date().toISOString() })
        .eq('key', row.key);
      if (error) throw error;
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, value: nextValue } : r)));
    } catch (error: any) {
      console.error('[admin-config] Save error:', error);
      Alert.alert('Error', error.message || 'Failed to save value');
    } finally {
      setSavingKey(null);
    }
  }

  // A true/false value is switched with one button (after a short question), and saved at once.
  async function handleToggle(row: ConfigRow) {
    if (savingKey) return;
    if (!(await confirmDialog('Switch setting?', switchQuestion(row.key, row.value), { confirmText: 'Switch' }))) return;
    const nextValue = nextBooleanValue(row.value);
    setSavingKey(row.key);
    try {
      const { error } = await supabase
        .from('app_config')
        .update({ value: nextValue, updated_at: new Date().toISOString() })
        .eq('key', row.key);
      if (error) throw error;
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, value: nextValue } : r)));
      setDrafts((prev) => ({ ...prev, [row.key]: nextValue }));
    } catch (error: any) {
      console.error('[admin-config] Toggle error:', error);
      Alert.alert('Error', error.message || 'Failed to change the value');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleAdd() {
    const key = addingKey.trim();
    const value = addingValue.trim();
    if (!key || !value) {
      Alert.alert('Error', 'Key and value are both required');
      return;
    }
    if (rows.some((r) => r.key === key)) {
      Alert.alert('Error', `"${key}" already exists`);
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase
        .from('app_config')
        .insert({
          key,
          value,
          description: addingDescription.trim() || null,
          env_var_name: addingEnvVarName.trim() || null,
        });
      if (error) throw error;
      setAddingKey('');
      setAddingValue('');
      setAddingDescription('');
      setAddingEnvVarName('');
      await loadRows();
    } catch (error: any) {
      console.error('[admin-config] Add error:', error);
      Alert.alert('Error', error.message || 'Failed to add config value');
    } finally {
      setAdding(false);
    }
  }

  function handleDeleteRequest(row: ConfigRow) {
    setDeleteTarget(row);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    const key = deleteTarget.key;
    setDeleteTarget(null);
    setSavingKey(key);
    try {
      const { error } = await supabase.from('app_config').delete().eq('key', key);
      if (error) throw error;
      setRows((prev) => prev.filter((r) => r.key !== key));
    } catch (error: any) {
      console.error('[admin-config] Delete error:', error);
      Alert.alert('Error', error.message || 'Failed to delete config value');
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <Text style={styles.hint}>
          These values are read by each app at startup when its EXPO_PUBLIC_CONFIG_SOURCE is set to
          "db". A row missing here falls back to that app's own .env default automatically.
        </Text>

        <FlatList
          data={rows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.addCard}>
              <Text style={styles.addTitle}>Add new value</Text>
              <TextInput
                style={styles.input}
                placeholder="Key (e.g. maxManualMenuItems)"
                value={addingKey}
                onChangeText={setAddingKey}
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
                placeholder="Value"
                value={addingValue}
                onChangeText={setAddingValue}
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
                placeholder="Description (optional)"
                value={addingDescription}
                onChangeText={setAddingDescription}
              />
              <TextInput
                style={styles.input}
                placeholder=".env equivalent (optional, e.g. owner/.env: EXPO_PUBLIC_...)"
                value={addingEnvVarName}
                onChangeText={setAddingEnvVarName}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.addBtn, adding && styles.btnDisabled]}
                onPress={handleAdd}
                disabled={adding}
              >
                {adding ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addBtnText}>+ Add</Text>
                )}
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const draft = drafts[item.key] ?? item.value;
            const dirty = draft !== item.value;
            const busy = savingKey === item.key;
            return (
              <View style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowKey}>{item.key}</Text>
                  {!!item.description && <Text style={styles.rowDescription}>{item.description}</Text>}
                  {!!item.env_var_name && <Text style={styles.rowEnvVar}>.env: {item.env_var_name}</Text>}
                </View>
                {isBooleanValue(item.value) ? (
                  <TouchableOpacity
                    style={[styles.toggleBtn, item.value === 'true' ? styles.toggleOn : styles.toggleOff, busy && styles.btnDisabled]}
                    onPress={() => handleToggle(item)}
                    disabled={busy}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: item.value === 'true' }}
                    accessibilityLabel={`${item.key}: ${item.value}. Tap to switch.`}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.toggleText}>{item.value === 'true' ? '✓ true' : '✕ false'}</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <>
                    <TextInput
                      style={styles.valueInput}
                      value={draft}
                      onChangeText={(text) => setDrafts((prev) => ({ ...prev, [item.key]: text }))}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={[styles.saveBtn, (!dirty || busy) && styles.btnDisabled]}
                      onPress={() => handleSave(item)}
                      disabled={!dirty || busy}
                    >
                      {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity
                  style={[styles.deleteBtn, busy && styles.btnDisabled]}
                  onPress={() => handleDeleteRequest(item)}
                  disabled={busy}
                >
                  <Text style={styles.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No config values yet</Text>
            </View>
          }
        />
      </View>

      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Delete "{deleteTarget?.key}"?</Text>
            <Text style={styles.confirmMessage}>
              Apps reading this key will fall back to their own .env default the next time they start.
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setDeleteTarget(null)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmDeleteBtn} onPress={handleDeleteConfirm}>
                <Text style={styles.confirmDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  hint: { fontSize: 12, color: '#666', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },

  list: { paddingHorizontal: 16, paddingVertical: 12 },

  addCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 14, gap: 8, elevation: 1 },
  addTitle: { fontSize: 14, fontWeight: '800', color: '#222', marginBottom: 2 },
  addBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  input: { backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: '#222' },

  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8, elevation: 1 },
  rowInfo: { flex: 1, minWidth: 100 },
  rowKey: { fontSize: 13, fontWeight: '700', color: '#222' },
  rowDescription: { fontSize: 11, color: '#999', marginTop: 2 },
  rowEnvVar: { fontSize: 10, color: '#1565C0', fontWeight: '600', marginTop: 2 },
  valueInput: { flex: 1, minWidth: 80, backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#222' },

  toggleBtn: { flex: 1, minWidth: 110, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  toggleOn: { backgroundColor: '#2E7D32' },
  toggleOff: { backgroundColor: '#78909C' },
  toggleText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  saveBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  deleteBtn: { backgroundColor: '#e53e3e', borderRadius: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  btnDisabled: { opacity: 0.5 },

  emptyContainer: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#999' },

  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 360 },
  confirmTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  confirmMessage: { fontSize: 13, color: '#666', marginBottom: 18 },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  confirmCancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  confirmCancelText: { fontSize: 13, fontWeight: '700', color: '#666' },
  confirmDeleteBtn: { backgroundColor: '#e53e3e', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  confirmDeleteText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
