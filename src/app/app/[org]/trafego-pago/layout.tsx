import { PageHeader } from "@/components/ui";
import { RouteTabs } from "@/components/ui/tabs";

export default async function AdsLayout({ children, params }: LayoutProps<"/app/[org]/trafego-pago">) {
  const { org } = await params;
  const base = `/app/${org}/trafego-pago`;
  return (
    <>
      <PageHeader
        title="Tráfego Pago IA"
        description="Prepare campanhas na Meta com a ajuda da IA. Nada é publicado nem gasto sem a sua aprovação explícita."
      />
      <RouteTabs
        label="Secções de publicidade"
        tabs={[
          { href: base, label: "Nova campanha", exact: true },
          { href: `${base}/limites`, label: "Limites de orçamento" },
          { href: `${base}/conta`, label: "Conta Meta" },
        ]}
      />
      <div className="mt-6">{children}</div>
    </>
  );
}
