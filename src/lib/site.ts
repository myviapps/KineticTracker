/** Absolute origin — og:image and canonical must be absolute; several social
    scrapers reject relative URLs. VERCEL_URL is per-deployment, so not used. */
export const SITE_URL = (import.meta.env.VITE_SITE_URL ?? "http://localhost:5173").replace(/\/$/, "");
