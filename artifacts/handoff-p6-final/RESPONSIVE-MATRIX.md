# Responsive matrix

| Viewport | Library / Gallery | Builder | Studio / Launch | Dialogs | Result |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | Bounded content, 32 resolved templates | Stable edit/preview balance | Stable preview/action hierarchy | Centered, content-sized | Pass |
| 1280×800 | No excess stretch | Stable columns | No clipped panels | Centered | Pass |
| 1024×768 | No page overflow | Responsive columns | Studio moves to compact navigation before collision | Centered | Pass |
| 768×1024 | Tablet composition | Controls remain usable | No desktop-sidebar collision | Safe margins | Pass |
| 390×844 | Useful Gallery cards | Sticky Review bar clears bottom fields and safe area | Useful preview, wrapped URLs | Centered | Pass |
| 360×800 | No horizontal overflow | Focused bottom field scrolls above sticky bar | Compact navigation remains discoverable | Centered, no edge contact | Pass |

The Studio compact-layout threshold is `1100px`, preventing the 1024px sidebar/content collision observed during P6 audit.
