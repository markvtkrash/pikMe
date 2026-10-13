// The accessibility role for the heart that pins a page to Favorites. The heart sits inside cards that are buttons themselves, and
// on the web a button inside a button is invalid HTML (React logs "<button> cannot contain a nested <button>"), so on the web the
// heart does not claim the button role. It stays tappable and keeps its label and selected state; on phones nothing changes.
export function favoriteHeartRole(platform: string): 'button' | undefined {
  return platform === 'web' ? undefined : 'button';
}
