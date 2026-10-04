import { describe, expect, it, vi, afterEach } from "vitest";
import { normalizeStoryInput, sanitizeStoryHtml, storyHtmlToPlainText } from "@/server/pim/html-sanitize";
import { normalizeSlug, typingSlug, SLUG_RE } from "@/lib/seo-limits";
import {
  buildSeoUserPrompt,
  dimensionsForPrompt,
  requestSeoSuggestion,
  SEO_NOT_CONFIGURED,
  SEO_UNUSABLE,
  type SeoPromptInput,
} from "@/server/pim/seo-assistant";

describe("sanitizeStoryHtml (server-side allowlist)", () => {
  it("keeps only p, br, strong, em, ul, ol, li, a", () => {
    const out = sanitizeStoryHtml(
      '<p>Hello <strong>bold</strong> <em>it</em><br>line</p><ul><li>one</li></ul><ol><li>two</li></ol><a href="https://ccpatio.com/x">link</a>',
    )!;
    for (const tag of ["p", "br", "strong", "em", "ul", "ol", "li", "a"]) {
      expect(out).toContain(`<${tag}`);
    }
  });

  it("strips scripts, styles, handlers, images, iframes and disallowed tags", () => {
    const out = sanitizeStoryHtml(
      '<p onclick="x()" style="color:red" class="c">Hi</p><script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)><iframe src="https://evil"></iframe><h1>Title</h1><div>d</div>',
    )!;
    expect(out).not.toMatch(/script|alert|style|onclick|onerror|<img|iframe|<h1|<div|class=/i);
    expect(out).toContain("<p>Hi</p>");
    expect(out).toContain("Title");
  });

  it("neutralises javascript:, data: and protocol-relative links and hardens rel", () => {
    const js = sanitizeStoryHtml('<a href="javascript:alert(1)">x</a>')!;
    expect(js).not.toContain("javascript:");
    const data = sanitizeStoryHtml('<a href="data:text/html;base64,AAA">x</a>')!;
    expect(data).not.toContain("data:");
    const rel = sanitizeStoryHtml("<a href='//evil.example'>x</a>")!;
    expect(rel).not.toContain("//evil.example");
    const ok = sanitizeStoryHtml('<a href="https://ccpatio.com" target="_blank">x</a>')!;
    expect(ok).toContain('rel="noopener noreferrer"');
    expect(ok).not.toContain("target");
  });

  it("returns null for empty or markup-only-empty input", () => {
    expect(sanitizeStoryHtml("   ")).toBeNull();
    expect(sanitizeStoryHtml("<script>alert(1)</script>")).toBeNull();
    expect(sanitizeStoryHtml(null)).toBeNull();
  });

  it("converts plain text to escaped paragraphs and line breaks", () => {
    expect(normalizeStoryInput("One\nTwo\n\nThree & <b")).toBe("<p>One<br />Two</p><p>Three &amp; &lt;b</p>");
    expect(storyHtmlToPlainText("<p>A &amp; B</p><ul><li>x</li></ul>")).toContain("A & B");
  });
});

describe("requestSeoSuggestion (LLM adapter)", () => {
  const input: SeoPromptInput = {
    productName: "Milan Lounge Chair",
    collectionLabel: "Milan",
    categoryLabel: "Lounge Chair",
    origin: "manufactured",
    lengthIn: "32",
    depthIn: "34",
    heightIn: null,
    marketingCopy: "Hand-woven frame with deep seating.",
  };
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });
  const respond = (content: unknown, status = 200) =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
    ) as unknown as typeof fetch;

  it("is disabled until model + key are configured", async () => {
    delete process.env.SEO_ASSISTANT_MODEL;
    delete process.env.SEO_ASSISTANT_API_KEY;
    await expect(requestSeoSuggestion(input, vi.fn() as unknown as typeof fetch)).rejects.toThrow(SEO_NOT_CONFIGURED);
  });

  it("accepts a valid JSON suggestion and sends only whitelisted product facts", async () => {
    process.env.SEO_ASSISTANT_MODEL = "test-model";
    process.env.SEO_ASSISTANT_API_KEY = "sk-test";
    const f = respond(
      JSON.stringify({
        seoTitle: "Milan Lounge Chair | CC Patio",
        metaDescription: "A hand-woven lounge chair with deep seating, designed for refined outdoor living.",
        slug: "milan-lounge-chair",
      }),
    );
    const out = await requestSeoSuggestion(input, f);
    expect(out.slug).toBe("milan-lounge-chair");
    const body = JSON.parse((vi.mocked(f).mock.calls[0][1] as RequestInit).body as string);
    const userMsg = body.messages.find((m: { role: string }) => m.role === "user").content as string;
    expect(userMsg).toContain("Milan");
    expect(userMsg).toContain("Length: 32 in");
    expect(userMsg).not.toMatch(/cost|wholesale|msrp|vendor/i);
  });

  it("discards over-limit, bad-slug, and non-JSON output", async () => {
    process.env.SEO_ASSISTANT_MODEL = "test-model";
    process.env.SEO_ASSISTANT_API_KEY = "sk-test";
    const tooLong = respond(
      JSON.stringify({ seoTitle: "x".repeat(61), metaDescription: "ok", slug: "ok" }),
    );
    await expect(requestSeoSuggestion(input, tooLong)).rejects.toThrow(SEO_UNUSABLE);
    const badSlug = respond(
      JSON.stringify({ seoTitle: "ok", metaDescription: "ok", slug: "Bad Slug!" }),
    );
    await expect(requestSeoSuggestion(input, badSlug)).rejects.toThrow(SEO_UNUSABLE);
    await expect(requestSeoSuggestion(input, respond("not json"))).rejects.toThrow(SEO_UNUSABLE);
  });

  it("does not leak provider error bodies", async () => {
    process.env.SEO_ASSISTANT_MODEL = "test-model";
    process.env.SEO_ASSISTANT_API_KEY = "sk-test";
    const f = vi.fn().mockResolvedValue(new Response("secret details", { status: 500 })) as unknown as typeof fetch;
    await expect(requestSeoSuggestion(input, f)).rejects.toThrow(/failed \(500\)/);
  });
});

describe("dimensionsForPrompt (N/A-aware)", () => {
  it("omits any dimension flagged in na_fields, even if a value is stored", () => {
    expect(dimensionsForPrompt({ length: "30", depth: "34", height: "29", naFields: ["depth"] })).toEqual({
      lengthIn: "30",
      depthIn: null,
      heightIn: "29",
    });
    expect(dimensionsForPrompt({ length: "30", depth: "34", height: "29", naFields: ["Length", " height "] })).toEqual({
      lengthIn: null,
      depthIn: "34",
      heightIn: null,
    });
  });

  it("passes dimensions through when nothing is flagged and drops blanks", () => {
    expect(dimensionsForPrompt({ length: " 30 ", depth: "", height: null, naFields: null })).toEqual({
      lengthIn: "30",
      depthIn: null,
      heightIn: null,
    });
    expect(dimensionsForPrompt({ length: "1", depth: "2", height: "3", naFields: ["msrp", "weight"] })).toEqual({
      lengthIn: "1",
      depthIn: "2",
      heightIn: "3",
    });
  });

  it("never mentions an omitted dimension in the prompt text", () => {
    const dims = dimensionsForPrompt({ length: "30", depth: "34", height: "29", naFields: ["depth"] });
    const prompt = buildSeoUserPrompt({
      productName: "P",
      collectionLabel: "C",
      categoryLabel: "K",
      origin: "manufactured",
      ...dims,
      marketingCopy: "copy",
    });
    expect(prompt).not.toMatch(/Depth/);
    expect(prompt).toContain("Length: 30 in");
  });
});

describe("slug normalization", () => {
  it("typingSlug lowercases and hyphenates but keeps a trailing hyphen while typing", () => {
    expect(typingSlug("Milan Lounge ")).toBe("milan-lounge-");
    expect(typingSlug("  --Café  Table!!")).toBe("cafe-table-");
    expect(typingSlug("a__b  c")).toBe("a-b-c");
  });

  it("normalizeSlug always yields a value that satisfies SLUG_RE (or empty)", () => {
    for (const raw of ["Milan Lounge ", "--x--", "A/B\\C", "Ünï Cödé 9", "hello---world"]) {
      const s = normalizeSlug(raw);
      expect(s === "" || SLUG_RE.test(s)).toBe(true);
    }
    expect(normalizeSlug("Milan Lounge Chair!")).toBe("milan-lounge-chair");
    expect(normalizeSlug("!!!")).toBe("");
  });
});
