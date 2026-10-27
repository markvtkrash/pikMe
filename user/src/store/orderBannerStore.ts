import { create } from 'zustand';

// How tall the order bar at the top of the app is right now (0 when it is not showing), so the pinned logo can sit just below it.
interface OrderBannerStore {
  height: number;
  setHeight: (height: number) => void;
}

export const useOrderBannerStore = create<OrderBannerStore>((set) => ({
  height: 0,
  setHeight: (height) => set((s) => (s.height === height ? s : { height })),
}));
