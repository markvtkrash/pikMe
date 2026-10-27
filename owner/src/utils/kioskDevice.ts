// Browser-only helpers for the staff tablet: a chime for a new order, and keeping the screen on. Both do nothing where the browser
// has no support (or on a phone app), and neither can throw into the screen.

let audioContext: AudioContext | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;
let wakeLockListening = false;

// A browser only allows sound after the person has tapped something, so the screen calls this from a button.
export function enableSound(): boolean {
  try {
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined' ? (window.AudioContext || (window as any).webkitAudioContext) : undefined;
    if (!Ctor) return false;
    audioContext = audioContext ?? new Ctor();
    void audioContext.resume?.();
    return true;
  } catch {
    return false;
  }
}

// Two short notes, once.
export function playChime(): void {
  try {
    const ctx = audioContext;
    if (!ctx) return;
    const start = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = start + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    });
  } catch {
    // a chime is a nicety; never let it break the screen
  }
}

async function acquireWakeLock(): Promise<boolean> {
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.wakeLock?.request) return false;
    wakeLock = await nav.wakeLock.request('screen');
    return true;
  } catch {
    return false;
  }
}

// Asks the browser to keep the screen on. The browser drops the request when the tab is hidden, so it is asked again when the tab
// comes back. Returns whether the first request worked.
export async function keepScreenAwake(): Promise<boolean> {
  const ok = await acquireWakeLock();
  if (!wakeLockListening && typeof document !== 'undefined') {
    wakeLockListening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void acquireWakeLock();
    });
  }
  return ok;
}

export function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}
