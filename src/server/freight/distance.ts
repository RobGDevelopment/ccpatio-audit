import { eq } from "drizzle-orm";
import { CC_PATIO_PICKUP_ZIP } from "@/server/freight/priority1";
import { getDb } from "@/server/db/client";
import { dock_distances } from "@/server/db/schema";

/** A stored geocode is reused for 30 days. */
export const DOCK_DISTANCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ZIPPOPOTAM_URL = "https://api.zippopotam.us/us/";

export type GeoPoint = {
  lat: number;
  lng: number;
};

export type MeasuredDistance = {
  miles: number;
  source: "geocode";
  fetchedAt: Date;
};

export function dockDistanceFresh(fetchedAt: Date, now: Date): boolean {
  return now.getTime() - fetchedAt.getTime() < DOCK_DISTANCE_TTL_MS;
}

/** Great-circle miles between two ZIP centroids, rounded to cents of a mile. */
export function haversineMiles(origin: GeoPoint, dest: GeoPoint): number {
  const earthMiles = 3958.7613;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = toRad(dest.lat - origin.lat);
  const lngDelta = toRad(dest.lng - origin.lng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRad(origin.lat)) *
      Math.cos(toRad(dest.lat)) *
      Math.sin(lngDelta / 2) ** 2;
  const arc = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((earthMiles * arc + Number.EPSILON) * 100) / 100;
}

type ZippopotamBody = {
  places?: Array<{ latitude?: string; longitude?: string }>;
};

export async function geocodeUsZip(
  zip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeoPoint | null> {
  const response = await fetchImpl(`${ZIPPOPOTAM_URL}${zip}`, {
    headers: {
      accept: "application/json",
      "user-agent": "ccpatio-freight",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`ZIP geocode failed (${response.status})`);
  }
  const body = (await response.json()) as ZippopotamBody;
  const place = body.places?.[0];
  const lat = Number(place?.latitude);
  const lng = Number(place?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function zip5(raw: string): string | null {
  const zip = raw.trim();
  return /^\d{5}$/.test(zip) ? zip : null;
}

const originPointCache = new Map<string, GeoPoint>();

async function pointFor(
  zip: string,
  fetchImpl: typeof fetch,
): Promise<GeoPoint | null> {
  const cached = originPointCache.get(zip);
  if (cached) return cached;
  const point = await geocodeUsZip(zip, fetchImpl);
  if (point && zip === CC_PATIO_PICKUP_ZIP) originPointCache.set(zip, point);
  return point;
}

/**
 * Measured miles from the Scottsdale dock to a destination ZIP.
 * A fresh `dock_distances` row is returned as-is. A miss or a row older
 * than 30 days geocodes both ZIPs and stores the great-circle miles.
 * An unknown ZIP returns null and does not invent a fallback distance.
 */
export async function lookupDockDistance(
  destZip: string,
  options?: { fetchImpl?: typeof fetch; now?: Date },
): Promise<MeasuredDistance | null> {
  const zip = zip5(destZip);
  if (!zip) return null;
  const now = options?.now ?? new Date();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const db = getDb();
  const [row] = await db
    .select()
    .from(dock_distances)
    .where(eq(dock_distances.dest_zip, zip))
    .limit(1);

  if (
    row &&
    row.source === "geocode" &&
    dockDistanceFresh(row.fetched_at, now)
  ) {
    const miles = Number(row.distance_miles);
    if (Number.isFinite(miles) && miles >= 0) {
      return { miles, source: "geocode", fetchedAt: row.fetched_at };
    }
  }

  const origin = await pointFor(CC_PATIO_PICKUP_ZIP, fetchImpl);
  const dest = zip === CC_PATIO_PICKUP_ZIP ? origin : await geocodeUsZip(zip, fetchImpl);
  if (!origin || !dest) return null;
  const miles = zip === CC_PATIO_PICKUP_ZIP ? 0 : haversineMiles(origin, dest);
  await db
    .insert(dock_distances)
    .values({
      dest_zip: zip,
      origin_zip: CC_PATIO_PICKUP_ZIP,
      distance_miles: miles.toFixed(2),
      source: "geocode",
      fetched_at: now,
    })
    .onConflictDoUpdate({
      target: dock_distances.dest_zip,
      set: {
        origin_zip: CC_PATIO_PICKUP_ZIP,
        distance_miles: miles.toFixed(2),
        source: "geocode",
        fetched_at: now,
      },
    });
  return { miles, source: "geocode", fetchedAt: now };
}
