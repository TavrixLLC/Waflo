# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: staging-regression-remaining.spec.ts >> uses themed keyboard-accessible SearchableSelect controls for Activity Type and Default Language
- Location: tests\e2e\staging-regression-remaining.spec.ts:187:5

# Error details

```
Error: expect(locator).toBeHidden() failed

Locator:  getByRole('listbox')
Expected: hidden
Received: visible
Timeout:  15000ms

Call log:
  - Expect "toBeHidden" with timeout 15000ms
  - waiting for getByRole('listbox')
    33 × locator resolved to <div dir="rtl" id="_r_3_" role="listbox" class="wf-search-select__list">…</div>
       - unexpected value "visible"

```

```yaml
- listbox:
  - option "LegacyActivityValue"
  - option "الأطعمة والمشروبات"
  - option "السيارات"
  - option "الجمال والعافية"
  - option "الخدمات والتجزئة"
  - option "عام"
```

# Test source

```ts
  121 |     fulfill(route, { accountEmail: "gallery@example.test", passwordEnabled: true, identities: [] }),
  122 |   );
  123 |   await page.route("**/v1/auth/external/reauthentication", (route) =>
  124 |     fulfill(route, { status: "VERIFIED", expiresAt: "2026-09-08T12:00:00.000Z" }),
  125 |   );
  126 | }
  127 | 
  128 | async function openStudioLaunch(page: Page): Promise<void> {
  129 |   await page.goto("/en/dashboard/programs/new");
  130 |   await page
  131 |     .locator(".template-gallery__section--recommended .template-gallery-card__preview")
  132 |     .first()
  133 |     .click();
  134 |   await page.getByRole("dialog").getByRole("button", { name: "Use this template" }).click();
  135 |   const review = page.getByRole("button", { name: "Review card" });
  136 |   const continueToStudio = page.getByRole("button", { name: "Continue to Studio" });
  137 |   await expect(review.or(continueToStudio)).toBeVisible();
  138 |   if (await review.isVisible()) await review.click();
  139 |   await continueToStudio.click();
  140 |   await page
  141 |     .getByRole("navigation", { name: "Studio sections" })
  142 |     .getByRole("button", { name: /^Review & launch/u })
  143 |     .click();
  144 |   await expect(page.locator(".publication-wallet-list")).toBeVisible();
  145 | }
  146 | 
  147 | test("maps the Arabic billing downgrade violation from its stable code and retains usage facts", async ({
  148 |   page,
  149 | }) => {
  150 |   const rawBackendProse =
  151 |     "Archive loyalty cards until the active card count fits the target plan. Current: 7; allowed: 3.";
  152 |   const responseData = billingFixture([
  153 |     {
  154 |       plan: "STARTER",
  155 |       violations: [{ code: "ACTIVE_PROGRAMS", actual: 7, limit: 3, message: rawBackendProse }],
  156 |     },
  157 |   ]);
  158 |   let observedResponse: unknown;
  159 |   await mockTemplateGalleryApi(page);
  160 |   await page.route(
  161 |     `**/v1/organizations/${templateGalleryOrganizationId}/billing`,
  162 |     async (route) => {
  163 |       await fulfill(route, responseData, "billing-stable-code");
  164 |     },
  165 |   );
  166 |   page.on("response", async (response) => {
  167 |     if (!response.url().endsWith(`/v1/organizations/${templateGalleryOrganizationId}/billing`))
  168 |       return;
  169 |     observedResponse = await response.json();
  170 |   });
  171 | 
  172 |   await page.goto("/ar/dashboard/billing");
  173 |   const downgradeCard = page.locator(".billing-downgrade-card");
  174 |   await expect(downgradeCard).toBeVisible();
  175 |   await expect(downgradeCard).toContainText("7");
  176 |   await expect(downgradeCard).toContainText("3");
  177 |   const renderedText = await downgradeCard.textContent();
  178 |   expect(renderedText).toMatch(/[\u0600-\u06FF]/u);
  179 |   expect(renderedText).not.toContain(rawBackendProse);
  180 |   expect(JSON.stringify(observedResponse)).toContain('"code":"ACTIVE_PROGRAMS"');
  181 |   expect(JSON.stringify(observedResponse)).toContain('"actual":7');
  182 |   expect(JSON.stringify(observedResponse)).toContain('"limit":3');
  183 |   await expect(page.getByRole("button").first()).toBeEnabled();
  184 |   await captureStagingRepairEvidence(page, "08-billing-arabic-error.png");
  185 | });
  186 | 
  187 | test("uses themed keyboard-accessible SearchableSelect controls for Activity Type and Default Language", async ({
  188 |   page,
  189 | }) => {
  190 |   let savedSettings: Record<string, unknown> = {};
  191 |   await mockTemplateGalleryApi(page, {
  192 |     businessCategory: "LegacyActivityValue",
  193 |     onOrganizationPatch: (body) => {
  194 |       savedSettings = body;
  195 |     },
  196 |   });
  197 |   await installSettingsRoutes(page);
  198 |   await page.goto("/ar/dashboard/settings");
  199 |   await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  200 | 
  201 |   const activity = page
  202 |     .locator(".wf-search-select")
  203 |     .filter({ has: page.locator('input[name="category"]') });
  204 |   const activityInput = activity.getByRole("combobox");
  205 |   await expect(activityInput).toBeVisible();
  206 |   await expect(activityInput).not.toHaveJSProperty("tagName", "SELECT");
  207 |   await expect(activityInput).toHaveValue("LegacyActivityValue");
  208 |   await activityInput.focus();
  209 |   await page.keyboard.press("ArrowDown");
  210 |   const activityListbox = page.getByRole("listbox");
  211 |   await expect(activityListbox).toBeVisible();
  212 |   await expect(activityListbox).toHaveAttribute("dir", "rtl");
  213 |   await captureStagingRepairEvidence(page, "09-activity-select-themed.png");
  214 |   await page.keyboard.press("ArrowDown");
  215 |   await page.keyboard.press("Enter");
  216 |   await expect(activityListbox).toBeHidden();
  217 |   await activityInput.focus();
  218 |   await page.keyboard.press("ArrowUp");
  219 |   await expect(activityListbox).toBeVisible();
  220 |   await page.keyboard.press("Escape");
> 221 |   await expect(activityListbox).toBeHidden();
      |                                 ^ Error: expect(locator).toBeHidden() failed
  222 |   const selectedActivity = await page.locator('input[name="category"]').inputValue();
  223 |   expect(selectedActivity).not.toBe("");
  224 | 
  225 |   const language = page
  226 |     .locator(".wf-search-select")
  227 |     .filter({ has: page.locator('input[name="locale"]') });
  228 |   const languageInput = language.getByRole("combobox");
  229 |   await expect(languageInput).toBeVisible();
  230 |   await languageInput.focus();
  231 |   await page.keyboard.press("ArrowDown");
  232 |   const languageListbox = page.getByRole("listbox");
  233 |   await expect(languageListbox).toBeVisible();
  234 |   await expect(languageListbox).toHaveAttribute("dir", "rtl");
  235 |   await captureStagingRepairEvidence(page, "10-default-language-select-themed.png");
  236 |   await languageListbox
  237 |     .getByRole("option", { name: /^\u0627\u0644\u0639\u0631\u0628\u064a\u0629/u })
  238 |     .click();
  239 |   await expect(page.locator('input[name="locale"]')).toHaveValue("ar");
  240 | 
  241 |   await activity
  242 |     .locator("xpath=ancestor::form")
  243 |     .getByRole("button", { name: /\u062d\u0641\u0638/u })
  244 |     .click();
  245 |   await expect(page.getByRole("alert")).toBeVisible();
  246 |   expect(savedSettings.businessCategory).toBe(selectedActivity);
  247 |   expect(savedSettings.defaultLocale).toBe("ar");
  248 |   await page.reload();
  249 |   await expect(page.locator('input[name="category"]')).toHaveValue(selectedActivity);
  250 |   await expect(page.locator('input[name="locale"]')).toHaveValue("ar");
  251 | });
  252 | 
  253 | test("keeps Google linking secure while presenting a localized inline wrong-password error", async ({
  254 |   page,
  255 | }) => {
  256 |   const rawBackendProse = "Incorrect Waflo password. This must never be displayed in Arabic UI.";
  257 |   let rejectedCode = "";
  258 |   await mockTemplateGalleryApi(page);
  259 |   await page.route("**/v1/auth/sessions", (route) => fulfill(route, []));
  260 |   await page.route("**/v1/security/events", (route) => fulfill(route, { items: [] }));
  261 |   await page.route("**/v1/auth/external/identities", (route) =>
  262 |     fulfill(route, { accountEmail: "gallery@example.test", passwordEnabled: true, identities: [] }),
  263 |   );
  264 |   await page.route("**/v1/auth/external/providers", (route) =>
  265 |     fulfill(route, { googleSignInAvailable: true }),
  266 |   );
  267 |   await page.route("**/v1/auth/external/google/link", async (route) => {
  268 |     const payload = route.request().postDataJSON() as Record<string, unknown>;
  269 |     expect(payload.currentPassword).toBe("not-the-real-password");
  270 |     rejectedCode = "REAUTHENTICATION_REQUIRED";
  271 |     await reject(route, rejectedCode, rawBackendProse);
  272 |   });
  273 | 
  274 |   await page.goto("/ar/dashboard/security");
  275 |   const googleSection = page.locator(".security-section").filter({ hasText: "Google" });
  276 |   const password = googleSection.locator('input[autocomplete="current-password"]');
  277 |   await expect(password).toBeVisible();
  278 |   await password.fill("not-the-real-password");
  279 |   const linkButton = googleSection.getByRole("button", { name: /Google/u });
  280 |   await linkButton.click();
  281 |   await expect(password).toHaveAttribute("aria-invalid", "true");
  282 |   const inlineError = googleSection.getByRole("alert");
  283 |   await expect(inlineError).toBeVisible();
  284 |   const errorText = await inlineError.textContent();
  285 |   expect(errorText).toMatch(/[\u0600-\u06FF]/u);
  286 |   expect(errorText).not.toContain(rawBackendProse);
  287 |   expect(rejectedCode).toBe("REAUTHENTICATION_REQUIRED");
  288 |   await expect(linkButton).toBeEnabled();
  289 |   await captureStagingRepairEvidence(page, "11-google-link-wrong-password.png");
  290 |   await password.fill("corrected-password");
  291 |   await expect(inlineError).toBeHidden();
  292 |   await expect(password).not.toHaveAttribute("aria-invalid", "true");
  293 | });
  294 | 
  295 | test("separates Wallet provider configuration, artifact readiness, and device eligibility on launch", async ({
  296 |   page,
  297 | }) => {
  298 |   const configuredIneligible = [
  299 |     {
  300 |       provider: "APPLE",
  301 |       mode: "REAL",
  302 |       status: "HEALTHY",
  303 |       safeMessage: "Configured",
  304 |       configured: true,
  305 |       providerConfigured: true,
  306 |       artifactAvailable: true,
  307 |       installationAvailable: true,
  308 |       deviceEligibility: "REQUIRES_COMPATIBLE_DEVICE",
  309 |       reason: "DEVICE",
  310 |     },
  311 |     {
  312 |       provider: "GOOGLE",
  313 |       mode: "REAL",
  314 |       status: "HEALTHY",
  315 |       safeMessage: "Configured",
  316 |       configured: true,
  317 |       providerConfigured: true,
  318 |       artifactAvailable: true,
  319 |       installationAvailable: true,
  320 |       deviceEligibility: "REQUIRES_COMPATIBLE_DEVICE",
  321 |       reason: "DEVICE",
```