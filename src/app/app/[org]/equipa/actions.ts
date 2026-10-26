"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/lib/auth/action";
import { ORG_ROLES } from "@/lib/authz/permissions";
import { getAppUrl } from "@/lib/env";
import type { ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, inviteSchema } from "@/lib/validation";

const uuid = z.uuid();

export async function inviteMemberAction(
  _: ActionResult<{ link: string; email: string }> | null,
  form: FormData,
): Promise<ActionResult<{ link: string; email: string }>> {
  return orgAction(form, "team.manage", async (ctx) => {
    const parsed = inviteSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("create_invitation", {
        p_org: ctx.org.id,
        p_email: parsed.data.email,
        p_role: parsed.data.role,
      })
      .single<{ invitation_id: string; token: string; expires_at: string }>();
    if (error) throw error;

    revalidatePath(`/app/${ctx.org.slug}/equipa`);
    return {
      ok: true,
      data: { link: `${getAppUrl()}/convite/${data.token}`, email: parsed.data.email },
    };
  });
}

export async function revokeInvitationAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "team.manage", async (ctx) => {
    const id = uuid.parse(form.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_invitation", { p_invitation: id });
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/equipa`);
    return { ok: true, message: "Convite cancelado." };
  });
}

export async function changeRoleAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "team.manage", async (ctx) => {
    const id = uuid.parse(form.get("id"));
    const role = z.enum(ORG_ROLES).parse(form.get("role"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("change_member_role", { p_membership: id, p_role: role });
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/equipa`);
    return { ok: true, message: "Papel atualizado." };
  });
}

export async function setStatusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "team.manage", async (ctx) => {
    const id = uuid.parse(form.get("id"));
    const status = z.enum(["active", "suspended"]).parse(form.get("status"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_member_status", { p_membership: id, p_status: status });
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/equipa`);
    return { ok: true, message: status === "active" ? "Acesso reativado." : "Acesso suspenso." };
  });
}

export async function removeMemberAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "team.manage", async (ctx) => {
    const id = uuid.parse(form.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_member", { p_membership: id });
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/equipa`);
    return { ok: true, message: "Membro removido do escritório." };
  });
}
