"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Field, Input } from "@/components/ui";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; status: string; friendly_name?: string };
type Enrollment = { factorId: string; qr: string; secret: string };

/**
 * Gestão de TOTP com o Supabase Auth. Corre no browser porque a inscrição
 * devolve o QR code e o segredo, que nunca devem ser guardados pelo servidor.
 */
export function MfaManager({ returnTo }: { returnTo: string | null }) {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [aal, setAal] = useState<{ current: string | null; next: string | null }>({ current: null, next: null });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data, error: e }, { data: level }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (e) return setError(toUserMessage(e));
    setFactors(data.totp as Factor[]);
    setAal({ current: level?.currentLevel ?? null, next: level?.nextLevel ?? null });
  }, []);

  useEffect(() => {
    // Carregamento inicial dos fatores de autenticação.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const verified = factors?.find((f) => f.status === "verified");

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // Remove inscrições anteriores não concluídas para não acumular fatores.
    for (const f of factors ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error: e } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Telemóvel ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (e) return setError(toUserMessage(e));
    setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify(factorId: string) {
    if (!/^[0-9]{6}$/.test(code)) return setError("Indique o código de 6 dígitos.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (e) return setError(toUserMessage(e));
    setEnrollment(null);
    setCode("");
    setDone("Verificação em dois passos ativa nesta sessão.");
    await refresh();
    router.refresh();
    if (returnTo) router.push(returnTo);
  }

  async function remove(factorId: string) {
    if (!window.confirm("Desativar a verificação em dois passos? A conta fica menos protegida.")) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (e) {
      return setError(
        aal.current !== "aal2"
          ? "Para desativar, entre primeiro com o código da aplicação (sessão verificada)."
          : toUserMessage(e),
      );
    }
    await supabase.auth.refreshSession();
    setDone("Verificação em dois passos desativada.");
    await refresh();
    router.refresh();
  }

  if (factors === null) {
    return error ? <Alert tone="seal">{error}</Alert> : <p className="text-sm text-muted">A carregar…</p>;
  }

  const codeInput = (
    <Field id="mfa-code" label="Código de 6 dígitos" error={error ?? undefined}>
      <Input
        id="mfa-code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        className="max-w-40 text-lg tracking-[0.3em]"
        aria-invalid={error ? true : undefined}
      />
    </Field>
  );

  return (
    <div className="space-y-5">
      {done ? <Alert tone="ok">{done}</Alert> : null}

      {verified ? (
        <>
          <div className="flex items-center gap-2">
            <Badge tone="ok">Ativa</Badge>
            <span className="text-sm text-muted">
              {aal.current === "aal2" ? "Sessão atual verificada." : "Sessão atual ainda não verificada."}
            </span>
          </div>
          {aal.current !== "aal2" ? (
            <div className="space-y-3">
              <p className="text-sm">Introduza o código atual para verificar esta sessão.</p>
              {codeInput}
              <Button onClick={() => verify(verified.id)} disabled={busy}>
                Verificar
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => remove(verified.id)} disabled={busy}>
              Desativar
            </Button>
          )}
        </>
      ) : enrollment ? (
        <div className="grid gap-6 sm:grid-cols-[12rem_minmax(0,1fr)]">
          {/* QR gerado pelo Supabase como data URL SVG */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qr} alt="QR code para a aplicação de autenticação" className="size-48 rounded border border-line bg-white p-2" />
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Abra uma aplicação de autenticação (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
              <li>Leia o QR code. Se não conseguir, introduza a chave manualmente.</li>
              <li>Escreva o código de 6 dígitos que aparece.</li>
            </ol>
            <p className="text-xs break-all text-muted">
              Chave: <span className="font-medium text-text select-all">{enrollment.secret}</span>
            </p>
            {codeInput}
            <div className="flex gap-2">
              <Button onClick={() => verify(enrollment.factorId)} disabled={busy}>
                Ativar
              </Button>
              <Button variant="ghost" onClick={() => setEnrollment(null)} disabled={busy}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {error ? <Alert tone="seal">{error}</Alert> : null}
          <div className="flex items-center gap-3">
            <Badge>Desativada</Badge>
            <Button onClick={startEnrollment} disabled={busy}>
              Ativar verificação em dois passos
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
