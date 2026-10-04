import type { EditableMenuItem } from '../api/menuAdmin';

// The Manual Edit form keeps every field as text (what a TextInput gives us);
// validateMenuItemForm turns it into the numbers the database function expects,
// or returns per-field error messages.
export interface MenuItemFormValues {
  name: string;
  calories: string;
  protein_g: string;
  total_carbs_g: string;
  total_fat_g: string;
  saturated_fat_g: string;
  sodium_mg: string;
  dietary_fiber_g: string;
  sugars_g: string;
  serving_weight_grams: string;
  is_verified: boolean;
  is_out_of_stock: boolean;
}

export type MenuItemFormField = keyof MenuItemFormValues;

export interface ParsedMenuItem {
  name: string;
  calories: number;
  protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  saturated_fat_g: number;
  sodium_mg: number;
  dietary_fiber_g: number;
  sugars_g: number;
  serving_weight_grams: number | null;
  is_verified: boolean;
  is_out_of_stock: boolean;
}

export type MenuItemFormResult =
  | { ok: true; value: ParsedMenuItem }
  | { ok: false; errors: Partial<Record<MenuItemFormField, string>> };

export const MAX_ITEM_NAME_LENGTH = 120;

export function emptyMenuItemForm(): MenuItemFormValues {
  return {
    name: '',
    calories: '',
    protein_g: '',
    total_carbs_g: '',
    total_fat_g: '',
    saturated_fat_g: '',
    sodium_mg: '',
    dietary_fiber_g: '',
    sugars_g: '',
    serving_weight_grams: '',
    // New admin-created items start unverified; the admin can flip it.
    is_verified: false,
    is_out_of_stock: false,
  };
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

export function formFromItem(item: EditableMenuItem): MenuItemFormValues {
  return {
    name: item.name,
    calories: str(item.calories),
    protein_g: str(item.protein_g),
    total_carbs_g: str(item.total_carbs_g),
    total_fat_g: str(item.total_fat_g),
    saturated_fat_g: str(item.saturated_fat_g),
    sodium_mg: str(item.sodium_mg),
    dietary_fiber_g: str(item.dietary_fiber_g),
    sugars_g: str(item.sugars_g),
    serving_weight_grams: str(item.serving_weight_grams),
    is_verified: item.is_verified,
    is_out_of_stock: item.is_out_of_stock,
  };
}

const NUMBER_RE = /^\d+(\.\d+)?$/;

interface NumberRule {
  field: MenuItemFormField;
  label: string;
  required: boolean;
  integer: boolean;
  max: number;
  // Must be greater than zero (serving size) rather than just non-negative.
  positive?: boolean;
}

const NUMBER_RULES: NumberRule[] = [
  { field: 'calories', label: 'Calories', required: true, integer: true, max: 10000 },
  { field: 'protein_g', label: 'Protein', required: true, integer: false, max: 1000 },
  { field: 'total_carbs_g', label: 'Carbs', required: true, integer: false, max: 1000 },
  { field: 'total_fat_g', label: 'Fat', required: true, integer: false, max: 1000 },
  { field: 'sodium_mg', label: 'Sodium', required: true, integer: true, max: 50000 },
  { field: 'saturated_fat_g', label: 'Saturated fat', required: false, integer: false, max: 1000 },
  { field: 'dietary_fiber_g', label: 'Fiber', required: false, integer: false, max: 1000 },
  { field: 'sugars_g', label: 'Sugars', required: false, integer: false, max: 1000 },
  { field: 'serving_weight_grams', label: 'Serving size', required: false, integer: false, max: 5000, positive: true },
];

export function validateMenuItemForm(values: MenuItemFormValues): MenuItemFormResult {
  const errors: Partial<Record<MenuItemFormField, string>> = {};
  const parsed: Record<string, number | null> = {};

  const name = values.name.trim();
  if (!name) errors.name = 'Name is required';
  else if (name.length > MAX_ITEM_NAME_LENGTH) errors.name = `Name must be ${MAX_ITEM_NAME_LENGTH} characters or fewer`;

  for (const rule of NUMBER_RULES) {
    const raw = String(values[rule.field] ?? '').trim();

    if (raw === '') {
      if (rule.required) errors[rule.field] = `${rule.label} is required`;
      // Optional fields: saturated fat / fiber / sugars default to 0, serving size to none.
      parsed[rule.field] = rule.field === 'serving_weight_grams' ? null : 0;
      continue;
    }
    if (!NUMBER_RE.test(raw)) {
      errors[rule.field] = `${rule.label} must be a positive number`;
      continue;
    }
    const num = Number(raw);
    if (rule.integer && !Number.isInteger(num)) {
      errors[rule.field] = `${rule.label} must be a whole number`;
      continue;
    }
    if (rule.positive && num <= 0) {
      errors[rule.field] = `${rule.label} must be greater than 0`;
      continue;
    }
    if (num > rule.max) {
      errors[rule.field] = `${rule.label} must be ${rule.max} or less`;
      continue;
    }
    parsed[rule.field] = num;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      calories: parsed.calories as number,
      protein_g: parsed.protein_g as number,
      total_carbs_g: parsed.total_carbs_g as number,
      total_fat_g: parsed.total_fat_g as number,
      saturated_fat_g: parsed.saturated_fat_g as number,
      sodium_mg: parsed.sodium_mg as number,
      dietary_fiber_g: parsed.dietary_fiber_g as number,
      sugars_g: parsed.sugars_g as number,
      serving_weight_grams: parsed.serving_weight_grams,
      is_verified: values.is_verified,
      is_out_of_stock: values.is_out_of_stock,
    },
  };
}
