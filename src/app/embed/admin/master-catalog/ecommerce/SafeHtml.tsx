"use client";

import React, { useMemo } from "react";

const ALLOWED = new Set(["P", "BR", "STRONG", "EM", "UL", "OL", "LI", "A"]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Last-line-of-defence allowlist (p, br, strong, em, ul, ol, li, a[http/https]) for markup
 * that was ALREADY sanitized on the server. Anything else is unwrapped to its text;
 * script/style content is dropped. Without a DOM (SSR) it degrades to escaped plain text.
 */
export function sanitizeForDisplay(html: string): string {
  if (typeof DOMParser === "undefined") {
    return escapeHtml(html.replace(/<[^>]*>/g, ""));
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE" || tag === "IFRAME") return "";
    const inner = Array.from(el.childNodes).map(walk).join("");
    if (!ALLOWED.has(tag)) return inner;
    const t = tag.toLowerCase();
    if (t === "br") return "<br>";
    if (t === "a") {
      const href = el.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href.trim())) return inner;
      return `<a href="${href.trim().replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    return `<${t}>${inner}</${t}>`;
  };

  return Array.from(doc.body.childNodes).map(walk).join("");
}

const PROSE =
  "[&_p]:mb-2 last:[&_p]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_a]:text-sky-700 [&_a]:underline [&_strong]:font-semibold";

/** Renders story copy as formatted HTML (no literal `<p>` tags). */
export function SafeHtml({
  html,
  className = "",
  empty,
}: {
  html: string | null | undefined;
  className?: string;
  empty?: React.ReactNode;
}) {
  const clean = useMemo(() => (html ? sanitizeForDisplay(html) : ""), [html]);
  if (!clean.trim()) return <>{empty ?? null}</>;
  return (
    <div
      className={`${PROSE} ${className}`}
      // Allowlist-sanitized above (and on the server before it was stored).
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
