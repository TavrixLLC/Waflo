import type { Config } from "tailwindcss";

const wafloPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        waflo: {
          brick: "#AE3115",
          coral: "#FF6B4A",
          ember: "#7D2311",
          ink: "#241916",
          soft: "#FFF0EC",
          cloud: "#F7F9FF",
          white: "#FFFFFF",
        },
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        arabic: ["Noto Sans Arabic", "system-ui", "sans-serif"],
      },
      borderRadius: {
        waflo: "22px",
      },
      boxShadow: {
        waflo: "0 12px 32px rgba(36, 25, 22, 0.10)",
      },
    },
  },
};

export default wafloPreset;
