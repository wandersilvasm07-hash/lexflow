import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { Permission } from "@/lib/authz/permissions";
import { fail, type ActionResult } from "@/lib/errors";
import { assertCan, getOrgContext, PermissionError, type OrgContext } from "./dal";
import { t } from "@/i18n";

/**
 * Envolve uma Server Action de um escritório:
 *  1. resolve o escritório e confirma que o utilizador é membro ativo;
 *  2. verifica a permissão ANTES de qualquer escrita;
 *  3. converte erros em mensagens claras.
 * A base de dados volta a verificar tudo (RLS/RPC): defesa em profundidade.
 */
export async function orgAction<T>(
  form: FormData,
  permission: Permission,
  fn: (ctx: OrgContext) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const slug = String(form.get("org") ?? "");
    if (!slug) return { ok: false, error: t.errors.generic };
    const ctx = await getOrgContext(slug);
    assertCan(ctx, permission);
    return await fn(ctx);
  } catch (error) {
    unstable_rethrow(error); // redirect()/notFound() do Next seguem o seu curso
    if (error instanceof PermissionError) return { ok: false, error: t.errors.forbidden };
    return fail(error);
  }
}
