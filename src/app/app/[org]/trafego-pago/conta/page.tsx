import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Badge, Panel, PanelHeader, buttonClass } from "@/components/ui";
import { decryptToken } from "@/lib/ads/crypto";
import { MetaAds, isMetaConfigured } from "@/lib/ads/meta";
import { can, getOrgContext } from "@/lib/auth/dal";
import { getAdAccount } from "@/lib/data/ads";
import { formatDateTime } from "@/lib/format";
import { disconnectMetaAccountAction } from "../../campanhas/actions";
import { ActionButton, ConnectMetaForm } from "../../campanhas/campaign-forms";

export const metadata: Metadata = { title: "Conta Meta" };

const META_MESSAGES: Record<string, string> = {
  sem_permissao: "O seu papel não permite ligar contas de anúncios.",
  nao_configurado: "A ligação à Meta ainda não está configurada nesta instalação do Patrono.",
  estado_invalido: "A autorização não pôde ser confirmada (pode ter expirado). Tente de novo.",
  cancelado: "A autorização foi cancelada na Meta.",
  falhou: "A Meta não concluiu a autorização. Tente de novo dentro de alguns minutos.",
};

async function pendingChoices(slug: string, uid: string) {
  const raw = (await cookies()).get("meta_pending")?.value;
  if (!raw) return null;
  try {
    const p = JSON.parse(decryptToken(raw)) as { token: string; org: string; uid: string };
    if (p.org !== slug || p.uid !== uid) return null;
    const meta = new MetaAds(p.token);
    const [accounts, pages] = await Promise.all([meta.listAdAccounts(), meta.listPages()]);
    return { ok: true as const, accounts, pages };
  } catch {
    return { ok: false as const };
  }
}

export default async function MetaAccountPage({ params, searchParams }: PageProps<"/app/[org]/trafego-pago/conta">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "campaigns.read")) return <PermissionDenied />;
  const canConnect = can(ctx, "campaigns.publish");
  const configured = isMetaConfigured();
  const account = await getAdAccount(ctx.org.id);
  const choices = canConnect && sp.escolher ? await pendingChoices(slug, ctx.user.id) : null;
  const notice = typeof sp.meta === "string" ? META_MESSAGES[sp.meta] : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        {notice ? <Alert tone="warn">{notice}</Alert> : null}

        <Panel>
          <PanelHeader title="Conta de anúncios da Meta" description="Facebook e Instagram. O Patrono só publica nesta conta e só com aprovação." />
          <div className="space-y-4 p-5 text-sm">
            {account ? (
              <>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-muted">Conta</dt><dd className="font-medium">{account.name ?? account.external_id} <span className="text-muted">({account.external_id.replace("act_", "")})</span></dd></div>
                  <div><dt className="text-muted">Estado</dt><dd>{account.status === "connected" ? <Badge tone="ok">Ligada</Badge> : <Badge tone="seal">Com erro</Badge>}</dd></div>
                  <div><dt className="text-muted">Moeda</dt><dd>{account.currency}</dd></div>
                  <div><dt className="text-muted">WhatsApp dos anúncios</dt><dd>{account.whatsapp_number ?? "—"}</dd></div>
                  <div><dt className="text-muted">Ligada em</dt><dd>{formatDateTime(account.connected_at)}</dd></div>
                  <div><dt className="text-muted">Autorização válida até</dt><dd>{account.token_expires_at ? formatDateTime(account.token_expires_at) : "—"}</dd></div>
                </dl>
                {account.last_error ? <Alert tone="seal" title="Último erro da Meta">{account.last_error}</Alert> : null}
                {canConnect ? (
                  <ActionButton
                    action={disconnectMetaAccountAction}
                    fields={{ org: slug, account_id: account.id }}
                    variant="danger"
                    confirm="Desligar a conta? O acesso guardado é apagado. As campanhas já publicadas continuam na Meta e devem ser geridas lá."
                  >
                    Desligar conta
                  </ActionButton>
                ) : null}
              </>
            ) : choices?.ok ? (
              choices.accounts.length && choices.pages.length ? (
                <ConnectMetaForm org={slug} accounts={choices.accounts} pages={choices.pages} />
              ) : (
                <Alert tone="warn">
                  A autorização foi dada, mas a Meta não devolveu {choices.accounts.length ? "nenhuma Página do Facebook" : "nenhuma conta de anúncios ativa"} para este utilizador.
                  Confirme no Gestor de Negócios da Meta que tem acesso e volte a ligar.
                </Alert>
              )
            ) : (
              <>
                {choices && !choices.ok ? <Alert tone="warn">A autorização expirou ou não pôde ser lida. Volte a ligar a conta.</Alert> : null}
                <p className="text-muted">Nenhuma conta ligada.</p>
                {!configured ? (
                  <Alert tone="neutral" title="Ligação à Meta por configurar">
                    Falta configurar a aplicação da Meta nesta instalação (identificador e segredo da app e chave de cifra). Até lá, pode preparar e aprovar campanhas,
                    mas não publicá-las.
                  </Alert>
                ) : canConnect ? (
                  <a href={`/api/meta/oauth/start?org=${encodeURIComponent(slug)}`} className={buttonClass("primary")}>
                    Ligar conta da Meta
                  </a>
                ) : (
                  <p className="text-muted">Peça a um administrador ou advogado que ligue a conta.</p>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>

      <Panel className="self-start p-5 text-sm">
        <p className="font-semibold">O que é preciso</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-muted">
          <li>Conta de anúncios ativa no Gestor de Negócios da Meta, com método de pagamento.</li>
          <li>Página do Facebook do escritório (e, para conversas, o WhatsApp Business ligado à Página).</li>
          <li>O acesso fica guardado cifrado e pode ser desligado a qualquer momento.</li>
        </ul>
        <p className="mt-4 font-semibold">Limitação importante</p>
        <p className="mt-1 text-muted">
          Desde outubro de 2025, a Meta não entrega na UE anúncios sobre temas sociais ou políticos. Anúncios centrados no serviço jurídico (ex.: apoio em
          processos de residência) não deviam ser afetados, mas a classificação é da Meta e pode recusar anúncios que toquem em imigração.
        </p>
      </Panel>
    </div>
  );
}
