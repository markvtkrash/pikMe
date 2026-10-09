// The wording owners see about where their restaurant's information comes from (sign-up and claim screens).
// Kept in one place so both screens, and the tests, say the same thing. Informational only: it does not ask
// for or record any agreement.

export const DATA_SOURCES_TITLE = 'Where your restaurant information comes from';

export const DATA_SOURCES_POINTS: string[] = [
  "Your restaurant's name, address and location come from Google Maps listings (Google Maps Platform) when you claim it.",
  "Menu item names may be read from your restaurant's public website and listings. The nutrition values customers see are estimates unless you verify them.",
  "If your restaurant is part of a chain, its menu is managed centrally. You can view it, and you can open a Support Ticket if something needs correcting.",
];

export const DATA_SOURCES_FOOTER = 'Not affiliated with or endorsed by Google.';

// Shown next to Google-sourced search results on the claim screen.
export const GOOGLE_RESULTS_ATTRIBUTION =
  "Powered by Google. Listing details come from Google Maps and may not be current: check that yours is right before claiming it.";
