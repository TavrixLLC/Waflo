import type { Page, Route } from "@playwright/test";
import { artworkFor } from "../../apps/api/src/programs/library-artwork.js";
import {
  renderTemplateGalleryPreviews,
  renderTemplateGalleryThumbnail,
} from "../../apps/api/src/programs/template-gallery-preview.js";
import type { TemplateItem } from "../../apps/merchant-dashboard/components/program-studio-types.js";
import { findProgramTemplate, latestProgramTemplates } from "../../packages/contracts/src/index.js";

export const templateGalleryOrganizationId = "merchant-template-gallery-fixture";

function artworkPreviewUrl(content: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(content, "utf8").toString("base64")}`;
}

export function templateGalleryFixtures(locale: "EN" | "AR" = "EN"): TemplateItem[] {
  return latestProgramTemplates().map((template) => ({
    ...template,
    galleryThumbnail: renderTemplateGalleryThumbnail(template, locale),
    ...(template.code === "GENERAL_VISITS"
      ? { blankGalleryThumbnail: renderTemplateGalleryThumbnail(template, locale, "BLANK") }
      : {}),
    artwork: {
      filled: {
        ...template.artwork.filled,
        previewUrl: artworkPreviewUrl(artworkFor(template.artwork.filled)?.content ?? ""),
      },
      empty: {
        ...template.artwork.empty,
        previewUrl: artworkPreviewUrl(artworkFor(template.artwork.empty)?.content ?? ""),
      },
      milestone: {
        ...template.artwork.milestone,
        previewUrl: artworkPreviewUrl(artworkFor(template.artwork.milestone)?.content ?? ""),
      },
    },
  }));
}

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "http://localhost:3001",
      "access-control-allow-credentials": "true",
    },
    body: JSON.stringify({ data, requestId: "merchant-template-gallery-test" }),
  });
}

export async function mockTemplateGalleryApi(
  page: Page,
  {
    businessCategory = "Cafe",
    onCreate,
    onPreviewRequest,
  }: {
    businessCategory?: string | null;
    onCreate?: (body: Record<string, unknown>) => void;
    onPreviewRequest?: (templateCode: string, presentation: string) => void;
  } = {},
): Promise<void> {
  await page.route("http://localhost:4000/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/v1/auth/csrf") {
      await fulfill(route, { csrfToken: "merchant-template-gallery-csrf" });
      return;
    }
    if (path === "/v1/auth/me") {
      await fulfill(route, {
        id: "merchant-template-gallery-owner",
        displayName: "Gallery Merchant",
        email: "gallery@example.test",
        preferredLocale: "EN",
        lastSelectedOrganizationId: templateGalleryOrganizationId,
        memberships: [
          {
            id: "merchant-template-gallery-membership",
            role: "OWNER",
            organization: {
              id: templateGalleryOrganizationId,
              name: "Gallery Coffee",
              merchantSlug: "gallery-coffee",
              defaultLocale: "EN",
              selectedPlan: "GROWTH",
              onboardingState: "COMPLETE",
            },
          },
        ],
      });
      return;
    }
    if (path === `/v1/organizations/${templateGalleryOrganizationId}`) {
      await fulfill(route, { id: templateGalleryOrganizationId, businessCategory });
      return;
    }
    if (path.endsWith("/programs/templates")) {
      await fulfill(
        route,
        templateGalleryFixtures(url.searchParams.get("locale") === "AR" ? "AR" : "EN"),
      );
      return;
    }
    const previewMatch = path.match(/\/programs\/templates\/([^/]+)\/previews$/u);
    if (previewMatch) {
      const templateCode = decodeURIComponent(previewMatch[1] ?? "");
      const versionValue = url.searchParams.get("version");
      const version = versionValue ? Number(versionValue) : undefined;
      const template = findProgramTemplate(templateCode, version);
      if (!template) {
        await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        return;
      }
      const locale = url.searchParams.get("locale") === "AR" ? "AR" : "EN";
      const presentation = url.searchParams.get("presentation") === "BLANK" ? "BLANK" : "TEMPLATE";
      onPreviewRequest?.(templateCode, presentation);
      await fulfill(route, renderTemplateGalleryPreviews(template, locale, presentation));
      return;
    }
    if (path.endsWith("/programs") && request.method() === "GET") {
      await fulfill(route, { items: [], nextCursor: null });
      return;
    }
    if (path.endsWith("/programs") && request.method() === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      onCreate?.(body);
      await fulfill(route, {
        id: "created-program-id",
        internalName: body.internalName,
        status: "DRAFT",
        currentDraftVersion: null,
        currentPublishedVersion: null,
      });
      return;
    }
    if (path.endsWith("/locations")) {
      await fulfill(route, {
        items: [{ id: "gallery-location", name: "Gallery Main Branch", status: "ACTIVE" }],
      });
      return;
    }
    if (path.endsWith("/assets")) {
      await fulfill(route, { items: [], nextCursor: null });
      return;
    }
    if (path.endsWith("/wallet/providers")) {
      await fulfill(route, []);
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}
