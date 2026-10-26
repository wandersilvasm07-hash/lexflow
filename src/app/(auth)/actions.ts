"use server";

import { redirect } from "next/navigation";
import { getAppUrl, isSupabaseConfigured } from "@/lib/env";
import { fail, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import {
  emailOnlySchema,
  fieldErrors,
  newPasswordSchema,
  safeNextPath,
  signInSchema,
  signUpSchema,
} from "@/lib/validation";
import { t } from "@/i18n";

function notConfigured(): ActionResult {
  return { ok: false, error: t.errors.not_configured };
}

export async function signUpAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
  }

  const next = safeNextPath(form.get("next")?.toString(), "/app");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${getAppUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return fail(error);

  // Com confirmação de email ativa (recomendado), não há sessão até confirmar.
  if (!data.session) {
    return {
      ok: true,
      message: `Enviámos um email para ${parsed.data.email}. Abra o link para confirmar a conta.`,
    };
  }
  redirect(next);
}

export async function signInAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return fail(error);

  const next = safeNextPath(parsed.data.next);
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/entrar/verificacao?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function signOutAction() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/entrar");
}

export async function requestPasswordResetAction(
  _: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = emailOnlySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, error: "Indique um email válido.", fieldErrors: fieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getAppUrl()}/auth/confirm?next=/redefinir-palavra-passe`,
  });
  // Resposta igual quer o email exista ou não, para não revelar contas.
  if (error && error.code !== "user_not_found") return fail(error);
  return {
    ok: true,
    message: "Se existir uma conta com esse email, receberá um link para definir nova palavra-passe.",
  };
}

export async function updatePasswordAction(
  _: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(error);
  redirect("/app?palavra-passe=alterada");
}

export async function verifyMfaAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^[0-9]{6}$/.test(code)) {
    return { ok: false, error: "Indique o código de 6 dígitos.", fieldErrors: { code: "Código inválido." } };
  }
  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return fail(listError);
  const factor = factors.totp.find((f) => f.status === "verified");
  if (!factor) return { ok: false, error: "Não há nenhuma aplicação de autenticação associada." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return fail(error);
  redirect(safeNextPath(form.get("next")?.toString()));
}
