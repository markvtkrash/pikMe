export type UserRole = 'admin' | 'owner' | 'customer';
export type RoleFilter = 'all' | UserRole;

export interface FilterableUser {
  email: string;
  role: UserRole;
  business_name: string | null;
  restaurant_name?: string | null;
  restaurant_address?: string | null;
}

// The All Users page's tab + search filter. The search matches the login email,
// the business name and — for owners — their restaurant's name and address.
export function filterUsers<T extends FilterableUser>(users: T[], tab: RoleFilter, searchQuery: string): T[] {
  const query = searchQuery.trim().toLowerCase();
  return users.filter((u) => {
    if (tab !== 'all' && u.role !== tab) return false;
    if (!query) return true;
    return [u.email, u.business_name, u.restaurant_name, u.restaurant_address].some(
      (field) => !!field && field.toLowerCase().includes(query)
    );
  });
}
