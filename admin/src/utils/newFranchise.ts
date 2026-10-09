import { validateMenuLinkInput } from './chainMenuSources';

export const MAX_ALIASES = 20;
export const MAX_NAME_LENGTH = 120;
export const MAX_CATEGORY_LENGTH = 60;

// "The Cheesecake Factory, Cheesecake Factory Bakery" -> a clean list: trimmed, no blanks, no repeats
// (ignoring case). Commas or new lines separate aliases.
export function parseAliases(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const alias = part.trim();
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

// The check shown in the Add franchise window before anything is sent. The database repeats these
// rules and also refuses a name or alias already on the list. Returns an error message or null.
export function validateNewFranchise(input: { name: string; category: string; aliases: string; menuUrl: string }): string | null {
  const name = input.name.trim();
  if (!name) return 'Enter the franchise name.';
  if (name.length > MAX_NAME_LENGTH) return `The name is too long (${MAX_NAME_LENGTH} characters at most).`;
  if (!/[a-z0-9]/i.test(name)) return 'The name must contain letters or numbers.';
  if (input.category.trim().length > MAX_CATEGORY_LENGTH) return `The category is too long (${MAX_CATEGORY_LENGTH} characters at most).`;
  const aliases = parseAliases(input.aliases);
  if (aliases.length > MAX_ALIASES) return `Too many aliases (${MAX_ALIASES} at most).`;
  if (aliases.some((a) => a.length > MAX_NAME_LENGTH)) return `An alias is too long (${MAX_NAME_LENGTH} characters at most).`;
  return validateMenuLinkInput(input.menuUrl, '');
}
