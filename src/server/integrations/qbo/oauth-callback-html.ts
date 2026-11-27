/**
 * Dark Executive HTML pages for `/api/auth/qbo/callback` browser navigations.
 * Never dump raw JSON into a popup window.
 */
import {
  QBO_OAUTH_RESULT_MESSAGE_TYPE,
  type SanitizedQboConfig,
  qboSafeCredentialDiagnostics,
} from "@/server/integrations/qbo/oauth";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SHELL_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #1a2332 0%, #0b0f17 55%, #07090d 100%);
    color: #e2e8f0;
  }
  .card {
    width: min(440px, 92vw); border-radius: 16px; padding: 28px 26px 24px;
    background: #0d1117; border: 1px solid rgba(197,160,89,0.28);
    box-shadow: 0 24px 60px rgba(0,0,0,0.45);
  }
  .eyebrow { letter-spacing: 0.18em; text-transform: uppercase; font-size: 11px; color: #c5a059; margin: 0 0 10px; font-weight: 700; }
  h1 { margin: 0 0 10px; font-size: 22px; font-weight: 650; color: #f8fafc; }
  p { margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: #94a3b8; }
  .ok { color: #86efac; }
  .bad { color: #fda4af; }
  .diag {
    margin: 14px 0 16px; padding: 12px 14px; border-radius: 10px;
    background: rgba(15,23,42,0.85); border: 1px solid rgba(148,163,184,0.18);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px; line-height: 1.55; color: #cbd5e1;
  }
  .diag div { display: flex; justify-content: space-between; gap: 12px; }
  .diag span:last-child { color: #f1f5f9; text-align: right; word-break: break-all; }
  ol { margin: 0 0 16px; padding-left: 18px; color: #94a3b8; font-size: 13px; line-height: 1.55; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  a.btn, button.btn {
    appearance: none; border: 0; cursor: pointer; text-decoration: none;
    border-radius: 8px; padding: 10px 14px; font-size: 12px; font-weight: 700;
    letter-spacing: 0.04em; text-transform: uppercase;
  }
  .gold { background: #c5a059; color: #0b0f17; }
  .ghost { background: rgba(148,163,184,0.12); color: #e2e8f0; }
`;

export function renderQboOAuthSuccessHtml(opts?: { returnHref?: string }): string {
  const returnHref = escapeHtml(opts?.returnHref ?? "/embed/admin/master-catalog");
  const msgType = QBO_OAUTH_RESULT_MESSAGE_TYPE;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>QuickBooks Online Connected</title><style>${SHELL_CSS}</style></head>
<body><main class="card">
  <p class="eyebrow">CC Patio · Executive Control</p>
  <h1 class="ok">QuickBooks Online Connected</h1>
  <p>OAuth completed. Returning to the Control Center…</p>
  <div class="actions">
    <a class="btn gold" href="${returnHref}">Return to Control Center</a>
  </div>
</main>
<script>
(function () {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: ${JSON.stringify(msgType)}, ok: true }, "*");
    }
  } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} }, 1200);
})();
</script>
</body></html>`;
}

export function renderQboOAuthFailureHtml(input: {
  title?: string;
  oauthError?: string | null;
  message: string;
  config: SanitizedQboConfig;
  reconnectHref?: string;
  returnHref?: string;
}): string {
  const diag = qboSafeCredentialDiagnostics(input.config);
  const title = escapeHtml(input.title ?? "QuickBooks Reconnect Required");
  const oauthError = escapeHtml(input.oauthError ?? "unknown");
  const message = escapeHtml(input.message);
  const reconnectHref = escapeHtml(
    input.reconnectHref ?? "/api/auth/qbo/connect",
  );
  const returnHref = escapeHtml(input.returnHref ?? "/embed/admin/master-catalog");
  const msgType = QBO_OAUTH_RESULT_MESSAGE_TYPE;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title><style>${SHELL_CSS}</style></head>
<body><main class="card">
  <p class="eyebrow">CC Patio · Executive Control</p>
  <h1 class="bad">${title}</h1>
  <p>${message}</p>
  <p>Intuit error: <strong class="bad">${oauthError}</strong></p>
  <div class="diag" data-testid="qbo-oauth-diagnostics">
    <div><span>environment</span><span>${escapeHtml(diag.environment)}</span></div>
    <div><span>redirectUri</span><span>${escapeHtml(diag.redirectUri)}</span></div>
    <div><span>clientIdPrefix</span><span>${escapeHtml(diag.clientIdPrefix)}</span></div>
    <div><span>clientIdLength</span><span>${diag.clientIdLength}</span></div>
    <div><span>clientSecretLength</span><span>${diag.clientSecretLength}</span></div>
    <div><span>secretSha256Prefix8</span><span>${escapeHtml(diag.secretSha256Prefix8 || "n/a")}</span></div>
    <div><span>trimmedWhitespaceOrQuotes</span><span>${diag.trimmedWhitespaceOrQuotes ? "true" : "false"}</span></div>
  </div>
  <ol>
    <li>Open Vercel → Project → Settings → Environment Variables.</li>
    <li>Confirm Production vs Sandbox Client ID/Secret match the Intuit Developer Portal app.</li>
    <li>Remove accidental quotes, spaces, or Windows CR/LF from <code>QBO_CLIENT_ID</code> / <code>QBO_CLIENT_SECRET</code> / <code>QBO_OAUTH_REDIRECT_URI</code> (legacy alias <code>QBO_REDIRECT_URI</code>).</li>
    <li>Ensure <code>QBO_ENVIRONMENT</code> matches the Intuit app (production vs sandbox; case-insensitive).</li>
    <li>Confirm the redirect URI is exactly registered in Intuit and equals the value above.</li>
  </ol>
  <div class="actions">
    <a class="btn gold" href="${reconnectHref}">Try Reconnect Again</a>
    <a class="btn ghost" href="${returnHref}">Return to Control Center</a>
  </div>
</main>
<script>
(function () {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        type: ${JSON.stringify(msgType)},
        ok: false,
        oauth_error: ${JSON.stringify(input.oauthError ?? null)}
      }, "*");
    }
  } catch (e) {}
})();
</script>
</body></html>`;
}
