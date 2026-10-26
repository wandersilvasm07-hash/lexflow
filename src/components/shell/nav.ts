import type { Permission } from "@/lib/authz/permissions";
import { t } from "@/i18n";

export type NavKey = keyof typeof t.nav;

export type NavItem = {
  key: NavKey;
  /** Segmento depois de /app/[org]. Vazio = dashboard. */
  segment: string;
  /** Permissão necessária para ver o item (verificada também no servidor). */
  permission: Permission;
  /** Fase do plano em que o módulo fica funcional. */
  phase: 1 | 2 | 3 | 4 | 5 | 6;
};

export type NavGroup = { label: string | null; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ key: "dashboard", segment: "", permission: "org.read", phase: 1 }],
  },
  {
    label: "Atendimento",
    items: [
      { key: "whatsapp", segment: "whatsapp", permission: "whatsapp.manage", phase: 2 },
      { key: "inbox", segment: "caixa-de-entrada", permission: "conversations.read", phase: 2 },
      { key: "contacts", segment: "contactos", permission: "contacts.read", phase: 2 },
      { key: "calendar", segment: "agenda", permission: "calendar.read", phase: 4 },
    ],
  },
  {
    label: "Conhecimento",
    items: [{ key: "knowledge", segment: "base-juridica", permission: "knowledge.read", phase: 3 }],
  },
  {
    label: "Captação",
    items: [
      { key: "ads", segment: "trafego-pago", permission: "campaigns.write", phase: 5 },
      { key: "campaigns", segment: "campanhas", permission: "campaigns.read", phase: 5 },
      { key: "reports", segment: "relatorios", permission: "reports.read", phase: 4 },
    ],
  },
  {
    label: "Escritório",
    items: [
      { key: "team", segment: "equipa", permission: "team.read", phase: 1 },
      { key: "billing", segment: "faturacao", permission: "billing.manage", phase: 6 },
      { key: "settings", segment: "configuracoes", permission: "org.read", phase: 1 },
    ],
  },
];

export const CURRENT_PHASE = 2;

export function navHref(orgSlug: string, item: Pick<NavItem, "segment">) {
  return item.segment ? `/app/${orgSlug}/${item.segment}` : `/app/${orgSlug}`;
}

export function findNavItem(key: NavKey): NavItem {
  for (const g of NAV) for (const i of g.items) if (i.key === key) return i;
  throw new Error(`nav item ${key} não existe`);
}
