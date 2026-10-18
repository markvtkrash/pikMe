// A Google search for a restaurant's menu, by name and address (the address string already carries the city).
// Used by every admin screen that shows one restaurant's menu, so "Find Menu on Google" behaves the same
// wherever it's reached from.
import { Linking, Platform } from 'react-native';

export function googleMenuSearchUrl(name: string, address?: string | null): string {
  const query = [name, address, 'menu'].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// Opens in a new tab/page -- never navigates the admin away from the current one.
export function openInNewPage(url: string): void {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    Linking.openURL(url);
  }
}
