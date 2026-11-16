import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-manrope)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-fraunces)", "ui-serif", "Georgia", "serif"],
      },
      colors: {
        surface: {
          DEFAULT: "var(--nx-bg)",
          elevated: "var(--nx-surface)",
          border: "var(--nx-border)",
        },
        ink: {
          DEFAULT: "var(--nx-ink)",
          muted: "var(--nx-muted)",
        },
        accent: {
          DEFAULT: "var(--nx-accent)",
          muted: "var(--nx-accent-hover)",
          soft: "var(--nx-accent-soft)",
        },
      },
      boxShadow: {
        nx: "0 1px 2px rgba(21, 26, 24, 0.04), 0 8px 24px rgba(21, 26, 24, 0.06)",
      },
      borderRadius: {
        nx: "0.75rem",
      },
    },
  },
  plugins: [],
};

export default config;
