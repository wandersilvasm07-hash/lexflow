import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isPermission, isOrgRole, type OrgRole, type Permission } from "@/lib/authz/permissions";
import { cookies } from "next/headers";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Camada de acesso a dados (DAL): o único sítio onde se lê a sessão e se
 * resolve o contexto do escritório. Páginas e ações usam estas funções em vez
 * de consultar a sessão diretamente.
 */

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string | null;
  /** Nível de garantia da sessão: aal2 = autenticação de dois fatores concluída. */
  aal: "aal1" | "aal2";
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  await cookies(); // pedido dinâmico, mesmo sem Supabase configurado
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", claims.sub)
    .maybeSingle();

  return {
    id: claims.sub,
    email: (claims.email as string | undefined) ?? "",
    fullName: profile?.full_name ?? null,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
  };
});

export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/entrar?next=${encodeURIComponent(next)}` : "/entrar");
  return user;
}

export type OrgSummary = { id: string; name: string; slug: string; role: OrgRole };

/** Escritórios ativos do utilizador (o RLS só devolve os seus). */
export const listMyOrganizations = cache(async (): Promise<OrgSummary[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("role, organizations!inner(id, name, slug)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at");
  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    const org = row.organizations as unknown as { id: string; name: string; slug: string } | null;
    if (!org || !isOrgRole(row.role)) return [];
    return [{ id: org.id, name: org.name, slug: org.slug, role: row.role }];
  });
});

export type Organization = {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  nif: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  default_locale: string;
  require_mfa: boolean;
  created_at: string;
};

export type OrgContext = {
  user: CurrentUser;
  org: Organization;
  role: OrgRole;
  permissions: ReadonlySet<Permission>;
};

/**
 * Resolve o escritório pelo endereço (slug) e confirma que o utilizador é
 * membro ativo. Se não for, devolve 404 — não revelamos que o escritório existe.
 */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const user = await requireUser(`/app/${slug}`);
  const supabase = await createClient();

  const { data: org, error } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, legal_name, nif, email, phone, address, timezone, default_locale, require_mfa, created_at",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!org) notFound();

  const [{ data: membership }, { data: perms, error: permError }] = await Promise.all([
    supabase
      .from("memberships")
      .select("role")
      .eq("organization_id", org.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    supabase.rpc("my_permissions", { p_org: org.id }),
  ]);
  if (permError) throw permError;
  // Administradores da plataforma veem metadados mas não entram no escritório.
  if (!membership || !isOrgRole(membership.role)) notFound();

  if (org.require_mfa && user.aal !== "aal2") {
    redirect(`/app/conta/seguranca?mfa=obrigatorio&escritorio=${encodeURIComponent(slug)}`);
  }

  const permissions = new Set(((perms as string[] | null) ?? []).filter(isPermission));
  return { user, org: org as Organization, role: membership.role, permissions };
});

export function can(ctx: OrgContext, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export class PermissionError extends Error {
  constructor(public readonly permission: Permission) {
    super("forbidden");
  }
}

/** Para Server Actions: falha antes de qualquer escrita se faltar a permissão. */
export function assertCan(ctx: OrgContext, permission: Permission) {
  if (!can(ctx, permission)) throw new PermissionError(permission);
}

/**
 * Administrador da plataforma (equipa que opera o produto): gere a base
 * jurídica comum. Não dá acesso a dados de clientes dos escritórios.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return Boolean(data);
});
