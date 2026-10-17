// The tools on the admin Tools page (Admin dashboard -> Tools). Add an entry here for each new tool page.
export interface AdminTool {
  key: string;
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  bg: string;
  href: string;
}

export const ADMIN_TOOLS: AdminTool[] = [
  {
    key: 'regions',
    icon: '🗺️',
    title: 'Region Management',
    subtitle: 'Open the app to customers state by state: go live now or on a date, turn a state off, and see who is waiting',
    color: '#00695C',
    bg: '#E0F2F1',
    href: '/admin/regions',
  },
  {
    key: 'analytics',
    icon: '📈',
    title: 'App Usage',
    subtitle: 'How customers use the app: opens, searches, restaurants and menus viewed, saves, sign-ups and who comes back (anonymous counts)',
    color: '#4527A0',
    bg: '#EDE7F6',
    href: '/admin/analytics',
  },
  {
    key: 'scheduled-builds',
    icon: '⏱️',
    title: 'Scheduled Builds',
    subtitle: 'How menus are built on a schedule: franchises and independent restaurants, limits, and recent builds',
    color: '#1565C0',
    bg: '#E3F2FD',
    href: '/admin/scheduled-builds',
  },
  {
    key: 'announcements',
    icon: '📢',
    title: 'Announcements',
    subtitle: 'Write a message that customers, owners or both see once, the next time they open the app',
    color: '#6A1B9A',
    bg: '#F3E5F5',
    href: '/admin/announcements',
  },
  {
    key: 'city-imports',
    icon: '🏙️',
    title: 'City Imports',
    subtitle: 'Add a city and how many independent restaurants to find; their menus are imported from their websites',
    color: '#EF6C00',
    bg: '#FFF3E0',
    href: '/admin/crawl-cities',
  },
  {
    key: 'restaurant-categories',
    icon: '🏷️',
    title: 'Restaurant Categories',
    subtitle: 'What a place is, how you get the food and what it serves: the filters customers use and the choices owners make',
    color: '#00695C',
    bg: '#E0F2F1',
    href: '/admin/restaurant-categories',
  },
  {
    key: 'app-config',
    icon: '⚙️',
    title: 'App Config',
    subtitle: 'App-wide settings, such as the AI model and how items are shown',
    color: '#455A64',
    bg: '#ECEFF1',
    href: '/admin/config',
  },
];
