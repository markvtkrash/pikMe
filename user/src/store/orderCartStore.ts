import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_CART, setQuantity, type Cart, type Dish } from '../utils/orders';

// The cart for ordering ahead, kept on this device (AsyncStorage) so a closed app does not lose it. It holds dishes from ONE restaurant
// at a time (see setQuantity in utils/orders.ts). It is cleared when the person signs out, and when an order is made from it.
interface OrderCartStore {
  cart: Cart;
  // 'other_restaurant' means the cart holds another restaurant's dishes and was left unchanged: the screen asks before clearing it
  setDishQuantity: (place: { placeId: string; restaurantName: string }, dish: Dish, quantity: number) => 'ok' | 'other_restaurant';
  replaceCart: (cart: Cart) => void;
  clear: () => void;
}

function isCart(value: unknown): value is Cart {
  const c = value as Cart | undefined;
  return !!c && Array.isArray(c.lines) && (c.placeId === null || typeof c.placeId === 'string');
}

export const useOrderCartStore = create<OrderCartStore>()(
  persist(
    (set, get) => ({
      cart: EMPTY_CART,
      setDishQuantity: (place, dish, quantity) => {
        const { cart, result } = setQuantity(get().cart, place, dish, quantity);
        if (result === 'ok') set({ cart });
        return result;
      },
      replaceCart: (cart) => set({ cart }),
      clear: () => set({ cart: EMPTY_CART }),
    }),
    {
      name: 'pikme-order-cart',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ cart: s.cart }),
      // a stored value that is not a cart is ignored
      merge: (persisted, current) => {
        const stored = (persisted as Partial<OrderCartStore> | undefined)?.cart;
        return { ...current, cart: isCart(stored) ? stored : EMPTY_CART };
      },
    }
  )
);
