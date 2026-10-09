// Wording for the "Import Menu from Online Link" section on the owner's Menu Management page. Kept here so it can be tested
// and stays in step with the names of the other import buttons ("Import Menu from Photo", "Import Menu from Text").

export const ONLINE_LINK_TITLE = 'Import Menu from Online Link';

// What the (i) button shows. We read the TEXT on the page, so a menu that is a picture cannot be imported this way.
export function onlineLinkHelp(isChain: boolean): { title: string; message: string } {
  if (isChain) {
    return {
      title: ONLINE_LINK_TITLE,
      message:
        "Your restaurant is part of a chain, whose menu is managed centrally.\n\n" +
        'The page you enter here is passed to our team as a suggestion for the chain menu page. It is only used after they review it.',
    };
  }
  return {
    title: ONLINE_LINK_TITLE,
    message:
      'We read the text on your menu page and add any new dishes to your menu, usually within a day.\n\n' +
      "This will NOT work if your online menu is a picture (for example a photo or scan of a printed menu), because there is no text to read.\n\n" +
      'In that case, use "Import Menu from Photo" instead.\n\n' +
      'Changed your menu page? Press "Import Menu" again to have it read again.',
  };
}

// What the owner is told after saving the link.
export function onlineLinkSavedMessage(hasLink: boolean, isChain: boolean): string {
  if (!hasLink) return 'Your menu page was removed.';
  if (isChain) return 'Thanks. Our team will review this page as a suggestion for the chain menu.';
  return (
    'Your menu page is saved. We will read it soon (usually within a day) and add any new dishes to your menu.\n\n' +
    'If your online menu is a picture, it cannot be read this way: use "Import Menu from Photo" instead.'
  );
}

// ── The bell alert: the daily read of the owner's menu link got no menu items ─────────────────────────────────────
export const MENU_IMPORT_ALERT_TITLE = 'Menu import was not successful';

// A short, readable form of the address for the message: no https://, no trailing slash, at most `max` characters.
export function shortLink(link: string, max = 48): string {
  const bare = String(link ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
}

// 'no_items': the page was read but held no dishes (most often a menu that is a picture).
// 'needs_attention': the page could not be read after several tries.
export function menuImportAlertMessage(status: 'no_items' | 'needs_attention', link: string): string {
  const where = shortLink(link);
  if (status === 'needs_attention') {
    return `We could not read the menu link you gave (${where}) after several tries. Please use "Import Menu from Photo" instead.`;
  }
  return (
    `We could not import any menu items from the menu link you gave (${where}). ` +
    'This usually means the online menu is a picture, not text. Please use "Import Menu from Photo" instead.'
  );
}

// The note under the link box. After a failed read of the owner's own link it says so; when only a working link from our team
// is known (their own read is no longer on record) it points to that link and asks them to check theirs. Without a
// suggestion it only asks them to check their link. Never says who set the link.
export function linkHelpMessage(suggestedLink: string | null, ownerLinkFailed = true): { text: string; suggestion: string | null } {
  if (suggestedLink && ownerLinkFailed) {
    return {
      text: "We couldn't find dishes at your link. Please check the address. Our team suggests this one:",
      suggestion: suggestedLink,
    };
  }
  if (suggestedLink) {
    return {
      text: 'Our team found a working menu link for your restaurant. Your saved link is different, so please check it. The working link is:',
      suggestion: suggestedLink,
    };
  }
  return {
    text: "We couldn't find dishes at your link. Please check that the address is right and opens your menu. If your menu is a picture, use Import Menu from Photo instead.",
    suggestion: null,
  };
}
