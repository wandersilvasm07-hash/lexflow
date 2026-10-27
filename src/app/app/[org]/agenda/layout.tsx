import { PageHeader } from "@/components/ui";
import { RouteTabs } from "@/components/ui/tabs";

export default async function AgendaLayout({ children, params }: LayoutProps<"/app/[org]/agenda">) {
  const { org } = await params;
  const base = `/app/${org}/agenda`;
  return (
    <>
      <PageHeader title="Agenda" description="Consultas do escritório. O assistente só propõe horários que aparecem aqui como livres." />
      <RouteTabs
        label="Secções da agenda"
        tabs={[
          { href: base, label: "Semana", exact: true },
          { href: `${base}/nova`, label: "Marcar consulta" },
          { href: `${base}/definicoes`, label: "Serviços e horários" },
        ]}
      />
      <div className="mt-6">{children}</div>
    </>
  );
}
