"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Atualiza os dados do servidor periodicamente enquanto o separador está visível. */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      // Não interrompe quem está a escrever.
      const active = document.activeElement;
      if (document.visibilityState === "visible" && !(active instanceof HTMLTextAreaElement && active.value)) {
        router.refresh();
      }
    };
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
