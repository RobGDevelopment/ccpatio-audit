import sanitizeHtml from "sanitize-html";

/** Tags allowed in marketing / construction copy (blueprint §3). */
export const ALLOWED_STORY_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a"] as const;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_STORY_TAGS],
  // No style, class, src, data-*, on* handlers. `rel` is only ever injected by us below.
  allowedAttributes: { a: ["href", "rel"] },
  allowedSchemes: ["http", "https"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  // Disallowed tags are dropped but their text is kept; script/style/textarea/option
  // content is discarded entirely (sanitize-html nonTextTags default).
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...(attribs.href ? { href: attribs.href } : {}),
        rel: "noopener noreferrer",
      },
    }),
  },
};

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sanitize rich text for storage. Output only contains p/br/strong/em/ul/ol/li and
 * <a href="http(s)://…">. Returns null for empty / whitespace-only results.
 */
export function sanitizeStoryHtml(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input).replace(/\0/g, "");
  if (!raw.trim()) return null;
  const clean = sanitizeHtml(raw, OPTIONS).trim();
  // Treat markup that sanitizes to nothing visible as empty.
  const visible = clean.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return visible ? clean : null;
}

/**
 * Operator input that contains no tag at all is plain text: blank-line separated
 * paragraphs become <p>, single newlines become <br>. Everything is escaped first,
 * then still run through the allowlist sanitizer.
 */
export function normalizeStoryInput(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input).replace(/\0/g, "").replace(/\r\n?/g, "\n");
  if (!raw.trim()) return null;
  if (!/<[a-z!/][^>]*>/i.test(raw)) {
    const html = raw
      .trim()
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeText(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
    return sanitizeStoryHtml(html);
  }
  return sanitizeStoryHtml(raw);
}

/** HTML -> plain text (for the AI prompt; never sends markup to the model). */
export function storyHtmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<\/(p|li|ul|ol)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
