# MISSION
Execute the integration of Clover POS and QuickBooks Online (QBO) into the `ccpatio-audit` architecture. You must adhere strictly to the existing Next.js App Router, Drizzle ORM, and Inngest v4 paradigms.

## STEP 1: Drizzle Schema Updates (`src/server/db/schema.ts`)
Do not create new polymorphic tables. Inject the integrations directly into the existing Single Source of Truth mapping table.

1. **Update `sku_mappings`:**
   - Add column: `clover_item_id: varchar('clover_item_id')`
   - Add column: `qbo_item_id: varchar('qbo_item_id')`
2. **Add Token Storage:**
   - Create table `qbo_auth_tokens`:
     - `id: boolean('id').primaryKey().default(true)` (Ensures single-row config)
     - `realm_id: varchar('realm_id')`
     - `access_token: text('access_token')`
     - `refresh_token: text('refresh_token')`
     - `expires_at: timestamp('expires_at')`
3. Generate the migration using `npx drizzle-kit generate` and run it.

## STEP 2: Clover Webhook Ingress (`src/app/api/webhooks/clover/route.ts`)
Create the webhook listener. It must execute the Vercel verification handshake and offload processing to Inngest immediately.

1. **Handshake Logic:**
   - If the incoming JSON contains `verificationCode`, `console.log('[CLOVER SETUP] 🟢 VERIFICATION CODE:', body.verificationCode)` and return `NextResponse.json({ success: true })`.
2. **Authentication Verification:**
   - Validate `req.headers.get('x-clover-auth')` against `process.env.CLOVER_WEBHOOK_SECRET`.
3. **Inngest Dispatch:**
   - Parse the `merchants` object array.
   - For every event where `type === 'CREATE'` and `objectId` starts with `P:` (Payment):
     - Strip the `P:` prefix.
     - `await inngest.send({ name: 'clover/payment.created', data: { merchantId, paymentId } });`
   - Immediately return a 200 OK.

## STEP 3: Inngest Worker (`src/inngest/functions.ts` & `src/server/integrations/`)
Create the background pipeline to translate and push the data.

1. **Create the Function:**
   - `export const syncCloverPayment = inngest.createFunction({ id: 'clover-payment-sync' }, { event: 'clover/payment.created' }, async ({ event, step }) => { ... })`
2. **Hydration (Step 1):**
   - `step.run('fetch-clover-order', ...)` -> GET `apisandbox.dev.clover.com/v3/merchants/{merchantId}/payments/{paymentId}?expand=order`. Extract the `order.id` and fetch the full order line items.
3. **Translation (Step 2):**
   - `step.run('translate-skus', ...)` -> Query Drizzle `sku_mappings`. 
   - For each Clover line item, look up `clover_item_id`. If found, retrieve the adjacent `qbo_item_id`. 
   - *Throw an error if the mapping does not exist (halts Inngest run for DLQ/Retry).*
4. **QBO Push (Step 3):**
   - `step.run('push-to-qbo', ...)` -> Format the items into a QBO `SalesReceipt` JSON payload.
   - Convert Clover cents to QBO decimals.
   - Push to Intuit API using the tokens from `qbo_auth_tokens`. (Ensure a lock/transaction wrapper is used when checking token expiration to prevent race conditions).