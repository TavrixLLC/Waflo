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
Error: locator.click: Test timeout of 90000ms exceeded.
Call log:
  - waiting for getByRole('tab', { name: /\u0627\u0644\u0639\u0631\u0628\u064a\u0629/u })

```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - alert [ref=f1e2]
  - generic [ref=f1e3]:
    - complementary [ref=f1e4]:
      - link "نظرة عامة" [ref=f1e6] [cursor=pointer]:
        - /url: /ar/dashboard
        - img "Waflo" [ref=f1e7]
      - button "اختيار المؤسسة" [ref=f1e9] [cursor=pointer]:
        - generic [ref=f1e14]: متجر القهوة العربية للمكافآت والولاء المحلي
      - navigation [ref=f1e17]:
        - generic [ref=f1e18]:
          - link "نظرة عامة" [ref=f1e19] [cursor=pointer]:
            - /url: /ar/dashboard
          - link "بطاقات الولاء" [ref=f1e24] [cursor=pointer]:
            - /url: /ar/dashboard/programs
          - link "العملاء" [ref=f1e29] [cursor=pointer]:
            - /url: /ar/dashboard/customers
          - link "الفروع" [ref=f1e36] [cursor=pointer]:
            - /url: /ar/dashboard/locations
          - link "الفريق" [ref=f1e41] [cursor=pointer]:
            - /url: /ar/dashboard/team
          - link "التحليلات" [ref=f1e48] [cursor=pointer]:
            - /url: /ar/dashboard/analytics
          - link "التصدير" [ref=f1e52] [cursor=pointer]:
            - /url: /ar/dashboard/exports
          - link "الفوترة والدفع" [ref=f1e57] [cursor=pointer]:
            - /url: /ar/dashboard/billing
        - generic [ref=f1e61]:
          - generic [ref=f1e62]: الحساب
          - link "الإعدادات" [ref=f1e63] [cursor=pointer]:
            - /url: /ar/dashboard/settings
          - link "الأمان" [ref=f1e68] [cursor=pointer]:
            - /url: /ar/dashboard/security
      - link "Gallery Merchant Gallery Merchant gallery@example.test" [ref=f1e75] [cursor=pointer]:
        - /url: /ar/dashboard/security
        - img "Gallery Merchant" [ref=f1e76]: GM
        - generic [ref=f1e77]:
          - strong [ref=f1e78]: Gallery Merchant
          - generic [ref=f1e79]: gallery@example.test
    - generic [ref=f1e80]:
      - banner [ref=f1e81]:
        - generic [ref=f1e82]:
          - button "اللغة" [ref=f1e84] [cursor=pointer]:
            - generic [ref=f1e89]: العربية
          - group [ref=f1e92]:
            - img "Gallery Merchant" [ref=f1e94] [cursor=pointer]: GM
      - main [ref=f1e95]:
        - generic [ref=f1e96]:
          - generic [ref=f1e97]:
            - button "بطاقات الولاء" [ref=f1e98] [cursor=pointer]
            - generic [ref=f1e101]:
              - text: إنشاء بطاقة ولاء
              - heading "خصّص بطاقة الولاء" [level=1] [ref=f1e102]
              - paragraph [ref=f1e103]: عدّل المكافأة واللغات والمظهر مع إبقاء البطاقة الحقيقية أمامك.
            - status [ref=f1e104]:
              - generic [ref=f1e109]: تم الحفظ
          - generic [ref=f1e110]:
            - generic [ref=f1e111]:
              - generic [ref=f1e112]: التصميم الأساسي
              - strong [ref=f1e113]: المحمصة الكلاسيكية
              - generic [ref=f1e114]: القهوة · كلاسيكي
            - generic [ref=f1e115]: الوضع السريع
            - button "تغيير التصميم" [ref=f1e116] [cursor=pointer]
          - generic [ref=f1e120]:
            - generic [ref=f1e121]:
              - navigation "أقسام محرر البطاقة" [ref=f1e122]:
                - button "اللغات مكتمل" [active] [ref=f1e123] [cursor=pointer]:
                  - generic [ref=f1e129]: اللغات
                  - img "مكتمل" [ref=f1e130]
                - button "الأساسيات مكتمل" [ref=f1e132] [cursor=pointer]:
                  - generic [ref=f1e136]: الأساسيات
                  - img "مكتمل" [ref=f1e137]
                - button "المكافأة مكتمل" [ref=f1e139] [cursor=pointer]:
                  - generic [ref=f1e143]: المكافأة
                  - img "مكتمل" [ref=f1e144]
                - button "المواقع مكتمل" [ref=f1e146] [cursor=pointer]:
                  - generic [ref=f1e150]: المواقع
                  - img "مكتمل" [ref=f1e151]
                - button "المظهر مكتمل" [ref=f1e153] [cursor=pointer]:
                  - generic [ref=f1e160]: المظهر
                  - img "مكتمل" [ref=f1e161]
                - button "المراجعة والتحقق" [ref=f1e163] [cursor=pointer]
                - button "الإعدادات المتقدمة" [ref=f1e168] [cursor=pointer]
              - region [ref=f1e173]:
                - generic [ref=f1e174]:
                  - generic [ref=f1e175]:
                    - text: الوضع السريع
                    - heading "اللغات" [level=2] [ref=f1e176]
                    - paragraph [ref=f1e177]: أضف لغات العملاء وأكمل محتوى البطاقة لكل لغة.
                  - generic [ref=f1e178]: مكتمل
                - generic [ref=f1e179]:
                  - generic [ref=f1e180]:
                    - generic [ref=f1e182]:
                      - heading "لغات البطاقة" [level=3] [ref=f1e183]
                      - paragraph [ref=f1e184]: اختر اللغات التي يمكن للعملاء عرض بطاقة الولاء بها. يمكنك إضافة اللغات أو إزالتها لاحقًا.
                    - generic [ref=f1e185]:
                      - generic [ref=f1e186]:
                        - generic [ref=f1e187]: اللغة الافتراضية *
                        - combobox "اللغة الافتراضية" [ref=f1e189]: English — English
                        - generic [ref=f1e190]: يتغير اختيار العملاء الافتراضي فقط بعد نشر هذه المسودة.
                      - generic [ref=f1e191]:
                        - generic [ref=f1e192]: إضافة لغة
                        - combobox "إضافة لغة" [ref=f1e194]
                        - generic [ref=f1e195]: ابحث بالاسم الإنجليزي أو الأصلي
                    - list "اللغات المفعلة" [ref=f1e196]:
                      - listitem [ref=f1e197]:
                        - generic [ref=f1e198]:
                          - strong [ref=f1e199]: English
                          - generic [ref=f1e200]: English
                        - generic [ref=f1e201]:
                          - generic [ref=f1e202]: افتراضية
                          - generic [ref=f1e203]: مكتمل
                          - button "إزالة اللغة" [disabled] [ref=f1e204]
                  - tablist "لغات البطاقة" [ref=f1e205]:
                    - tab "English مكتمل" [selected] [ref=f1e206] [cursor=pointer]:
                      - generic [ref=f1e207]: English
                      - generic [ref=f1e208]: مكتمل
                  - tabpanel "English مكتمل" [ref=f1e209]:
                    - status [ref=f1e210]:
                      - strong [ref=f1e214]: "English: مكتمل"
                    - generic [ref=f1e215]:
                      - generic [ref=f1e216]: اسم البطاقة الظاهر للعملاء *
                      - textbox "اسم البطاقة الظاهر للعملاء" [ref=f1e217]: Classic Roast rewards
                    - generic [ref=f1e218]:
                      - generic [ref=f1e219]: الوصف القصير *
                      - textbox "الوصف القصير" [ref=f1e220]: Collect a cup stamp with every qualifying coffee.
                    - generic [ref=f1e221]:
                      - generic [ref=f1e222]: كيف يحصل العميل على ختم؟ *
                      - textbox "كيف يحصل العميل على ختم؟" [ref=f1e223]: Collect a cup stamp with every qualifying coffee.
                    - group [ref=f1e224]:
                      - generic "المحتوى التفصيلي والرسائل" [ref=f1e225] [cursor=pointer]
            - complementary "معاينة مباشرة" [ref=f1e226]:
              - generic [ref=f1e227]:
                - generic [ref=f1e228]:
                  - generic [ref=f1e229]:
                    - text: للمعاينة فقط
                    - heading "معاينة مباشرة" [level=2] [ref=f1e230]
                  - combobox "لغة المعاينة" [ref=f1e233]: English · English
                - tablist "معاينة مباشرة" [ref=f1e234]:
                  - tab "Apple Legacy" [selected] [ref=f1e235] [cursor=pointer]
                  - tab "Apple iOS 27+" [ref=f1e236] [cursor=pointer]
                  - tab "Google Wallet" [ref=f1e237] [cursor=pointer]
                - paragraph [ref=f1e238]: يستخدم موقع العميل عارض البطاقة المنشورة. تحاكي معاينتا Apple وGoogle مزوّد المحفظة، بينما تتحكم المحفظة في المسافات والخط النهائية.
                - tabpanel "Apple Legacy" [ref=f1e239]:
                  - img "Apple Legacy للمعاينة فقط" [ref=f1e241]:
                    - img [ref=f1e243]:
                      - generic [ref=f1e246]: متجر القهوة العربية للمكافآت والولاء المحلي
                      - generic [ref=f1e250]:
                        - generic [ref=f1e251]: STAMPS
                        - generic [ref=f1e252]: 0/8
                      - generic [ref=f1e278]:
                        - generic [ref=f1e279]: REWARD
                        - generic [ref=f1e280]: A coffee on us
                - generic [ref=f1e434]:
                  - generic [ref=f1e435]: تقدم الأختام في المعاينة
                  - generic [ref=f1e436]:
                    - slider "تقدم الأختام في المعاينة" [ref=f1e437]: "0"
                    - status [ref=f1e438]: 0/8
          - button "مراجعة البطاقة" [ref=f1e440] [cursor=pointer]
```

# Test source

```ts
  911  |         internalName: "Existing card",
  912  |         status: "PUBLISHED",
  913  |         currentDraftVersion: null,
  914  |         currentPublishedVersion: { id: "published", versionNumber: 1, status: "PUBLISHED" },
  915  |       },
  916  |     ],
  917  |     onCreate: () => {
  918  |       creates += 1;
  919  |     },
  920  |   });
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
  1008 |   await page.goto("/ar/dashboard/programs/created-program-id/edit");
  1009 | 
  1010 |   await page.locator('[data-builder-section-link="languages"]').click();
> 1011 |   await page.getByRole("tab", { name: /\u0627\u0644\u0639\u0631\u0628\u064a\u0629/u }).click();
       |                                                                                        ^ Error: locator.click: Test timeout of 90000ms exceeded.
  1012 |   const title = page.locator('.builder-language-panel[lang="ar"] input').first();
  1013 |   await title.fill(longArabicTitle);
  1014 |   await title.press("Tab");
  1015 |   await expect(page.getByText(/\u0645\u062d\u0641\u0648\u0638/u)).toBeVisible();
  1016 | 
  1017 |   await page.locator('[data-builder-section-link="reward"]').click();
  1018 |   await page.getByRole("tab", { name: /\u0627\u0644\u0639\u0631\u0628\u064a\u0629/u }).click();
  1019 |   const reward = page.locator('.builder-language-panel[lang="ar"] input').first();
  1020 |   await reward.fill(longArabicReward);
  1021 |   await reward.press("Tab");
  1022 |   await expect(page.getByText(/\u0645\u062d\u0641\u0648\u0638/u)).toBeVisible();
  1023 | 
  1024 |   const inspectGeometry = async (container: Locator) =>
  1025 |     container.locator(".builder-preview-canvas").evaluate((frame) => {
  1026 |       const root = frame.querySelector<SVGSVGElement>(
  1027 |         ".wallet-preview-image-stack__canvas > span > svg",
  1028 |       );
  1029 |       const master = frame.querySelector<SVGGraphicsElement>(
  1030 |         '[data-wallet-plan-layer="apple-google-master"]',
  1031 |       );
  1032 |       const qr = frame.querySelector<SVGGraphicsElement>('[data-wallet-plan-layer="qr"]');
  1033 |       const stamp = frame.querySelector<SVGGraphicsElement>('[data-wallet-plan-layer="stamp"]');
  1034 |       if (!root || !master || !qr || !stamp)
  1035 |         throw new Error("iOS 27+ artwork layers are incomplete.");
  1036 |       const rootBounds = root.getBoundingClientRect();
  1037 |       const masterBounds = master.getBoundingClientRect();
  1038 |       const qrBounds = qr.getBoundingClientRect();
  1039 |       const stampBounds = stamp.getBoundingClientRect();
  1040 |       const overlaps = (left: DOMRect, right: DOMRect) =>
  1041 |         left.left < right.right &&
  1042 |         left.right > right.left &&
  1043 |         left.top < right.bottom &&
  1044 |         left.bottom > right.top;
  1045 |       const textBounds = [...root.querySelectorAll<SVGTextElement>("text")]
  1046 |         .filter((text) => !text.closest('[data-wallet-plan-layer="stamp"]'))
  1047 |         .map((text) => ({
  1048 |           content: text.textContent ?? "",
  1049 |           anchor: text.getAttribute("text-anchor"),
  1050 |           bounds: text.getBoundingClientRect(),
  1051 |         }))
  1052 |         .filter((entry) => entry.bounds.width > 0 && entry.bounds.height > 0);
  1053 |       return {
  1054 |         documentWidth: document.documentElement.scrollWidth,
  1055 |         viewportWidth: window.innerWidth,
  1056 |         rootBounds,
  1057 |         masterBounds,
  1058 |         qrBounds,
  1059 |         stampBounds,
  1060 |         rootAspect: rootBounds.width / rootBounds.height,
  1061 |         textBounds,
  1062 |         textOutsideMaster: textBounds.filter(
  1063 |           ({ bounds }) =>
  1064 |             bounds.left < masterBounds.left - 1 ||
  1065 |             bounds.right > masterBounds.right + 1 ||
  1066 |             bounds.top < masterBounds.top - 1 ||
  1067 |             bounds.bottom > masterBounds.bottom + 1,
  1068 |         ),
  1069 |         textOverlappingQr: textBounds.filter(({ bounds }) => overlaps(bounds, qrBounds)),
  1070 |         textOverlappingStamp: textBounds.filter(({ bounds }) => overlaps(bounds, stampBounds)),
  1071 |       };
  1072 |     });
  1073 | 
  1074 |   const desktopPreview = page.locator(".builder-preview-desktop");
  1075 |   await desktopPreview.locator(".builder-preview-language").getByRole("combobox").click();
  1076 |   await page.getByRole("option", { name: /^Arabic\b/u }).click();
  1077 |   await desktopPreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  1078 |   await expectBuilderPreviewReady(desktopPreview, "ar");
  1079 |   const desktop = await inspectGeometry(desktopPreview);
  1080 |   expect(desktop.documentWidth).toBeLessThanOrEqual(desktop.viewportWidth + 1);
  1081 |   expect(desktop.textOutsideMaster).toEqual([]);
  1082 |   expect(desktop.textOverlappingQr).toEqual([]);
  1083 |   expect(desktop.textOverlappingStamp).toEqual([]);
  1084 |   expect(desktop.textBounds.some(({ anchor }) => anchor === "end")).toBe(true);
  1085 |   expect(desktop.rootAspect).toBeGreaterThan(0.7);
  1086 |   expect(desktop.rootAspect).toBeLessThan(1.1);
  1087 | 
  1088 |   await page.setViewportSize({ width: 390, height: 844 });
  1089 |   await page.locator(".builder-mobile-preview-action").click();
  1090 |   const mobilePreview = page.locator(".builder-preview-modal");
  1091 |   await expect(mobilePreview).toBeVisible();
  1092 |   await mobilePreview.locator(".builder-preview-language").getByRole("combobox").click();
  1093 |   await page.getByRole("option", { name: /^Arabic\b/u }).click();
  1094 |   await mobilePreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  1095 |   await expectBuilderPreviewReady(mobilePreview, "ar");
  1096 |   const mobile = await inspectGeometry(mobilePreview);
  1097 |   expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewportWidth + 1);
  1098 |   expect(mobile.textOutsideMaster).toEqual([]);
  1099 |   expect(mobile.textOverlappingQr).toEqual([]);
  1100 |   expect(mobile.textOverlappingStamp).toEqual([]);
  1101 |   expect(Math.abs(mobile.rootAspect - desktop.rootAspect)).toBeLessThan(0.01);
  1102 |   await captureStagingRepairEvidence(page, "05b-ios27-long-arabic.png");
  1103 | });
  1104 | 
  1105 | test("reserves sticky-footer space and keeps active section navigation visible", async ({
  1106 |   page,
  1107 | }) => {
  1108 |   await mockTemplateGalleryApi(page);
  1109 |   await enterBuilder(page);
  1110 |   await page.getByRole("button", { name: "Review card" }).click();
  1111 |   await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
```