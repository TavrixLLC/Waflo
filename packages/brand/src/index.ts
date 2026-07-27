export const brandColors = {
  brick: "#AE3115",
  coral: "#FF6B4A",
  ember: "#7D2311",
  ink: "#241916",
  soft: "#FFF0EC",
  cloud: "#F7F9FF",
  white: "#FFFFFF",
  muted: "#76645F",
  success: "#1F8F6A",
  warning: "#E6A23C",
  danger: "#C93C2B",
} as const;

export const brandTypography = {
  latin: "Manrope, system-ui, sans-serif",
  arabic: "Noto Sans Arabic, system-ui, sans-serif",
  weights: [400, 500, 600, 700, 800],
  scale: {
    display: { size: "3rem", lineHeight: "3.5rem", weight: 800 },
    h1: { size: "2.25rem", lineHeight: "2.75rem", weight: 800 },
    h2: { size: "1.75rem", lineHeight: "2.25rem", weight: 700 },
    body: { size: "1rem", lineHeight: "1.625rem", weight: 400 },
    label: { size: "0.875rem", lineHeight: "1.25rem", weight: 600 },
    caption: { size: "0.75rem", lineHeight: "1.125rem", weight: 500 },
  },
} as const;

export const brandSpacing = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
  "3xl": "4rem",
} as const;

export const brandRadii = {
  sm: "8px",
  md: "14px",
  lg: "22px",
  xl: "32px",
  pill: "999px",
} as const;

export const brandShadows = {
  card: "0 12px 32px rgba(36, 25, 22, 0.10)",
  raised: "0 18px 48px rgba(36, 25, 22, 0.14)",
} as const;

export const brandMotion = {
  quick: "160ms",
  standard: "200ms",
  reassuring: "240ms",
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

export const brandAssets = {
  logoPrimary: "/brand/waflo-logo-primary-horizontal.svg",
  logoDarkSurface: "/brand/waflo-logo-white-horizontal.svg",
  mark: "/brand/waflo-mark-primary.svg",
  favicon: "/brand/favicon.svg",
  openGraph: "/brand/waflo-open-graph-1200x630.png",
} as const;
