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
  217 |   const selectedActivity = await page.locator('input[name="category"]').inputValue();
  218 |   expect(selectedActivity).not.toBe("");
  219 | 
  220 |   const language = page
  221 |     .locator(".wf-search-select")
  222 |     .filter({ has: page.locator('input[name="locale"]') });
  223 |   const languageInput = language.getByRole("combobox");
  224 |   await expect(languageInput).toBeVisible();
  225 |   await languageInput.focus();
  226 |   await page.keyboard.press("ArrowDown");
  227 |   const languageListbox = page.getByRole("listbox");
  228 |   await expect(languageListbox).toBeVisible();
  229 |   await expect(languageListbox).toHaveAttribute("dir", "rtl");
  230 |   await captureStagingRepairEvidence(page, "10-default-language-select-themed.png");
  231 |   await page.keyboard.press("ArrowDown");
  232 |   await page.keyboard.press("Enter");
  233 |   await page.keyboard.press("Escape");
  234 | 
  235 |   await activity
  236 |     .locator("xpath=ancestor::form")
  237 |     .getByRole("button", { name: /\u062d\u0641\u0638/u })
  238 |     .click();
  239 |   await expect(page.getByRole("alert")).toBeVisible();
> 240 |   expect(savedSettings.businessCategory).toBe(selectedActivity);
      |                                          ^ Error: expect(received).toBe(expected) // Object.is equality
  241 |   expect(savedSettings.defaultLocale).toBe("ar");
  242 |   await page.reload();
  243 |   await expect(page.locator('input[name="category"]')).toHaveValue(selectedActivity);
  244 |   await expect(page.locator('input[name="locale"]')).toHaveValue("ar");
  245 | });
  246 | 
  247 | test("keeps Google linking secure while presenting a localized inline wrong-password error", async ({
  248 |   page,
  249 | }) => {
  250 |   const rawBackendProse = "Incorrect Waflo password. This must never be displayed in Arabic UI.";
  251 |   let rejectedCode = "";
  252 |   await mockTemplateGalleryApi(page);
  253 |   await page.route("**/v1/auth/sessions", (route) => fulfill(route, []));
  254 |   await page.route("**/v1/security/events", (route) => fulfill(route, { items: [] }));
  255 |   await page.route("**/v1/auth/external/identities", (route) =>
  256 |     fulfill(route, { accountEmail: "gallery@example.test", passwordEnabled: true, identities: [] }),
  257 |   );
  258 |   await page.route("**/v1/auth/external/providers", (route) =>
  259 |     fulfill(route, { googleSignInAvailable: true }),
  260 |   );
  261 |   await page.route("**/v1/auth/external/google/link", async (route) => {
  262 |     const payload = route.request().postDataJSON() as Record<string, unknown>;
  263 |     expect(payload.currentPassword).toBe("not-the-real-password");
  264 |     rejectedCode = "REAUTHENTICATION_REQUIRED";
  265 |     await reject(route, rejectedCode, rawBackendProse);
  266 |   });
  267 | 
  268 |   await page.goto("/ar/dashboard/security");
  269 |   const googleSection = page.locator(".security-section").filter({ hasText: "Google" });
  270 |   const password = googleSection.locator('input[autocomplete="current-password"]');
  271 |   await expect(password).toBeVisible();
  272 |   await password.fill("not-the-real-password");
  273 |   const linkButton = googleSection.getByRole("button", { name: /Google/u });
  274 |   await linkButton.click();
  275 |   await expect(password).toHaveAttribute("aria-invalid", "true");
  276 |   const inlineError = googleSection.getByRole("alert");
  277 |   await expect(inlineError).toBeVisible();
  278 |   const errorText = await inlineError.textContent();
  279 |   expect(errorText).toMatch(/[\u0600-\u06FF]/u);
  280 |   expect(errorText).not.toContain(rawBackendProse);
  281 |   expect(rejectedCode).toBe("REAUTHENTICATION_REQUIRED");
  282 |   await expect(linkButton).toBeEnabled();
  283 |   await captureStagingRepairEvidence(page, "11-google-link-wrong-password.png");
  284 |   await password.fill("corrected-password");
  285 |   await expect(inlineError).toBeHidden();
  286 |   await expect(password).not.toHaveAttribute("aria-invalid", "true");
  287 | });
  288 | 
  289 | test("separates Wallet provider configuration, artifact readiness, and device eligibility on launch", async ({
  290 |   page,
  291 | }) => {
  292 |   const configuredIneligible = [
  293 |     {
  294 |       provider: "APPLE",
  295 |       mode: "REAL",
  296 |       status: "HEALTHY",
  297 |       safeMessage: "Configured",
  298 |       configured: true,
  299 |       providerConfigured: true,
  300 |       artifactAvailable: true,
  301 |       installationAvailable: true,
  302 |       deviceEligibility: "REQUIRES_COMPATIBLE_DEVICE",
  303 |       reason: "DEVICE",
  304 |     },
  305 |     {
  306 |       provider: "GOOGLE",
  307 |       mode: "REAL",
  308 |       status: "HEALTHY",
  309 |       safeMessage: "Configured",
  310 |       configured: true,
  311 |       providerConfigured: true,
  312 |       artifactAvailable: true,
  313 |       installationAvailable: true,
  314 |       deviceEligibility: "REQUIRES_COMPATIBLE_DEVICE",
  315 |       reason: "DEVICE",
  316 |     },
  317 |   ];
  318 |   await mockTemplateGalleryApi(page, { studioState: "READY", walletHealth: configuredIneligible });
  319 |   await openStudioLaunch(page);
  320 |   const wallets = page.locator(".publication-wallet-list");
  321 |   const apple = wallets.locator("section").filter({ hasText: "Apple Wallet" });
  322 |   const google = wallets.locator("section").filter({ hasText: "Google Wallet" });
  323 |   await expect(apple).toContainText("Configured");
  324 |   await expect(apple).toContainText("compatible Apple device");
  325 |   await expect(google).toContainText("Configured");
  326 |   await expect(google).toContainText("save link");
  327 |   await expect(wallets).not.toContainText(/Unavailable|disabled/u);
  328 |   await captureStagingRepairEvidence(page, "16-wallet-provider-device-state.png");
  329 | 
  330 |   await page.unrouteAll({ behavior: "ignoreErrors" });
  331 |   const configuredEligible = configuredIneligible.map((provider) => ({
  332 |     ...provider,
  333 |     deviceEligibility: "ELIGIBLE",
  334 |   }));
  335 |   await mockTemplateGalleryApi(page, { studioState: "READY", walletHealth: configuredEligible });
  336 |   await openStudioLaunch(page);
  337 |   const eligibleWallets = page.locator(".publication-wallet-list");
  338 |   await expect(
  339 |     eligibleWallets.locator("section").filter({ hasText: "Apple Wallet" }),
  340 |   ).toContainText("This device can complete the Add to Wallet action.");
```