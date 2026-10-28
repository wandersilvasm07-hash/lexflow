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
    background_color: "#f5f4f0",
    theme_color: "#142b3b",
    lang: "pt-PT",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
