// Voice search for the Explore search box: helpers kept apart from the hook so they can be tested without a phone.

// What the speech recognizer reports: a list of guesses (best first) for what was said, and whether it is final.
export interface VoiceResultEvent {
  isFinal?: boolean;
  results?: { transcript?: string }[];
}

// The best guess as plain text for the search box, or null when there is nothing usable.
export function transcriptFrom(event: VoiceResultEvent | null | undefined): string | null {
  const text = event?.results?.[0]?.transcript;
  if (typeof text !== 'string') return null;
  // the recognizer often ends a spoken phrase with a full stop, which a search should not contain
  const cleaned = text.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

export const VOICE_PERMISSION_MESSAGE =
  'To search by voice, allow the microphone and speech recognition for this app in your phone\'s Settings.';
