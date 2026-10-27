/**
 * Rótulos partilhados do CRM e da agenda (servidor e browser).
 * Ficam fora de ficheiros "use client" para poderem ser lidos no servidor.
 */
export const CONTACT_STATUS = {
  new: "Novo contacto",
  in_progress: "Em atendimento",
  awaiting_info: "A aguardar informação",
  consultation_proposed: "Consulta proposta",
  consultation_booked: "Consulta marcada",
  converted: "Convertido em cliente",
  closed: "Encerrado",
} as const;
export type ContactStatus = keyof typeof CONTACT_STATUS;
export const CONTACT_STATUS_KEYS = Object.keys(CONTACT_STATUS) as ContactStatus[];

export const CONTACT_SOURCE = {
  whatsapp: "WhatsApp",
  ads: "Anúncio",
  form: "Formulário",
  referral: "Recomendação",
  manual: "Manual",
} as const;
export type ContactSource = keyof typeof CONTACT_SOURCE;

export const APPOINTMENT_STATUS = {
  booked: { label: "Marcada", tone: "ink" },
  confirmed: { label: "Confirmada", tone: "ok" },
  cancelled: { label: "Cancelada", tone: "neutral" },
  completed: { label: "Realizada", tone: "ok" },
  no_show: { label: "Faltou", tone: "warn" },
} as const;
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUS;

export const SERVICE_MODE = {
  presencial: "Presencial",
  online: "Online",
  presencial_ou_online: "Presencial ou online",
} as const;

export const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"] as const;

/** Segunda-feira (data local AAAA-MM-DD) da semana que contém `date`. */
export function mondayOf(date: Date, timeZone: string): string {
  const local = new Date(date.toLocaleString("en-US", { timeZone }));
  const dow = (local.getDay() + 6) % 7; // 0 = segunda
  local.setDate(local.getDate() - dow);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Converte "AAAA-MM-DD" + "HH:MM" no fuso indicado para um instante ISO. */
export function zonedToIso(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // Primeira estimativa em UTC e correção pelo desfasamento do fuso nesse instante.
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - t;
  };
  let ts = guess - offset(guess);
  ts = guess - offset(ts);
  return new Date(ts).toISOString();
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Evita injeção de fórmulas ao abrir no Excel.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  // BOM para o Excel reconhecer UTF-8; ";" é o separador habitual em Portugal.
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
}
