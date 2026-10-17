jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { NO_CATEGORY_FILTERS } from '../utils/categories';
import { useRememberedFiltersStore } from './rememberedFiltersStore';

beforeEach(() => {
  useRememberedFiltersStore.setState({ filters: NO_CATEGORY_FILTERS, seededFrom: '' });
});

describe('remembered filters store', () => {
  it('starts with no filters', () => {
    expect(useRememberedFiltersStore.getState().filters).toEqual(NO_CATEGORY_FILTERS);
  });
  it('remembers what was chosen', () => {
    useRememberedFiltersStore.getState().remember({ venues: ['cafe'], services: [], cuisines: ['thai'] });
    expect(useRememberedFiltersStore.getState().filters).toEqual({ venues: ['cafe'], services: [], cuisines: ['thai'] });
  });
  it('remembers clearing the filters too (so an opt-out sticks)', () => {
    useRememberedFiltersStore.getState().remember({ venues: ['cafe'], services: [], cuisines: [] });
    useRememberedFiltersStore.getState().remember(NO_CATEGORY_FILTERS);
    expect(useRememberedFiltersStore.getState().filters).toEqual(NO_CATEGORY_FILTERS);
  });
  it('stores only clean values', () => {
    useRememberedFiltersStore.getState().remember({ venues: ['cafe', 5, ''] as any, services: null as any, cuisines: [] });
    expect(useRememberedFiltersStore.getState().filters).toEqual({ venues: ['cafe'], services: [], cuisines: [] });
  });
  it('clear (sign-out) forgets everything', () => {
    useRememberedFiltersStore.getState().remember({ venues: ['cafe'], services: ['takeout'], cuisines: ['thai'] });
    useRememberedFiltersStore.getState().clear();
    expect(useRememberedFiltersStore.getState().filters).toEqual(NO_CATEGORY_FILTERS);
  });
  it('seed stores the filters and the profile state they came from', () => {
    useRememberedFiltersStore.getState().seed({ venues: [], services: [], cuisines: ['thai'] }, 'v:|s:|c:thai');
    expect(useRememberedFiltersStore.getState().filters.cuisines).toEqual(['thai']);
    expect(useRememberedFiltersStore.getState().seededFrom).toBe('v:|s:|c:thai');
  });
  it('remembering a later change keeps which profile state Explore started from', () => {
    useRememberedFiltersStore.getState().seed({ venues: [], services: [], cuisines: ['thai'] }, 'sig');
    useRememberedFiltersStore.getState().remember({ venues: ['cafe'], services: [], cuisines: [] });
    expect(useRememberedFiltersStore.getState().seededFrom).toBe('sig');
  });
  it('clear (sign-out) also forgets which profile state it started from', () => {
    useRememberedFiltersStore.getState().seed({ venues: [], services: [], cuisines: ['thai'] }, 'sig');
    useRememberedFiltersStore.getState().clear();
    expect(useRememberedFiltersStore.getState().seededFrom).toBe('');
  });
});
