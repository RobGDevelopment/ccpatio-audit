import { headers } from "next/headers";
import {
  EMBED_KEY_HEADER,
  EMBED_TOKEN_HEADER,
  embedKeyIsValid,
  getGhlEmbedSecret,
  mintEmbedSessionToken,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";
import { EmbedSessionProvider } from "@/components/embed/EmbedSessionProvider";

export default async function EmbedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hdrs = await headers();
  const secret = getGhlEmbedSecret();
  const existing = hdrs.get(EMBED_TOKEN_HEADER);
  let embedToken: string | null = null;
  if (existing && (await verifyEmbedSessionToken(existing, secret))) {
    embedToken = existing;
  } else if (embedKeyIsValid(hdrs.get(EMBED_KEY_HEADER), secret)) {
    embedToken = await mintEmbedSessionToken(secret);
  }

  return (
    <EmbedSessionProvider embedToken={embedToken}>
      <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#0b0f17] text-slate-100">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </EmbedSessionProvider>
  );
}
