/**
 * Matriz de papéis e permissões.
 *
 * Fonte de verdade espelhada na tabela `public.role_permissions` (migração de
 * fundação). O teste `tests/db/permissions-sync.test.ts` falha se divergirem.
 * A autorização efetiva é SEMPRE verificada no servidor (RLS + RPC); esta matriz
 * serve também para a interface esconder ações que o utilizador não pode fazer.
 */

export const ORG_ROLES = [
  "org_admin",
  "lawyer",
  "legal_assistant",
  "marketing_manager",
  "viewer",
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSIONS = [
  "org.read",
  "org.update",
  "team.read",
  "team.manage",
  "audit.read",
  "billing.manage",
  "settings.manage",
  "whatsapp.manage",
  "conversations.read",
  "conversations.reply",
  "conversations.assign",
  "contacts.read",
  "contacts.write",
  "contacts.export",
  "contacts.delete",
  "calendar.read",
  "calendar.write",
  "knowledge.read",
  "knowledge.write",
  "knowledge.approve",
  "campaigns.read",
  "campaigns.write",
  "campaigns.publish",
  "reports.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  org_admin: PERMISSIONS,
  lawyer: [
    "org.read",
    "team.read",
    "conversations.read",
    "conversations.reply",
    "conversations.assign",
    "contacts.read",
    "contacts.write",
    "contacts.export",
    "contacts.delete",
    "calendar.read",
    "calendar.write",
    "knowledge.read",
    "knowledge.write",
    "knowledge.approve",
    "campaigns.read",
    "reports.read",
  ],
  legal_assistant: [
    "org.read",
    "team.read",
    "conversations.read",
    "conversations.reply",
    "contacts.read",
    "contacts.write",
    "calendar.read",
    "calendar.write",
    "knowledge.read",
    "knowledge.write",
  ],
  // Separação entre atendimento e publicidade: sem acesso a conversas/contactos.
  marketing_manager: [
    "org.read",
    "team.read",
    "campaigns.read",
    "campaigns.write",
    "campaigns.publish",
    "reports.read",
  ],
  viewer: ["org.read", "team.read", "calendar.read", "reports.read"],
};

export function roleHasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Papéis que um administrador pode atribuir por convite ou alteração. */
export const ASSIGNABLE_ROLES: readonly OrgRole[] = ORG_ROLES;
