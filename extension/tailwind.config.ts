import type { Config } from "tailwindcss";
import site from "../tailwind.config";

// The website's theme, for the extension's pages and the site components they reuse.
export default {
  ...site,
  content: { relative: true, files: ["./entrypoints/**/*.{html,tsx}", "../src/components/**/*.tsx"] },
} satisfies Config;
