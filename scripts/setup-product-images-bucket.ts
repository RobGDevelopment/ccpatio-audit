/**
 * Superseded: the product-images bucket is now configured together with
 * product-documents by scripts/setup-vault-buckets.ts (15 MiB, and NO direct
 * authenticated INSERT/UPDATE policies - writes are signed-URL / service role only).
 * Kept as an alias so the old command keeps working.
 * Usage: npx tsx scripts/setup-product-images-bucket.ts
 */
import "./setup-vault-buckets";
