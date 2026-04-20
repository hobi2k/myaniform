import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 다크 네이비/그레이 — 저채도로 장시간 편집에도 눈이 편함
        surface: {
          DEFAULT: "#0d1117",
          raised:  "#161b22",
          overlay: "#21262d",
          sunken:  "#010409",
        },
        // 부드러운 코랄 액센트
        accent: {
          DEFAULT: "#ff7a90",
          hover:   "#ff5f7a",
          muted:   "rgba(255,122,144,0.18)",
        },
        // 씬 타입 스워치
        lipsync: "#7aa2ff",
        loop:    "#4ade80",
        effect:  "#fbbf24",
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Noto Sans KR",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.2)",
        "card-hover": "0 4px 24px rgba(255,122,144,0.12)",
      },
      animation: {
        "fade-in": "fadeIn .2s ease-out",
        shimmer: "shimmer 1.4s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
