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
