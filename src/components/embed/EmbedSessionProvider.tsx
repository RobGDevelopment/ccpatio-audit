"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { EMBED_TOKEN_HEADER } from "@/lib/embed-auth";

const REFRESH_INTERVAL_MS = 45 * 60 * 1000;

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

  useEffect(() => {
    setEmbedToken(initialToken);
  }, [initialToken]);

  useEffect(() => {
    if (!embedToken || typeof document === "undefined") return;
    writeMirrorCookie(embedToken);
  }, [embedToken]);

  const refreshToken = useCallback(async () => {
    if (!embedToken) return;
    try {
      const res = await fetch("/api/embed/refresh-token", {
        method: "POST",
        credentials: "include",
        headers: { [EMBED_TOKEN_HEADER]: embedToken },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { ok?: boolean; token?: string };
      if (data.ok && typeof data.token === "string" && data.token) {
        setEmbedToken(data.token);
        writeMirrorCookie(data.token);
      }
    } catch {
      // Silent — next visibility/interval tick can retry.
    }
  }, [embedToken]);

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
