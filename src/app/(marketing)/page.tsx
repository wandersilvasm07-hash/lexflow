import { CalendarCheck, FileSearch, Hand, MessagesSquare, ShieldCheck, Target } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui";
import { APP } from "@/config/app";
import { DemoForm } from "./demo-form";

const FLOW = [
  {
    title: "Responde no WhatsApp",
    text: "A pessoa escreve para o número do escritório e recebe resposta em segundos, em português, inglês ou outro idioma.",
  },
  {
    title: "Faz as perguntas certas",
    text: "Uma pergunta de cada vez, só o necessário para perceber o assunto: título de residência, família, prazos, notificações recebidas.",
  },
  {
    title: "Entrega o caso à equipa",
    text: "Casos urgentes, indeferimentos e prazos a correr seguem logo para um advogado, com um resumo factual da conversa.",
  },
  {
    title: "Marca a consulta",
    text: "Propõe apenas horários realmente livres na agenda e só confirma depois de a marcação ficar gravada.",
  },
];

const FEATURES = [
  {
    icon: MessagesSquare,
    title: "Caixa de entrada partilhada",
    text: "Todas as conversas num só sítio, com estado, responsável, notas internas e resumo da IA.",
  },
  {
    icon: FileSearch,
    title: "Base jurídica com fontes",
    text: "A IA consulta documentos aprovados pela equipa, com datas de vigência e revisão. Sem fonte, não responde: encaminha.",
  },
  {
    icon: CalendarCheck,
    title: "Contactos e agenda",
    text: "Cada contacto com origem, serviço pretendido e próxima ação. Consultas sem marcações duplicadas.",
  },
  {
    icon: Target,
    title: "Campanhas com aprovação",
    text: "A IA prepara textos e estrutura de anúncios no Meta. Nada é publicado nem gasto sem a sua confirmação explícita.",
  },
  {
    icon: Hand,
    title: "Controlo humano",
    text: "Assuma qualquer conversa com um clique. A IA para de responder até a reativar.",
  },
  {
    icon: ShieldCheck,
    title: "Dados separados por escritório",
    text: "Isolamento na base de dados, papéis por pessoa, verificação em dois passos e registo de atividade inalterável.",
  },
];

const PLANS = [
  {
    name: "Essencial",
    for: "Advogado em prática individual",
    items: ["Assistente no WhatsApp", "Caixa de entrada e contactos", "Agenda de consultas", "1 utilizador"],
  },
  {
    name: "Profissional",
    for: "Escritórios com equipa",
    items: ["Tudo do Essencial", "Equipa com papéis e permissões", "Base jurídica privada do escritório", "Relatórios"],
  },
  {
    name: "Premium",
    for: "Escritórios que investem em captação",
    items: ["Tudo do Profissional", "Campanhas Meta Ads assistidas por IA", "Controlo de orçamento e alertas", "Acompanhamento dedicado"],
  },
];

const FAQ = [
  {
    q: "A IA dá aconselhamento jurídico aos clientes?",
    a: "Não. Dá informação geral, recolhe os dados necessários e prepara um resumo para o advogado. Não promete vistos, autorizações de residência nem nacionalidade, e não decide a estratégia do processo.",
  },
  {
    q: "E quando a IA não sabe a resposta?",
    a: "Diz ao cliente que vai confirmar com a equipa e encaminha a conversa para um profissional. Só responde a questões jurídicas com base em documentos que o escritório aprovou.",
  },
  {
    q: "Usa o WhatsApp oficial?",
    a: "Sim, a WhatsApp Business Platform da Meta. O número fica associado ao seu escritório e respeita as regras e janelas de mensagens da Meta.",
  },
  {
    q: "As conversas são usadas para treinar modelos?",
    a: "Não. Os dados de cada escritório ficam isolados e não são usados para treino. Pode exportar ou eliminar dados de clientes quando for pedido.",
  },
  {
    q: "A publicidade respeita as regras da profissão?",
    a: "Cada campanha passa por uma revisão de conformidade antes de ser publicada, e é sempre o escritório que aprova o texto e o orçamento. A responsabilidade final pelo conteúdo é do advogado.",
  },
  {
    q: "Quanto custa?",
    a: "Os preços estão a ser definidos com os primeiros escritórios. Peça uma demonstração e apresentamos a proposta para a dimensão da sua equipa.",
  },
];

export default function LandingPage() {
  return (
    <div className="bg-surface">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="#planos" className="hidden px-3 py-2 text-sm text-muted hover:text-ink sm:block">
            Planos
          </Link>
          <Link href="#perguntas" className="hidden px-3 py-2 text-sm text-muted hover:text-ink sm:block">
            Perguntas
          </Link>
          <ButtonLink href="/entrar" variant="ghost" size="sm">
            Entrar
          </ButtonLink>
          <ButtonLink href="#demonstracao" size="sm">
            Pedir demonstração
          </ButtonLink>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl gap-12 px-5 pt-12 pb-20 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:pt-20">
          <div>
            <h1 className="max-w-xl text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              O primeiro contacto do escritório, atendido a qualquer hora.
            </h1>
            <p className="mt-6 max-w-lg text-base text-muted">
              {APP.name} responde no WhatsApp a quem procura apoio em imigração, faz as perguntas
              certas e entrega à sua equipa um resumo pronto a analisar. Quem decide continua a ser o
              advogado.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="#demonstracao" size="lg">
                Pedir demonstração
              </ButtonLink>
              <ButtonLink href="/registar" variant="secondary" size="lg">
                Criar conta
              </ButtonLink>
            </div>
          </div>
          <ConversationIllustration />
        </section>

        {/* Fluxo */}
        <section className="border-y border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <h2 className="max-w-lg text-xl font-semibold tracking-tight">
              Do primeiro “olá” à consulta marcada
            </h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-4">
              {FLOW.map((step, i) => (
                <li key={step.title} className="relative border-t-2 border-ink pt-4">
                  <span className="text-sm font-semibold text-ink">{i + 1}</span>
                  <h3 className="mt-1 text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Funcionalidades */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <h2 className="max-w-xl text-xl font-semibold tracking-tight">
            Feito para a forma como um escritório trabalha
          </h2>
          <div className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <f.icon className="size-5 text-ink" aria-hidden="true" />
                <h3 className="mt-3 text-base font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* O que a IA não faz */}
        <section className="bg-ink text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2">
            <h2 className="max-w-md text-xl font-semibold tracking-tight">
              O que o assistente nunca faz
            </h2>
            <ul className="space-y-3 text-sm text-white/80">
              <li>Prometer resultados, prazos ou decisões da AIMA.</li>
              <li>Inventar legislação, taxas ou requisitos que não estejam nas fontes aprovadas.</li>
              <li>Pedir documentos sensíveis sem necessidade e sem um canal seguro.</li>
              <li>Continuar a responder depois de um profissional assumir a conversa.</li>
              <li>Publicar anúncios ou aumentar orçamentos sem autorização expressa.</li>
            </ul>
          </div>
        </section>

        {/* Planos */}
        <section id="planos" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-20 sm:px-8">
          <h2 className="text-xl font-semibold tracking-tight">Planos</h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Preços em definição com os primeiros escritórios. Todos os planos incluem a verificação em
            dois passos e o isolamento total dos dados.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PLANS.map((p, i) => (
              <div
                key={p.name}
                className={
                  i === 1
                    ? "rounded-lg border-2 border-ink p-6"
                    : "rounded-lg border border-line p-6"
                }
              >
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="text-sm text-muted">{p.for}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {p.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden="true" className="text-ink">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-sm font-medium text-ink">Preço sob consulta</p>
              </div>
            ))}
          </div>
        </section>

        {/* Perguntas */}
        <section id="perguntas" className="scroll-mt-8 border-t border-line bg-paper">
          <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8">
            <h2 className="text-xl font-semibold tracking-tight">Perguntas frequentes</h2>
            <div className="mt-8 divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium">
                    {f.q}
                    <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Demonstração */}
        <section id="demonstracao" className="mx-auto max-w-3xl scroll-mt-8 px-5 py-20 sm:px-8">
          <h2 className="text-xl font-semibold tracking-tight">Pedir demonstração</h2>
          <p className="mt-2 text-sm text-muted">
            Mostramos o atendimento a funcionar com os serviços do seu escritório. Respondemos por email.
          </p>
          <div className="mt-8">
            <DemoForm />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted sm:px-8">
          <Logo />
          <nav className="flex gap-5">
            <Link href="/privacidade" className="hover:text-ink">Privacidade</Link>
            <Link href="/termos" className="hover:text-ink">Termos</Link>
            <Link href="/entrar" className="hover:text-ink">Entrar</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** Ilustração de uma conversa — rotulada como exemplo, não como caso real. */
function ConversationIllustration() {
  return (
    <figure className="relative">
      <div className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <p className="text-sm font-semibold">Atendimento do escritório</p>
            <p className="text-xs text-muted">Assistente ativo</p>
          </div>
          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-muted">WhatsApp</span>
        </div>
        <div className="space-y-2.5 pt-4 text-sm">
          <Bubble from="client">
            Boa tarde. Tenho autorização de residência para trabalho e queria trazer a minha mulher e os
            meus dois filhos. É possível?
          </Bubble>
          <Bubble from="assistant">
            Boa tarde. Posso ajudar a preparar esse pedido com a equipa do escritório. Para começar: o
            seu título de residência está válido neste momento?
          </Bubble>
          <Bubble from="client">Sim, até março de 2027.</Bubble>
          <Bubble from="assistant">Obrigado. A sua família está em Portugal ou no país de origem?</Bubble>
        </div>
        <div className="mt-4 rounded-lg border-l-4 border-seal bg-surface px-4 py-3">
          <p className="text-xs font-semibold text-seal">Encaminhado para a equipa</p>
          <p className="mt-1 text-sm">
            Pedido de reagrupamento familiar. Título válido até 03/2027. Cônjuge e dois filhos fora de
            Portugal. Aguarda proposta de consulta.
          </p>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-muted">Exemplo ilustrativo de uma conversa.</figcaption>
    </figure>
  );
}

function Bubble({ from, children }: { from: "client" | "assistant"; children: React.ReactNode }) {
  return (
    <p
      className={
        from === "client"
          ? "ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-ink-faint px-3 py-2"
          : "max-w-[85%] rounded-lg rounded-bl-sm border border-line bg-surface px-3 py-2"
      }
    >
      {children}
    </p>
  );
}
