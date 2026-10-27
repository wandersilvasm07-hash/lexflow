import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AppointmentStatus } from "@/lib/crm";
import { listMembers } from "./team";

export type Service = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  mode: "presencial" | "online" | "presencial_ou_online";
  min_notice_minutes: number;
  bookable_by_ai: boolean;
  active: boolean;
  position: number;
};

export async function listServices(orgId: string, onlyActive = false): Promise<Service[]> {
  const supabase = await createClient();
  let q = supabase
    .from("services")
    .select("id, name, description, duration_minutes, mode, min_notice_minutes, bookable_by_ai, active, position")
    .eq("organization_id", orgId)
    .order("position")
    .order("name");
  if (onlyActive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Service[];
}

/** Profissionais que podem ter consultas: administradores e advogados ativos. */
export async function listProfessionals(orgId: string) {
  const members = await listMembers(orgId);
  return members
    .filter((m) => m.status === "active" && (m.role === "org_admin" || m.role === "lawyer"))
    .map((m) => ({ id: m.user_id, name: m.full_name ?? m.email }));
}

export type Appointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  source: "member" | "ai";
  mode: string | null;
  notes: string | null;
  professional_id: string;
  contact_id: string;
  contacts: { full_name: string | null; phone_e164: string | null } | null;
  services: { name: string } | null;
};

export async function listAppointments(orgId: string, fromIso: string, toIso: string, professionalId?: string) {
  const supabase = await createClient();
  let q = supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status, source, mode, notes, professional_id, contact_id, contacts(full_name, phone_e164), services(name)")
    .eq("organization_id", orgId)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at");
  if (professionalId) q = q.eq("professional_id", professionalId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Appointment[];
}

export async function listRules(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability_rules")
    .select("id, user_id, weekday, start_time, end_time")
    .eq("organization_id", orgId)
    .order("weekday")
    .order("start_time");
  if (error) throw error;
  return data ?? [];
}

export async function listUpcomingBlocks(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability_blocks")
    .select("id, user_id, starts_at, ends_at, reason")
    .eq("organization_id", orgId)
    .gte("ends_at", new Date().toISOString())
    .order("starts_at")
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function availableSlots(orgId: string, serviceId: string, fromIso: string, toIso: string, professionalId?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("available_slots", {
    p_org: orgId,
    p_service: serviceId,
    p_from: fromIso,
    p_to: toIso,
    p_professional: professionalId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as { professional_id: string; starts_at: string; ends_at: string }[];
}
