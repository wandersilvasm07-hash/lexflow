import { Alert, Panel, PageHeader } from "@/components/ui";
import { t } from "@/i18n";
import { findNavItem, type NavKey } from "./nav";

/**
 * Página de um módulo ainda não implementado. Diz com clareza o que vai fazer,
 * em que fase chega e o que é preciso — sem dados fictícios nem botões falsos.
 */
export function ModulePlaceholder({
  module,
  summary,
  willDo,
  requires,
}: {
  module: NavKey;
  summary: string;
  willDo: string[];
  requires?: string[];
}) {
  const item = findNavItem(module);
  return (
    <>
      <PageHeader title={t.nav[module]} description={summary} />
      <Alert tone="ink" className="mb-6">
        Este módulo fica disponível na fase {item.phase} do desenvolvimento. Nada nesta página está
        ligado a dados reais ainda.
      </Alert>
      <div className="grid gap-6 md:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-base font-semibold">O que vai permitir</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-line-strong">
            {willDo.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Panel>
        {requires?.length ? (
          <Panel className="p-5">
            <h2 className="text-base font-semibold">O que será preciso</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-line-strong">
              {requires.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  );
}

export function PermissionDenied() {
  return (
    <Panel className="px-6 py-12 text-center">
      <p className="text-base font-semibold">Sem acesso a esta área</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{t.errors.forbidden} Se precisar, peça ao administrador do escritório para rever o seu papel.</p>
    </Panel>
  );
}
