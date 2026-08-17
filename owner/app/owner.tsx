import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function OwnerScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/restaurant/auth/login');
  }, []);

  return null;
}
