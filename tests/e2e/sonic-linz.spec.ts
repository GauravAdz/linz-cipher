import { expect, test } from '@playwright/test';

test('presents one clear visitor path into listening', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-sonic-linz-hydrated', 'true', { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /The city has something to tell you/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listen to the city' })).toBeVisible();
  await expect(page.getByText(/Musical pieces are playing at selected places around Linz/i)).toBeVisible();
  await expect(page.getByText(/Transmit a street|Sonic ID|checksum|bits|carrier|RMS|confidence/i)).toHaveCount(0);
  await expect(page.locator('a[href*="/debug"], a[href*="/internal"]')).toHaveCount(0);
});

test('uses reassuring language when microphone permission is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
    });
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-sonic-linz-hydrated', 'true', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Listen to the city' }).click();
  await expect(page.getByText(/Nothing is recorded or uploaded/i)).toBeVisible();
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.getByRole('heading', { name: /Let’s try that again/i })).toBeVisible();
  await expect(page.getByText(/Allow it in your browser settings/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try listening again' })).toBeVisible();
});

test('reveals an English place story without protocol metadata', async ({ page }) => {
  await page.goto('/?preview=1223');
  await expect(page.getByRole('heading', { name: 'Kollegiumgasse' })).toBeVisible();
  await expect(page.getByText(/once called Flohgaßl/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /The name beneath today’s street/i })).toBeVisible();
  await expect(page.getByText(/carried the name Flohgaßl/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /official City of Linz record/i })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('button', { name: /Listen again/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to the start', exact: true })).toBeVisible();
  await expect(page.getByText(/SIGNAL DECODED|CHECKSUM|Sonic Record|payload/i)).toHaveCount(0);
});

for (const width of [320, 360, 390, 430]) {
  test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Listen to the city' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      button: document.querySelector<HTMLButtonElement>('.primary-action')?.getBoundingClientRect().toJSON(),
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.button?.height).toBeGreaterThanOrEqual(44);
    expect(dimensions.button?.top).toBeGreaterThanOrEqual(0);
    expect(dimensions.button?.bottom).toBeLessThanOrEqual(780);
  });
}
