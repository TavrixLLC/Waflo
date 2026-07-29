# Platform capability matrix

The typed source is `packages/contracts/src/platform-capabilities.ts`. Studio guidance, validation context, preview warnings, and this documentation share the same capability vocabulary.

Legend: **Supported** is directly rendered; **Mapped** is represented in a platform-appropriate region; **Unsupported** is not used and must be explained.

| Feature | Customer Web | Apple Wallet preview | Google Wallet preview |
| --- | --- | --- | --- |
| Logo | Supported | Supported | Supported |
| Hero artwork | Supported | Unsupported | Supported |
| Background artwork | Supported | Unsupported | Unsupported |
| Background color | Supported | Supported | Mapped |
| Foreground color | Supported | Supported | Mapped |
| Text fields | Supported | Supported | Supported |
| Back content | Mapped | Supported | Mapped |
| Links | Supported | Mapped | Mapped |
| Location metadata | Supported | Mapped | Mapped |
| Expiry presentation | Supported | Mapped | Mapped |
| Custom stamp artwork | Supported | Supported | Supported |
| Barcode region | Unsupported | Supported preview placeholder | Supported preview placeholder |

## Selected background behavior

- Customer Web embeds the processed background variant behind the card with a readability overlay.
- Apple states that pass colors are used and selected background artwork is not used.
- Google states that the hero region is used and selected background artwork is not used.

The Studio displays the capability matrix per platform, and unsupported selected options generate explicit preview warnings. W2 remains preview-only for Apple and Google; no wallet pass is issued.

