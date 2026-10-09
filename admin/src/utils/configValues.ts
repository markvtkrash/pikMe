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
