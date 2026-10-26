"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { fail, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvitationAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const token = String(form.get("token") ?? "");
  await requireUser(`/convite/${token}`);
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, error: "Convite inválido." };

  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return fail(error);

  const { data: org } = await supabase.from("organizations").select("slug").eq("id", orgId).single();
  redirect(org ? `/app/${org.slug}` : "/app");
}
