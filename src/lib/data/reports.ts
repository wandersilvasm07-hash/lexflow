import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays, zonedToIso } from "@/lib/crm";

export type Report = {
  conversations_new: number;
  conversations_ai_attended: number;
  conversations_handed_off: number;
  conversations_urgent: number;
  conversations_pending_now: number;
  contacts_new: number;
  contacts_by_source: Record<string, number>;
  contacts_by_status: Record<string, number>;
  appointments_booked: number;
  appointments_booked_by_ai: number;
  appointments_held: number;
  appointments_no_show: number;
  appointments_cancelled: number;
  appointments_by_service: Record<string, number>;
  generated_at: string;
};

export const PERIODS = {
  "7": "7 dias",
  "30": "30 dias",
  "90": "90 dias",
  mes: "Este mês",
  "mes-anterior": "Mês anterior",
} as const;
export type PeriodKey = keyof typeof PERIODS;

/** Intervalo [de, até) no fuso do escritório para um período. */
export function periodRange(key: PeriodKey, timeZone: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const tomorrow = addDays(today, 1);
  if (key === "mes" || key === "mes-anterior") {
    const [y, m] = today.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1 - (key === "mes-anterior" ? 1 : 0), 1));
    const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const end = key === "mes" ? tomorrow : iso(next);
    return { from: zonedToIso(iso(first), "00:00", timeZone), to: zonedToIso(end, "00:00", timeZone) };
  }
  const days = Number(key);
  return { from: zonedToIso(addDays(tomorrow, -days), "00:00", timeZone), to: zonedToIso(tomorrow, "00:00", timeZone) };
}

export async function getReport(orgId: string, from: string, to: string): Promise<Report> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_overview", { p_org: orgId, p_from: from, p_to: to });
  if (error) throw error;
  return data as Report;
}
