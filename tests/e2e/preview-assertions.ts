import { expect, type Locator } from "@playwright/test";

export function builderPreviewMedia(preview: Locator): Locator {
  return preview.locator(".builder-preview-canvas").getByRole("img");
}

export async function expectBuilderPreviewReady(
  preview: Locator,
  expectedLocale?: string,
): Promise<Locator> {
  const media = builderPreviewMedia(preview);
  await expect(media).toBeVisible();
  await expect
    .poll(() =>
      media.evaluate((element, locale) => {
        if (element instanceof HTMLCanvasElement) {
          return element.dataset.previewReady === "true" && element.width > 0 && element.height > 0;
        }
        if (!(element instanceof HTMLImageElement)) return false;
        if (!element.complete || element.naturalWidth <= 0) return false;
        if (!locale) return true;
        const encodedSvg = element.currentSrc.split(",", 2)[1];
        return Boolean(
          encodedSvg && decodeURIComponent(encodedSvg).includes(`<svg lang="${locale}"`),
        );
      }, expectedLocale ?? null),
    )
    .toBe(true);
  return media;
}
