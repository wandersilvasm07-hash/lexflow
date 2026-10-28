"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orgAction } from "@/lib/auth/action";
import type { ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, orgProfileSchema } from "@/lib/validation";

export async function updateOrgProfileAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "org.update", async (ctx) => {
    const parsed = orgProfileSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
    }
    const supabase = await createClient();
    const { error, count } = await supabase
      .from("organizations")
      .update(parsed.data, { count: "exact" })
      .eq("id", ctx.org.id);
    if (error) throw error;
    if (count === 0) return { ok: false, error: "Não foi possível guardar: sem permissão." };

    await supabase.rpc("log_audit_event", {
      p_org: ctx.org.id,
      p_action: "organization.profile_updated",
      p_entity_type: "organization",
      p_entity_id: ctx.org.id,
      p_metadata: { fields: Object.keys(parsed.data) },
    });
    revalidatePath(`/app/${ctx.org.slug}`, "layout");
    return { ok: true, message: "Alterações guardadas." };
  });
}

export async function updateOrgSecurityAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "settings.manage", async (ctx) => {
    const requireMfa = form.get("require_mfa") === "on";
    if (requireMfa && ctx.user.aal !== "aal2") {
      return {
        ok: false,
        error:
          "Ative e use primeiro a verificação em dois passos na sua conta, para não perder o acesso ao escritório.",
      };
    }
    const supabase = await createClient();
    const { error } = await supabase
      .from("organizations")
      .update({ require_mfa: requireMfa })
      .eq("id", ctx.org.id);
    if (error) throw error;

    await supabase.rpc("log_audit_event", {
      p_org: ctx.org.id,
      p_action: "security.mfa_policy_changed",
      p_entity_type: "organization",
      p_entity_id: ctx.org.id,
      p_metadata: { require_mfa: requireMfa },
    });
    revalidatePath(`/app/${ctx.org.slug}`, "layout");
    return {
      ok: true,
      message: requireMfa
        ? "A verificação em dois passos passou a ser obrigatória para toda a equipa."
        : "A verificação em dois passos deixou de ser obrigatória.",
    };
  });
}

export async function updateRetentionAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "org.update", async (ctx) => {
    const months = Number(form.get("months"));
    if (!Number.isInteger(months) || months < 6 || months > 120) {
      return { ok: false, error: "Escolha um prazo entre 6 e 120 meses.", fieldErrors: { months: "Entre 6 e 120 meses." } };
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_retention", { p_org: ctx.org.id, p_months: months });
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/configuracoes/dados`);
    return { ok: true, message: "Prazo de conservação guardado. Fica no registo de atividade." };
  });
}

export async function deleteOrganizationAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const result = await orgAction<undefined>(form, "org.delete", async (ctx) => {
    const confirm = String(form.get("confirm") ?? "");
    const reason = String(form.get("reason") ?? "").trim().slice(0, 500);
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_organization", { p_org: ctx.org.id, p_confirm_slug: confirm, p_reason: reason || null });
    if (error) {
      const m = error.message;
      if (m.includes("confirmation_mismatch")) return { ok: false, error: "O endereço escrito não corresponde ao do escritório.", fieldErrors: { confirm: "Não corresponde." } };
      if (m.includes("campaigns_running")) return { ok: false, error: "Há campanhas ativas na Meta. Termine-as primeiro em Campanhas." };
      if (m.includes("subscription_active")) return { ok: false, error: "Há uma subscrição paga ativa. Cancele-a primeiro em Faturação › Gerir subscrição." };
      throw error;
    }
    return { ok: true };
  });
  if (result.ok) redirect("/app?eliminado=1");
  return result;
}
