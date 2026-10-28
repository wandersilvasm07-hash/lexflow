import type { Metadata } from "next";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Panel, PanelHeader, buttonClass } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { DeleteOrganizationForm, RetentionForm } from "./data-forms";

export const metadata: Metadata = { title: "Dados e privacidade" };

const PROCESSORS = [
  ["Supabase", "Base de dados, autenticação e ficheiros", "União Europeia (Irlanda)"],
  ["Vercel", "Alojamento da aplicação", "Funções na UE (Irlanda); rede global de distribuição"],
  ["Anthropic", "Modelo de IA do assistente e das campanhas", "EUA — transferência internacional, a enquadrar no acordo de tratamento de dados (DPA)"],
  ["Meta", "WhatsApp Business e anúncios (quando ligados)", "UE / EUA"],
  ["Stripe", "Pagamentos da subscrição", "UE / EUA"],
];

export default async function DataPrivacyPage({ params }: PageProps<"/app/[org]/configuracoes/dados">) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "org.read")) return <PermissionDenied />;
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("retention_months").eq("id", ctx.org.id).single();
  const isAdmin = can(ctx, "org.delete");

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title="Conservação de dados"
          description="Conversas fechadas são apagadas automaticamente (com mensagens, notas e registos da IA) depois deste prazo. Contactos, consultas e documentos mantêm-se."
        />
        <div className="p-5">
          <RetentionForm org={slug} months={org?.retention_months ?? 24} canEdit={can(ctx, "org.update")} />
          <p className="mt-4 text-xs text-muted">
            Registos técnicos de mensagens recebidas são apagados ao fim de 30 dias. Contactos individuais podem ser eliminados a pedido do titular na ficha do contacto.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Exportar todos os dados" description="Um ficheiro JSON com os dados do escritório: contactos, conversas, consultas, base jurídica, campanhas, faturas e registo de atividade. Não inclui palavras-passe nem chaves de acesso." />
        <div className="p-5">
          {isAdmin ? (
            <a href={`/app/${slug}/configuracoes/dados/exportar`} className={buttonClass("secondary")}>
              Descarregar exportação
            </a>
          ) : (
            <p className="text-sm text-muted">Só o administrador do escritório pode exportar todos os dados.</p>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Subcontratantes" description="Serviços externos que tratam dados em nome do escritório." />
        <ul className="divide-y divide-line text-sm">
          {PROCESSORS.map(([name, what, where]) => (
            <li key={name} className="grid gap-1 px-5 py-3 sm:grid-cols-[8rem_1fr_1fr]">
              <span className="font-medium text-ink">{name}</span>
              <span className="text-muted">{what}</span>
              <span className="text-muted">{where}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          As conversas não são usadas para treinar modelos de IA: a API comercial da Anthropic não usa os dados dos clientes para treino.
        </p>
      </Panel>

      {isAdmin ? (
        <Panel className="border-seal/30">
          <PanelHeader title="Eliminar o escritório" description="Apaga definitivamente o escritório e todos os seus dados. Não pode ser anulado." />
          <div className="space-y-4 p-5">
            <Alert tone="warn">Exporte os dados antes. Campanhas ativas na Meta e subscrições pagas têm de ser terminadas primeiro.</Alert>
            <DeleteOrganizationForm org={slug} />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
