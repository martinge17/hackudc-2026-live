import type { Config } from "@react-router/dev/config";

export default {
  // SPA mode for static hosting (e.g. GitHub Pages); SSR when GITHUB_PAGES is unset
  ssr: process.env.GITHUB_PAGES !== "true",
} satisfies Config;
