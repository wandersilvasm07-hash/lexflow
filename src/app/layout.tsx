import type { Metadata, Viewport } from "next";
import { APP } from "@/config/app";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${APP.name} — ${APP.tagline}`, template: `%s · ${APP.name}` },
  description:
    "Atendimento por WhatsApp com IA, gestão de contactos, agenda e campanhas para escritórios de advocacia em Portugal.",
  applicationName: APP.name,
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#15302a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-PT" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
