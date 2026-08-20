"use client";

import type { Locale } from "@waflo/contracts";
import { renderStampSvg } from "@waflo/stamp-engine";
import Image from "next/image";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { apiUrl } from "../lib/api-client";

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
        layoutType?: "ROW" | "GRID" | "PATH" | "RING" | undefined;
      }
    | null
    | undefined;
  locale: Locale;
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
  const ar = locale === "ar";
  const displayName = programName || internalName || (ar ? "بطاقة الولاء" : "Loyalty card");
  const initial = displayName.charAt(0).toLocaleUpperCase(ar ? "ar" : "en");
  const goal = Math.max(2, Math.min(30, Number(requiredStampCount) || 8));
  const layout = visualTheme?.layoutType ?? "ROW";

  const backgroundColor = visualTheme?.backgroundColor || "#f7f4ee";
  const foregroundColor = visualTheme?.foregroundColor || "#241916";
  const accentColor = visualTheme?.accentColor || "#e4572E";
  const secondaryColor = visualTheme?.secondaryColor || "#f2e8dc";
  const [unavailableLogoUrl, setUnavailableLogoUrl] = useState<string | null>(null);

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
      dir={ar ? "rtl" : "ltr"}
      style={
        {
          "--preview-bg": backgroundColor,
          "--preview-ink": foregroundColor,
          "--preview-accent": accentColor,
          "--preview-secondary": secondaryColor,
        } as CSSProperties
      }
      role="img"
      aria-label={`${ar ? "معاينة تصميم بطاقة الولاء" : "Loyalty card design preview"}: ${displayName}`}
    >
      <div className="loyalty-card-real-preview__surface">
        {/* Header with initial brand badge & program name */}
        <div className="loyalty-card-real-preview__header">
          {brandLogoUrl && unavailableLogoUrl !== brandLogoUrl ? (
            <span className="loyalty-card-real-preview__brand-badge" aria-hidden="true">
              <Image
                src={`${apiUrl}${brandLogoUrl}`}
                alt=""
                width={20}
                height={20}
                unoptimized
                onError={() => setUnavailableLogoUrl(brandLogoUrl)}
              />
            </span>
          ) : (
            <span className="loyalty-card-real-preview__brand-badge" aria-hidden="true">
              {initial}
            </span>
          )}
          <span className="loyalty-card-real-preview__title" title={displayName}>
            {displayName}
          </span>
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
            <span className="loyalty-card-real-preview__reward" title={rewardSummary}>
              {rewardSummary}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
