import { expect, test } from "@playwright/test";

/*
 * Contract for UNAUTHENTICATED requests, against production-mode next start.
 *
 * Regression coverage: an earlier deploy served `200 text/html` for /api/*
 * instead of a JSON error. Machine clients must receive the correct status
 * code and content type, and must never be redirected to a login page.
 */

test("GET /api/books with no session returns 401 JSON", async ({ request }) => {
  const response = await request.get("/api/books", { maxRedirects: 0 });

  expect(response.status()).toBe(401);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body = await response.json();
  expect(body.error.code).toBe("UNAUTHENTICATED");
});

test("GET /api/books/:id/jobs with no session returns 401 JSON", async ({ request }) => {
  const response = await request.get("/api/books/00000000-0000-0000-0000-000000000000/jobs", {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(401);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(body.error.code).toBe("UNAUTHENTICATED");
});

test("POST /api/register with no body returns a JSON validation error, not a redirect", async ({
  request,
}) => {
  const response = await request.post("/api/register", { maxRedirects: 0 });

  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(response.status()).toBeLessThan(500);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(body.error.code).toBe("VALIDATION_FAILED");
});

test("POST /api/register rejects a short password", async ({ request }) => {
  const response = await request.post("/api/register", {
    data: { email: `short-${Date.now()}@example.test`, password: "short" },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(422);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(body.error.code).toBe("VALIDATION_FAILED");
});

test("GET /dashboard with no session redirects to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL("**/login", { timeout: 20_000 });
  expect(page.url()).toContain("/login");
});

test("sign-in is rejected for a nonexistent user with AUTH_DEV_LOGIN unset", async ({ page }) => {
  // Proves the credentials provider verifies rather than silently accepting, and
  // that no dev bypass is active.
  await page.goto("/login");
  await page.getByTestId("email").fill(`nobody-${Date.now()}@example.test`);
  await page.getByTestId("password").fill("a-perfectly-valid-password");
  await page.getByTestId("submit").click();

  await expect(page.getByTestId("error")).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toContain("/login");
});