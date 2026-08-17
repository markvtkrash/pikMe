import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function RootIndexScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/login');
  }, []);

  return null;
}
