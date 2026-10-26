import type { ActionResult } from "@/lib/errors";
import { Alert } from "./index";

/** Mostra o resultado de uma Server Action (sucesso ou erro geral). */
export function FormMessage({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;
  if (state.ok) {
    return state.message ? <Alert tone="ok">{state.message}</Alert> : null;
  }
  return <Alert tone="seal">{state.error}</Alert>;
}
