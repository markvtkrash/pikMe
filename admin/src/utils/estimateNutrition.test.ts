// Tests for the pure helpers of the estimate-menu-nutrition edge function (the owner's manual menu save).
import {
  buildNutritionPrompt, chunk, describeReply, failureMessage, isUnsupportedFieldError, MAX_NAMES, maxTokensFor,
  parseBatchSize, parseEstimateReply, parseModelParams, parseTimeoutMs, REQUEST_BUDGET_MS, retryCutoffMs, stripThinking,
  toNutrition, withNoThink, hasUsableNutrition, normalizeItemName, planEstimates, rowToNutrition, isValidPlaceId, savedAsVerified, outOfStockNames,
} from '../../../supabase/functions/estimate-menu-nutrition/nutritionUtils';

describe('settings', () => {
  it('batch size defaults to 10 and accepts 1 to 50', () => {
    expect(parseBatchSize()).toBe(10);
    expect(parseBatchSize(' 8 ')).toBe(8);
    expect(parseBatchSize('50')).toBe(50);
    for (const bad of ['', 'abc', '0', '51', '-2', '2.5']) expect(parseBatchSize(bad)).toBe(10);
    expect(parseBatchSize('x', '12')).toBe(12);
  });

  it('timeout defaults to 30 seconds (in ms) and accepts 5 to 120', () => {
    expect(parseTimeoutMs()).toBe(30000);
    expect(parseTimeoutMs('45')).toBe(45000);
    for (const bad of ['', 'x', '4', '121']) expect(parseTimeoutMs(bad)).toBe(30000);
  });

  it('a retry is allowed only while it could still finish inside the request budget', () => {
    expect(REQUEST_BUDGET_MS).toBe(55000);
    expect(retryCutoffMs(30000)).toBe(25000);
    expect(retryCutoffMs(120000)).toBe(0);
  });

  it('allows 200 tokens a dish, within 1024 to 12000', () => {
    expect(maxTokensFor(10)).toBe(2000);
    expect(maxTokensFor(1)).toBe(1024);
    expect(maxTokensFor(50)).toBe(10000);
    expect(maxTokensFor(500)).toBe(12000);
  });

  it('accepts up to 150 names, no longer the old 30', () => {
    expect(MAX_NAMES).toBe(150);
  });
});

describe('chunk', () => {
  it('splits into batches of at most the size, keeping the order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
    expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
  });
});

describe('buildNutritionPrompt', () => {
  it('numbers the names, fixes the count, and asks for compact output', () => {
    const p = buildNutritionPrompt('Cactus Grill', ['Taco', 'Burrito']);
    expect(p).toContain('"Cactus Grill"');
    expect(p).toContain('1. Taco\n2. Burrito');
    expect(p).toContain('exactly 2 entries');
    expect(p).toContain('one entry per line, no indentation');
    expect(p).toContain('- sugars_g (number)');
  });
});

describe('parseEstimateReply', () => {
  const entry = (n: string) => `{"name":"${n}","calories":300,"protein_g":10}`;

  it('reads a normal reply, with or without markdown fences, one line or many', () => {
    expect(parseEstimateReply(`[${entry('A')},${entry('B')}]`)).toHaveLength(2);
    expect(parseEstimateReply('```json\n[' + entry('A') + ']\n```')).toHaveLength(1);
    expect(parseEstimateReply(JSON.stringify([{ name: 'A' }, { name: 'B' }], null, 2))).toHaveLength(2);
  });

  it('keeps the complete entries when the reply was cut off mid-entry', () => {
    const cut = `[\n${entry('A')},\n${entry('B')},\n{"name":"C","calor`;
    expect(parseEstimateReply(cut)!.map((e) => e.name)).toEqual(['A', 'B']);
  });

  it('is not fooled by braces or escaped quotes inside a name', () => {
    const r = parseEstimateReply('[{"name":"Mac \\"N\\" } Cheese","calories":400},{"name":"Cut');
    expect(r).toHaveLength(1);
    expect(r![0].name).toBe('Mac "N" } Cheese');
  });

  it('returns null when nothing usable can be read', () => {
    for (const bad of ['', 'Sorry, I cannot do that.', '[{"name":"cut before the first entry ends', undefined as any]) {
      expect(parseEstimateReply(bad)).toBeNull();
    }
  });
});

describe('toNutrition', () => {
  it('rounds calories and sodium, keeps the other numbers, and turns missing or invalid values into 0', () => {
    expect(toNutrition({ calories: 170.6, sodium_mg: 310.4, protein_g: 8, totalCarbs_g: '13', totalFat_g: 'x' })).toEqual({
      calories: 171, totalFat_g: 0, saturatedFat_g: 0, sodium_mg: 310, totalCarbs_g: 13, dietaryFiber_g: 0, sugars_g: 0,
      protein_g: 8, servingWeightGrams: null,
    });
  });

  it('allows a zero-calorie item such as water', () => {
    expect(toNutrition({ name: 'Water', calories: 0 }).calories).toBe(0);
  });
});

describe('failureMessage', () => {
  it('says how many failed and that nothing was saved', () => {
    const m = failureMessage(7, 30);
    expect(m).toContain('7 of 30 items');
    expect(m).toContain('Nothing was saved');
    expect(m).toContain('try again');
  });
});

describe('reasoning text in the reply', () => {
  const entry = (n: string) => `{"name":"${n}","calories":300}`;

  it('stripThinking removes <think> blocks, including an unopened one', () => {
    expect(stripThinking('<think>hmm [1, 2]</think>[{"a":1}]')).toBe('[{"a":1}]');
    expect(stripThinking('reasoning with [brackets] first</think>\n[{"a":1}]')).toBe('[{"a":1}]');
    expect(stripThinking('[{"a":1}]')).toBe('[{"a":1}]');
    expect(stripThinking(undefined as any)).toBe('');
  });

  it('the list is found even when the model "thought" first, with brackets and braces in the thinking', () => {
    const reply = `<think>The user wants 2 items: [Taco, Burrito]. Format {name, calories}.</think>\n[${entry('Taco')},${entry('Burrito')}]`;
    expect(parseEstimateReply(reply)!.map((e) => e.name)).toEqual(['Taco', 'Burrito']);
  });

  it('describeReply gives a short one-line start of the reply for the log', () => {
    expect(describeReply('')).toBe('(empty reply)');
    expect(describeReply(null)).toBe('(empty reply)');
    expect(describeReply('line one\n\nline   two')).toBe('line one line two');
    const long = describeReply('x'.repeat(500));
    expect(long.length).toBe(201);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('the fast-model setup shared with the menu builds', () => {
  it('withNoThink adds /no_think only for Qwen 3 models, and only once', () => {
    expect(withNoThink('Hi', 'qwen3.8-max')).toBe('Hi\n\n/no_think');
    expect(withNoThink('Hi', 'Qwen-3-turbo')).toBe('Hi\n\n/no_think');
    expect(withNoThink('Hi\n\n/no_think', 'qwen3.8-max')).toBe('Hi\n\n/no_think');
    expect(withNoThink('Hi', 'deepseek-v4-flash')).toBe('Hi');
    expect(withNoThink('Hi', 'claude-haiku-4-5-20251001')).toBe('Hi');
  });

  it('parseModelParams reads name=value pairs, nesting on dots, and never sets the fields the function owns', () => {
    expect(parseModelParams('reasoning.enabled=false;temperature=0.2;label="a b";nothing=null')).toEqual({
      reasoning: { enabled: false }, temperature: 0.2, label: 'a b', nothing: null,
    });
    expect(parseModelParams('model=x;messages=y;max_tokens=5;stream=true;n=3')).toEqual({});
    expect(parseModelParams('__proto__.x=1;constructor.y=2')).toEqual({});
    expect(parseModelParams('bad pair;=nokey;key=')).toEqual({});
    for (const v of ['', null, undefined, 5]) expect(parseModelParams(v)).toEqual({});
  });

  it('isUnsupportedFieldError spots a rejected request field but not other 400s', () => {
    expect(isUnsupportedFieldError('Unsupported request field(s): chat_template_kwargs')).toBe(true);
    expect(isUnsupportedFieldError('Extra inputs are not permitted')).toBe(true);
    expect(isUnsupportedFieldError('model not found')).toBe(false);
    expect(isUnsupportedFieldError(undefined)).toBe(false);
  });
});

describe('keeping what the menu already has', () => {
  const row = (name: string, calories: number, extra: Record<string, unknown> = {}) => ({
    name, calories, protein_g: 10, total_carbs_g: 20, total_fat_g: 5, saturated_fat_g: 1, sodium_mg: 300,
    dietary_fiber_g: 2, sugars_g: 4, serving_weight_grams: 150, ...extra,
  });

  it('normalizeItemName ignores capitals and extra spaces', () => {
    expect(normalizeItemName('  Crunchy   TACO ')).toBe('crunchy taco');
    expect(normalizeItemName(null)).toBe('');
  });

  it('hasUsableNutrition is false for a row with nothing in it and true for any real value', () => {
    expect(hasUsableNutrition({ name: 'x' })).toBe(false);
    expect(hasUsableNutrition({ name: 'x', calories: 0, protein_g: 0, sodium_mg: null })).toBe(false);
    expect(hasUsableNutrition({ name: 'x', calories: 120 })).toBe(true);
    expect(hasUsableNutrition({ name: 'x', calories: 0, sodium_mg: 40 })).toBe(true);
  });

  it('rowToNutrition maps the stored columns to the save format', () => {
    expect(rowToNutrition(row('Taco', 170.4))).toEqual({
      calories: 170, totalFat_g: 5, saturatedFat_g: 1, sodium_mg: 300, totalCarbs_g: 20, dietaryFiber_g: 2, sugars_g: 4,
      protein_g: 10, servingWeightGrams: 150,
    });
    expect(rowToNutrition({ name: 'x', calories: 50 }).servingWeightGrams).toBeNull();
  });

  it('planEstimates keeps names that are already on the menu and sends only the new ones to the AI', () => {
    const plan = planEstimates(['Taco', 'Burrito', 'Nachos'], [row('taco ', 170), row('Burrito', 640)]);
    expect(plan.kept.map((k) => k?.calories ?? null)).toEqual([170, 640, null]);
    expect(plan.toEstimate).toEqual([{ index: 2, name: 'Nachos' }]);
  });

  it('a rename counts as a new item, and a deleted item is simply not in the list', () => {
    const plan = planEstimates(['Crunchy Taco Supreme'], [row('Crunchy Taco', 170), row('Burrito', 640)]);
    expect(plan.kept).toEqual([null]);
    expect(plan.toEstimate).toEqual([{ index: 0, name: 'Crunchy Taco Supreme' }]);
  });

  it('deleting only: nothing needs the AI', () => {
    const plan = planEstimates(['Taco'], [row('Taco', 170), row('Burrito', 640)]);
    expect(plan.toEstimate).toEqual([]);
    expect(plan.kept[0]!.calories).toBe(170);
  });

  it('an existing row with no nutrition in it is estimated again, and the first usable duplicate wins', () => {
    const plan = planEstimates(['Soup', 'Pie'], [{ name: 'Soup', calories: 0 }, row('Pie', 300), row('pie', 999)]);
    expect(plan.toEstimate).toEqual([{ index: 0, name: 'Soup' }]);
    expect(plan.kept[1]!.calories).toBe(300);
  });

  it('with an empty menu everything is new', () => {
    expect(planEstimates(['A1', 'B2'], []).toEstimate).toHaveLength(2);
  });
});

describe('isValidPlaceId', () => {
  it('accepts a Google place ID and refuses anything else', () => {
    expect(isValidPlaceId('ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe(true);
    for (const bad of ['', 'short', 'has space in it 123', null, undefined, 42, 'x'.repeat(201)]) {
      expect(isValidPlaceId(bad)).toBe(false);
    }
  });
});

describe('keeping the confirmed and out-of-stock state when the list is saved', () => {
  const row = (name: string, extra: Record<string, unknown> = {}) => ({ name, calories: 200, protein_g: 5, ...extra });

  it('a name already on the menu keeps whether it is confirmed, so an unconfirmed item stays unconfirmed', () => {
    const plan = planEstimates(
      ['Taco', 'Burrito', 'Nachos'],
      [row('Taco', { is_verified: true }), row('burrito', { is_verified: false }), row('Nachos', { is_verified: null })],
    );
    expect(plan.state.map(savedAsVerified)).toEqual([true, false, false]);
  });

  it('a new name is saved as confirmed (the owner typed it as a real dish)', () => {
    const plan = planEstimates(['Brand New Dish'], [row('Taco', { is_verified: false })]);
    expect(plan.state).toEqual([null]);
    expect(savedAsVerified(plan.state[0])).toBe(true);
  });

  it('an item with no usable nutrition is estimated again but still keeps its confirmed state', () => {
    const plan = planEstimates(['Soup'], [{ name: 'Soup', calories: 0, is_verified: false }]);
    expect(plan.toEstimate).toEqual([{ index: 0, name: 'Soup' }]);
    expect(plan.state[0]).toEqual({ isVerified: false, isOutOfStock: false });
  });

  it('outOfStockNames lists the names that were out of stock, in the order of the list', () => {
    const names = ['Taco', 'Burrito', 'Nachos', 'New One'];
    const plan = planEstimates(names, [
      row('Taco', { is_out_of_stock: true }), row('Burrito', { is_out_of_stock: false }), row('Nachos', { is_out_of_stock: true }),
    ]);
    expect(outOfStockNames(names, plan.state)).toEqual(['Taco', 'Nachos']);
  });

  it('nothing is marked out of stock when nothing was', () => {
    const plan = planEstimates(['Taco'], [row('Taco')]);
    expect(outOfStockNames(['Taco'], plan.state)).toEqual([]);
    expect(outOfStockNames([], [])).toEqual([]);
  });

  it('the first row for a name decides when the menu has the same name twice', () => {
    const plan = planEstimates(['Taco'], [row('Taco', { is_verified: false }), row('taco ', { is_verified: true })]);
    expect(plan.state[0]!.isVerified).toBe(false);
  });
});
