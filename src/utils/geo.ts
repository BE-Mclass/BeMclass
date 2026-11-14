export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeofenceEvaluation {
  distance_m: number;
  radius_m: number;
  within_radius: boolean;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Memvalidasi apakah pasangan (latitude, longitude) berada pada rentang koordinat bumi yang sah.
 */
export function isValidCoordinates(
  latitude: unknown,
  longitude: unknown
): boolean {
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Menghitung jarak lingkaran besar (Haversine) antara dua koordinat GPS dalam satuan meter,
 * dibulatkan 1 angka di belakang koma sesuai spesifikasi TRD §5 (R = 6.371.000 m).
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  const rawDistance = EARTH_RADIUS_METERS * c;

  return Math.round(rawDistance * 10) / 10;
}

/**
 * Mengevaluasi apakah posisi klien berada di dalam radius geofence sekolah (BR-12, TRD §5).
 * Sesuai TRD §5: `distance <= radius_m` (sama dengan batas radius dianggap sah).
 */
export function evaluateGeofence(
  clientPoint: GeoPoint,
  schoolCenter: GeoPoint,
  radiusM: number
): GeofenceEvaluation {
  const distanceM = haversineMeters(clientPoint, schoolCenter);
  return {
    distance_m: distanceM,
    radius_m: radiusM,
    within_radius: distanceM <= radiusM,
  };
}
