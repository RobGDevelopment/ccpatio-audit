import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { createSupabaseFetch } from '../../src/lib/supabase-env';

// Prefer .env.local (2026 publishable/secret keys) over leftover local-stack JWT aliases.
dotenv.config({
  path: path.resolve(__dirname, "../../.env.local"),
  override: true,
});

test.describe('Gatekeeper Auth Proof', () => {
  test('rejects unauthorized domain', async ({ page }) => {
    await page.goto('/');
    
    // Fill in the form
    await page.fill('input[name="email"]', 'rogue.user@gmail.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    
    // Click the "Create @ccpatio.com Account" button
    await page.click('button:has-text("Create @ccpatio.com Account")');
    
    // Verify domain restriction error message appears
    await expect(page.locator('text=Access denied. Must use a @ccpatio.com email address.')).toBeVisible();
  });

  test('accepts authorized domain, creates session, and redirects', async ({ page }) => {
    const testEmail = 'qa.test@ccpatio.com';
    const testPassword = 'TestPassword123!';
    
    // Cleanup any previous run if it failed
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey =
      process.env.SUPABASE_SECRET_KEY?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: createSupabaseFetch(supabaseServiceKey) },
    });
    
    const { data: usersData } = await supabase.auth.admin.listUsers();
    const existingUser = usersData?.users.find(u => u.email === testEmail);
    if (existingUser) {
      await supabase.auth.admin.deleteUser(existingUser.id);
    }

    await page.goto('/');
    
    // Fill in the form
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);
    
    // Click the button
    await page.click('button:has-text("Create @ccpatio.com Account")');
    
    // Wait for either a redirect or an error message to appear
    await Promise.race([
      page.waitForURL(/\/admin\/dictionary/),
      page.waitForSelector('.text-rose-500', { state: 'visible' }).then(async () => {
        const errText = await page.textContent('.text-rose-500');
        throw new Error(`Sign up failed with error displayed on page: ${errText}`);
      })
    ]);
    
    // Should redirect to /admin/dictionary
    await expect(page).toHaveURL(/\/admin\/dictionary/);
    
    // Clean up using Supabase Admin API
    const { data: usersDataAfter } = await supabase.auth.admin.listUsers();
    const newUser = usersDataAfter?.users.find(u => u.email === testEmail);
    
    if (newUser) {
      await supabase.auth.admin.deleteUser(newUser.id);
      console.log(`Cleaned up test user ${testEmail}`);
    } else {
      console.log(`Test user ${testEmail} not found in admin API (likely a mock environment).`);
    }
  });
});
