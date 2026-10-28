import type { Instrumentation } from "next";

/**
 * Monitorização de erros do servidor: cada erro não tratado fica registado em
 * formato estruturado (visível nos registos da Vercel, filtráveis por
 * "[erro]"). Não inclui corpo de pedidos, cookies nem dados pessoais.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  console.error(
    "[erro]",
    JSON.stringify({
      message: e.message?.slice(0, 500),
      digest: e.digest,
      method: request.method,
      path: request.path.split("?")[0],
      route: context.routePath,
      type: context.routeType,
      at: new Date().toISOString(),
    }),
  );
};
