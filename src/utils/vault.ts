import { LRUCache } from "lru-cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { vendor_credentials } from "@/server/db/schema";

type VendorService = "katana" | "woocommerce" | "clover";

// Cache for decrypted keys, TTL of 5 minutes (300,000 ms), max 50 items.
const vendorKeyCache = new LRUCache<VendorService, string>({
  max: 50,
  ttl: 1000 * 60 * 5,
});

/**
 * Gets a decrypted vendor key from the Vault or the LRU cache.
 */
export async function getDecryptedVendorKey(
  service_name: VendorService
): Promise<string | null> {
  const cachedKey = vendorKeyCache.get(service_name);
  if (cachedKey) {
    return cachedKey;
  }

  const db = getDb();
  
  // Note: We are fetching the encrypted_token column directly.
  // When pgsodium is fully wired, this query should hit the secure view or RPC
  // that decrypts the token at the DB level, or we use a Node.js decrypt function.
  const record = await db.query.vendor_credentials.findFirst({
    where: eq(vendor_credentials.service_name, service_name),
  });

  if (record?.encrypted_token) {
    // Cache the decrypted token
    vendorKeyCache.set(service_name, record.encrypted_token);
    return record.encrypted_token;
  }

  return null;
}

/**
 * Invalidates a cached vendor key so it is fetched fresh on the next call.
 * This should be called immediately after a key is rotated.
 */
export function invalidateVendorKey(service_name: VendorService) {
  vendorKeyCache.delete(service_name);
}
