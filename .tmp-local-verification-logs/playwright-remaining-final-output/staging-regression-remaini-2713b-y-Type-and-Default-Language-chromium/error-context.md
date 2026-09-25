# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: staging-regression-remaining.spec.ts >> uses themed keyboard-accessible SearchableSelect controls for Activity Type and Default Language
- Location: tests\e2e\staging-regression-remaining.spec.ts:187:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "automotive"
Received: undefined
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
        - status [ref=e100]:
          - strong [ref=e104]: تم حفظ الإعدادات.
        - generic [ref=e105]:
          - generic [ref=e106]:
            - heading "عام" [level=2] [ref=e107]
            - generic [ref=e108]:
              - generic [ref=e109]:
                - generic [ref=e110]: اسم المؤسسة *
                - textbox "اسم المؤسسة" [ref=e111]: Gallery Coffee
              - generic [ref=e112]:
                - generic [ref=e113]: نوع النشاط
                - combobox "نوع النشاط" [ref=e115]: السيارات
              - generic [ref=e116]:
                - generic [ref=e117]: اللغة الافتراضية
                - combobox "اللغة الافتراضية" [ref=e119]: العربية
              - generic [ref=e120]:
                - generic [ref=e121]: المنطقة الزمنية
                - combobox "المنطقة الزمنية" [ref=e123]: Baghdad (غرينتش+3)
              - button "حفظ التغييرات" [active] [ref=e124] [cursor=pointer]
          - generic [ref=e125]:
            - generic [ref=e127]:
              - heading "الهوية البصرية" [level=2] [ref=e128]
              - paragraph [ref=e129]: يظهر شعار نشاطك في تجربة العميل وWallet عندما يدعم مزود المحفظة ذلك.
            - region "شعار النشاط" [ref=e130]:
              - generic [ref=e131]:
                - generic [ref=e132]:
                  - heading "شعار النشاط" [level=4] [ref=e133]
                  - paragraph [ref=e134]: اختر من مكتبة Waflo أو ارفع صورة PNG أو JPEG أو WebP.
                - button "شعار النشاط رفع صورة" [ref=e135]
              - button "إضافة شعار" [ref=e136]
            - paragraph [ref=e141]: PNG أو JPEG أو WebP بحجم أقل من 2 MB. يفحص Waflo الصورة ويحذف بياناتها الوصفية ويعيد ترميزها بأمان.
          - generic [ref=e142]:
            - heading "رابط التاجر" [level=2] [ref=e143]
            - status [ref=e144]:
              - generic [ref=e147]:
                - strong [ref=e148]: تحقق من هويتك
                - generic [ref=e149]: أدخل كلمة مرور Waflo لحماية هذا التغيير. يبقى الرابط السابق محجوزاً لمدة 90 يوماً.
            - generic [ref=e150]:
              - generic [ref=e151]:
                - generic [ref=e152]: الرابط الجديد *
                - textbox "الرابط الجديد" [ref=e153]: gallery-coffee
              - generic [ref=e154]:
                - link "https://gallery-coffee.waflo.app/" [ref=e155] [cursor=pointer]:
                  - /url: https://gallery-coffee.waflo.app/
                - button "نسخ رابط التاجر" [ref=e156] [cursor=pointer]
              - generic [ref=e160]:
                - generic [ref=e161]: تأكيد كلمة المرور *
                - textbox "تأكيد كلمة المرور" [ref=e162]
              - button "تغيير رابط التاجر" [ref=e163] [cursor=pointer]
```

# Test source

```ts
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
  209 |   await activityInput.press("ArrowDown");
  210 |   const activityListbox = page.getByRole("listbox");
  211 |   await expect(activityListbox).toBeVisible();
  212 |   await expect(activityListbox).toHaveAttribute("dir", "rtl");
  213 |   await captureStagingRepairEvidence(page, "09-activity-select-themed.png");
  214 |   await activityInput.press("ArrowDown");
  215 |   await activityInput.press("Enter");
  216 |   await expect(activityListbox).toBeHidden();
  217 |   await activityInput.focus();
  218 |   await activityInput.press("ArrowUp");
  219 |   await expect(activityListbox).toBeVisible();
  220 |   await activityInput.press("Escape");
  221 |   await expect(activityListbox).toBeHidden();
  222 |   const selectedActivity = await page.locator('input[name="category"]').inputValue();
  223 |   expect(selectedActivity).not.toBe("");
  224 | 
  225 |   const language = page
  226 |     .locator(".wf-search-select")
  227 |     .filter({ has: page.locator('input[name="locale"]') });
  228 |   const languageInput = language.getByRole("combobox");
  229 |   await expect(languageInput).toBeVisible();
  230 |   await languageInput.focus();
  231 |   await languageInput.press("ArrowDown");
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
> 246 |   expect(savedSettings.businessCategory).toBe(selectedActivity);
      |                                          ^ Error: expect(received).toBe(expected) // Object.is equality
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
  322 |     },
  323 |   ];
  324 |   await mockTemplateGalleryApi(page, { studioState: "READY", walletHealth: configuredIneligible });
  325 |   await openStudioLaunch(page);
  326 |   const wallets = page.locator(".publication-wallet-list");
  327 |   const apple = wallets.locator("section").filter({ hasText: "Apple Wallet" });
  328 |   const google = wallets.locator("section").filter({ hasText: "Google Wallet" });
  329 |   await expect(apple).toContainText("Configured");
  330 |   await expect(apple).toContainText("compatible Apple device");
  331 |   await expect(google).toContainText("Configured");
  332 |   await expect(google).toContainText("save link");
  333 |   await expect(wallets).not.toContainText(/Unavailable|disabled/u);
  334 |   await captureStagingRepairEvidence(page, "16-wallet-provider-device-state.png");
  335 | 
  336 |   await page.unrouteAll({ behavior: "ignoreErrors" });
  337 |   const configuredEligible = configuredIneligible.map((provider) => ({
  338 |     ...provider,
  339 |     deviceEligibility: "ELIGIBLE",
  340 |   }));
  341 |   await mockTemplateGalleryApi(page, { studioState: "READY", walletHealth: configuredEligible });
  342 |   await openStudioLaunch(page);
  343 |   const eligibleWallets = page.locator(".publication-wallet-list");
  344 |   await expect(
  345 |     eligibleWallets.locator("section").filter({ hasText: "Apple Wallet" }),
  346 |   ).toContainText("This device can complete the Add to Wallet action.");
```