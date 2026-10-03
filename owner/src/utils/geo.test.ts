import { haversineDistance, formatDistance, snapToGrid } from './geo';

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it('is symmetric', () => {
    const ab = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
    const ba = haversineDistance(34.0522, -118.2437, 40.7128, -74.006);
    expect(ab).toBe(ba);
  });

  it('approximates ~111.19km for 1 degree of longitude at the equator', () => {
    const distance = haversineDistance(0, 0, 0, 1);
    expect(Math.abs(distance - 111194.9)).toBeLessThan(50);
  });

  it('approximates ~111.19km for 1 degree of latitude', () => {
    const distance = haversineDistance(10, 0, 11, 0);
    expect(Math.abs(distance - 111194.9)).toBeLessThan(50);
  });

  it('approximates half the Earth\'s circumference for antipodal points', () => {
    const distance = haversineDistance(0, 0, 0, 180);
    expect(Math.abs(distance - Math.PI * 6371000)).toBeLessThan(50);
  });
});

describe('formatDistance', () => {
  it('formats sub-0.1-mile distances rounded to the nearest foot', () => {
    expect(formatDistance(0)).toBe('0ft');
    expect(formatDistance(100)).toBe('328ft');
    expect(formatDistance(160)).toBe('525ft');
  });

  it('formats distances at or above 0.1 miles in miles with one decimal', () => {
    expect(formatDistance(161)).toBe('0.1mi');
    expect(formatDistance(1000)).toBe('0.6mi');
    expect(formatDistance(1609.34)).toBe('1.0mi');
    expect(formatDistance(23456)).toBe('14.6mi');
  });
});

describe('snapToGrid', () => {
  it('snaps to the nearest multiple of the default 0.002 grid', () => {
    expect(snapToGrid(0.003)).toBeCloseTo(0.004);
    expect(snapToGrid(0.0009)).toBeCloseTo(0);
  });

  it('snaps using a custom grid size', () => {
    expect(snapToGrid(2.6, 1)).toBe(3);
    expect(snapToGrid(2.4, 1)).toBe(2);
  });

  it('handles negative coordinates', () => {
    expect(snapToGrid(-2.6, 1)).toBe(-3);
    expect(snapToGrid(-2.4, 1)).toBe(-2);
  });
});
