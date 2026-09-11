import { expect, test } from '@playwright/test';

test('moves from the home screen to a real historical Sonic Record', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Hear the city remember/i })).toBeVisible();
  await page.getByRole('button', { name: /Transmit a street/i }).click();
  await expect(page.getByText('PHONE A · TRANSMITTER')).toBeVisible();
  await expect(page.getByText('Flohgaßl', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Play Sonic Record/i })).toBeVisible();
});

test('shows local microphone privacy and progressive decoder intent', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Listen for Linz/i }).click();
  await expect(page.getByText(/Nothing is recorded or uploaded/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Start listening/i })).toBeVisible();
});
