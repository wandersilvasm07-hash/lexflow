import type { MetadataRoute } from "next";
import { APP } from "@/config/app";

// Base para PWA instalável. O service worker (modo offline) entra na Fase 6.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP.name,
    short_name: APP.name,
    description: APP.tagline,
    start_url: "/app",
    display: "standalone",
    background_color: "#f4f6f5",
    theme_color: "#15302a",
    lang: "pt-PT",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
