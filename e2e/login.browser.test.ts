import { expect, test } from "@playwright/test";

/*
 * Deploy gate: a real browser must be able to register, sign in, and reach an
 * authenticated app against PRODUCTION-mode `next start`.
 *
 * x-kdone-user-id is deliberately NOT used anywhere in this file - proving the
 * real Auth.js path works is the entire point.
 */

const EMAIL = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const PASSWORD = "correct-horse-battery-staple";

test("register, sign in, reach an authenticated dashboard", async ({ page, context }) => {
  // 1. Register a fresh user with a real password.
  await page.goto("/register");
  await page.getByTestId("email").fill(EMAIL);
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("submit").click();

  // 2. We should land on the authenticated dashboard.
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  // 3. A session cookie must exist.
  const cookies = await context.cookies();
  const sessionCookie = cookies.find(
    (c) =>
      c.name.includes("session-token") ||
      c.name.includes("authjs.session-token") ||
      c.name === "next-auth.session-token",
  );
  expect(sessionCookie, "expected an Auth.js session cookie").toBeTruthy();

  // 4. The dashboard shell renders and is not an auth error page.
  await expect(page.getByRole("heading", { name: /your books/i })).toBeVisible();
  const body = (await page.textContent("body")) ?? "";
  expect(body).not.toMatch(/unauthenticated/i);
  expect(body).not.toMatch(/no authenticated session/i);

  // 5. An unauthenticated API call from the same browser context returns 200,
  // proving the API reads the real session rather than a header.
  const apiResponse = await page.request.get("/api/books");
  expect(apiResponse.status()).toBe(200);
  const payload = await apiResponse.json();
  expect(Array.isArray(payload.books)).toBe(true);
});

test("a wrong password is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("email").fill(EMAIL);
  await page.getByTestId("password").fill("definitely-the-wrong-password");
  await page.getByTestId("submit").click();

  // Still on /login, and an error is shown.
  await expect(page.getByTestId("error")).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toContain("/login");
});
