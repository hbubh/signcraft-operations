import { test, expect } from '@playwright/test';

test('existing dashboard opens after login without changing orders', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL('/login');
  await page.getByLabel('Email address').fill('manager@signcraft.demo');
  await page.getByLabel('Password').fill('SignCraft!2026');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Your operations, at a glance.' })).toBeVisible();
  await expect(page.locator('.loading-list')).toHaveCount(0);
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your operations, at a glance.' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: '.local/dashboard-repaired.png', fullPage: true });
});
