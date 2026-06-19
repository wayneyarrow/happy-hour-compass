import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      boxShadow: {
        // Three-tier elevation system — use these instead of shadow-sm/md/lg for cards.
        // resting: standard cards, form sections, control panel tables
        // raised:  KPI cards, feature cards, interactive surfaces
        // hover:   interactive cards on pointer-over
        resting: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        raised:  "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
        hover:   "0 8px 24px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
