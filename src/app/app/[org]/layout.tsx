import { Suspense } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { AppShell } from "@/components/shell/app-shell";
import { NAV } from "@/components/shell/nav";
import { getOrgContext, listMyOrganizations } from "@/lib/auth/dal";
import { t } from "@/i18n";

export default function OrgLayout({ children, params }: LayoutProps<"/app/[org]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <OrgShell params={params}>{children}</OrgShell>
    </Suspense>
  );
}

async function OrgShell({
  params,
  children,
}: {
  params: Promise<{ org: string }>;
  children: React.ReactNode;
}) {
  const { org: slug } = await params;
  const [ctx, orgs] = await Promise.all([getOrgContext(slug), listMyOrganizations()]);

  // A lista de módulos visíveis é decidida no servidor, a partir das permissões.
  const allowed = NAV.flatMap((g) => g.items)
    .filter((i) => ctx.permissions.has(i.permission))
    .map((i) => i.key);

  return (
    <AppShell
      org={{ slug: ctx.org.slug, name: ctx.org.name, roleLabel: t.roles[ctx.role] }}
      orgs={orgs.map((o) => ({ slug: o.slug, name: o.name }))}
      allowed={allowed}
      user={{ name: ctx.user.fullName ?? ctx.user.email, email: ctx.user.email }}
      signOut={signOutAction}
    >
      {children}
    </AppShell>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]" aria-busy="true">
      <div className="hidden bg-ink lg:block" />
      <div>
        <div className="h-16 border-b border-line" />
        <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
          <div className="h-7 w-48 animate-pulse rounded bg-line" />
          <div className="h-32 animate-pulse rounded-lg bg-line/60" />
        </div>
      </div>
    </div>
  );
}
