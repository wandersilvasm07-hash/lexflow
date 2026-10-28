"use client";

import { Bell, ChevronsUpDown, LogOut, Menu, Search, ShieldCheck, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/components/ui";
import { t } from "@/i18n";
import { CURRENT_PHASE, NAV, navHref, type NavKey } from "./nav";
import { NAV_ICONS } from "./nav-icons";

type OrgOption = { slug: string; name: string };

export type ShellProps = {
  org: OrgOption & { roleLabel: string };
  orgs: OrgOption[];
  allowed: NavKey[];
  user: { name: string; email: string };
  signOut: () => Promise<void>;
  children: ReactNode;
};

export function AppShell({ org, orgs, allowed, user, signOut, children }: ShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Fundo do menu móvel */}
      {open ? (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-ink text-white transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Navegação principal"
      >
        <div className="flex h-16 items-center justify-between border-b border-white/[0.06] px-5">
          <Link href={`/app/${org.slug}`}>
            <Logo inverted />
          </Link>
          <button
            className="rounded p-1 text-white/70 hover:text-white lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <OrgSwitcher current={org} orgs={orgs} />

        <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="Módulos">
          {NAV.map((group, gi) => {
            const items = group.items.filter((i) => allowed.includes(i.key));
            if (items.length === 0) return null;
            return (
              <div key={gi} className="mt-6 first:mt-4">
                {group.label ? (
                  <p className="mb-1.5 px-3 text-[0.6875rem] font-medium tracking-[0.12em] text-white/40 uppercase">{group.label}</p>
                ) : null}
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const href = navHref(org.slug, item);
                    const active = item.segment
                      ? pathname === href || pathname.startsWith(`${href}/`)
                      : pathname === href;
                    const Icon = NAV_ICONS[item.key];
                    return (
                      <li key={item.key}>
                        <Link
                          href={href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "relative flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors",
                            active
                              ? "bg-white/[0.08] font-medium text-white before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-gold"
                              : "text-white/70 hover:bg-white/[0.05] hover:text-white",
                          )}
                        >
                          <Icon className={cn("size-[1.05rem] shrink-0", active ? "text-gold" : "text-white/55")} aria-hidden="true" />
                          <span className="flex-1">{t.nav[item.key]}</span>
                          {item.phase > CURRENT_PHASE ? (
                            <span
                              className="rounded-full border border-white/15 px-1.5 text-[0.625rem] text-white/45"
                              title={`Disponível na fase ${item.phase} do desenvolvimento`}
                            >
                              F{item.phase}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-8">
          <button
            className="-ml-1 rounded p-1.5 text-ink lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={open}
          >
            <Menu className="size-5" />
          </button>
          <ModuleSearch orgSlug={org.slug} allowed={allowed} />
          <div className="ml-auto flex items-center gap-1">
            <Notifications />
            <UserMenu user={user} roleLabel={org.roleLabel} signOut={signOut} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

/* --------------------------------------------------- Troca de escritório */

function OrgSwitcher({ current, orgs }: { current: OrgOption & { roleLabel: string }; orgs: OrgOption[] }) {
  const others = orgs.filter((o) => o.slug !== current.slug);
  const body = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">{current.name}</span>
        <span className="block text-xs text-gold/80">{current.roleLabel}</span>
      </span>
      {others.length ? <ChevronsUpDown className="size-4 text-white/50" aria-hidden="true" /> : null}
    </>
  );

  if (!others.length) {
    return <div className="mx-3 mt-4 flex items-center gap-2 rounded-control bg-white/[0.05] px-3 py-2.5">{body}</div>;
  }
  return (
    <details className="group relative mx-3 mt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-control bg-white/[0.05] px-3 py-2.5 hover:bg-white/[0.09]">
        {body}
      </summary>
      <ul className="absolute inset-x-0 top-full z-10 mt-1 rounded-control border border-line bg-surface py-1 text-text shadow-pop">
        {others.map((o) => (
          <li key={o.slug}>
            <Link href={`/app/${o.slug}`} className="block truncate px-3 py-2 text-sm hover:bg-paper">
              {o.name}
            </Link>
          </li>
        ))}
        <li className="border-t border-line">
          <Link href="/app/novo-escritorio" className="block px-3 py-2 text-sm text-muted hover:bg-paper">
            Criar outro escritório
          </Link>
        </li>
      </ul>
    </details>
  );
}

/* ------------------------------------------------- Pesquisa de módulos */

function ModuleSearch({ orgSlug, allowed }: { orgSlug: string; allowed: NavKey[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const listId = useId();

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return NAV.flatMap((g) => g.items)
      .filter((i) => allowed.includes(i.key))
      .filter((i) => t.nav[i.key].toLowerCase().includes(needle));
  }, [q, allowed]);

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            router.push(navHref(orgSlug, results[0]));
            setQ("");
          }
        }}
        placeholder="Ir para…"
        aria-label="Pesquisar módulos"
        aria-controls={listId}
        className="h-9 w-full rounded-control border border-line bg-subtle pr-3 pl-9 text-sm placeholder:text-muted/80 focus:border-ink/40 focus:bg-surface focus:ring-3 focus:ring-ink/10 focus:outline-none"
      />
      {focused && q ? (
        <ul id={listId} className="absolute inset-x-0 top-full mt-1 rounded-control border border-line bg-surface py-1 shadow-pop">
          {results.length ? (
            results.map((i) => (
              <li key={i.key}>
                <Link
                  href={navHref(orgSlug, i)}
                  onClick={() => setQ("")}
                  className="block px-3 py-2 text-sm hover:bg-paper"
                >
                  {t.nav[i.key]}
                </Link>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-muted">Nenhum módulo encontrado.</li>
          )}
          <li className="border-t border-line px-3 py-1.5 text-xs text-muted">
            A pesquisa de contactos e conversas chega com esses módulos.
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- Notificações */

function Popover({ button, label, children }: { button: ReactNode; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={label}
        className="flex cursor-pointer list-none items-center rounded-control p-2 text-muted hover:bg-ink-faint hover:text-ink"
      >
        {button}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-72 rounded-card border border-line bg-surface shadow-pop">
        {children}
      </div>
    </details>
  );
}

function Notifications() {
  return (
    <Popover label="Notificações" button={<Bell className="size-5" aria-hidden="true" />}>
      <div className="px-4 py-5 text-center">
        <p className="text-sm font-medium">Sem notificações</p>
        <p className="mt-1 text-xs text-muted">
          Aqui vai ver conversas encaminhadas para si e consultas marcadas.
        </p>
      </div>
    </Popover>
  );
}

function UserMenu({
  user,
  roleLabel,
  signOut,
}: {
  user: { name: string; email: string };
  roleLabel: string;
  signOut: () => Promise<void>;
}) {
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <Popover
      label="Conta"
      button={
        <span className="flex size-8 items-center justify-center rounded-full bg-ink-faint text-xs font-semibold text-ink ring-1 ring-ink/10">
          {initials || <UserRound className="size-4" />}
        </span>
      }
    >
      <div className="border-b border-line px-4 py-3">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted">{user.email}</p>
        <p className="mt-1 text-xs text-muted">{roleLabel}</p>
      </div>
      <ul className="py-1 text-sm">
        <li>
          <Link href="/app/conta" className="flex items-center gap-2 px-4 py-2 hover:bg-paper">
            <UserRound className="size-4 text-muted" aria-hidden="true" /> A minha conta
          </Link>
        </li>
        <li>
          <Link href="/app/conta/seguranca" className="flex items-center gap-2 px-4 py-2 hover:bg-paper">
            <ShieldCheck className="size-4 text-muted" aria-hidden="true" /> Segurança
          </Link>
        </li>
        <li className="border-t border-line">
          <form action={signOut}>
            <button type="submit" className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-paper">
              <LogOut className="size-4 text-muted" aria-hidden="true" /> Sair
            </button>
          </form>
        </li>
      </ul>
    </Popover>
  );
}
