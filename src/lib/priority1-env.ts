/**
 * Server-only Priority1 credential. Never log the value.
 * A NEXT_PUBLIC_ name would ship the key to the browser, so that name is rejected.
 * A missing or blank PRIORITY1_API_KEY means mock mode, not a thrown error.
 */
export function readPriority1ApiKey(): string | null {
  const leaked = process.env.NEXT_PUBLIC_PRIORITY1_API_KEY?.trim();
  if (leaked) {
    throw new Error(
      "NEXT_PUBLIC_PRIORITY1_API_KEY is set. Remove it. Priority1 credentials stay on the server as PRIORITY1_API_KEY.",
    );
  }

  const key = process.env.PRIORITY1_API_KEY?.trim() ?? "";
  if (!key) return null;
  if (/\s/.test(key)) {
    throw new Error("PRIORITY1_API_KEY must not contain whitespace.");
  }
  return key;
}

export function requirePriority1ApiKey(): string {
  const key = readPriority1ApiKey();
  if (!key) {
    throw new Error(
      "PRIORITY1_API_KEY is not set. Add it to .env.local. Do not prefix it with NEXT_PUBLIC_.",
    );
  }
  return key;
}
