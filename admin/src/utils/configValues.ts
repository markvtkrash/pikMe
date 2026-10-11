// Values on the admin App Config page that are simply "true" or "false" are switched with a button instead of typed in.

// True when the value is exactly the text true or false (any other value, such as 5 or hello, stays a text box).
export function isBooleanValue(value: string | null | undefined): boolean {
  return value === 'true' || value === 'false';
}

// The other one of the two.
export function nextBooleanValue(value: string): 'true' | 'false' {
  return value === 'true' ? 'false' : 'true';
}

// The question asked before switching, so a global setting is not changed by an accidental tap.
export function switchQuestion(key: string, value: string): string {
  return `Switch "${key}" from ${value} to ${nextBooleanValue(value)}? The apps pick the change up within a few minutes.`;
}

// The two switches pinned at the top of the App Config page: which kinds of restaurants customers see (migration 126).
export interface QuickSwitch {
  key: string;
  title: string;
  onText: string;
  offText: string;
}

export const QUICK_SWITCHES: QuickSwitch[] = [
  { key: 'showFranchiseRestaurants', title: 'Franchise Restaurants', onText: 'Shown to customers', offText: 'Hidden from customers' },
  { key: 'showIndependentRestaurants', title: 'Independent Restaurants', onText: 'Shown to customers', offText: 'Hidden from customers' },
];

// The question asked before turning one of these on or off, in plain words.
export function quickSwitchQuestion(sw: QuickSwitch, currentValue: string): string {
  const turningOff = currentValue === 'true';
  return turningOff
    ? `Hide all ${sw.title.toLowerCase()} from customers? The customer app picks the change up within a few minutes.`
    : `Show ${sw.title.toLowerCase()} to customers again? The customer app picks the change up within a few minutes.`;
}
