import { useCallback, useState } from 'react';
import { transcriptFrom, VOICE_PERMISSION_MESSAGE, type VoiceResultEvent } from '../utils/voiceSearch';

// Speak into the search box. The speech recognizer is a NATIVE module, so a phone whose installed build does not include it (an older build that
// has only had over-the-air updates) simply has no microphone button: the module is loaded inside try / catch and nothing else changes.
// On the web it uses the browser's own speech recognition where there is one.
// deno-lint-ignore no-explicit-any
let speech: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  speech = require('expo-speech-recognition');
} catch {
  speech = null;
}

const mod = speech?.ExpoSpeechRecognitionModule ?? null;
const useSpeechEvent: ((name: string, handler: (event: any) => void) => void) | null = speech?.useSpeechRecognitionEvent ?? null;

function recognitionAvailable(): boolean {
  if (!mod) return false;
  try {
    return typeof mod.isRecognitionAvailable === 'function' ? !!mod.isRecognitionAvailable() : true;
  } catch {
    return false;
  }
}

const AVAILABLE = recognitionAvailable();

// onText gets the words as they are heard (and the final words), for the search box.
export function useVoiceSearch(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The events exist only when the native module does; that never changes while the app runs, so the hooks below are called the same way every time.
  if (useSpeechEvent) {
    useSpeechEvent('result', (event: VoiceResultEvent) => {
      const text = transcriptFrom(event);
      if (text) onText(text);
    });
    useSpeechEvent('end', () => setListening(false));
    useSpeechEvent('error', (event: { error?: string; message?: string }) => {
      setListening(false);
      // "no-speech" and "aborted" are not problems: nothing was said, or the person stopped it
      if (event?.error && event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(event.error === 'not-allowed' ? VOICE_PERMISSION_MESSAGE : (event.message ?? 'Could not hear you. Please try again.'));
      }
    });
  }

  const start = useCallback(async () => {
    if (!AVAILABLE) return;
    setError(null);
    try {
      const permission = await mod.requestPermissionsAsync();
      if (!permission?.granted) {
        setError(VOICE_PERMISSION_MESSAGE);
        return;
      }
      mod.start({ lang: 'en-US', interimResults: true, continuous: false });
      setListening(true);
    } catch (e) {
      setListening(false);
      setError(e instanceof Error ? e.message : 'Could not start voice search.');
    }
  }, []);

  const stop = useCallback(() => {
    try {
      mod?.stop();
    } catch {
      // already stopped
    }
    setListening(false);
  }, []);

  return { available: AVAILABLE, listening, error, clearError: () => setError(null), start, stop };
}
