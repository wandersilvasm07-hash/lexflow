import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Política de privacidade" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidade">
      <h2>Quem trata os dados</h2>
      <p>
        Em relação aos clientes dos escritórios, cada escritório é o responsável pelo tratamento e a
        plataforma atua como subcontratante. Em relação aos utilizadores da plataforma e aos pedidos de
        demonstração, o responsável é a entidade que comercializa a plataforma (a identificar).
      </p>
      <h2>Que dados tratamos e para quê</h2>
      <p>
        Dados de conta (nome, email), dados do escritório e os dados estritamente necessários ao
        atendimento inicial. Pedidos de demonstração são usados apenas para responder ao pedido.
      </p>
      <h2>Inteligência artificial</h2>
      <p>
        O atendimento automático usa um modelo de linguagem fornecido por terceiros. As conversas não
        são usadas para treinar modelos. Cada pessoa é informada de que está a falar com um assistente
        automático e pode pedir atendimento humano.
      </p>
      <h2>Os seus direitos</h2>
      <p>
        Acesso, retificação, eliminação, limitação, portabilidade e oposição, nos termos do RGPD. Pode
        também apresentar reclamação à CNPD.
      </p>
    </LegalPage>
  );
}
