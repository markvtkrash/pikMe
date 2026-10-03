export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const METERS_PER_MILE = 1609.34;
const METERS_PER_FOOT = 0.3048;

export function formatDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return `${Math.round(meters / METERS_PER_FOOT)}ft`;
  return `${miles.toFixed(1)}mi`;
}

// Snap coordinates to ~200m grid to prevent over-fetching on small movements
export function snapToGrid(coord: number, deg = 0.002): number {
  return Math.round(coord / deg) * deg;
}
