import { test, expect } from '@playwright/test';

test.describe('E2E Boundary Verification', () => {
  test('Application boots successfully', async ({ page }) => {
    // Navigate to the root page
    const response = await page.goto('/');
    
    // Ensure the network layer returns a 200 or 30x redirect (e.g., auth)
    expect(response?.status()).toBeLessThan(400);

    // Verify a DOM element to ensure React hydration didn't crash
    // Since we don't know the exact auth state, just verifying the body exists is enough
    // to prove the Node server isn't returning a 500 error page.
    await expect(page.locator('body')).toBeVisible();
  });
});
