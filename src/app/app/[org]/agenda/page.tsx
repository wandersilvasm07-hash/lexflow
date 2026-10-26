import type { Metadata } from "next";
import { ModulePlaceholder, PermissionDenied } from "@/components/shell/module-placeholder";
import { can, getOrgContext } from "@/lib/auth/dal";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.calendar };

export default async function Page({ params }: PageProps<"/app/[org]/agenda">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "calendar.read")) return <PermissionDenied />;
  return (
    <ModulePlaceholder
      module="calendar"
      summary="Horários, disponibilidade e consultas marcadas."
      willDo={["Horários e duração de consultas por profissional","Marcação, cancelamento e confirmações sem marcações duplicadas","A IA só propõe horários realmente livres","Integração futura com Google Calendar e Outlook"]}
    />
  );
}
