import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { createCoupon } from '../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';

// Type for HTML input element
declare global {
  namespace JSX {
    interface IntrinsicElements {
      input: any;
    }
  }
}

type CouponType = 'item_percent' | 'item_fixed' | 'generic_percent' | 'generic_fixed';

interface MenuItem {
  id: string;
  name: string;
  item_id: string;
}

export default function NewCouponScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ menuItemId?: string; menuItemName?: string }>();
  const { restaurant } = useRestaurantOwnerStore();
  const [couponType, setCouponType] = useState<CouponType>('generic_percent');
  const [discount, setDiscount] = useState('');
  const [code, setCode] = useState('');
  const [menuItemId, setMenuItemId] = useState(params?.menuItemId || '');
  const [selectedMenuItemName, setSelectedMenuItemName] = useState(params?.menuItemName || '');
  const [usageLimit, setUsageLimit] = useState('');
  const [expiryDate, setExpiryDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ code?: string; discount?: string; menuItem?: string; usageLimit?: string }>({});

  // Validate on input change
  const validateForm = () => {
    const newErrors: typeof errors = {};
    if (!code.trim()) newErrors.code = 'Coupon code is required';
    if (!discount.trim()) newErrors.discount = 'Discount value is required';
    if (couponType.includes('item') && !menuItemId.trim()) newErrors.menuItem = 'Menu item is required';
    if (!usageLimit.trim()) {
      newErrors.usageLimit = 'Usage limit is required';
    } else if (!Number.isInteger(Number(usageLimit)) || Number(usageLimit) <= 0) {
      newErrors.usageLimit = 'Enter a whole number greater than 0';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // If menu item was passed, default to item-specific coupon type
  useEffect(() => {
    if (params?.menuItemId && !couponType.includes('item')) {
      setCouponType('item_percent');
    }
  }, [params?.menuItemId]);

  // Generate random coupon code
  const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let newCode = '';
    for (let i = 0; i < 8; i++) {
      newCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCode(newCode);
    if (errors.code) setErrors(prev => ({ ...prev, code: undefined }));
  };

  if (!restaurant) return null;

  const couponTypes: { label: string; value: CouponType }[] = [
    { label: '% off item', value: 'item_percent' },
    { label: '$ off item', value: 'item_fixed' },
    { label: '% off total', value: 'generic_percent' },
    { label: '$ off total', value: 'generic_fixed' },
  ];

  async function handleCreate() {
    console.log('[coupon-new] Create button pressed');

    if (!validateForm()) {
      console.log('[coupon-new] Validation failed:', errors);
      return;
    }

    console.log('[coupon-new] Validation passed, creating coupon...');
    setLoading(true);
    try {
      console.log('[coupon-new] Calling createCoupon with:', {
        restaurantId: restaurant.id,
        couponType,
        discountValue: parseFloat(discount),
        couponCode: code.toUpperCase().trim(),
        expiryDate: expiryDate.toISOString(),
        menuItemId: menuItemId.trim() || undefined,
        usageLimit: usageLimit ? parseInt(usageLimit) : undefined,
      });

      // Only include menuItemId for item-specific coupons
      const finalMenuItemId = couponType.includes('item') ? (menuItemId.trim() || undefined) : undefined;

      await createCoupon({
        restaurantId: restaurant.id,
        couponType,
        discountValue: parseFloat(discount),
        couponCode: code.toUpperCase().trim(),
        expiryDate: expiryDate.toISOString(),
        menuItemId: finalMenuItemId,
        usageLimit: parseInt(usageLimit, 10),
      });

      console.log('[coupon-new] createCoupon called with:', { couponType, menuItemId: finalMenuItemId });

      console.log('[coupon-new] Coupon created successfully, navigating to menu');
      setLoading(false);

      // Navigate immediately, then show confirmation
      router.replace('/restaurant/menu');

      // Show success message after navigation
      setTimeout(() => {
        Alert.alert('Success', 'Coupon created! ✓');
      }, 500);
    } catch (error: any) {
      console.error('[coupon-new] Create error:', JSON.stringify(error, null, 2));
      setLoading(false);

      let errorMessage = 'Failed to create coupon';

      // Handle duplicate coupon code
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        errorMessage = `Coupon code "${code.toUpperCase()}" already exists. Please use a different code.`;
      } else if (error.message) {
        errorMessage = error.message;
      }

      Alert.alert('Error', errorMessage);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container}>
        <View style={styles.content}>
        <Text style={styles.title}>Create New Coupon</Text>

        {/* Coupon Type */}
        <Text style={styles.label}>Coupon Type</Text>
        <View style={styles.typeGrid}>
          {couponTypes.map((type) => (
            <TouchableOpacity
              key={type.value}
              style={[
                styles.typeBtn,
                couponType === type.value && styles.typeBtnActive,
              ]}
              onPress={() => setCouponType(type.value)}
            >
              <Text
                style={[
                  styles.typeBtnText,
                  couponType === type.value && styles.typeBtnTextActive,
                ]}
              >
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Coupon Code */}
        <Text style={styles.label}>Coupon Code *</Text>
        <View style={styles.codeInputRow}>
          <TextInput
            style={[styles.input, styles.codeInput, errors.code && styles.inputError]}
            placeholder="e.g., SAVE15"
            placeholderTextColor="#999"
            value={code}
            onChangeText={(text) => {
              setCode(text);
              if (text.trim()) setErrors(prev => ({ ...prev, code: undefined }));
            }}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={styles.generateBtn}
            onPress={generateCode}
          >
            <Text style={styles.generateBtnText}>🎲 Generate</Text>
          </TouchableOpacity>
        </View>
        {errors.code && <Text style={styles.errorText}>{errors.code}</Text>}

        {/* Discount Value */}
        <Text style={styles.label}>Discount Value *</Text>
        <View style={styles.discountRow}>
          <TextInput
            style={[styles.input, styles.discountInput, errors.discount && styles.inputError]}
            placeholder="15"
            placeholderTextColor="#999"
            keyboardType="decimal-pad"
            value={discount}
            onChangeText={(text) => {
              setDiscount(text);
              if (text.trim()) setErrors(prev => ({ ...prev, discount: undefined }));
            }}
          />
          <Text style={styles.discountUnit}>
            {couponType.includes('percent') ? '%' : '$'}
          </Text>
        </View>

        {/* Menu Item (for item-specific coupons) */}
        {couponType.includes('item') && selectedMenuItemName && (
          <>
            <Text style={styles.label}>Menu Item</Text>
            <View style={styles.selectedItemBox}>
              <Text style={styles.selectedItemText}>✓ {selectedMenuItemName}</Text>
            </View>
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
          style={[styles.input, errors.usageLimit && styles.inputError]}
          placeholder="e.g., 100"
          placeholderTextColor="#999"
          keyboardType="number-pad"
          value={usageLimit}
          onChangeText={(text) => {
            setUsageLimit(text);
            if (text.trim()) setErrors(prev => ({ ...prev, usageLimit: undefined }));
          }}
        />
        {errors.usageLimit && <Text style={styles.errorText}>{errors.usageLimit}</Text>}

        {/* Expiry Date */}
        <Text style={styles.label}>Expiry Date</Text>
        {Platform.OS === 'web' ? (
          <input
            type="date"
            value={expiryDate.toISOString().split('T')[0]}
            onChange={(e) => {
              console.log('[coupon] Date changed:', e.target.value);
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
              console.log('[coupon] Opening date picker');
              setShowDatePicker(true);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.datePickerText}>
              📅 {expiryDate.toDateString()}
            </Text>
          </TouchableOpacity>
        )}


        {/* Action Buttons */}
        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.createBtnText}>✓ Create Coupon</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => router.replace('/restaurant/dashboard')}
          >
            <Text style={styles.cancelBtnText}>✕ Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>

      {showDatePicker && (
        <>
          <DateTimePicker
            value={expiryDate}
            mode="date"
            display="default"
            onChange={(event, selectedDate) => {
              if (selectedDate) {
                setExpiryDate(selectedDate);
              }
              if (Platform.OS === 'android') {
                setShowDatePicker(false);
              }
            }}
            minimumDate={new Date()}
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={styles.confirmDateBtn}
              onPress={() => setShowDatePicker(false)}
            >
              <Text style={styles.confirmDateText}>Done</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#222', marginBottom: 8, marginTop: 12 },
  helpText: { fontSize: 12, color: '#888', lineHeight: 17, marginTop: -4, marginBottom: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeBtn: {
    flex: 1,
    minWidth: '48%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  typeBtnActive: { borderColor: '#4CAF50', backgroundColor: '#E8F5E9' },
  typeBtnText: { fontSize: 12, fontWeight: '600', color: '#666' },
  typeBtnTextActive: { color: '#2e7d32' },
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
  inputError: { borderColor: '#e53e3e', borderWidth: 2 },
  errorText: { fontSize: 12, color: '#e53e3e', fontWeight: '600', marginBottom: 8, marginTop: -8 },
  codeInputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  codeInput: { flex: 1, marginBottom: 0 },
  generateBtn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 0, justifyContent: 'center', alignItems: 'center', minHeight: 40 },
  generateBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  discountInput: { flex: 1, marginBottom: 0 },
  discountUnit: { fontSize: 18, fontWeight: '800', color: '#4CAF50', minWidth: 30, textAlign: 'center' },
  selectedItemBox: { backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#4CAF50', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectedItemText: { fontSize: 14, fontWeight: '600', color: '#2e7d32', flex: 1 },
  changeItemLink: { fontSize: 12, fontWeight: '600', color: '#4CAF50', textDecorationLine: 'underline' },
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
  confirmDateBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  confirmDateText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  buttonGroup: { flexDirection: 'row', gap: 10, marginTop: 20 },
  createBtn: {
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
  createBtnDisabled: { opacity: 0.6 },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
