import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getUserProfile, upsertUserProfile } from '../api/functions';
import type { UserProfile } from '../types';

export const USER_PROFILE_KEY = ['userProfile'];

export function useUserProfile() {
  return useQuery({
    queryKey: USER_PROFILE_KEY,
    queryFn: getUserProfile,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInvalidateUserProfile() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: USER_PROFILE_KEY });
}
