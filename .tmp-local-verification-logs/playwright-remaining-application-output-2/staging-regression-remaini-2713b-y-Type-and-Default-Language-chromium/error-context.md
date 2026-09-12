# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: staging-regression-remaining.spec.ts >> uses themed keyboard-accessible SearchableSelect controls for Activity Type and Default Language
- Location: tests\e2e\staging-regression-remaining.spec.ts:218:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "automotive"
Received: "LegacyActivityValue"
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - alert [ref=e2]
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - link "نظرة عامة" [ref=e6] [cursor=pointer]:
        - /url: /ar/dashboard
        - img "Waflo" [ref=e7]
      - button "اختيار المؤسسة" [ref=e9] [cursor=pointer]:
        - generic [ref=e14]: Gallery Coffee
      - navigation [ref=e17]:
        - generic [ref=e18]:
          - link "نظرة عامة" [ref=e19] [cursor=pointer]:
            - /url: /ar/dashboard
          - link "بطاقات الولاء" [ref=e24] [cursor=pointer]:
            - /url: /ar/dashboard/programs
          - link "العملاء" [ref=e29] [cursor=pointer]:
            - /url: /ar/dashboard/customers
          - link "الفروع" [ref=e36] [cursor=pointer]:
            - /url: /ar/dashboard/locations
          - link "الفريق" [ref=e41] [cursor=pointer]:
            - /url: /ar/dashboard/team
          - link "التحليلات" [ref=e48] [cursor=pointer]:
            - /url: /ar/dashboard/analytics
          - link "التصدير" [ref=e52] [cursor=pointer]:
            - /url: /ar/dashboard/exports
          - link "الفوترة والدفع" [ref=e57] [cursor=pointer]:
            - /url: /ar/dashboard/billing
        - generic [ref=e61]:
          - generic [ref=e62]: الحساب
          - link "الإعدادات" [ref=e63] [cursor=pointer]:
            - /url: /ar/dashboard/settings
          - link "الأمان" [ref=e68] [cursor=pointer]:
            - /url: /ar/dashboard/security
      - link "Gallery Merchant Gallery Merchant gallery@example.test" [ref=e75] [cursor=pointer]:
        - /url: /ar/dashboard/security
        - img "Gallery Merchant" [ref=e76]: GM
        - generic [ref=e77]:
          - strong [ref=e78]: Gallery Merchant
          - generic [ref=e79]: gallery@example.test
    - generic [ref=e80]:
      - banner [ref=e81]:
        - generic [ref=e82]:
          - button "اللغة" [ref=e84] [cursor=pointer]:
            - generic [ref=e89]: العربية
          - group [ref=e92]:
            - img "Gallery Merchant" [ref=e94] [cursor=pointer]: GM
      - main [ref=e95]:
        - generic [ref=e97]:
          - heading "الإعدادات" [level=1] [ref=e98]
          - paragraph [ref=e99]: حدّث معلومات نشاطك واللغة والمنطقة الزمنية.
        - generic [ref=e100]:
          - generic [ref=e101]:
            - heading "عام" [level=2] [ref=e102]
            - generic [ref=e103]:
              - generic [ref=e104]:
                - generic [ref=e105]: اسم المؤسسة *
                - textbox "اسم المؤسسة" [ref=e106]: Gallery Coffee
              - generic [ref=e107]:
                - generic [ref=e108]: نوع النشاط
                - combobox "نوع النشاط" [ref=e110]: السيارات
              - generic [ref=e111]:
                - generic [ref=e112]: اللغة الافتراضية
                - combobox "اللغة الافتراضية" [expanded] [active] [ref=e114]
              - generic [ref=e115]:
                - generic [ref=e116]: المنطقة الزمنية
                - combobox "المنطقة الزمنية" [ref=e118]: Baghdad (غرينتش+3)
              - button "حفظ التغييرات" [ref=e119] [cursor=pointer]
          - generic [ref=e120]:
            - generic [ref=e122]:
              - heading "الهوية البصرية" [level=2] [ref=e123]
              - paragraph [ref=e124]: يظهر شعار نشاطك في تجربة العميل وWallet عندما يدعم مزود المحفظة ذلك.
            - region "شعار النشاط" [ref=e125]:
              - generic [ref=e126]:
                - generic [ref=e127]:
                  - heading "شعار النشاط" [level=4] [ref=e128]
                  - paragraph [ref=e129]: اختر من مكتبة Waflo أو ارفع صورة PNG أو JPEG أو WebP.
                - button "شعار النشاط رفع صورة" [ref=e130]
              - button "إضافة شعار" [ref=e131]
            - paragraph [ref=e136]: PNG أو JPEG أو WebP بحجم أقل من 2 MB. يفحص Waflo الصورة ويحذف بياناتها الوصفية ويعيد ترميزها بأمان.
          - generic [ref=e137]:
            - heading "رابط التاجر" [level=2] [ref=e138]
            - status [ref=e139]:
              - generic [ref=e142]:
                - strong [ref=e143]: تحقق من هويتك
                - generic [ref=e144]: أدخل كلمة مرور Waflo لحماية هذا التغيير. يبقى الرابط السابق محجوزاً لمدة 90 يوماً.
            - generic [ref=e145]:
              - generic [ref=e146]:
                - generic [ref=e147]: الرابط الجديد *
                - textbox "الرابط الجديد" [ref=e148]: gallery-coffee
              - generic [ref=e149]:
                - link "https://gallery-coffee.waflo.app/" [ref=e150] [cursor=pointer]:
                  - /url: https://gallery-coffee.waflo.app/
                - button "نسخ رابط التاجر" [ref=e151] [cursor=pointer]
              - generic [ref=e155]:
                - generic [ref=e156]: تأكيد كلمة المرور *
                - textbox "تأكيد كلمة المرور" [ref=e157]
              - button "تغيير رابط التاجر" [ref=e158] [cursor=pointer]
  - listbox [ref=e159]:
    - option "English" [ref=e161] [cursor=pointer]
    - option "العربية" [ref=e164] [cursor=pointer]
```

# Test source

```ts
  165 |   await page.getByRole("dialog").getByRole("button", { name: "Use this template" }).click();
  166 |   const review = page.getByRole("button", { name: "Review card" });
  167 |   const continueToStudio = page.getByRole("button", { name: "Continue to Studio" });
  168 |   await expect(review.or(continueToStudio)).toBeVisible();
  169 |   if (await review.isVisible()) await review.click();
  170 |   await continueToStudio.click();
  171 |   await page
  172 |     .getByRole("navigation", { name: "Studio sections" })
  173 |     .getByRole("button", { name: /^Review & launch/u })
  174 |     .click();
  175 |   await expect(page.locator(".publication-wallet-list")).toBeVisible();
  176 | }
  177 | 
  178 | test("maps the Arabic billing downgrade violation from its stable code and retains usage facts", async ({
  179 |   page,
  180 | }) => {
  181 |   const rawBackendProse =
  182 |     "Archive loyalty cards until the active card count fits the target plan. Current: 7; allowed: 3.";
  183 |   const responseData = billingFixture([
  184 |     {
  185 |       plan: "STARTER",
  186 |       violations: [{ code: "ACTIVE_PROGRAMS", actual: 7, limit: 3, message: rawBackendProse }],
  187 |     },
  188 |   ]);
  189 |   let observedResponse: unknown;
  190 |   await mockTemplateGalleryApi(page);
  191 |   await page.route(
  192 |     `**/v1/organizations/${templateGalleryOrganizationId}/billing`,
  193 |     async (route) => {
  194 |       await fulfill(route, responseData, "billing-stable-code");
  195 |     },
  196 |   );
  197 |   page.on("response", async (response) => {
  198 |     if (!response.url().endsWith(`/v1/organizations/${templateGalleryOrganizationId}/billing`))
  199 |       return;
  200 |     observedResponse = await response.json();
  201 |   });
  202 | 
  203 |   await page.goto("/ar/dashboard/billing");
  204 |   const downgradeCard = page.locator(".billing-downgrade-card");
  205 |   await expect(downgradeCard).toBeVisible();
  206 |   await expect(downgradeCard).toContainText("7");
  207 |   await expect(downgradeCard).toContainText("3");
  208 |   const renderedText = await downgradeCard.textContent();
  209 |   expect(renderedText).toMatch(/[\u0600-\u06FF]/u);
  210 |   expect(renderedText).not.toContain(rawBackendProse);
  211 |   expect(JSON.stringify(observedResponse)).toContain('"code":"ACTIVE_PROGRAMS"');
  212 |   expect(JSON.stringify(observedResponse)).toContain('"actual":7');
  213 |   expect(JSON.stringify(observedResponse)).toContain('"limit":3');
  214 |   await expect(page.getByRole("button").first()).toBeEnabled();
  215 |   await captureStagingRepairEvidence(page, "08-billing-arabic-error.png");
  216 | });
  217 | 
  218 | test("uses themed keyboard-accessible SearchableSelect controls for Activity Type and Default Language", async ({
  219 |   page,
  220 | }) => {
  221 |   await mockTemplateGalleryApi(page, { businessCategory: "LegacyActivityValue" });
  222 |   const settings = await installSettingsRoutes(page);
  223 |   await page.goto("/ar/dashboard/settings");
  224 |   await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  225 | 
  226 |   const activity = page
  227 |     .locator(".wf-search-select")
  228 |     .filter({ has: page.locator('input[name="category"]') });
  229 |   const activityInput = activity.getByRole("combobox");
  230 |   await expect(activityInput).toBeVisible();
  231 |   await expect(activityInput).not.toHaveJSProperty("tagName", "SELECT");
  232 |   await expect(activityInput).toHaveValue("LegacyActivityValue");
  233 |   await activityInput.focus();
  234 |   await page.keyboard.press("ArrowDown");
  235 |   const activityListbox = page.getByRole("listbox");
  236 |   await expect(activityListbox).toBeVisible();
  237 |   await expect(activityListbox).toHaveAttribute("dir", "rtl");
  238 |   await captureStagingRepairEvidence(page, "09-activity-select-themed.png");
  239 |   await page.keyboard.press("ArrowDown");
  240 |   await page.keyboard.press("Enter");
  241 |   await expect(activityListbox).toBeHidden();
  242 |   const selectedActivity = await page.locator('input[name="category"]').inputValue();
  243 |   expect(selectedActivity).not.toBe("");
  244 | 
  245 |   const language = page
  246 |     .locator(".wf-search-select")
  247 |     .filter({ has: page.locator('input[name="locale"]') });
  248 |   const languageInput = language.getByRole("combobox");
  249 |   await expect(languageInput).toBeVisible();
  250 |   await languageInput.focus();
  251 |   await page.keyboard.press("ArrowDown");
  252 |   const languageListbox = page.getByRole("listbox");
  253 |   await expect(languageListbox).toBeVisible();
  254 |   await expect(languageListbox).toHaveAttribute("dir", "rtl");
  255 |   await captureStagingRepairEvidence(page, "10-default-language-select-themed.png");
  256 |   await page.keyboard.press("ArrowDown");
  257 |   await page.keyboard.press("Enter");
  258 |   await page.keyboard.press("Escape");
  259 | 
  260 |   await activity
  261 |     .locator("xpath=ancestor::form")
  262 |     .getByRole("button", { name: /\u062d\u0641\u0638/u })
  263 |     .click();
  264 |   await expect(page.getByRole("alert")).toBeVisible();
> 265 |   expect(settings.saved().category).toBe(selectedActivity);
      |                                     ^ Error: expect(received).toBe(expected) // Object.is equality
  266 |   expect(settings.saved().locale).toBe("AR");
  267 |   await page.reload();
  268 |   await expect(page.locator('input[name="category"]')).toHaveValue(selectedActivity);
  269 |   await expect(page.locator('input[name="locale"]')).toHaveValue("ar");
  270 | });
  271 | 
  272 | test("keeps Google linking secure while presenting a localized inline wrong-password error", async ({
  273 |   page,
  274 | }) => {
  275 |   const rawBackendProse = "Incorrect Waflo password. This must never be displayed in Arabic UI.";
  276 |   let rejectedCode = "";
  277 |   await mockTemplateGalleryApi(page);
  278 |   await page.route("**/v1/auth/sessions", (route) => fulfill(route, []));
  279 |   await page.route("**/v1/security/events", (route) => fulfill(route, { items: [] }));
  280 |   await page.route("**/v1/auth/external/identities", (route) =>
  281 |     fulfill(route, { accountEmail: "gallery@example.test", passwordEnabled: true, identities: [] }),
  282 |   );
  283 |   await page.route("**/v1/auth/external/providers", (route) =>
  284 |     fulfill(route, { googleSignInAvailable: true }),
  285 |   );
  286 |   await page.route("**/v1/auth/external/google/link", async (route) => {
  287 |     const payload = route.request().postDataJSON() as Record<string, unknown>;
  288 |     expect(payload.currentPassword).toBe("not-the-real-password");
  289 |     rejectedCode = "REAUTHENTICATION_REQUIRED";
  290 |     await reject(route, rejectedCode, rawBackendProse);
  291 |   });
  292 | 
  293 |   await page.goto("/ar/dashboard/security");
  294 |   const googleSection = page.locator(".security-section").filter({ hasText: "Google" });
  295 |   const password = googleSection.locator('input[autocomplete="current-password"]');
  296 |   await expect(password).toBeVisible();
  297 |   await password.fill("not-the-real-password");
  298 |   const linkButton = googleSection.getByRole("button", { name: /Google/u });
  299 |   await linkButton.click();
  300 |   await expect(password).toHaveAttribute("aria-invalid", "true");
  301 |   const inlineError = googleSection.getByRole("alert");
  302 |   await expect(inlineError).toBeVisible();
  303 |   const errorText = await inlineError.textContent();
  304 |   expect(errorText).toMatch(/[\u0600-\u06FF]/u);
  305 |   expect(errorText).not.toContain(rawBackendProse);
  306 |   expect(rejectedCode).toBe("REAUTHENTICATION_REQUIRED");
  307 |   await expect(linkButton).toBeEnabled();
  308 |   await captureStagingRepairEvidence(page, "11-google-link-wrong-password.png");
  309 |   await password.fill("corrected-password");
  310 |   await expect(inlineError).toBeHidden();
  311 |   await expect(password).not.toHaveAttribute("aria-invalid", "true");
  312 | });
  313 | 
  314 | test("separates Wallet provider configuration, artifact readiness, and device eligibility on launch", async ({
  315 |   page,
  316 | }) => {
  317 |   const configuredIneligible = [
  318 |     {
  319 |       provider: "APPLE",
  320 |       mode: "REAL",
  321 |       status: "HEALTHY",
  322 |       safeMessage: "Configured",
  323 |       configured: true,
  324 |       providerConfigured: true,
  325 |       artifactAvailable: true,
  326 |       installationAvailable: true,
  327 |       deviceEligibility: "REQUIRES_COMPATIBLE_DEVICE",
  328 |       reason: "DEVICE",
  329 |     },
  330 |     {
  331 |       provider: "GOOGLE",
  332 |       mode: "REAL",
  333 |       status: "HEALTHY",
  334 |       safeMessage: "Configured",
  335 |       configured: true,
  336 |       providerConfigured: true,
  337 |       artifactAvailable: true,
  338 |       installationAvailable: true,
  339 |       deviceEligibility: "REQUIRES_COMPATIBLE_DEVICE",
  340 |       reason: "DEVICE",
  341 |     },
  342 |   ];
  343 |   await mockTemplateGalleryApi(page, { studioState: "READY", walletHealth: configuredIneligible });
  344 |   await openStudioLaunch(page);
  345 |   const wallets = page.locator(".publication-wallet-list");
  346 |   const apple = wallets.locator("section").filter({ hasText: "Apple Wallet" });
  347 |   const google = wallets.locator("section").filter({ hasText: "Google Wallet" });
  348 |   await expect(apple).toContainText("Configured");
  349 |   await expect(apple).toContainText("compatible Apple device");
  350 |   await expect(google).toContainText("Configured");
  351 |   await expect(google).toContainText("save link");
  352 |   await expect(wallets).not.toContainText(/Unavailable|disabled/u);
  353 |   await captureStagingRepairEvidence(page, "16-wallet-provider-device-state.png");
  354 | 
  355 |   await page.unrouteAll({ behavior: "ignoreErrors" });
  356 |   const configuredEligible = configuredIneligible.map((provider) => ({
  357 |     ...provider,
  358 |     deviceEligibility: "ELIGIBLE",
  359 |   }));
  360 |   await mockTemplateGalleryApi(page, { studioState: "READY", walletHealth: configuredEligible });
  361 |   await openStudioLaunch(page);
  362 |   const eligibleWallets = page.locator(".publication-wallet-list");
  363 |   await expect(
  364 |     eligibleWallets.locator("section").filter({ hasText: "Apple Wallet" }),
  365 |   ).toContainText("This device can complete the Add to Wallet action.");
```