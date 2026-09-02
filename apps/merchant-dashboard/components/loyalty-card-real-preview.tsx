"use client";

import { cardLocalePresentation } from "@waflo/contracts";
import { renderStampSvg } from "@waflo/stamp-engine";
import Image from "next/image";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import { MerchantBrandMark } from "./merchant-brand-mark";

export interface LoyaltyCardRealPreviewProps {
  programName: string;
  internalName?: string | undefined;
  requiredStampCount: number;
  rewardSummary?: string | undefined;
  visualTheme?:
    | {
        backgroundColor?: string | undefined;
        foregroundColor?: string | undefined;
        accentColor?: string | undefined;
        secondaryColor?: string | undefined;
        /** Historical values are normalized to Grid before display. */
        layoutType?: "ROW" | "GRID" | "PATH" | "RING" | undefined;
      }
    | null
    | undefined;
  locale: string;
  brandLogoUrl?: string | null | undefined;
  className?: string | undefined;
}

export function LoyaltyCardRealPreview({
  programName,
  internalName,
  requiredStampCount,
  rewardSummary,
  visualTheme,
  locale,
  brandLogoUrl,
  className = "",
}: LoyaltyCardRealPreviewProps) {
  const presentation = cardLocalePresentation(locale);
  const displayName =
    programName ||
    internalName ||
    (presentation.isRtl
      ? "\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0648\u0644\u0627\u0621"
      : "Loyalty card");
  const initial = displayName.charAt(0).toLocaleUpperCase(presentation.locale);
  const goal = Math.max(2, Math.min(30, Number(requiredStampCount) || 8));
  const layout = "GRID" as const;

  const backgroundColor = visualTheme?.backgroundColor || "#f7f4ee";
  const foregroundColor = visualTheme?.foregroundColor || "#241916";
  const accentColor = visualTheme?.accentColor || "#e4572E";
  const secondaryColor = visualTheme?.secondaryColor || "#f2e8dc";
  const stampSvgDataUri = useMemo(() => {
    try {
      const rendered = renderStampSvg({
        goal,
        progress: 0,
        layout,
        filledColor: accentColor,
        emptyColor: backgroundColor,
        accentColor,
        backgroundColor,
        foregroundColor,
        stampSize: 36,
        spacing: 6,
      });
      return `data:image/svg+xml;utf8,${encodeURIComponent(rendered.svg)}`;
    } catch {
      return null;
    }
  }, [goal, layout, accentColor, backgroundColor, foregroundColor]);

  return (
    <div
      className={`loyalty-card-real-preview ${className}`}
      lang={presentation.locale}
      dir={presentation.direction}
      style={
        {
          "--preview-bg": backgroundColor,
          "--preview-ink": foregroundColor,
          "--preview-accent": accentColor,
          "--preview-secondary": secondaryColor,
        } as CSSProperties
      }
      role="img"
      aria-label={`${presentation.isRtl ? "\u0645\u0639\u0627\u064a\u0646\u0629 \u062a\u0635\u0645\u064a\u0645 \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0648\u0644\u0627\u0621" : "Loyalty card design preview"}: ${displayName}`}
    >
      <div className="loyalty-card-real-preview__surface">
        {/* Header with initial brand badge & program name */}
        <div className="loyalty-card-real-preview__header">
          <MerchantBrandMark
            className="loyalty-card-real-preview__brand-badge"
            contentUrl={brandLogoUrl}
            fallback={initial}
            size={20}
          />
          <bdi className="loyalty-card-real-preview__title" dir="auto" title={displayName}>
            {displayName}
          </bdi>
        </div>

        {/* Real Stamp Artwork Seal */}
        <div className="loyalty-card-real-preview__body" aria-hidden="true">
          {stampSvgDataUri ? (
            <Image
              className="loyalty-card-real-preview__stamps-img"
              src={stampSvgDataUri}
              alt=""
              width={216}
              height={104}
              unoptimized
            />
          ) : (
            <div className="loyalty-card-real-preview__stamps-fallback">
              {["slot-0", "slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6", "slot-7"]
                .slice(0, Math.min(8, goal))
                .map((slotId) => (
                  <span
                    key={`${internalName}-${slotId}`}
                    className="loyalty-card-real-preview__stamp-dot"
                  />
                ))}
            </div>
          )}
        </div>

        {/* Footer with fraction & reward summary */}
        <div className="loyalty-card-real-preview__footer">
          <span dir="ltr" className="loyalty-card-real-preview__fraction numeric-fraction">
            0 / {goal}
          </span>
          {rewardSummary ? (
            <bdi className="loyalty-card-real-preview__reward" dir="auto" title={rewardSummary}>
              {rewardSummary}
            </bdi>
          ) : null}
        </div>
      </div>
    </div>
  );
}
