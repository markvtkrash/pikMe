// Tests for the pure decision in the replace-restaurant-menu-items edge function: a claimed independent restaurant is
// saved against its place ID; a franchise stays shared by chain name. Imported straight from the functions folder.
import {
  decidePlaceMode, isValidPlaceId,
} from '../../../supabase/functions/replace-restaurant-menu-items/placeMode';

const PLACE = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

describe('isValidPlaceId', () => {
  it('accepts a normal place ID and rejects anything else', () => {
    expect(isValidPlaceId(PLACE)).toBe(true);
    expect(isValidPlaceId('short')).toBe(false);
    expect(isValidPlaceId('has spaces in it here')).toBe(false);
    expect(isValidPlaceId('a'.repeat(201))).toBe(false);
    expect(isValidPlaceId(null)).toBe(false);
    expect(isValidPlaceId(12345678901)).toBe(false);
  });
});

describe('decidePlaceMode', () => {
  it('saves an independent restaurant against its place', () => {
    expect(decidePlaceMode({ placeId: PLACE, isChain: false })).toBe(PLACE);
  });

  it('never uses a place for a franchise', () => {
    expect(decidePlaceMode({ placeId: PLACE, isChain: true })).toBeNull();
  });

  it('never uses a missing or invalid place ID', () => {
    expect(decidePlaceMode({ placeId: null, isChain: false })).toBeNull();
    expect(decidePlaceMode({ placeId: undefined, isChain: false })).toBeNull();
    expect(decidePlaceMode({ placeId: 'bad', isChain: false })).toBeNull();
  });
});
