"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-5 text-center">
      <h1 className="text-xl font-semibold">Algo correu mal</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        Não foi possível carregar esta página. Tente novamente; se o problema continuar, contacte o suporte
        {error.digest ? ` indicando a referência ${error.digest}` : ""}.
      </p>
      <Button className="mt-6" onClick={reset}>
        Tentar novamente
      </Button>
    </div>
  );
}
