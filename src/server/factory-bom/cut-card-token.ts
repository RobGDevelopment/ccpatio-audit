import crypto from "crypto";

const getSecret = () => process.env.SUPABASE_JWT_SECRET || "default_development_secret_key";

export function createCutCardToken(payload: { jobId: string; globalSku: string }): string {
  const dataB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", getSecret()).update(dataB64).digest("base64url");
  return `${dataB64}.${signature}`;
}

export function verifyCutCardToken(token: string): { jobId: string; globalSku: string } | null {
  try {
    const [dataB64, signature] = token.split(".");
    if (!dataB64 || !signature) return null;
    
    const expectedSignature = crypto.createHmac("sha256", getSecret()).update(dataB64).digest("base64url");
    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));
    }
    return null;
  } catch {
    return null;
  }
}
