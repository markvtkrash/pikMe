// The message shown on the Update Menu pages after items were added from a
// photo/text/link. Kept as a function so the wording (singular/plural/none) is
// tested in one place.
export type MenuUploadSource = 'photo' | 'text';

export function menuUploadMessage(itemCount: unknown, source: MenuUploadSource): string {
  const count = Number(itemCount);
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

  if (safeCount === 0) {
    return source === 'photo'
      ? 'No new menu items were added — everything we could read from your photo is already on your menu.'
      : 'No new menu items were added — everything in your text is already on your menu.';
  }

  const noun = safeCount === 1 ? 'menu item' : 'menu items';
  return `${safeCount} ${noun} added to your menu from your ${source}.`;
}
