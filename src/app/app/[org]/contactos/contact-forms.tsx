"use client";

import { useActionState, useRef } from "react";
import { Select } from "@/components/ui";
import { updateContactStatusAction } from "./actions";

export const CONTACT_STATUS = {
  new: "Novo contacto",
  in_progress: "Em atendimento",
  awaiting_info: "A aguardar informação",
  consultation_proposed: "Consulta proposta",
  consultation_booked: "Consulta marcada",
  converted: "Convertido em cliente",
  closed: "Encerrado",
} as const;

export function StatusSelect({ org, id, status }: { org: string; id: string; status: string }) {
  const [state, run] = useActionState(updateContactStatusAction, null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={run}>
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <Select
        name="status"
        defaultValue={status}
        aria-label="Estado do contacto"
        className="h-8 w-52 text-xs"
        onChange={() => ref.current?.requestSubmit()}
      >
        {Object.entries(CONTACT_STATUS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      {state && !state.ok ? <span className="mt-1 block text-xs text-seal">{state.error}</span> : null}
    </form>
  );
}
