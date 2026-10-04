import {
  emptyMenuItemForm,
  formFromItem,
  validateMenuItemForm,
  MAX_ITEM_NAME_LENGTH,
  MenuItemFormValues,
} from './menuItemForm';
import type { EditableMenuItem } from '../api/menuAdmin';

function validForm(overrides: Partial<MenuItemFormValues> = {}): MenuItemFormValues {
  return {
    ...emptyMenuItemForm(),
    name: 'Crunchy Taco',
    calories: '170',
    protein_g: '8',
    total_carbs_g: '13',
    total_fat_g: '9',
    sodium_mg: '310',
    ...overrides,
  };
}

describe('emptyMenuItemForm', () => {
  it('starts with blank fields, unverified and in stock', () => {
    const form = emptyMenuItemForm();
    expect(form.name).toBe('');
    expect(form.calories).toBe('');
    expect(form.is_verified).toBe(false);
    expect(form.is_out_of_stock).toBe(false);
  });
});

describe('formFromItem', () => {
  const item: EditableMenuItem = {
    item_id: 'i1',
    name: 'Burrito',
    calories: 500,
    protein_g: 20.5,
    total_carbs_g: 60,
    total_fat_g: 18,
    saturated_fat_g: 6,
    sodium_mg: 1100,
    dietary_fiber_g: 7,
    sugars_g: 4,
    serving_weight_grams: 250,
    is_verified: true,
    is_out_of_stock: true,
    nutrition_source: 'owner_provided',
  };

  it('turns every value into text and keeps the flags', () => {
    expect(formFromItem(item)).toEqual({
      name: 'Burrito',
      calories: '500',
      protein_g: '20.5',
      total_carbs_g: '60',
      total_fat_g: '18',
      saturated_fat_g: '6',
      sodium_mg: '1100',
      dietary_fiber_g: '7',
      sugars_g: '4',
      serving_weight_grams: '250',
      is_verified: true,
      is_out_of_stock: true,
    });
  });

  it('maps null values to empty text', () => {
    const form = formFromItem({ ...item, saturated_fat_g: null, serving_weight_grams: null, calories: null });
    expect(form.saturated_fat_g).toBe('');
    expect(form.serving_weight_grams).toBe('');
    expect(form.calories).toBe('');
  });

  it('round-trips through validation unchanged', () => {
    const result = validateMenuItemForm(formFromItem(item));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: 'Burrito',
        calories: 500,
        protein_g: 20.5,
        total_carbs_g: 60,
        total_fat_g: 18,
        saturated_fat_g: 6,
        sodium_mg: 1100,
        dietary_fiber_g: 7,
        sugars_g: 4,
        serving_weight_grams: 250,
        is_verified: true,
        is_out_of_stock: true,
      });
    }
  });
});

describe('validateMenuItemForm — valid input', () => {
  it('parses the required fields and defaults the optional ones', () => {
    const result = validateMenuItemForm(validForm());
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Crunchy Taco',
        calories: 170,
        protein_g: 8,
        total_carbs_g: 13,
        total_fat_g: 9,
        saturated_fat_g: 0,
        sodium_mg: 310,
        dietary_fiber_g: 0,
        sugars_g: 0,
        serving_weight_grams: null,
        is_verified: false,
        is_out_of_stock: false,
      },
    });
  });

  it('trims the name and numbers', () => {
    const result = validateMenuItemForm(validForm({ name: '  Soft Taco  ', calories: ' 180 ' }));
    expect(result.ok && result.value.name).toBe('Soft Taco');
    expect(result.ok && result.value.calories).toBe(180);
  });

  it('accepts decimals where allowed and zero for required fields', () => {
    const result = validateMenuItemForm(validForm({ calories: '0', protein_g: '0.5', sodium_mg: '0' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.calories).toBe(0);
      expect(result.value.protein_g).toBe(0.5);
      expect(result.value.sodium_mg).toBe(0);
    }
  });

  it('keeps an explicit serving size and the flags', () => {
    const result = validateMenuItemForm(
      validForm({ serving_weight_grams: '85.5', is_verified: true, is_out_of_stock: true })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.serving_weight_grams).toBe(85.5);
      expect(result.value.is_verified).toBe(true);
      expect(result.value.is_out_of_stock).toBe(true);
    }
  });

  it('accepts the maximum allowed values', () => {
    const result = validateMenuItemForm(
      validForm({
        name: 'x'.repeat(MAX_ITEM_NAME_LENGTH),
        calories: '10000',
        protein_g: '1000',
        sodium_mg: '50000',
        serving_weight_grams: '5000',
      })
    );
    expect(result.ok).toBe(true);
  });
});

describe('validateMenuItemForm — invalid input', () => {
  function errorsFor(values: MenuItemFormValues) {
    const result = validateMenuItemForm(values);
    expect(result.ok).toBe(false);
    return result.ok ? {} : result.errors;
  }

  it('requires a name and every required number', () => {
    const errors = errorsFor(emptyMenuItemForm());
    expect(Object.keys(errors).sort()).toEqual(
      ['calories', 'name', 'protein_g', 'sodium_mg', 'total_carbs_g', 'total_fat_g'].sort()
    );
  });

  it('treats a whitespace-only name as missing', () => {
    expect(errorsFor(validForm({ name: '   ' })).name).toBe('Name is required');
  });

  it('rejects an over-long name', () => {
    expect(errorsFor(validForm({ name: 'x'.repeat(MAX_ITEM_NAME_LENGTH + 1) })).name).toMatch(/or fewer/);
  });

  it.each(['-5', 'abc', '1e3', '12.5.1', '1,5', '$5', '5 0', '+5', '.5', '5.'])(
    'rejects "%s" as a number',
    (bad) => {
      expect(errorsFor(validForm({ protein_g: bad })).protein_g).toBe('Protein must be a positive number');
    }
  );

  it('requires whole numbers for calories and sodium', () => {
    expect(errorsFor(validForm({ calories: '170.5' })).calories).toBe('Calories must be a whole number');
    expect(errorsFor(validForm({ sodium_mg: '310.2' })).sodium_mg).toBe('Sodium must be a whole number');
  });

  it('enforces the upper limits', () => {
    expect(errorsFor(validForm({ calories: '10001' })).calories).toMatch(/10000 or less/);
    expect(errorsFor(validForm({ total_fat_g: '1001' })).total_fat_g).toMatch(/1000 or less/);
    expect(errorsFor(validForm({ sodium_mg: '50001' })).sodium_mg).toMatch(/50000 or less/);
    expect(errorsFor(validForm({ serving_weight_grams: '5001' })).serving_weight_grams).toMatch(/5000 or less/);
  });

  it('rejects a zero serving size but allows it to be blank', () => {
    expect(errorsFor(validForm({ serving_weight_grams: '0' })).serving_weight_grams).toBe(
      'Serving size must be greater than 0'
    );
    const blank = validateMenuItemForm(validForm({ serving_weight_grams: '' }));
    expect(blank.ok && blank.value.serving_weight_grams).toBeNull();
  });

  it('reports every problem at once, not just the first', () => {
    const errors = errorsFor(validForm({ name: '', calories: 'abc', protein_g: '-1' }));
    expect(Object.keys(errors).sort()).toEqual(['calories', 'name', 'protein_g']);
  });

  it('validates optional fields when they are filled in', () => {
    expect(errorsFor(validForm({ sugars_g: 'lots' })).sugars_g).toMatch(/positive number/);
    expect(errorsFor(validForm({ dietary_fiber_g: '-2' })).dietary_fiber_g).toMatch(/positive number/);
    expect(errorsFor(validForm({ saturated_fat_g: '2000' })).saturated_fat_g).toMatch(/1000 or less/);
  });
});
