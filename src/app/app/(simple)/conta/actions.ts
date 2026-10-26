"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/dal";
import { fail, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, profileSchema } from "@/lib/validation";

export async function updateProfileAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser("/app/conta");
  const parsed = profileSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", user.id);
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Perfil atualizado." };
}
