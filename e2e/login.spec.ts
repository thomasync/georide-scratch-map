import { test, expect } from '@playwright/test';
import { mockGeorideApi, blockExternal } from './fixtures/api-mock';

test.describe('Login', () => {
	test('logs in and navigates to the map', async ({ page }) => {
		await blockExternal(page);
		await mockGeorideApi(page);

		await page.goto('/login');
		await page.locator('#email').fill('rider@example.com');
		await page.locator('#password').fill('secret');
		await page.getByRole('button', { name: 'Se connecter' }).click();

		await expect(page).toHaveURL(/\/map$/, { timeout: 15_000 });
	});

	test('shows an error on invalid credentials', async ({ page }) => {
		await blockExternal(page);
		await mockGeorideApi(page, { loginStatus: 401 });

		await page.goto('/login');
		await page.locator('#email').fill('rider@example.com');
		await page.locator('#password').fill('wrong');
		await page.getByRole('button', { name: 'Se connecter' }).click();

		await expect(page.getByText('Identifiants incorrects')).toBeVisible({ timeout: 10_000 });
		await expect(page).toHaveURL(/\/login$/);
	});
});
