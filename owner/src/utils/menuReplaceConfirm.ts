import type { MenuReplaceResult } from '../api/restaurantAuth';

// Shared by every action that can replace a restaurant's cached menu items
// (manual refresh, saving a menu link, and later manual entry). If the
// backend reports that proceeding would orphan existing item-specific
// coupons, this surfaces that to the owner and only retries with
// force=true if they choose to proceed — never silently.
export async function confirmAndRetryIfNeeded(
  result: MenuReplaceResult,
  retryWithForce: () => Promise<MenuReplaceResult>
): Promise<MenuReplaceResult> {
  if (!result.requiresConfirmation) return result;

  const couponCount = result.affectedCoupons?.length || 0;
  const verifiedCount = result.overwritesVerifiedCount || 0;
  const parts: string[] = [];

  if (verifiedCount > 0) {
    parts.push(
      `${verifiedCount} verified menu item${verifiedCount === 1 ? '' : 's'} (from a real menu link or ` +
      `manual entry) will be replaced with AI-guessed items, which may not be accurate.`
    );
  }
  if (couponCount > 0) {
    parts.push(
      `${couponCount} coupon${couponCount === 1 ? '' : 's'} tied to specific menu items will stop matching ` +
      `any item until you reactivate or delete ${couponCount === 1 ? 'it' : 'them'} from the Orphaned Coupons screen.`
    );
  }

  const message = `${parts.join(' ')} Continue anyway?`;

  // Matches the existing confirm() convention already used in expired.tsx
  // for this web-focused app.
  const confirmed = confirm(message);
  if (!confirmed) return result;

  return retryWithForce();
}
