import { useRestaurantStore } from './restaurantStore';
import type { Restaurant } from '../types';

const initialState = useRestaurantStore.getState();

beforeEach(() => {
  useRestaurantStore.setState(initialState, true);
});

function makeRestaurant(): Restaurant {
  return {
    placeId: 'p1',
    name: 'Diner',
    location: { latitude: 0, longitude: 0, address: 'addr', city: 'city' },
    distanceMeters: 100,
    rating: 4,
    cuisineTypes: ['american'],
    openNow: true,
    hasNutritionData: false,
  };
}

describe('restaurantStore', () => {
  it('starts empty with no selection or location, defaulting to a 2km radius', () => {
    const s = useRestaurantStore.getState();
    expect(s.restaurants).toEqual([]);
    expect(s.selectedRestaurantId).toBeNull();
    expect(s.userLocation).toBeNull();
    expect(s.searchRadiusMeters).toBe(2000);
  });

  it('setSearchRadiusMeters updates the radius independently of other fields', () => {
    useRestaurantStore.getState().setSelectedRestaurantId('p1');
    useRestaurantStore.getState().setSearchRadiusMeters(5000);

    const s = useRestaurantStore.getState();
    expect(s.searchRadiusMeters).toBe(5000);
    expect(s.selectedRestaurantId).toBe('p1');
  });

  it('setRestaurants replaces the restaurant list independently of other fields', () => {
    useRestaurantStore.getState().setSelectedRestaurantId('p1');
    useRestaurantStore.getState().setRestaurants([makeRestaurant()]);

    const s = useRestaurantStore.getState();
    expect(s.restaurants).toEqual([makeRestaurant()]);
    expect(s.selectedRestaurantId).toBe('p1');
  });

  it('setSelectedRestaurantId sets and clears the selection', () => {
    useRestaurantStore.getState().setSelectedRestaurantId('p1');
    expect(useRestaurantStore.getState().selectedRestaurantId).toBe('p1');

    useRestaurantStore.getState().setSelectedRestaurantId(null);
    expect(useRestaurantStore.getState().selectedRestaurantId).toBeNull();
  });

  it('setUserLocation sets and clears the location', () => {
    useRestaurantStore.getState().setUserLocation({ latitude: 1, longitude: 2 });
    expect(useRestaurantStore.getState().userLocation).toEqual({ latitude: 1, longitude: 2 });

    useRestaurantStore.getState().setUserLocation(null);
    expect(useRestaurantStore.getState().userLocation).toBeNull();
  });
});
