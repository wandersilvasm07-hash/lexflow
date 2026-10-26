import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Termos de utilização" };

export default function TermsPage() {
  return (
    <LegalPage title="Termos de utilização">
      <h2>O serviço</h2>
      <p>
        A plataforma apoia o atendimento inicial, a gestão de contactos, a agenda e a preparação de
        campanhas de escritórios de advocacia. Não presta aconselhamento jurídico.
      </p>
      <h2>Responsabilidade profissional</h2>
      <p>
        O escritório é responsável pela análise jurídica, pelas respostas dadas aos seus clientes, pelo
        conteúdo aprovado na base jurídica e pela publicidade que decide publicar.
      </p>
      <h2>Contas e segurança</h2>
      <p>
        Cada utilizador é responsável pela confidencialidade das suas credenciais. Recomendamos ativar a
        verificação em dois passos.
      </p>
    </LegalPage>
  );
}
