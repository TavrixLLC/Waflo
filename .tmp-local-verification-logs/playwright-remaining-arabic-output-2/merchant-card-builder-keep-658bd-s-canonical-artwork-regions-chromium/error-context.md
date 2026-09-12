# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: merchant-card-builder.spec.ts >> keeps deliberately long Arabic iOS 27+ content inside its canonical artwork regions
- Location: tests\e2e\merchant-card-builder.spec.ts:995:5

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.fill: Test timeout of 90000ms exceeded.
Call log:
  - waiting for locator('.builder-language-panel[lang="ar"] input').first()

```

# Page snapshot

```yaml
- generic [ref=f3e1]:
  - alert [ref=f3e2]
  - generic [ref=f3e3]:
    - complementary [ref=f3e4]:
      - link "نظرة عامة" [ref=f3e6] [cursor=pointer]:
        - /url: /ar/dashboard
        - img "Waflo" [ref=f3e7]
      - button "اختيار المؤسسة" [ref=f3e9] [cursor=pointer]:
        - generic [ref=f3e14]: متجر القهوة العربية للمكافآت والولاء المحلي
      - navigation [ref=f3e17]:
        - generic [ref=f3e18]:
          - link "نظرة عامة" [ref=f3e19] [cursor=pointer]:
            - /url: /ar/dashboard
          - link "بطاقات الولاء" [ref=f3e24] [cursor=pointer]:
            - /url: /ar/dashboard/programs
          - link "العملاء" [ref=f3e29] [cursor=pointer]:
            - /url: /ar/dashboard/customers
          - link "الفروع" [ref=f3e36] [cursor=pointer]:
            - /url: /ar/dashboard/locations
          - link "الفريق" [ref=f3e41] [cursor=pointer]:
            - /url: /ar/dashboard/team
          - link "التحليلات" [ref=f3e48] [cursor=pointer]:
            - /url: /ar/dashboard/analytics
          - link "التصدير" [ref=f3e52] [cursor=pointer]:
            - /url: /ar/dashboard/exports
          - link "الفوترة والدفع" [ref=f3e57] [cursor=pointer]:
            - /url: /ar/dashboard/billing
        - generic [ref=f3e61]:
          - generic [ref=f3e62]: الحساب
          - link "الإعدادات" [ref=f3e63] [cursor=pointer]:
            - /url: /ar/dashboard/settings
          - link "الأمان" [ref=f3e68] [cursor=pointer]:
            - /url: /ar/dashboard/security
      - link "Gallery Merchant Gallery Merchant gallery@example.test" [ref=f3e75] [cursor=pointer]:
        - /url: /ar/dashboard/security
        - img "Gallery Merchant" [ref=f3e76]: GM
        - generic [ref=f3e77]:
          - strong [ref=f3e78]: Gallery Merchant
          - generic [ref=f3e79]: gallery@example.test
    - generic [ref=f3e80]:
      - banner [ref=f3e81]:
        - generic [ref=f3e82]:
          - button "اللغة" [ref=f3e84] [cursor=pointer]:
            - generic [ref=f3e89]: العربية
          - group [ref=f3e92]:
            - img "Gallery Merchant" [ref=f3e94] [cursor=pointer]: GM
      - main [ref=f3e95]:
        - generic [ref=f3e96]:
          - generic [ref=f3e97]:
            - button "بطاقات الولاء" [ref=f3e98] [cursor=pointer]
            - generic [ref=f3e101]:
              - text: إنشاء بطاقة ولاء
              - heading "خصّص بطاقة الولاء" [level=1] [ref=f3e102]
              - paragraph [ref=f3e103]: عدّل المكافأة واللغات والمظهر مع إبقاء البطاقة الحقيقية أمامك.
            - status [ref=f3e104]:
              - generic [ref=f3e109]: تم الحفظ
          - generic [ref=f3e110]:
            - generic [ref=f3e111]:
              - generic [ref=f3e112]: التصميم الأساسي
              - strong [ref=f3e113]: المحمصة الكلاسيكية
              - generic [ref=f3e114]: القهوة · كلاسيكي
            - generic [ref=f3e115]: الوضع السريع
            - button "تغيير التصميم" [ref=f3e116] [cursor=pointer]
          - generic [ref=f3e120]:
            - generic [ref=f3e121]:
              - navigation "أقسام محرر البطاقة" [ref=f3e122]:
                - button "اللغات مكتمل" [ref=f3e123] [cursor=pointer]:
                  - generic [ref=f3e129]: اللغات
                  - img "مكتمل" [ref=f3e130]
                - button "الأساسيات مكتمل" [ref=f3e132] [cursor=pointer]:
                  - generic [ref=f3e136]: الأساسيات
                  - img "مكتمل" [ref=f3e137]
                - button "المكافأة مكتمل" [ref=f3e139] [cursor=pointer]:
                  - generic [ref=f3e143]: المكافأة
                  - img "مكتمل" [ref=f3e144]
                - button "المواقع مكتمل" [ref=f3e146] [cursor=pointer]:
                  - generic [ref=f3e150]: المواقع
                  - img "مكتمل" [ref=f3e151]
                - button "المظهر مكتمل" [ref=f3e153] [cursor=pointer]:
                  - generic [ref=f3e160]: المظهر
                  - img "مكتمل" [ref=f3e161]
                - button "المراجعة والتحقق" [ref=f3e163] [cursor=pointer]
                - button "الإعدادات المتقدمة" [ref=f3e168] [cursor=pointer]
              - region [ref=f3e173]:
                - generic [ref=f3e174]:
                  - generic [ref=f3e175]:
                    - text: الوضع السريع
                    - heading "المكافأة" [level=2] [ref=f3e176]
                    - paragraph [ref=f3e177]: وضّح ما الذي سيحصل عليه العميل عند بلوغ الهدف.
                  - generic [ref=f3e178]: مكتمل
                - generic [ref=f3e179]:
                  - tablist "لغة المحتوى" [ref=f3e180]:
                    - tab "English English" [ref=f3e181] [cursor=pointer]:
                      - generic [ref=f3e182]: English
                      - generic [ref=f3e183]: English
                    - tab "العربية Arabic" [active] [selected] [ref=f3e184] [cursor=pointer]:
                      - generic [ref=f3e185]: العربية
                      - generic [ref=f3e186]: Arabic
                  - generic [ref=f3e187]:
                    - generic [ref=f3e188]: عند اكتمال
                    - strong [ref=f3e189]: 8 ختمًا
                    - generic [ref=f3e190]: تظهر جاهزية المكافأة خارج شبكة الأختام.
                  - generic [ref=f3e191]:
                    - generic [ref=f3e192]: ما الذي سيحصل عليه العميل؟ — English *
                    - textbox "ما الذي سيحصل عليه العميل؟ — English" [ref=f3e193]: قهوة مجانية من اختيارك
                  - group [ref=f3e194]:
                    - generic "خيارات المكافأة" [ref=f3e195] [cursor=pointer]
                    - option "عنصر مجاني"
                    - option "خصم"
                    - option "مكافأة وصفية" [selected]
                    - option "مخصصة"
            - complementary "معاينة مباشرة" [ref=f3e196]:
              - generic [ref=f3e197]:
                - generic [ref=f3e198]:
                  - generic [ref=f3e199]:
                    - text: للمعاينة فقط
                    - heading "معاينة مباشرة" [level=2] [ref=f3e200]
                  - combobox "لغة المعاينة" [ref=f3e203]: Arabic · العربية
                - tablist "معاينة مباشرة" [ref=f3e204]:
                  - tab "Apple Legacy" [selected] [ref=f3e205] [cursor=pointer]
                  - tab "Apple iOS 27+" [ref=f3e206] [cursor=pointer]
                  - tab "Google Wallet" [ref=f3e207] [cursor=pointer]
                - paragraph [ref=f3e208]: يستخدم موقع العميل عارض البطاقة المنشورة. تحاكي معاينتا Apple وGoogle مزوّد المحفظة، بينما تتحكم المحفظة في المسافات والخط النهائية.
                - tabpanel "Apple Legacy" [ref=f3e209]:
                  - img "Apple Legacy للمعاينة فقط" [ref=f3e211]:
                    - img [ref=f3e213]:
                      - generic [ref=f3e216]: متجر القهوة العربية للمكافآت والولاء المحلي
                      - generic [ref=f3e220]:
                        - generic [ref=f3e221]: الأختام
                        - generic [ref=f3e222]: 0/8
                      - generic [ref=f3e248]:
                        - generic [ref=f3e249]: المكافأة
                        - generic [ref=f3e250]: قهوة مجانية من اختيارك
                - generic [ref=f3e404]:
                  - generic [ref=f3e405]: تقدم الأختام في المعاينة
                  - generic [ref=f3e406]:
                    - slider "تقدم الأختام في المعاينة" [ref=f3e407]: "0"
                    - status [ref=f3e408]: 0/8
          - button "مراجعة البطاقة" [ref=f3e410] [cursor=pointer]
```

# Test source

```ts
  921  |   await page.goto("/en/dashboard/programs/new");
  922  |   await allTemplates(page)
  923  |     .getByRole("button", { name: "Preview: Classic Roast, all templates" })
  924  |     .click();
  925  |   await page
  926  |     .getByRole("dialog", { name: "Classic Roast" })
  927  |     .getByRole("button", { name: "Use this template" })
  928  |     .click();
  929  | 
  930  |   await expect(page.getByText(/reached your plan's active loyalty-card limit/u)).toBeVisible();
  931  |   expect(creates).toBe(0);
  932  |   await expect(page).toHaveURL(/\/dashboard\/programs\/new$/u);
  933  | });
  934  | 
  935  | test("keeps Arabic intentional and adapts from split desktop to a mobile preview sheet", async ({
  936  |   page,
  937  | }) => {
  938  |   await mockTemplateGalleryApi(page);
  939  |   await enterBuilder(page);
  940  |   await addCardLanguage(page, "Arabic");
  941  |   await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  942  |   await page.goto("/ar/dashboard/programs/created-program-id/edit");
  943  | 
  944  |   await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  945  |   await expect(page.locator(".builder-shell")).toHaveAttribute("dir", "rtl");
  946  |   await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  947  |   await page.getByRole("button", { name: /اللغات/u }).click();
  948  |   await page.getByRole("tab", { name: /English/u }).click();
  949  |   const englishTitle = page.locator('.builder-language-panel[lang="en"] input').first();
  950  |   await englishTitle.fill(
  951  |     "Classic Roast loyalty card with a deliberately long English customer-facing name",
  952  |   );
  953  |   await expect(englishTitle).toHaveAttribute("dir", "ltr");
  954  |   await expect(englishTitle).toHaveAttribute("lang", "en");
  955  |   await englishTitle.press("Tab");
  956  |   await expect.poll(() => englishTitle.evaluate((input) => input.scrollLeft)).toBe(0);
  957  |   expect(await englishTitle.evaluate((element) => getComputedStyle(element).direction)).toBe("ltr");
  958  |   await page.getByRole("tab", { name: /العربية/u }).click();
  959  |   await expect(page.locator(".builder-language-panel")).toHaveAttribute("lang", "ar");
  960  |   const arabicTitle = page.getByLabel("اسم البطاقة");
  961  |   await expect(arabicTitle).toHaveAttribute("dir", "rtl");
  962  |   await expect(arabicTitle).toHaveAttribute("lang", "ar");
  963  | 
  964  |   for (const width of [1440, 1280, 1024, 768, 390, 360]) {
  965  |     await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
  966  |     expect(
  967  |       await page.evaluate(
  968  |         () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  969  |       ),
  970  |     ).toBe(true);
  971  |   }
  972  |   await page.setViewportSize({ width: 390, height: 844 });
  973  |   await expect(page.locator(".builder-preview-desktop")).toBeHidden();
  974  |   const previewAction = page.locator(".builder-mobile-preview-action");
  975  |   await expect(previewAction).toHaveText("معاينة");
  976  |   await previewAction.focus();
  977  |   await page.keyboard.press("Enter");
  978  |   await expect(page.getByRole("dialog", { name: /معاينة مباشرة/u })).toBeVisible();
  979  | 
  980  |   const accessibility = await new AxeBuilder({ page }).analyze();
  981  |   expect(
  982  |     accessibility.violations.filter((violation) =>
  983  |       ["serious", "critical"].includes(violation.impact ?? ""),
  984  |     ),
  985  |   ).toEqual([]);
  986  | 
  987  |   await page.keyboard.press("Escape");
  988  |   await page.setViewportSize({ width: 1440, height: 1000 });
  989  |   await page.getByRole("tab", { name: "Apple iOS 27+" }).click();
  990  |   await expectBuilderPreviewReady(page.locator(".builder-preview-desktop"));
  991  |   await captureStagingRepairEvidence(page, "04-ios27-rtl-desktop.png");
  992  |   await captureStagingRepairEvidence(page, "05-ios27-long-content.png");
  993  | });
  994  | 
  995  | test("keeps deliberately long Arabic iOS 27+ content inside its canonical artwork regions", async ({
  996  |   page,
  997  | }) => {
  998  |   const longArabicMerchant =
  999  |     "\u0645\u062a\u062c\u0631 \u0627\u0644\u0642\u0647\u0648\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0644\u0644\u0645\u0643\u0627\u0641\u0622\u062a \u0648\u0627\u0644\u0648\u0644\u0627\u0621 \u0627\u0644\u0645\u062d\u0644\u064a";
  1000 |   const longArabicTitle =
  1001 |     "\u0628\u0631\u0646\u0627\u0645\u062c \u0627\u0644\u0632\u0628\u0627\u0626\u0646 \u0627\u0644\u0645\u0645\u064a\u0632 \u0644\u0644\u0642\u0647\u0648\u0629 \u0627\u0644\u064a\u0648\u0645\u064a\u0629 \u0648\u0627\u0644\u0639\u0631\u0648\u0636 \u0627\u0644\u0645\u0633\u062a\u0645\u0631\u0629";
  1002 |   const longArabicReward =
  1003 |     "\u0645\u0643\u0627\u0641\u0623\u0629 \u0645\u062c\u0627\u0646\u064a\u0629 \u0645\u0645\u064a\u0632\u0629 \u0645\u0639 \u0627\u062e\u062a\u064a\u0627\u0631 \u0645\u0634\u0631\u0648\u0628 \u0648\u062d\u0644\u0648\u0649 \u0648\u0625\u0636\u0627\u0641\u0627\u062a \u0645\u0648\u0633\u0645\u064a\u0629 \u0637\u0648\u0627\u0644 \u0627\u0644\u064a\u0648\u0645";
  1004 |   await mockTemplateGalleryApi(page, { merchantName: longArabicMerchant });
  1005 |   await page.setViewportSize({ width: 1440, height: 1000 });
  1006 |   await enterBuilder(page);
  1007 |   await addCardLanguage(page, "Arabic");
  1008 |   await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  1009 |   await page.goto("/ar/dashboard/programs/created-program-id/edit");
  1010 | 
  1011 |   await page.locator('[data-builder-section-link="languages"]').click();
  1012 |   await page.getByRole("tab", { name: /\u0627\u0644\u0639\u0631\u0628\u064a\u0629/u }).click();
  1013 |   const title = page.locator('.builder-language-panel[lang="ar"] input').first();
  1014 |   await title.fill(longArabicTitle);
  1015 |   await title.press("Tab");
  1016 |   await expect(page.locator(".builder-save-state--saved")).toBeVisible();
  1017 | 
  1018 |   await page.locator('[data-builder-section-link="reward"]').click();
  1019 |   await page.getByRole("tab", { name: /\u0627\u0644\u0639\u0631\u0628\u064a\u0629/u }).click();
  1020 |   const reward = page.locator('.builder-language-panel[lang="ar"] input').first();
> 1021 |   await reward.fill(longArabicReward);
       |                ^ Error: locator.fill: Test timeout of 90000ms exceeded.
  1022 |   await reward.press("Tab");
  1023 |   await expect(page.locator(".builder-save-state--saved")).toBeVisible();
  1024 | 
  1025 |   const inspectGeometry = async (container: Locator) =>
  1026 |     container.locator(".builder-preview-canvas").evaluate((frame) => {
  1027 |       const root = frame.querySelector<SVGSVGElement>(
  1028 |         ".wallet-preview-image-stack__canvas > span > svg",
  1029 |       );
  1030 |       const master = frame.querySelector<SVGGraphicsElement>(
  1031 |         '[data-wallet-plan-layer="apple-google-master"]',
  1032 |       );
  1033 |       const qr = frame.querySelector<SVGGraphicsElement>('[data-wallet-plan-layer="qr"]');
  1034 |       const stamp = frame.querySelector<SVGGraphicsElement>('[data-wallet-plan-layer="stamp"]');
  1035 |       if (!root || !master || !qr || !stamp)
  1036 |         throw new Error("iOS 27+ artwork layers are incomplete.");
  1037 |       const rootBounds = root.getBoundingClientRect();
  1038 |       const masterBounds = master.getBoundingClientRect();
  1039 |       const qrBounds = qr.getBoundingClientRect();
  1040 |       const stampBounds = stamp.getBoundingClientRect();
  1041 |       const overlaps = (left: DOMRect, right: DOMRect) =>
  1042 |         left.left < right.right &&
  1043 |         left.right > right.left &&
  1044 |         left.top < right.bottom &&
  1045 |         left.bottom > right.top;
  1046 |       const textBounds = [...root.querySelectorAll<SVGTextElement>("text")]
  1047 |         .filter((text) => !text.closest('[data-wallet-plan-layer="stamp"]'))
  1048 |         .map((text) => ({
  1049 |           content: text.textContent ?? "",
  1050 |           anchor: text.getAttribute("text-anchor"),
  1051 |           bounds: text.getBoundingClientRect(),
  1052 |         }))
  1053 |         .filter((entry) => entry.bounds.width > 0 && entry.bounds.height > 0);
  1054 |       return {
  1055 |         documentWidth: document.documentElement.scrollWidth,
  1056 |         viewportWidth: window.innerWidth,
  1057 |         rootBounds,
  1058 |         masterBounds,
  1059 |         qrBounds,
  1060 |         stampBounds,
  1061 |         rootAspect: rootBounds.width / rootBounds.height,
  1062 |         textBounds,
  1063 |         textOutsideMaster: textBounds.filter(
  1064 |           ({ bounds }) =>
  1065 |             bounds.left < masterBounds.left - 1 ||
  1066 |             bounds.right > masterBounds.right + 1 ||
  1067 |             bounds.top < masterBounds.top - 1 ||
  1068 |             bounds.bottom > masterBounds.bottom + 1,
  1069 |         ),
  1070 |         textOverlappingQr: textBounds.filter(({ bounds }) => overlaps(bounds, qrBounds)),
  1071 |         textOverlappingStamp: textBounds.filter(({ bounds }) => overlaps(bounds, stampBounds)),
  1072 |       };
  1073 |     });
  1074 | 
  1075 |   const desktopPreview = page.locator(".builder-preview-desktop");
  1076 |   await desktopPreview.locator(".builder-preview-language").getByRole("combobox").click();
  1077 |   await page.getByRole("option", { name: /^Arabic\b/u }).click();
  1078 |   await desktopPreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  1079 |   await expectBuilderPreviewReady(desktopPreview, "ar");
  1080 |   const desktop = await inspectGeometry(desktopPreview);
  1081 |   expect(desktop.documentWidth).toBeLessThanOrEqual(desktop.viewportWidth + 1);
  1082 |   expect(desktop.textOutsideMaster).toEqual([]);
  1083 |   expect(desktop.textOverlappingQr).toEqual([]);
  1084 |   expect(desktop.textOverlappingStamp).toEqual([]);
  1085 |   expect(desktop.textBounds.some(({ anchor }) => anchor === "end")).toBe(true);
  1086 |   expect(desktop.rootAspect).toBeGreaterThan(0.7);
  1087 |   expect(desktop.rootAspect).toBeLessThan(1.1);
  1088 | 
  1089 |   await page.setViewportSize({ width: 390, height: 844 });
  1090 |   await page.locator(".builder-mobile-preview-action").click();
  1091 |   const mobilePreview = page.locator(".builder-preview-modal");
  1092 |   await expect(mobilePreview).toBeVisible();
  1093 |   await mobilePreview.locator(".builder-preview-language").getByRole("combobox").click();
  1094 |   await page.getByRole("option", { name: /^Arabic\b/u }).click();
  1095 |   await mobilePreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  1096 |   await expectBuilderPreviewReady(mobilePreview, "ar");
  1097 |   const mobile = await inspectGeometry(mobilePreview);
  1098 |   expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewportWidth + 1);
  1099 |   expect(mobile.textOutsideMaster).toEqual([]);
  1100 |   expect(mobile.textOverlappingQr).toEqual([]);
  1101 |   expect(mobile.textOverlappingStamp).toEqual([]);
  1102 |   expect(Math.abs(mobile.rootAspect - desktop.rootAspect)).toBeLessThan(0.01);
  1103 |   await captureStagingRepairEvidence(page, "05b-ios27-long-arabic.png");
  1104 | });
  1105 | 
  1106 | test("reserves sticky-footer space and keeps active section navigation visible", async ({
  1107 |   page,
  1108 | }) => {
  1109 |   await mockTemplateGalleryApi(page);
  1110 |   await enterBuilder(page);
  1111 |   await page.getByRole("button", { name: "Review card" }).click();
  1112 |   await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  1113 | 
  1114 |   for (const width of [1280, 1024, 768, 390, 360]) {
  1115 |     await page.setViewportSize({ width, height: width <= 390 ? 780 : 860 });
  1116 |     const activeNavigation = page.locator(
  1117 |       '.builder-section-nav [data-builder-section-link="review"]',
  1118 |     );
  1119 |     await expect(activeNavigation).toHaveAttribute("aria-current", "page");
  1120 |     await activeNavigation.scrollIntoViewIfNeeded();
  1121 |     await expect(activeNavigation).toBeInViewport();
```