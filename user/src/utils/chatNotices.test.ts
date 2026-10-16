import { CHAT_DISCLAIMER, chatSuggestions } from './chatNotices';

describe('Quick Find wording', () => {
  it('says it is AI, not medical or allergy advice, and to confirm with the restaurant', () => {
    expect(CHAT_DISCLAIMER).toMatch(/AI suggestion/);
    expect(CHAT_DISCLAIMER).toMatch(/Not medical or allergy advice/);
    expect(CHAT_DISCLAIMER).toMatch(/Confirm ingredients with the restaurant/);
  });

  it('always gives four chips', () => {
    expect(chatSuggestions(null)).toHaveLength(4);
    expect(chatSuggestions({})).toHaveLength(4);
    expect(chatSuggestions({ healthGoals: ['balanced'], dietaryRestrictions: ['vegan'], cuisinePreferences: ['thai'] })).toHaveLength(4);
  });

  it('uses what the person has set, then plain chips', () => {
    const s = chatSuggestions({ healthGoals: ['balanced'], cuisinePreferences: ['thai'] });
    expect(s[0]).toBe('What might fit my goals?');
    expect(s).toContain('Show me my favorite cuisines nearby');
    expect(chatSuggestions({ dietaryRestrictions: ['none'] })).not.toContain('Show me options for my diet choices');
  });

  it('never makes a health, "best" or safety claim', () => {
    const all = [...chatSuggestions(null), ...chatSuggestions({ healthGoals: ['x'], dietaryRestrictions: ['vegan'], cuisinePreferences: ['y'] })].join(' ').toLowerCase();
    for (const word of ['healthy', 'best', 'safe', 'allerg']) expect(all).not.toContain(word);
  });
});
