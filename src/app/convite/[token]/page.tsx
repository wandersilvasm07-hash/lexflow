import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { Alert, ButtonLink, Panel } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/dal";
import { isOrgRole } from "@/lib/authz/permissions";
import { isSupabaseConfigured } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/i18n";
import { AcceptInvitation } from "./accept";

export const metadata: Metadata = { title: "Convite", robots: { index: false } };

type Preview = {
  organization_name: string;
  role: string;
  email: string;
  expires_at: string;
  status: "pending" | "accepted" | "revoked" | "expired";
};

export default function InvitePage({ params }: PageProps<"/convite/[token]">) {
  return (
    <div className="flex min-h-screen flex-col items-center px-5 py-10">
      <Link href="/" aria-label="Página inicial">
        <Logo />
      </Link>
      <Panel className="mt-10 w-full max-w-md p-6">
        <Suspense fallback={<p className="text-sm text-muted">A verificar o convite…</p>}>
          <InviteContent params={params} />
        </Suspense>
      </Panel>
    </div>
  );
}

async function InviteContent({ params }: { params: Promise<{ token: string }> }) {
  if (!isSupabaseConfigured()) return <Alert tone="seal">{t.errors.not_configured}</Alert>;
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) return <Invalid />;

  const supabase = await createClient();
  const { data } = await supabase
    .rpc("get_invitation_preview", { p_token: token })
    .maybeSingle<Preview>();
  if (!data) return <Invalid />;

  if (data.status !== "pending") {
    const text = {
      accepted: "Este convite já foi aceite.",
      revoked: "Este convite foi cancelado pelo escritório.",
      expired: t.errors.invitation_expired,
    }[data.status];
    return (
      <>
        <h1 className="text-lg font-semibold">Convite indisponível</h1>
        <p className="mt-2 text-sm text-muted">{text}</p>
        <ButtonLink href="/app" variant="secondary" className="mt-6">
          Ir para a aplicação
        </ButtonLink>
      </>
    );
  }

  const user = await getCurrentUser();
  const next = `/convite/${token}`;
  const role = isOrgRole(data.role) ? t.roles[data.role] : data.role;

  return (
    <>
      <h1 className="text-lg font-semibold">Convite para {data.organization_name}</h1>
      <p className="mt-2 text-sm text-muted">
        Papel: <span className="text-text">{role}</span>. Válido até {formatDate(data.expires_at)}.
      </p>

      {!user ? (
        <>
          <p className="mt-4 text-sm">
            Entre ou crie conta com <span className="font-medium">{data.email}</span> para aceitar.
          </p>
          <div className="mt-6 flex gap-2">
            <ButtonLink href={`/registar?next=${encodeURIComponent(next)}&email=${encodeURIComponent(data.email)}`}>
              Criar conta
            </ButtonLink>
            <ButtonLink href={`/entrar?next=${encodeURIComponent(next)}`} variant="secondary">
              Entrar
            </ButtonLink>
          </div>
        </>
      ) : user.email.toLowerCase() !== data.email.toLowerCase() ? (
        <Alert tone="warn" className="mt-4">
          Está a usar a conta {user.email}, mas o convite é para {data.email}. Saia e entre com a conta
          certa.
        </Alert>
      ) : (
        <AcceptInvitation token={token} />
      )}
    </>
  );
}

function Invalid() {
  return (
    <>
      <h1 className="text-lg font-semibold">Convite inválido</h1>
      <p className="mt-2 text-sm text-muted">
        O link não é válido. Confirme que o copiou completo ou peça um novo convite ao escritório.
      </p>
    </>
  );
}
