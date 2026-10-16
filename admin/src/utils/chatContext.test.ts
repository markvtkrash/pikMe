// Tests for what the Quick Find chat is given and told (the ai-chat edge function).
import {
  buildSystemPrompt, confirmedItemLines, formatMenuBlock, NO_CONFIRMED_ITEMS, normalizePlaces,
} from '../../../supabase/functions/ai-chat/chatContext';

describe('normalizePlaces', () => {
  it('reads restaurants with place IDs, each once', () => {
    expect(normalizePlaces([{ placeId: 'p1', name: 'Taco Loco' }, { placeId: 'p1', name: 'Taco Loco' }, { placeId: 'p2', name: ' Sushi Zen ' }], null))
      .toEqual([{ placeId: 'p1', name: 'Taco Loco' }, { placeId: 'p2', name: 'Sushi Zen' }]);
  });
  it('falls back to names when an older app sends only those', () => {
    expect(normalizePlaces(undefined, ['Subway', 'subway', 'Pho 88'])).toEqual([{ placeId: null, name: 'Subway' }, { placeId: null, name: 'Pho 88' }]);
  });
  it('keeps at most 12, and ignores junk', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ placeId: `p${i}`, name: `R${i}` }));
    expect(normalizePlaces(many, null)).toHaveLength(12);
    expect(normalizePlaces([{ name: 5 }, null, {}], [1, '', '  '])).toEqual([]);
    expect(normalizePlaces('x', 'y')).toEqual([]);
  });
});

describe('confirmedItemLines', () => {
  const rows = [
    { name: 'Grilled Chicken Salad', calories: 420, protein_g: 31, is_verified: true },
    { name: 'AI Guess Burger', calories: 900, protein_g: 40, is_verified: false },
    { name: 'Veggie Wrap', calories: 380, protein_g: null, is_verified: true },
    { name: 'Veggie Wrap', calories: 380, is_verified: true },
    { name: 'Plain Rice', is_verified: true },
    { name: '', is_verified: true },
    { name: 'No Flag', calories: 100 },
  ];
  it('lists only CONFIRMED items, once each', () => {
    expect(confirmedItemLines(rows)).toEqual([
      '- Grilled Chicken Salad (420 cal, 31g protein)',
      '- Veggie Wrap (380 cal)',
      '- Plain Rice',
    ]);
  });
  it('never includes an item that is not confirmed', () => {
    expect(confirmedItemLines(rows).join('\n')).not.toMatch(/AI Guess|No Flag/);
  });
  it('writes only the numbers we hold, and copes with nothing', () => {
    expect(confirmedItemLines(null)).toEqual([]);
    expect(confirmedItemLines([])).toEqual([]);
    expect(confirmedItemLines([{ name: 'X', calories: 0, protein_g: 0, is_verified: true }])).toEqual(['- X']);
  });
  it('stops at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Dish ${i}`, is_verified: true }));
    expect(confirmedItemLines(many)).toHaveLength(6);
    expect(confirmedItemLines(many, 2)).toHaveLength(2);
  });
});

describe('formatMenuBlock', () => {
  it('leaves out restaurants with nothing confirmed', () => {
    const block = formatMenuBlock([
      { place: { placeId: 'a', name: 'Taco Loco' }, lines: ['- Taco (200 cal)'] },
      { place: { placeId: 'b', name: 'Empty Cafe' }, lines: [] },
    ]);
    expect(block).toBe('Taco Loco:\n- Taco (200 cal)');
    expect(formatMenuBlock([])).toBe('');
  });
});

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt({ healthGoals: ['weight_loss'], dietaryRestrictions: ['vegetarian'], cuisinePreferences: ['italian'] }, 'Taco Loco:\n- Taco (200 cal)', ['vegetarian']);

  it('gives the AI only the confirmed items, and tells it to use nothing else', () => {
    expect(prompt).toContain('Taco Loco:\n- Taco (200 cal)');
    expect(prompt).toMatch(/ONLY from the confirmed menu items/);
    expect(prompt).toMatch(/Never invent a dish, a restaurant, a price or a nutrition number/);
  });
  it('forbids safety, allergy, medical and "healthy / best" claims', () => {
    expect(prompt).toMatch(/Never say or imply that an item is safe for, free of, or suitable for an allergy/);
    expect(prompt).toMatch(/Never give medical, allergy or treatment advice/);
    expect(prompt).toMatch(/Do not call anything "healthy", "the best" or "safe"/);
    expect(prompt).toMatch(/never describe what a dish contains/);
  });
  it('says there is nothing when no item is confirmed', () => {
    expect(buildSystemPrompt({}, '', [])).toContain(NO_CONFIRMED_ITEMS);
  });
  it('does not carry a name or allergens, and has no invented sample numbers', () => {
    expect(prompt).not.toMatch(/allerg\w* *:/i);
    expect(prompt).not.toMatch(/36g|1340mg|Subway/);
    expect(prompt).toMatch(/goals: weight_loss; diet: vegetarian; cuisines: italian/);
  });
  it('keeps the short bullet format the app expects', () => {
    expect(prompt).toMatch(/up to 3 bullet points/);
  });
});
