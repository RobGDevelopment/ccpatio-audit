"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { EMBED_TOKEN_HEADER } from "@/lib/embed-auth";

type EmbedSessionContextValue = {
  embedToken: string | null;
  /** Attach the HMAC embed token header for cookie-independent auth. */
  withEmbedAuth: (init?: RequestInit) => RequestInit;
  embedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const EmbedSessionContext = createContext<EmbedSessionContextValue>({
  embedToken: null,
  withEmbedAuth: (init) => init ?? {},
  embedFetch: (input, init) => fetch(input, init),
});

export function EmbedSessionProvider({
  embedToken,
  children,
}: {
  embedToken: string | null;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!embedToken || typeof document === "undefined") return;
    // Mirror the Partitioned non-httpOnly cookie for same-tab API calls.
    const maxAge = 60 * 60 * 2;
    document.cookie = `${EMBED_TOKEN_HEADER}=${encodeURIComponent(embedToken)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=None; Partitioned`;
  }, [embedToken]);

  const withEmbedAuth = useCallback(
    (init?: RequestInit): RequestInit => {
      if (!embedToken) return init ?? {};
      const headers = new Headers(init?.headers);
      headers.set(EMBED_TOKEN_HEADER, embedToken);
      return { ...init, headers, credentials: init?.credentials ?? "include" };
    },
    [embedToken],
  );

  const embedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => fetch(input, withEmbedAuth(init)),
    [withEmbedAuth],
  );

  const value = useMemo(
    () => ({ embedToken, withEmbedAuth, embedFetch }),
    [embedToken, withEmbedAuth, embedFetch],
  );

  return (
    <EmbedSessionContext.Provider value={value}>{children}</EmbedSessionContext.Provider>
  );
}

export function useEmbedSession(): EmbedSessionContextValue {
  return useContext(EmbedSessionContext);
}
