# SOP — QuickBooks Admin Handoff & Reconnect

**Audience:** Ops / IT / QBO Company Admin (Mia, Hamid)  
**Surface:** https://hub.ccpatio.com/mission-control  
**Ledger flag:** leave `QBO_LEDGER_MODE=log` unless Finance explicitly flips live.

## Why Intuit asks for Primary / Company Admin

Intuit only grants the app’s OAuth consent to a **Primary Admin** or **Company Admin** on the QuickBooks company (e.g. *CC Patio Scottsdale LLC*). A standard user can sign in to Intuit and still see *“Uh oh… Middleware Integration didn’t connect”* — that is Intuit’s permission check, not a hub bug. Hub never stores passwords; it only keeps the tokens Intuit issues after a successful Admin authorize.

## Reconnect in ~30 seconds (Mission Control)

1. Open **https://hub.ccpatio.com/mission-control** (SuperAdmin or IT_Admin).
2. Confirm the **QuickBooks → Company Connection** card: status (`Connected` / `Expired` / `Disconnected`), `realm_id`, and `expires_at` for the active environment.
3. Click **Reconnect QuickBooks** → Intuit App Center opens.
4. Sign in as the **QBO Company Admin**, choose the correct company, and Allow.
5. You return to the hub callback; the card should show **Connected** after Refresh.

Register this page as the Intuit Developer Portal **Reconnect URL**:  
`https://hub.ccpatio.com/mission-control`

## Warning — do not disconnect inside QBO unless reconnecting now

Never remove or disconnect **Middleware Integration** under QuickBooks **Settings → Apps** unless you are about to complete Mission Control reconnect in the same sitting. Disconnecting without an immediate Admin authorize drops the refresh token; ledger keep-alive and payment posting cannot recover until a Company Admin reconnects.

## Optional zero-login handoff

If a Company Admin should not use a hub login, IT can set `QBO_CONNECT_SECRET` on Vercel Production and send:  
`https://hub.ccpatio.com/api/auth/qbo/connect?secret=<secret>`  
Treat the secret like a password; rotate after use.
