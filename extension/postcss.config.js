import { fileURLToPath } from "node:url";

// Same plugins as the website (resolved from its node_modules), with the extension's Tailwind config.
export default {
  plugins: {
    tailwindcss: { config: fileURLToPath(new URL("tailwind.config.ts", import.meta.url)) },
    autoprefixer: {},
  },
};
