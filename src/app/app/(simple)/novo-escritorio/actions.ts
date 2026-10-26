"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { fail, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { createOrgSchema, fieldErrors } from "@/lib/validation";

export async function createOrganizationAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser("/app/novo-escritorio");
  const parsed = createOrgSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  // RPC atómica: cria o escritório, torna o utilizador administrador e audita.
  const { error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });
  if (error) {
    const result = fail(error);
    if (error.message.includes("slug_taken") && !result.ok) {
      return { ...result, fieldErrors: { slug: result.error } };
    }
    return result;
  }
  redirect(`/app/${parsed.data.slug}`);
}
