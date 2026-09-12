# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: merchant-card-builder.spec.ts >> keeps deliberately long Arabic iOS 27+ content inside its canonical artwork regions
- Location: tests\e2e\merchant-card-builder.spec.ts:995:5

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 26

- Array []
+ Array [
+   Object {
+     "anchor": "end",
+     "bounds": Object {
+       "bottom": 608.423115192428,
+       "height": 12.000000240645477,
+       "left": 268.97771093779835,
+       "right": 345.0388072482204,
+       "top": 596.4231149517825,
+       "width": 76.06109631042204,
+     },
+     "content": "مكافأة مجانية مميزة مع اختيار",
+   },
+   Object {
+     "anchor": "end",
+     "bounds": Object {
+       "bottom": 616.6111333252508,
+       "height": 12.000000240645363,
+       "left": 269.9777117234126,
+       "right": 375.97628837555123,
+       "top": 604.6111330846054,
+       "width": 105.99857665213864,
+     },
+     "content": "مشروب وحلوى وإضافات موسمية طوال…",
+   },
+ ]
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
                    - tab "العربية Arabic" [selected] [ref=f3e184] [cursor=pointer]:
                      - generic [ref=f3e185]: العربية
                      - generic [ref=f3e186]: Arabic
                  - generic [ref=f3e187]:
                    - generic [ref=f3e188]: عند اكتمال
                    - strong [ref=f3e189]: 8 ختمًا
                    - generic [ref=f3e190]: تظهر جاهزية المكافأة خارج شبكة الأختام.
                  - generic [ref=f3e191]:
                    - generic [ref=f3e192]: ما الذي سيحصل عليه العميل؟ — English *
                    - textbox "ما الذي سيحصل عليه العميل؟ — English" [ref=f3e193]: مكافأة مجانية مميزة مع اختيار مشروب وحلوى وإضافات موسمية طوال اليوم
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
                  - tab "Apple Legacy" [ref=f3e205] [cursor=pointer]
                  - tab "Apple iOS 27+" [active] [selected] [ref=f3e206] [cursor=pointer]
                  - tab "Google Wallet" [ref=f3e207] [cursor=pointer]
                - paragraph [ref=f3e208]: يستخدم موقع العميل عارض البطاقة المنشورة. تحاكي معاينتا Apple وGoogle مزوّد المحفظة، بينما تتحكم المحفظة في المسافات والخط النهائية.
                - tabpanel "Apple iOS 27+" [ref=f3e209]:
                  - img "Apple iOS 27+ للمعاينة فقط" [ref=f3e211]:
                    - img [ref=f3e213]:
                      - generic [ref=f3e226]:
                        - generic [ref=f3e240]:
                          - generic [ref=f3e242]: برنامج الزبائن المميز للقهوة…
                          - generic [ref=f3e243]: Preview member
                        - generic [ref=f3e246]: الأختام
                        - generic [ref=f3e247]: 0/8
                        - generic [ref=f3e253]:
                          - generic [ref=f3e254]: المكافأة
                          - generic [ref=f3e255]: مكافأة مجانية مميزة مع اختيار
                          - generic [ref=f3e256]: مشروب وحلوى وإضافات موسمية طوال…
                      - generic [ref=f3e264]: متجر القهوة العربية للم…
                - generic [ref=f3e268]:
                  - generic [ref=f3e269]: تقدم الأختام في المعاينة
                  - generic [ref=f3e270]:
                    - slider "تقدم الأختام في المعاينة" [ref=f3e271]: "0"
                    - status [ref=f3e272]: 0/8
          - button "مراجعة البطاقة" [ref=f3e274] [cursor=pointer]
```

# Test source

```ts
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
  1020 |   const reward = page.locator('[data-builder-section="reward"] input').first();
  1021 |   await reward.fill(longArabicReward);
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
  1039 |       const screenBounds = (element: SVGGraphicsElement) => {
  1040 |         const box = element.getBBox();
  1041 |         const matrix = element.getScreenCTM();
  1042 |         if (!matrix) throw new Error("Wallet artwork layer has no screen transform.");
  1043 |         const points = [
  1044 |           new DOMPoint(box.x, box.y).matrixTransform(matrix),
  1045 |           new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix),
  1046 |           new DOMPoint(box.x, box.y + box.height).matrixTransform(matrix),
  1047 |           new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix),
  1048 |         ];
  1049 |         return {
  1050 |           left: Math.min(...points.map((point) => point.x)),
  1051 |           right: Math.max(...points.map((point) => point.x)),
  1052 |           top: Math.min(...points.map((point) => point.y)),
  1053 |           bottom: Math.max(...points.map((point) => point.y)),
  1054 |           width:
  1055 |             Math.max(...points.map((point) => point.x)) -
  1056 |             Math.min(...points.map((point) => point.x)),
  1057 |           height:
  1058 |             Math.max(...points.map((point) => point.y)) -
  1059 |             Math.min(...points.map((point) => point.y)),
  1060 |         };
  1061 |       };
  1062 |       const qrBounds = screenBounds(qr);
  1063 |       const stampBounds = screenBounds(stamp);
  1064 |       const overlaps = (left: DOMRect, right: DOMRect) =>
  1065 |         left.left < right.right &&
  1066 |         left.right > right.left &&
  1067 |         left.top < right.bottom &&
  1068 |         left.bottom > right.top;
  1069 |       const textBounds = [...root.querySelectorAll<SVGTextElement>("text")]
  1070 |         .filter((text) => !text.closest('[data-wallet-plan-layer="stamp"]'))
  1071 |         .map((text) => ({
  1072 |           content: text.textContent ?? "",
  1073 |           anchor: text.getAttribute("text-anchor"),
  1074 |           bounds: screenBounds(text),
  1075 |         }))
  1076 |         .filter((entry) => entry.bounds.width > 0 && entry.bounds.height > 0);
  1077 |       return {
  1078 |         documentWidth: document.documentElement.scrollWidth,
  1079 |         viewportWidth: window.innerWidth,
  1080 |         rootBounds,
  1081 |         masterBounds,
  1082 |         qrBounds,
  1083 |         stampBounds,
  1084 |         rootAspect: rootBounds.width / rootBounds.height,
  1085 |         rootDirection: root.getAttribute("direction"),
  1086 |         textBounds,
  1087 |         textOutsideRoot: textBounds.filter(
  1088 |           ({ bounds }) =>
  1089 |             bounds.left < rootBounds.left - 1 ||
  1090 |             bounds.right > rootBounds.right + 1 ||
  1091 |             bounds.top < rootBounds.top - 1 ||
  1092 |             bounds.bottom > rootBounds.bottom + 1,
  1093 |         ),
  1094 |         textOverlappingQr: textBounds.filter(({ bounds }) => overlaps(bounds, qrBounds)),
  1095 |         textOverlappingStamp: textBounds.filter(({ bounds }) => overlaps(bounds, stampBounds)),
  1096 |       };
  1097 |     });
  1098 | 
  1099 |   const desktopPreview = page.locator(".builder-preview-desktop");
  1100 |   await desktopPreview.locator(".builder-preview-language").getByRole("combobox").click();
  1101 |   await page.getByRole("option", { name: /^Arabic\b/u }).click();
  1102 |   await desktopPreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  1103 |   await expectBuilderPreviewReady(desktopPreview, "ar");
  1104 |   const desktop = await inspectGeometry(desktopPreview);
  1105 |   expect(desktop.documentWidth).toBeLessThanOrEqual(desktop.viewportWidth + 1);
  1106 |   expect(desktop.textOutsideRoot).toEqual([]);
> 1107 |   expect(desktop.textOverlappingQr).toEqual([]);
       |                                     ^ Error: expect(received).toEqual(expected) // deep equality
  1108 |   expect(desktop.textOverlappingStamp).toEqual([]);
  1109 |   expect(desktop.rootDirection).toBe("rtl");
  1110 |   expect(desktop.textBounds.every(({ anchor }) => anchor === "start" || anchor === "end")).toBe(
  1111 |     true,
  1112 |   );
  1113 |   expect(desktop.rootAspect).toBeGreaterThan(0.7);
  1114 |   expect(desktop.rootAspect).toBeLessThan(1.1);
  1115 | 
  1116 |   await page.setViewportSize({ width: 390, height: 844 });
  1117 |   await page.locator(".builder-mobile-preview-action").click();
  1118 |   const mobilePreview = page.locator(".builder-preview-modal");
  1119 |   await expect(mobilePreview).toBeVisible();
  1120 |   await mobilePreview.locator(".builder-preview-language").getByRole("combobox").click();
  1121 |   await page.getByRole("option", { name: /^Arabic\b/u }).click();
  1122 |   await mobilePreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  1123 |   await expectBuilderPreviewReady(mobilePreview, "ar");
  1124 |   const mobile = await inspectGeometry(mobilePreview);
  1125 |   expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewportWidth + 1);
  1126 |   expect(mobile.textOutsideRoot).toEqual([]);
  1127 |   expect(mobile.textOverlappingQr).toEqual([]);
  1128 |   expect(mobile.textOverlappingStamp).toEqual([]);
  1129 |   expect(Math.abs(mobile.rootAspect - desktop.rootAspect)).toBeLessThan(0.01);
  1130 |   await captureStagingRepairEvidence(page, "05b-ios27-long-arabic.png");
  1131 | });
  1132 | 
  1133 | test("reserves sticky-footer space and keeps active section navigation visible", async ({
  1134 |   page,
  1135 | }) => {
  1136 |   await mockTemplateGalleryApi(page);
  1137 |   await enterBuilder(page);
  1138 |   await page.getByRole("button", { name: "Review card" }).click();
  1139 |   await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  1140 | 
  1141 |   for (const width of [1280, 1024, 768, 390, 360]) {
  1142 |     await page.setViewportSize({ width, height: width <= 390 ? 780 : 860 });
  1143 |     const activeNavigation = page.locator(
  1144 |       '.builder-section-nav [data-builder-section-link="review"]',
  1145 |     );
  1146 |     await expect(activeNavigation).toHaveAttribute("aria-current", "page");
  1147 |     await activeNavigation.scrollIntoViewIfNeeded();
  1148 |     await expect(activeNavigation).toBeInViewport();
  1149 |     await page.getByRole("button", { name: "Continue to Studio" }).scrollIntoViewIfNeeded();
  1150 |     await page.evaluate(() => window.scrollBy(0, 1_000));
  1151 |     const geometry = await page.evaluate(() => {
  1152 |       const footer = document.querySelector<HTMLElement>(".builder-footer");
  1153 |       const editor = document.querySelector<HTMLElement>(".builder-editor");
  1154 |       const controls = [
  1155 |         ...(editor?.querySelectorAll<HTMLElement>("button, input, textarea, select") ?? []),
  1156 |       ].filter((element) => element.getClientRects().length > 0);
  1157 |       const lastControl = controls.at(-1);
  1158 |       const dashboardContent = document.querySelector<HTMLElement>(".dashboard-content");
  1159 |       return {
  1160 |         bodyWidth: document.body.getBoundingClientRect().width,
  1161 |         clientWidth: document.documentElement.clientWidth,
  1162 |         dashboardContentBoxSizing: dashboardContent
  1163 |           ? getComputedStyle(dashboardContent).boxSizing
  1164 |           : "missing",
  1165 |         dashboardContentRect: dashboardContent
  1166 |           ? {
  1167 |               left: dashboardContent.getBoundingClientRect().left,
  1168 |               right: dashboardContent.getBoundingClientRect().right,
  1169 |               width: dashboardContent.getBoundingClientRect().width,
  1170 |             }
  1171 |           : null,
  1172 |         footerTop: footer?.getBoundingClientRect().top ?? 0,
  1173 |         innerWidth: window.innerWidth,
  1174 |         lastControlBottom: lastControl?.getBoundingClientRect().bottom ?? 0,
  1175 |         scrollX: window.scrollX,
  1176 |         viewportHeight: window.innerHeight,
  1177 |         documentOverflow:
  1178 |           document.documentElement.scrollWidth > document.documentElement.clientWidth,
  1179 |         overflowingElements: [...document.querySelectorAll<HTMLElement>("body *")]
  1180 |           .filter((element) => {
  1181 |             if (element.getClientRects().length === 0) return false;
  1182 |             const rect = element.getBoundingClientRect();
  1183 |             return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
  1184 |           })
  1185 |           .slice(0, 12)
  1186 |           .map((element) => {
  1187 |             const rect = element.getBoundingClientRect();
  1188 |             return {
  1189 |               className: element.className,
  1190 |               left: Math.round(rect.left * 10) / 10,
  1191 |               right: Math.round(rect.right * 10) / 10,
  1192 |               tagName: element.tagName,
  1193 |               text: element.textContent?.trim().slice(0, 80) ?? "",
  1194 |             };
  1195 |           }),
  1196 |       };
  1197 |     });
  1198 |     expect(
  1199 |       geometry.documentOverflow,
  1200 |       `${width}px horizontal overflow: ${JSON.stringify(geometry)}`,
  1201 |     ).toBe(false);
  1202 |     expect(
  1203 |       geometry.lastControlBottom <= geometry.footerTop - 4 ||
  1204 |         geometry.footerTop >= geometry.viewportHeight,
  1205 |       `${width}px footer overlap: ${JSON.stringify(geometry)}`,
  1206 |     ).toBe(true);
  1207 |   }
```