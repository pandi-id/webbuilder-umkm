import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Same token names the editor canvas uses, backed by HSL vars that
      // lib/theme.ts emits from the site theme — so `bg-card`, `bg-muted/30`,
      // `text-foreground` produce real CSS here, not nothing.
      colors: {
        background: "hsl(var(--wb-bg-hsl) / <alpha-value>)",
        foreground: "hsl(var(--wb-fg-hsl) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--wb-bg-hsl) / <alpha-value>)",
          foreground: "hsl(var(--wb-fg-hsl) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--wb-muted-hsl) / <alpha-value>)",
          foreground: "hsl(var(--wb-muted-fg-hsl) / <alpha-value>)",
        },
        border: "hsl(var(--wb-border-hsl) / <alpha-value>)",
        input: "hsl(var(--wb-border-hsl) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
export default config;
