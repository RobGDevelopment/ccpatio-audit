import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { BANNED_TERMS_PATTERNS } from "@/lib/intake/copy";

function scanFiles(relDir: string): string[] {
  const fullDir = path.resolve(process.cwd(), relDir);
  if (!fs.existsSync(fullDir)) return [];
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...scanFiles(path.relative(process.cwd(), fullPath)));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(path.relative(process.cwd(), fullPath).replace(/\\/g, "/"));
    }
  }
  return files;
}

describe("Embed Copy Guard (Banned Terms Purge)", () => {
  it("enforces no banned developer jargon in user-visible text", () => {
    const files = [
      ...scanFiles("src/lib/intake"),
      ...scanFiles("src/server/factory-bom/intake"),
      ...scanFiles("src/app/embed/factory-bom"),
    ].filter(
      (f) =>
        // Exclude legacy components slated for deletion in Task 11
        !f.includes("AirlockWizard") &&
        !f.includes("FunnelFork") &&
        !f.includes("IntakeDropzone") &&
        !f.includes("PacketLines")
    );

    const allowlistPath = path.resolve(process.cwd(), "tests/fixtures/embed-copy-allowlist.json");
    let allowlist: string[] = [];
    if (fs.existsSync(allowlistPath)) {
      allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
    }

    const violations: { file: string; text: string; pattern: string }[] = [];

    // Check filenames
    for (const f of files) {
      const baseName = path.basename(f);
      for (const pattern of BANNED_TERMS_PATTERNS) {
        if (pattern.test(baseName)) {
          violations.push({
            file: f,
            text: baseName,
            pattern: pattern.toString(),
          });
        }
      }
    }

    // Check file contents using AST
    for (const f of files) {
      const fullPath = path.resolve(process.cwd(), f);
      const code = fs.readFileSync(fullPath, "utf8");
      const sourceFile = ts.createSourceFile(
        fullPath,
        code,
        ts.ScriptTarget.Latest,
        true
      );

      function visit(node: ts.Node) {
        // Skip imports and exports
        if (
          ts.isImportDeclaration(node) ||
          ts.isExportDeclaration(node) ||
          ts.isImportEqualsDeclaration(node)
        ) {
          return;
        }

        // Collect JSX text
        if (ts.isJsxText(node)) {
          const text = node.getText().trim();
          if (text) checkString(text, f, true);
        }

        // Collect JSX attribute values for user-visible props
        if (ts.isJsxAttribute(node)) {
          const attrName = node.name.getText(sourceFile);
          const userVisibleAttrs = ["aria-label", "title", "placeholder", "alt", "label"];
          if (userVisibleAttrs.includes(attrName) && node.initializer) {
            if (ts.isStringLiteral(node.initializer)) {
              checkString(node.initializer.text, f, true);
            }
          }
        }

        // String literals in return statements or object properties
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          const parent = node.parent;
          if (
            parent &&
            !ts.isImportDeclaration(parent) &&
            !ts.isExportDeclaration(parent) &&
            !ts.isTypeNode(parent)
          ) {
            // Check property assignments or call arguments
            const text = node.text;
            if (text && text.length > 2) {
              let isJsx = false;
              // Ignore classNames, testIds, ids, keys, etc.
              if (ts.isJsxAttribute(parent)) {
                const name = parent.name.getText(sourceFile);
                if (["className", "id", "key", "href", "name", "role", "type", "data-testid"].includes(name)) {
                  return;
                }
                isJsx = true;
              } else if (ts.isJsxElement(parent) || ts.isJsxFragment(parent) || ts.isJsxExpression(parent)) {
                isJsx = true;
              }
              checkString(text, f, isJsx);
            }
          }
        }

        // Template literals (with substitutions)
        if (ts.isTemplateExpression(node)) {
          const parent = node.parent;
          if (
            parent &&
            !ts.isImportDeclaration(parent) &&
            !ts.isExportDeclaration(parent) &&
            !ts.isTypeNode(parent)
          ) {
            const isJsx = Boolean(
              parent &&
                (ts.isJsxAttribute(parent) ||
                  ts.isJsxElement(parent) ||
                  ts.isJsxFragment(parent) ||
                  ts.isJsxExpression(parent))
            );
            if (node.head.text && node.head.text.length > 2) {
              checkString(node.head.text, f, isJsx);
            }
            for (const span of node.templateSpans) {
              if (span.literal.text && span.literal.text.length > 2) {
                checkString(span.literal.text, f, isJsx);
              }
            }
          }
        }

        ts.forEachChild(node, visit);
      }

      function checkString(text: string, file: string, isJsxContext = false) {
        if (allowlist.includes(text)) return;
        for (const pattern of BANNED_TERMS_PATTERNS) {
          if (pattern.test(text)) {
            // Filter out internal code identifiers, sql table references, or internal API routes strictly in non-JSX contexts
            if (!isJsxContext && (text.startsWith("factory-bom-intake") || text.startsWith("/embed/"))) {
              continue;
            }
            violations.push({ file, text, pattern: pattern.toString() });
          }
        }
      }

      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
