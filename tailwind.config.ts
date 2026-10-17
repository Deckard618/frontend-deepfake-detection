import type { Config } from "tailwindcss";

const color = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: color("bg"),
        fg: color("fg"),
        card: color("card"),
        muted: color("muted"),
        border: color("border"),
        accent: color("accent"),
        fake: color("fake"),
        real: color("real"),
      },
    },
  },
} satisfies Config;
