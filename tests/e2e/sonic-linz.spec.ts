import { expect, test } from '@playwright/test';

test('presents one clear visitor path into listening', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-sonic-linz-hydrated', 'true', { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /Linz city has something to sing to you/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listen to the city' })).toBeVisible();
  await expect(page.getByText(/Tap “Listen to the city.” Hold your phone near the music./i)).toBeVisible();
  await expect(page.getByText(/Musical pieces are playing at selected places around Linz/i)).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'Kollegiumgasse', exact: true })).toBeVisible();
  await expect(page.getByText(/Formerly Flohgaßl/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Why this name/i })).toBeVisible();
  await expect(page.getByText(/daily practice of beating out uniforms and blankets/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Name through time/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open the Stadtgeschichte record/i })).toHaveAttribute('href', 'https://stadtgeschichte.linz.at/strassennamen/index.php?ID=1716&action=strassendetail&hist=historisch');
  await expect(page.getByRole('button', { name: /Listen again/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to the start', exact: true })).toBeVisible();
  await expect(page.getByText(/SIGNAL DECODED|CHECKSUM|Sonic Record|payload/i)).toHaveCount(0);
});

test('presents known namesake facts as a city profile', async ({ page }) => {
  await page.goto('/?preview=1185');
  await expect(page.getByRole('heading', { name: 'Adalbert-Stifter-Platz', exact: true })).toBeVisible();
  await expect(page.getByText(/Linz cadastral area/i)).toBeVisible();
  await expect(page.getByText('1990', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The person in the place' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Adalbert Stifter' })).toBeVisible();
  await expect(page.getByText(/1805–1868 · Writer/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /namesake record/i })).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q168542');
});

for (const width of [320, 360, 390, 430]) {
  test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Listen to the city' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      viewportHeight: document.documentElement.clientHeight,
      pageHeight: document.documentElement.scrollHeight,
      button: document.querySelector<HTMLButtonElement>('.primary-action')?.getBoundingClientRect().toJSON(),
      artworkPosition: getComputedStyle(document.querySelector<HTMLElement>('.intro-hero > .city-artwork')!).position,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.pageHeight).toBeLessThanOrEqual(dimensions.viewportHeight);
    expect(dimensions.artworkPosition).toBe('absolute');
    expect(dimensions.button?.height).toBeGreaterThanOrEqual(44);
    expect(dimensions.button?.top).toBeGreaterThanOrEqual(0);
    expect(dimensions.button?.bottom).toBeLessThanOrEqual(780);

    await page.goto('/?preview=1223');
    await expect(page.getByRole('heading', { name: 'Kollegiumgasse', exact: true })).toBeVisible();
    const discoveryDimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(discoveryDimensions.page).toBeLessThanOrEqual(discoveryDimensions.viewport);
  });
}
