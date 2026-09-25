# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: merchant-card-builder.spec.ts >> keeps deliberately long Arabic iOS 27+ content inside its canonical artwork regions
- Location: tests\e2e\merchant-card-builder.spec.ts:995:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
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
                          - generic [ref=f3e255]: مكافأة مجانية مميزة مع
                          - generic [ref=f3e256]: اختيار مشروب وحلوى…
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
  1074 |           layer: text.closest("[data-wallet-plan-layer]")?.getAttribute("data-wallet-plan-layer"),
  1075 |           parent: text.parentElement?.outerHTML.slice(0, 220) ?? "",
  1076 |           bounds: screenBounds(text),
  1077 |         }))
  1078 |         .filter((entry) => entry.bounds.width > 0 && entry.bounds.height > 0);
  1079 |       return {
  1080 |         documentWidth: document.documentElement.scrollWidth,
  1081 |         viewportWidth: window.innerWidth,
  1082 |         rootBounds,
  1083 |         masterBounds,
  1084 |         qrBounds,
  1085 |         stampBounds,
  1086 |         rootAspect: rootBounds.width / rootBounds.height,
  1087 |         rootDirection: root.getAttribute("direction"),
  1088 |         textBounds,
  1089 |         textOutsideRoot: textBounds.filter(
  1090 |           ({ bounds }) =>
  1091 |             bounds.left < rootBounds.left - 1 ||
  1092 |             bounds.right > rootBounds.right + 1 ||
  1093 |             bounds.top < rootBounds.top - 1 ||
  1094 |             bounds.bottom > rootBounds.bottom + 1,
  1095 |         ),
  1096 |         textOverlappingQr: textBounds.filter(({ bounds }) => overlaps(bounds, qrBounds)),
  1097 |         textOverlappingStamp: textBounds.filter(({ bounds }) => overlaps(bounds, stampBounds)),
  1098 |       };
  1099 |     });
  1100 | 
  1101 |   const desktopPreview = page.locator(".builder-preview-desktop");
  1102 |   await desktopPreview.locator(".builder-preview-language").getByRole("combobox").click();
  1103 |   await page.getByRole("option", { name: /^Arabic\b/u }).click();
  1104 |   await desktopPreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  1105 |   await expectBuilderPreviewReady(desktopPreview, "ar");
  1106 |   const desktop = await inspectGeometry(desktopPreview);
  1107 |   console.info(
  1108 |     `iOS 27+ Arabic desktop geometry ${JSON.stringify({
  1109 |       root: desktop.rootBounds,
  1110 |       qr: desktop.qrBounds,
  1111 |       stamp: desktop.stampBounds,
  1112 |       collisions: desktop.textOverlappingQr,
  1113 |     })}`,
  1114 |   );
  1115 |   expect(desktop.documentWidth).toBeLessThanOrEqual(desktop.viewportWidth + 1);
  1116 |   expect(desktop.textOutsideRoot).toEqual([]);
  1117 |   expect(desktop.textOverlappingQr).toEqual([]);
  1118 |   expect(desktop.textOverlappingStamp).toEqual([]);
  1119 |   expect(desktop.rootDirection).toBe("rtl");
> 1120 |   expect(desktop.textBounds.every(({ anchor }) => anchor === "start" || anchor === "end")).toBe(
       |                                                                                            ^ Error: expect(received).toBe(expected) // Object.is equality
  1121 |     true,
  1122 |   );
  1123 |   expect(desktop.rootAspect).toBeGreaterThan(0.7);
  1124 |   expect(desktop.rootAspect).toBeLessThan(1.1);
  1125 | 
  1126 |   await page.setViewportSize({ width: 390, height: 844 });
  1127 |   await page.locator(".builder-mobile-preview-action").click();
  1128 |   const mobilePreview = page.locator(".builder-preview-modal");
  1129 |   await expect(mobilePreview).toBeVisible();
  1130 |   await mobilePreview.locator(".builder-preview-language").getByRole("combobox").click();
  1131 |   await page.getByRole("option", { name: /^Arabic\b/u }).click();
  1132 |   await mobilePreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  1133 |   await expectBuilderPreviewReady(mobilePreview, "ar");
  1134 |   const mobile = await inspectGeometry(mobilePreview);
  1135 |   expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewportWidth + 1);
  1136 |   expect(mobile.textOutsideRoot).toEqual([]);
  1137 |   expect(mobile.textOverlappingQr).toEqual([]);
  1138 |   expect(mobile.textOverlappingStamp).toEqual([]);
  1139 |   expect(Math.abs(mobile.rootAspect - desktop.rootAspect)).toBeLessThan(0.01);
  1140 |   await captureStagingRepairEvidence(page, "05b-ios27-long-arabic.png");
  1141 | });
  1142 | 
  1143 | test("reserves sticky-footer space and keeps active section navigation visible", async ({
  1144 |   page,
  1145 | }) => {
  1146 |   await mockTemplateGalleryApi(page);
  1147 |   await enterBuilder(page);
  1148 |   await page.getByRole("button", { name: "Review card" }).click();
  1149 |   await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  1150 | 
  1151 |   for (const width of [1280, 1024, 768, 390, 360]) {
  1152 |     await page.setViewportSize({ width, height: width <= 390 ? 780 : 860 });
  1153 |     const activeNavigation = page.locator(
  1154 |       '.builder-section-nav [data-builder-section-link="review"]',
  1155 |     );
  1156 |     await expect(activeNavigation).toHaveAttribute("aria-current", "page");
  1157 |     await activeNavigation.scrollIntoViewIfNeeded();
  1158 |     await expect(activeNavigation).toBeInViewport();
  1159 |     await page.getByRole("button", { name: "Continue to Studio" }).scrollIntoViewIfNeeded();
  1160 |     await page.evaluate(() => window.scrollBy(0, 1_000));
  1161 |     const geometry = await page.evaluate(() => {
  1162 |       const footer = document.querySelector<HTMLElement>(".builder-footer");
  1163 |       const editor = document.querySelector<HTMLElement>(".builder-editor");
  1164 |       const controls = [
  1165 |         ...(editor?.querySelectorAll<HTMLElement>("button, input, textarea, select") ?? []),
  1166 |       ].filter((element) => element.getClientRects().length > 0);
  1167 |       const lastControl = controls.at(-1);
  1168 |       const dashboardContent = document.querySelector<HTMLElement>(".dashboard-content");
  1169 |       return {
  1170 |         bodyWidth: document.body.getBoundingClientRect().width,
  1171 |         clientWidth: document.documentElement.clientWidth,
  1172 |         dashboardContentBoxSizing: dashboardContent
  1173 |           ? getComputedStyle(dashboardContent).boxSizing
  1174 |           : "missing",
  1175 |         dashboardContentRect: dashboardContent
  1176 |           ? {
  1177 |               left: dashboardContent.getBoundingClientRect().left,
  1178 |               right: dashboardContent.getBoundingClientRect().right,
  1179 |               width: dashboardContent.getBoundingClientRect().width,
  1180 |             }
  1181 |           : null,
  1182 |         footerTop: footer?.getBoundingClientRect().top ?? 0,
  1183 |         innerWidth: window.innerWidth,
  1184 |         lastControlBottom: lastControl?.getBoundingClientRect().bottom ?? 0,
  1185 |         scrollX: window.scrollX,
  1186 |         viewportHeight: window.innerHeight,
  1187 |         documentOverflow:
  1188 |           document.documentElement.scrollWidth > document.documentElement.clientWidth,
  1189 |         overflowingElements: [...document.querySelectorAll<HTMLElement>("body *")]
  1190 |           .filter((element) => {
  1191 |             if (element.getClientRects().length === 0) return false;
  1192 |             const rect = element.getBoundingClientRect();
  1193 |             return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
  1194 |           })
  1195 |           .slice(0, 12)
  1196 |           .map((element) => {
  1197 |             const rect = element.getBoundingClientRect();
  1198 |             return {
  1199 |               className: element.className,
  1200 |               left: Math.round(rect.left * 10) / 10,
  1201 |               right: Math.round(rect.right * 10) / 10,
  1202 |               tagName: element.tagName,
  1203 |               text: element.textContent?.trim().slice(0, 80) ?? "",
  1204 |             };
  1205 |           }),
  1206 |       };
  1207 |     });
  1208 |     expect(
  1209 |       geometry.documentOverflow,
  1210 |       `${width}px horizontal overflow: ${JSON.stringify(geometry)}`,
  1211 |     ).toBe(false);
  1212 |     expect(
  1213 |       geometry.lastControlBottom <= geometry.footerTop - 4 ||
  1214 |         geometry.footerTop >= geometry.viewportHeight,
  1215 |       `${width}px footer overlap: ${JSON.stringify(geometry)}`,
  1216 |     ).toBe(true);
  1217 |   }
  1218 | });
  1219 | 
  1220 | test("coalesces sixty seconds of continuous editing into one save while rendering the preview locally", async ({
```