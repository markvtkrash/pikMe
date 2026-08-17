import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { updateCoupon, deleteCoupon, getRestaurantCoupons } from '../../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../../src/store/restaurantOwnerStore';

// Type for HTML input element
declare global {
  namespace JSX {
    interface IntrinsicElements {
      input: any;
    }
  }
}

type CouponType = 'item_percent' | 'item_fixed' | 'generic_percent' | 'generic_fixed';

interface Coupon {
  id: string;
  coupon_type: CouponType;
  discount_value: number;
  coupon_code: string;
  menu_item_id?: string;
  usage_limit?: number;
  expiry_date: string;
  is_active: boolean;
}

export default function EditCouponScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { restaurant } = useRestaurantOwnerStore();

  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [discount, setDiscount] = useState('');
  const [code, setCode] = useState('');
  const [menuItemId, setMenuItemId] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [expiryDate, setExpiryDate] = useState(new Date());
  const [isActive, setIsActive] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [usageLimitError, setUsageLimitError] = useState<string | undefined>();

  useEffect(() => {
    loadCoupon();
  }, [id]);

  async function loadCoupon() {
    if (!restaurant || !id) {
      console.log('[edit] Missing restaurant or id:', { restaurant: !!restaurant, id });
      return;
    }

    try {
      console.log('[edit] Loading coupon:', id, 'for restaurant:', restaurant.id);
      const coupons = await getRestaurantCoupons(restaurant.id);
      console.log('[edit] Loaded coupons:', coupons);
      const found = coupons.find((c: Coupon) => c.id === id);
      if (found) {
        console.log('[edit] Found coupon:', found);
        setCoupon(found);
        setDiscount(found.discount_value.toString());
        setCode(found.coupon_code);
        setMenuItemId(found.menu_item_id || '');
        setUsageLimit(found.usage_limit?.toString() || '');
        setExpiryDate(new Date(found.expiry_date));
        setIsActive(found.is_active);
      } else {
        console.warn('[edit] Coupon not found:', id);
      }
    } catch (error: any) {
      console.error('[edit] Load error:', JSON.stringify(error, null, 2));
      Alert.alert('Error', 'Failed to load coupon: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate() {
    console.log('[coupon-edit] Update button pressed');

    if (!coupon || !discount.trim() || !code.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (!usageLimit.trim()) {
      setUsageLimitError('Usage limit is required');
      Alert.alert('Error', 'Usage limit is required');
      return;
    }
    if (!Number.isInteger(Number(usageLimit)) || Number(usageLimit) <= 0) {
      setUsageLimitError('Enter a whole number greater than 0');
      Alert.alert('Error', 'Usage limit must be a whole number greater than 0');
      return;
    }
    setUsageLimitError(undefined);

    console.log('[coupon-edit] Validation passed, updating...');
    setUpdating(true);
    try {
      console.log('[coupon-edit] Calling updateCoupon:', coupon.id);
      await updateCoupon(coupon.id, {
        discountValue: parseFloat(discount),
        couponCode: code.toUpperCase().trim(),
        expiryDate: expiryDate.toISOString(),
        menuItemId: menuItemId.trim() || undefined,
        usageLimit: parseInt(usageLimit, 10),
        isActive,
      });

      console.log('[coupon-edit] Coupon updated successfully');
      setUpdating(false);

      // Navigate back to menu automatically
      router.replace('/restaurant/menu');
    } catch (error: any) {
      console.error('[coupon-edit] Update error:', JSON.stringify(error, null, 2));
      setUpdating(false);

      let errorMessage = 'Failed to update coupon';

      // Handle duplicate coupon code
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        errorMessage = `Coupon code "${code.toUpperCase()}" already exists. Please use a different code.`;
      } else if (error.message) {
        errorMessage = error.message;
      }

      Alert.alert('Error', errorMessage);
    }
  }

  async function handleDelete() {
    console.log('[coupon-edit] handleDelete called, coupon:', coupon?.id);
    if (!coupon) {
      console.error('[coupon-edit] No coupon found');
      return;
    }

    console.log('[coupon-edit] Showing delete confirmation alert');
    Alert.alert(
      'Delete Coupon',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => console.log('[coupon-edit] Delete cancelled') },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            console.log('[coupon-edit] Delete confirmed, calling deleteCoupon');
            setDeleting(true);
            try {
              await deleteCoupon(coupon.id);
              console.log('[coupon-edit] Coupon deleted successfully');
              setDeleting(false);

              // Navigate immediately
              router.replace('/restaurant/menu');

              // Show success message after navigation
              setTimeout(() => {
                Alert.alert('Success', 'Coupon deleted');
              }, 500);
            } catch (error: any) {
              console.error('[coupon-edit] Delete error:', error.message);
              setDeleting(false);
              Alert.alert('Error', error.message);
            }
          },
        },
      ]
    );
  }

  if (loading || !coupon) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  const couponTypes: { label: string; value: CouponType }[] = [
    { label: '% off item', value: 'item_percent' },
    { label: '$ off item', value: 'item_fixed' },
    { label: '% off total', value: 'generic_percent' },
    { label: '$ off total', value: 'generic_fixed' },
  ];

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text style={styles.title}>Edit Coupon</Text>

          {/* Coupon Type (read-only) */}
          <Text style={styles.label}>Coupon Type</Text>
          <View style={styles.typeDisplay}>
            <Text style={styles.typeDisplayText}>
              {couponTypes.find(t => t.value === coupon.coupon_type)?.label}
            </Text>
          </View>

          {/* Coupon Code */}
          <Text style={styles.label}>Coupon Code</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., SAVE15"
            placeholderTextColor="#999"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
          />

          {/* Discount Value */}
          <Text style={styles.label}>Discount Value</Text>
          <View style={styles.discountRow}>
            <TextInput
              style={[styles.input, styles.discountInput]}
              placeholder="15"
              placeholderTextColor="#999"
              keyboardType="decimal-pad"
              value={discount}
              onChangeText={setDiscount}
            />
            <Text style={styles.discountUnit}>
              {coupon.coupon_type.includes('percent') ? '%' : '$'}
            </Text>
          </View>

          {/* Menu Item ID */}
          {coupon.coupon_type.includes('item') && (
            <>
              <Text style={styles.label}>Menu Item ID</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., nix_12345"
                placeholderTextColor="#999"
                value={menuItemId}
                onChangeText={setMenuItemId}
              />
            </>
          )}

          {/* Usage Limit */}
          <Text style={styles.label}>Usage Limit *</Text>
          <Text style={styles.helpText}>
            The maximum number of customers who can activate this coupon in total.
            Once that many people have activated it, it stops appearing for anyone
            else — so pick a number you can actually honor at the register.
          </Text>
          <TextInput
            style={[styles.input, usageLimitError && styles.inputError]}
            placeholder="e.g., 100"
            placeholderTextColor="#999"
            keyboardType="number-pad"
            value={usageLimit}
            onChangeText={(text) => {
              setUsageLimit(text);
              if (text.trim()) setUsageLimitError(undefined);
            }}
          />
          {usageLimitError && <Text style={styles.errorText}>{usageLimitError}</Text>}

          {/* Expiry Date */}
          <Text style={styles.label}>Expiry Date</Text>
          {Platform.OS === 'web' ? (
            <input
              type="date"
              value={expiryDate.toISOString().split('T')[0]}
              onChange={(e) => {
                console.log('[edit] Date changed:', e.target.value);
                setExpiryDate(new Date(e.target.value + 'T00:00:00'));
              }}
              style={{
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#ddd',
                fontSize: 16,
                fontFamily: 'System',
              }}
            />
          ) : (
            <TouchableOpacity
              style={styles.datePicker}
              onPress={() => {
                console.log('[edit] Date picker button pressed');
                setShowDatePicker(true);
              }}
            >
              <Text style={styles.datePickerText}>
                {expiryDate.toDateString()}
              </Text>
            </TouchableOpacity>
          )}

          {/* Active Status */}
          <Text style={styles.label}>Status</Text>
          <TouchableOpacity
            style={styles.statusToggle}
            onPress={() => setIsActive(!isActive)}
          >
            <View style={[styles.statusToggleBg, isActive && styles.statusToggleBgActive]}>
              <Text style={styles.statusToggleText}>
                {isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Action Buttons */}
          <View style={styles.buttonGroup}>
            <TouchableOpacity
              style={[styles.updateBtn, updating && styles.updateBtnDisabled]}
              onPress={() => {
                console.log('[edit] Save button clicked, updating:', updating);
                handleUpdate();
              }}
              disabled={updating}
            >
              {updating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.updateBtnText}>✓ Save Changes</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => router.replace('/restaurant/menu')}
            >
              <Text style={styles.cancelBtnText}>✕ Cancel</Text>
            </TouchableOpacity>
          </View>

          {/* Delete Button */}
          <TouchableOpacity
            style={[styles.deleteBtn, deleting && styles.deleteBtnDisabled]}
            onPress={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator color="#e53e3e" size="small" />
            ) : (
              <Text style={styles.deleteBtnText}>🗑️ Delete Coupon</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={expiryDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selectedDate) => {
            setShowDatePicker(false);
            if (selectedDate) setExpiryDate(selectedDate);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  scrollView: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#222', marginBottom: 8, marginTop: 12 },
  helpText: { fontSize: 12, color: '#888', lineHeight: 17, marginTop: -4, marginBottom: 8 },
  inputError: { borderColor: '#e53e3e', borderWidth: 2 },
  errorText: { fontSize: 12, color: '#e53e3e', fontWeight: '600', marginBottom: 8, marginTop: -8 },
  typeDisplay: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  typeDisplayText: { fontSize: 14, color: '#666' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#222',
    marginBottom: 12,
  },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  discountInput: { flex: 1, marginBottom: 0 },
  discountUnit: { fontSize: 18, fontWeight: '800', color: '#4CAF50', minWidth: 30, textAlign: 'center' },
  datePicker: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  datePickerText: { fontSize: 14, color: '#222' },
  statusToggle: { marginBottom: 12 },
  statusToggleBg: {
    backgroundColor: '#FFEBEE',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statusToggleBgActive: { backgroundColor: '#E8F5E9' },
  statusToggleText: { fontSize: 14, fontWeight: '600', color: '#222' },
  buttonGroup: { flexDirection: 'row', gap: 10, marginTop: 20 },
  updateBtn: {
    flex: 1.5,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#ddd',
  },
  cancelBtnText: { color: '#e53e3e', fontSize: 14, fontWeight: '700' },
  updateBtnDisabled: { opacity: 0.6 },
  updateBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  deleteBtn: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1.5,
    borderColor: '#e53e3e',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  deleteBtnDisabled: { opacity: 0.6 },
  deleteBtnText: { color: '#e53e3e', fontSize: 14, fontWeight: '700' },
});
