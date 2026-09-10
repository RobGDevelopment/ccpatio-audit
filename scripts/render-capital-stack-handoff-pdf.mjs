/**
 * One-shot: docs/CAPITAL_STACK_VENDOR_HANDOFF.md → printable HTML → PDF.
 * Uses the machine Chrome (no extra npm dependency).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MD_PATH = path.join(ROOT, "docs", "CAPITAL_STACK_VENDOR_HANDOFF.md");
const HTML_PATH = path.join(ROOT, "docs", "_handoff_print.html");
const PDF_PATH = path.join(ROOT, "docs", "CAPITAL_STACK_VENDOR_HANDOFF.pdf");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdown(source) {
  const fences = [];
  const withFences = source.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, body) => {
    const i = fences.length;
    fences.push({ lang, body: body.replace(/\n$/, "") });
    return `\n%%FENCE_${i}%%\n`;
  });

  const lines = withFences.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = line.trim().match(/^%%FENCE_(\d+)%%$/);
    if (fence) {
      const block = fences[Number(fence[1])];
      out.push(
        `<pre><code class="language-${escapeHtml(block.lang || "text")}">${escapeHtml(block.body)}</code></pre>`,
      );
      i += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
      i += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
      i += 1;
      continue;
    }
    if (line.startsWith("# ")) {
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
      i += 1;
      continue;
    }

    if (line.trim() === "---") {
      out.push("<hr />");
      i += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const quote = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        quote.push((lines[i] ?? "").slice(2));
        i += 1;
      }
      out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
      continue;
    }

    if (line.includes("|") && (lines[i + 1] ?? "").includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const rows = [];
      while (i < lines.length && (lines[i] ?? "").includes("|")) {
        rows.push(lines[i] ?? "");
        i += 1;
      }
      const parsed = rows
        .filter((row, idx) => idx !== 1)
        .map((row) =>
          row
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim()),
        );
      const [header, ...body] = parsed;
      const thead = `<tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr>`;
      const tbody = body
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`);
      continue;
    }

    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i] ?? "")) {
        items.push(`<li>${inline((lines[i] ?? "").slice(2))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i] ?? "")) {
        items.push(`<li>${inline((lines[i] ?? "").replace(/^\d+\. /, ""))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !(lines[i] ?? "").startsWith("#") &&
      (lines[i] ?? "").trim() !== "---" &&
      !(lines[i] ?? "").startsWith("|") &&
      !(lines[i] ?? "").startsWith("> ") &&
      !/^[-*] /.test(lines[i] ?? "") &&
      !/^\d+\. /.test(lines[i] ?? "") &&
      !/^%%FENCE_/.test((lines[i] ?? "").trim())
    ) {
      para.push((lines[i] ?? "").trim());
      i += 1;
    }
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }

  return out.join("\n");
}

const md = fs.readFileSync(MD_PATH, "utf8");
const body = renderMarkdown(md);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CC Patio — Capital Stack Vendor Handoff</title>
  <style>
    @page { size: letter; margin: 0.7in 0.75in; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #1a1a1a;
      max-width: 7in;
      margin: 0 auto;
    }
    h1 { font-size: 20pt; margin: 0 0 12pt; line-height: 1.2; page-break-after: avoid; }
    h2 { font-size: 14pt; margin: 22pt 0 8pt; border-bottom: 1px solid #ccc; padding-bottom: 4pt; page-break-after: avoid; }
    h3 { font-size: 12pt; margin: 16pt 0 6pt; page-break-after: avoid; }
    p { margin: 0 0 8pt; }
    blockquote {
      margin: 10pt 0;
      padding: 8pt 12pt;
      border-left: 3px solid #222;
      background: #f4f4f4;
    }
    blockquote p { margin: 0; }
    code {
      font-family: Consolas, "Courier New", monospace;
      font-size: 9.5pt;
      background: #f2f2f2;
      padding: 0 3px;
    }
    pre {
      background: #f4f4f4;
      border: 1px solid #ddd;
      padding: 10pt 12pt;
      overflow-x: auto;
      font-size: 8.5pt;
      line-height: 1.35;
      page-break-inside: avoid;
    }
    pre code { background: none; padding: 0; font-size: inherit; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8pt 0 12pt;
      font-size: 9.5pt;
      page-break-inside: auto;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 4pt 6pt;
      text-align: left;
      vertical-align: top;
    }
    th { background: #eee; font-weight: 600; }
    ul, ol { margin: 0 0 10pt; padding-left: 22pt; }
    li { margin: 0 0 3pt; }
    hr { border: none; border-top: 1px solid #ccc; margin: 16pt 0; }
    a { color: #111; text-decoration: underline; }
  </style>
</head>
<body>
${body}
</body>
</html>
`;

fs.writeFileSync(HTML_PATH, html, "utf8");

const fileUrl = `file:///${HTML_PATH.replaceAll("\\", "/")}`;
execFileSync(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${PDF_PATH}`,
    fileUrl,
  ],
  { stdio: "inherit" },
);

fs.unlinkSync(HTML_PATH);

const bytes = fs.statSync(PDF_PATH).size;
console.log(`wrote ${PDF_PATH} (${bytes} bytes)`);
