import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Member = {
  membership_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: "active" | "suspended";
  joined_at: string;
};

/** Membros do escritório (RPC verifica a permissão team.read no servidor). */
export async function listMembers(orgId: string): Promise<Member[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_members", { p_org: orgId });
  if (error) throw error;
  return (data ?? []) as Member[];
}
