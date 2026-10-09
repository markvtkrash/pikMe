import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Alert, confirmDialog } from '../../src/utils/alert';
import { deleteAnnouncement, endAnnouncement, listAnnouncements, saveAnnouncement } from '../../src/api/announcements';
import {
  AnnouncementAudience, AnnouncementForm, AnnouncementKind, AnnouncementRow, buildAnnouncementInput, describeAudience,
  describeStatus, describeVersions, describeWindow, EMPTY_ANNOUNCEMENT_FORM, formFromRow, LINK_LABEL_MAX, MESSAGE_MAX,
  publishQuestion, TITLE_MAX,
} from '../../src/utils/announcements';

const AUDIENCES: { value: AnnouncementAudience; label: string }[] = [
  { value: 'customer', label: 'Customers' },
  { value: 'owner', label: 'Owners' },
  { value: 'both', label: 'Both' },
];
const KINDS: { value: AnnouncementKind; label: string; hint: string }[] = [
  { value: 'info', label: 'Info', hint: 'Can be closed by tapping outside it' },
  { value: 'important', label: 'Important', hint: 'Must be acknowledged with OK' },
];
const TONES = {
  good: { bg: '#E8F5E9', fg: '#2E7D32' },
  warn: { bg: '#FFF3E0', fg: '#E65100' },
  neutral: { bg: '#ECEFF1', fg: '#546E7A' },
} as const;

// Tools -> Announcements: write a message for customers, owners or both. Each person sees it once, the next time they open the
// app or the owner site. Nothing is pushed to a phone that is not running the app.
export default function AnnouncementsScreen() {
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState<AnnouncementForm>(EMPTY_ANNOUNCEMENT_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listAnnouncements());
      setFailed(false);
    } catch (e: any) {
      console.warn('[admin-announcements] list failed:', e?.message);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof AnnouncementForm>(key: K, value: AnnouncementForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  function reset() {
    setForm(EMPTY_ANNOUNCEMENT_FORM);
    setEditingId(null);
    setError(null);
  }

  async function publish() {
    const built = buildAnnouncementInput(form);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    if (!editingId && !(await confirmDialog('Publish announcement?', publishQuestion(built.value), { confirmText: 'Publish' }))) return;
    setSaving(true);
    try {
      await saveAnnouncement(editingId, built.value);
      Alert.alert(editingId ? 'Saved' : 'Published', editingId ? 'Your changes are saved.' : 'The announcement is live (or scheduled).');
      reset();
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not save the announcement');
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: () => Promise<void>, doneMessage: string) {
    setBusyId(id);
    try {
      await action();
      if (editingId === id) reset();
      await load();
      Alert.alert('Done', doneMessage);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'That did not work');
    } finally {
      setBusyId(null);
    }
  }

  const built = buildAnnouncementInput(form);
  const showVersions = form.audience !== 'owner';
  const previewImportant = form.kind === 'important';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Announcements</Text>
      <Text style={styles.subtitle}>
        A message people see once, the next time they open the app or the owner site. It is not pushed to a phone that is not running the app.
      </Text>

      {/* The form */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{editingId ? 'Edit announcement' : 'New announcement'}</Text>

        <Text style={styles.label}>For</Text>
        <View style={styles.chips}>
          {AUDIENCES.map((a) => (
            <TouchableOpacity key={a.value} style={[styles.chip, form.audience === a.value && styles.chipOn]} onPress={() => set('audience', a.value)} accessibilityRole="button">
              <Text style={[styles.chipText, form.audience === a.value && styles.chipTextOn]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Title ({form.title.trim().length}/{TITLE_MAX})</Text>
        <TextInput style={styles.input} value={form.title} onChangeText={(v) => set('title', v)} placeholder="A short headline" placeholderTextColor="#999" maxLength={TITLE_MAX + 20} />

        <Text style={styles.label}>Message ({form.message.trim().length}/{MESSAGE_MAX})</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={form.message}
          onChangeText={(v) => set('message', v)}
          placeholder="What people need to know"
          placeholderTextColor="#999"
          multiline
          maxLength={MESSAGE_MAX + 50}
        />

        <Text style={styles.label}>Type</Text>
        <View style={styles.chips}>
          {KINDS.map((k) => (
            <TouchableOpacity key={k.value} style={[styles.chip, form.kind === k.value && styles.chipOn]} onPress={() => set('kind', k.value)} accessibilityRole="button">
              <Text style={[styles.chipText, form.kind === k.value && styles.chipTextOn]}>{k.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>{KINDS.find((k) => k.value === form.kind)?.hint}</Text>

        <Text style={styles.label}>Link button (optional, https only)</Text>
        <View style={styles.row}>
          <TextInput style={[styles.input, styles.flex1]} value={form.linkLabel} onChangeText={(v) => set('linkLabel', v)} placeholder={`Label (max ${LINK_LABEL_MAX})`} placeholderTextColor="#999" />
          <TextInput style={[styles.input, styles.flex2]} value={form.linkUrl} onChangeText={(v) => set('linkUrl', v)} placeholder="https://…" placeholderTextColor="#999" autoCapitalize="none" autoCorrect={false} />
        </View>

        <Text style={styles.label}>When (your local time, leave blank for now / no end)</Text>
        <View style={styles.row}>
          <TextInput style={[styles.input, styles.flex1]} value={form.startsAt} onChangeText={(v) => set('startsAt', v)} placeholder="Start: 2026-10-12 09:30" placeholderTextColor="#999" autoCapitalize="none" />
          <TextInput style={[styles.input, styles.flex1]} value={form.endsAt} onChangeText={(v) => set('endsAt', v)} placeholder="End: 2026-10-19 18:00" placeholderTextColor="#999" autoCapitalize="none" />
        </View>

        {showVersions && (
          <>
            <Text style={styles.label}>Customer app versions (optional)</Text>
            <View style={styles.row}>
              <TextInput style={[styles.input, styles.flex1]} value={form.minAppVersion} onChangeText={(v) => set('minAppVersion', v)} placeholder="Lowest, e.g. 1.0.0" placeholderTextColor="#999" autoCapitalize="none" />
              <TextInput style={[styles.input, styles.flex1]} value={form.maxAppVersion} onChangeText={(v) => set('maxAppVersion', v)} placeholder="Highest, e.g. 1.2.0" placeholderTextColor="#999" autoCapitalize="none" />
            </View>
          </>
        )}

        {/* Preview */}
        <Text style={styles.label}>Preview</Text>
        <View style={styles.preview}>
          <Text style={[styles.previewTag, previewImportant && styles.previewTagImportant]}>{previewImportant ? 'Important' : 'News'}</Text>
          <Text style={styles.previewTitle}>{form.title.trim() || 'Your title'}</Text>
          <Text style={styles.previewMessage}>{form.message.trim() || 'Your message appears here.'}</Text>
          {!!form.linkLabel.trim() && <Text style={styles.previewLink}>{form.linkLabel.trim()}</Text>}
          <Text style={styles.previewOk}>OK</Text>
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}
        {!error && !built.ok && (form.title || form.message) ? <Text style={styles.hint}>{built.error}</Text> : null}

        <View style={styles.row}>
          <TouchableOpacity style={[styles.publishBtn, saving && styles.disabled]} onPress={publish} disabled={saving} accessibilityRole="button">
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.publishText}>{editingId ? 'Save changes' : 'Publish'}</Text>}
          </TouchableOpacity>
          {!!(editingId || form.title || form.message) && (
            <TouchableOpacity style={styles.cancelBtn} onPress={reset} accessibilityRole="button">
              <Text style={styles.cancelText}>{editingId ? 'Cancel edit' : 'Clear'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* The list */}
      <Text style={styles.listTitle}>All announcements</Text>
      {loading && <ActivityIndicator size="small" color="#1565C0" style={{ alignSelf: 'flex-start' }} />}
      {failed && <Text style={styles.error}>The list could not be loaded. Check that migration 128 is applied.</Text>}
      {!loading && !failed && rows.length === 0 && <Text style={styles.hint}>Nothing yet.</Text>}
      {rows.map((r) => {
        const status = describeStatus(r.status);
        const tone = TONES[status.tone];
        const versions = describeVersions(r);
        return (
          <View key={r.id} style={styles.item}>
            <View style={styles.itemTop}>
              <Text style={styles.itemTitle} numberOfLines={1}>{r.title}</Text>
              <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>{status.label}</Text>
            </View>
            <Text style={styles.itemMeta}>
              {describeAudience(r.audience)} · {r.kind === 'important' ? 'Important' : 'Info'} · {describeWindow(r)}
              {versions ? ` · ${versions}` : ''}
            </Text>
            <Text style={styles.itemMessage} numberOfLines={3}>{r.message}</Text>
            <View style={styles.row}>
              <TouchableOpacity onPress={() => { setForm(formFromRow(r)); setEditingId(r.id); setError(null); }} accessibilityRole="button">
                <Text style={styles.action}>Edit</Text>
              </TouchableOpacity>
              {r.status !== 'ended' && (
                <TouchableOpacity disabled={busyId === r.id} onPress={() => act(r.id, () => endAnnouncement(r.id), r.status === 'live' ? 'The announcement has ended.' : 'The scheduled announcement was cancelled.')} accessibilityRole="button">
                  <Text style={styles.action}>{r.status === 'live' ? 'End now' : 'Cancel'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity disabled={busyId === r.id} onPress={async () => { if (await confirmDialog('Delete announcement?', 'Delete this announcement for good?', { confirmText: 'Delete', destructive: true })) act(r.id, () => deleteAnnouncement(r.id), 'Deleted.'); }} accessibilityRole="button">
                <Text style={[styles.action, styles.danger]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 14, lineHeight: 18 },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e0e0e0', padding: 14, marginBottom: 18 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#222' },
  label: { fontSize: 11, fontWeight: '700', color: '#666', marginTop: 12, marginBottom: 5 },
  hint: { fontSize: 11, color: '#888', marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  flex1: { flex: 1, minWidth: 140 },
  flex2: { flex: 2, minWidth: 180 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#444' },
  chipTextOn: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#222', backgroundColor: '#fff' },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  preview: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 14, padding: 14, backgroundColor: '#fafafa' },
  previewTag: { alignSelf: 'flex-start', fontSize: 10, fontWeight: '800', color: '#1565C0', backgroundColor: '#E3F2FD', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 8, overflow: 'hidden' },
  previewTagImportant: { color: '#E65100', backgroundColor: '#FFF3E0' },
  previewTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 6 },
  previewMessage: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 10 },
  previewLink: { alignSelf: 'flex-start', borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, color: '#1565C0', fontWeight: '700', fontSize: 13, marginBottom: 8, overflow: 'hidden' },
  previewOk: { backgroundColor: '#1565C0', color: '#fff', textAlign: 'center', borderRadius: 10, paddingVertical: 9, fontWeight: '700', overflow: 'hidden' },
  error: { fontSize: 12, color: '#c62828', marginTop: 10 },
  publishBtn: { marginTop: 14, backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 22, paddingVertical: 11 },
  publishText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  cancelBtn: { marginTop: 14, paddingHorizontal: 14, paddingVertical: 11 },
  cancelText: { color: '#666', fontWeight: '700', fontSize: 13 },
  disabled: { opacity: 0.5 },
  listTitle: { fontSize: 15, fontWeight: '800', color: '#222', marginBottom: 8 },
  item: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e6e6e6', padding: 12, marginBottom: 10 },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  itemTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: '#222' },
  badge: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  itemMeta: { fontSize: 11, color: '#888', marginTop: 3 },
  itemMessage: { fontSize: 12, color: '#555', marginTop: 6, marginBottom: 8, lineHeight: 17 },
  action: { fontSize: 12, fontWeight: '800', color: '#1565C0', paddingVertical: 4 },
  danger: { color: '#c62828' },
});
