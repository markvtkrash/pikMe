// The wording of the Quick Find chat: the line under every answer, and the suggestion chips. Neutral on purpose: no "healthy", "best" or "safe",
// and no health, allergy or diet promise.

export const CHAT_DISCLAIMER =
  'AI suggestion from confirmed menu items. Not medical or allergy advice. Confirm ingredients with the restaurant.';

interface ChatProfileLike {
  healthGoals?: string[];
  dietaryRestrictions?: string[];
  cuisinePreferences?: string[];
}

// Four chips: ones that use what the person has set, then plain ones.
export function chatSuggestions(profile: ChatProfileLike | null | undefined): string[] {
  const out: string[] = [];
  if (profile?.healthGoals && profile.healthGoals.length > 0) out.push('What might fit my goals?');
  if (profile?.dietaryRestrictions && profile.dietaryRestrictions.some((r) => r !== 'none')) out.push('Show me options for my diet choices');
  if (profile?.cuisinePreferences && profile.cuisinePreferences.length > 0) out.push('Show me my favorite cuisines nearby');
  const plain = ['Where can I get lunch nearby?', 'Light options nearby', 'High-protein options nearby', 'What can I eat right now?'];
  for (const p of plain) {
    if (out.length >= 4) break;
    if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, 4);
}
