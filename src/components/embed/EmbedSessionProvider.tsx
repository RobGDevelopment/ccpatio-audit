"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EMBED_TOKEN_HEADER } from "@/lib/embed-auth";

const REFRESH_INTERVAL_MS = 45 * 60 * 1000;

type EmbedSessionContextValue = {
  embedToken: string | null;
  /** Live mutable headers for cookie-independent auth (avoids stale closures). */
  getEmbedHeaders: () => HeadersInit;
  /** Attach the HMAC embed token header for cookie-independent auth. */
  withEmbedAuth: (init?: RequestInit) => RequestInit;
  embedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const EmbedSessionContext = createContext<EmbedSessionContextValue>({
  embedToken: null,
  getEmbedHeaders: () => ({}),
  withEmbedAuth: (init) => init ?? {},
  embedFetch: (input, init) => fetch(input, init),
});

function writeMirrorCookie(token: string) {
  if (typeof document === "undefined") return;
  const maxAge = 60 * 60 * 2;
  document.cookie = `${EMBED_TOKEN_HEADER}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=None; Partitioned`;
}

export function EmbedSessionProvider({
  embedToken: initialToken,
  children,
}: {
  embedToken: string | null;
  children: ReactNode;
}) {
  const [embedToken, setEmbedToken] = useState<string | null>(initialToken);
  /** Always holds the freshest token so fetch helpers never close over a stale value. */
  const tokenRef = useRef<string | null>(initialToken);

  useEffect(() => {
    tokenRef.current = initialToken;
    setEmbedToken(initialToken);
  }, [initialToken]);

  useEffect(() => {
    tokenRef.current = embedToken;
    if (!embedToken || typeof document === "undefined") return;
    writeMirrorCookie(embedToken);
  }, [embedToken]);

  const getEmbedHeaders = useCallback((): HeadersInit => {
    const token = tokenRef.current;
    if (!token) return {};
    return {
      [EMBED_TOKEN_HEADER]: token,
      Authorization: `Bearer ${token}`,
    };
  }, []);

  const refreshToken = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    try {
      const res = await fetch("/api/embed/refresh-token", {
        method: "POST",
        credentials: "include",
        headers: { [EMBED_TOKEN_HEADER]: current },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { ok?: boolean; token?: string };
      if (data.ok && typeof data.token === "string" && data.token) {
        tokenRef.current = data.token;
        setEmbedToken(data.token);
        writeMirrorCookie(data.token);
      }
    } catch {
      // Silent — next visibility/interval tick can retry.
    }
  }, []);

  useEffect(() => {
    if (!embedToken || typeof window === "undefined") return;
    const handle = window.setInterval(() => {
      void refreshToken();
    }, REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshToken();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [embedToken, refreshToken]);

  const withEmbedAuth = useCallback((init?: RequestInit): RequestInit => {
    const token = tokenRef.current;
    if (!token) return init ?? {};
    const headers = new Headers(init?.headers);
    headers.set(EMBED_TOKEN_HEADER, token);
    headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers, credentials: init?.credentials ?? "include" };
  }, []);

  const embedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => fetch(input, withEmbedAuth(init)),
    [withEmbedAuth],
  );

  const value = useMemo(
    () => ({ embedToken, getEmbedHeaders, withEmbedAuth, embedFetch }),
    [embedToken, getEmbedHeaders, withEmbedAuth, embedFetch],
  );

  return (
    <EmbedSessionContext.Provider value={value}>{children}</EmbedSessionContext.Provider>
  );
}

export function useEmbedSession(): EmbedSessionContextValue {
  return useContext(EmbedSessionContext);
}
