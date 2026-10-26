import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Badge, PageHeader, Panel, PanelHeader } from "@/components/ui";
import { isAgentConfigured } from "@/lib/agent/run";
import { can, getOrgContext } from "@/lib/auth/dal";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/i18n";
import { AgentToggle, EnableSimulation, Simulator } from "./whatsapp-forms";

export const metadata: Metadata = { title: t.nav.whatsapp };

type Account = {
  mode: "live" | "simulation";
  display_phone: string | null;
  status: string;
  agent_enabled: boolean;
  connected_at: string | null;
  last_error: string | null;
};

export default async function WhatsAppPage({ params }: PageProps<"/app/[org]/whatsapp">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "whatsapp.manage")) return <PermissionDenied />;
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("whatsapp_accounts")
    .select("mode, display_phone, status, agent_enabled, connected_at, last_error")
    .eq("organization_id", ctx.org.id)
    .maybeSingle<Account>();

  const aiReady = isAgentConfigured() && getAdminClient() !== null;
  const liveReady = Boolean(
    process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_ACCESS_TOKEN,
  );
  const slug = ctx.org.slug;

  return (
    <>
      <PageHeader
        title="WhatsApp IA"
        description="Ligação ao WhatsApp do escritório e assistente de atendimento inicial."
      />

      {!account ? (
        <Panel>
          <PanelHeader title="Ainda sem WhatsApp ligado" />
          <div className="space-y-4 p-5 text-sm">
            <p className="text-muted">
              A ligação real usa a WhatsApp Business Platform oficial da Meta e precisa de uma conta
              Meta Business verificada e de um número dedicado. Enquanto isso não está pronto, pode
              experimentar tudo num ambiente de simulação: as mensagens não saem para ninguém e
              ficam identificadas como simuladas.
            </p>
            <EnableSimulation org={slug} />
          </div>
        </Panel>
      ) : (
        <div className="space-y-6">
          {account.mode === "simulation" ? (
            <Alert tone="warn" title="Modo de simulação">
              O WhatsApp real <strong>não</strong> está ligado. Nenhuma mensagem é enviada ou
              recebida de números reais.
            </Alert>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Estado" />
              <dl className="divide-y divide-line text-sm">
                <Row label="Ligação">
                  {account.mode === "simulation" ? (
                    <Badge tone="warn">Simulação</Badge>
                  ) : account.status === "connected" ? (
                    <Badge tone="ok">Ligado</Badge>
                  ) : (
                    <Badge tone="seal">Não ligado</Badge>
                  )}
                </Row>
                <Row label="Número">{account.display_phone ?? "—"}</Row>
                <Row label="Assistente de IA">
                  <AgentToggle org={slug} enabled={account.agent_enabled} />
                </Row>
                <Row label="Motor de IA">
                  {aiReady ? <Badge tone="ok">Configurado</Badge> : <Badge tone="seal">Falta configurar</Badge>}
                </Row>
              </dl>
              {!aiReady ? (
                <p className="border-t border-line px-5 py-3 text-xs text-muted">
                  Sem o motor de IA configurado no servidor, as mensagens chegam à caixa de entrada
                  mas o assistente não responde. Faltam as chaves do modelo de IA e a chave de
                  serviço do Supabase (ver docs/CREDENTIALS.md).
                </p>
              ) : null}
            </Panel>

            <Panel>
              <PanelHeader title="Ligação real à Meta" />
              <div className="space-y-3 p-5 text-sm text-muted">
                {liveReady ? (
                  <p>As credenciais do servidor estão definidas. Falta associar o número a este escritório.</p>
                ) : (
                  <>
                    <p>Para ligar o número real são precisos:</p>
                    <ul className="list-disc space-y-1 pl-5 marker:text-line-strong">
                      <li>Conta Meta Business verificada e app na Meta for Developers</li>
                      <li>Número dedicado ao WhatsApp Business Platform</li>
                      <li>Webhook apontado para <code className="text-text">/api/webhooks/whatsapp</code></li>
                    </ul>
                  </>
                )}
              </div>
            </Panel>
          </div>

          {account.mode === "simulation" ? (
            <Panel>
              <PanelHeader
                title="Simular uma mensagem de um cliente"
                description="Escreva como se fosse alguém a contactar o escritório pelo WhatsApp."
                actions={
                  <Link href={`/app/${slug}/caixa-de-entrada`} className="text-sm font-medium text-ink underline underline-offset-4">
                    Abrir caixa de entrada
                  </Link>
                }
              />
              <div className="p-5">
                <Simulator org={slug} />
              </div>
            </Panel>
          ) : null}
        </div>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
