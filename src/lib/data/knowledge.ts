import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { KnowledgeCategory, KnowledgeStatus } from "@/lib/knowledge/categories";

export type KnowledgeDocSummary = {
  id: string;
  organization_id: string | null;
  title: string;
  category: KnowledgeCategory;
  status: KnowledgeStatus;
  version: number;
  source_name: string | null;
  effective_from: string | null;
  effective_until: string | null;
  last_verified_on: string | null;
  next_review_on: string | null;
  updated_at: string;
};

export type KnowledgeDoc = KnowledgeDocSummary & {
  summary: string | null;
  content: string;
  jurisdiction: string;
  source_url: string | null;
  legal_references: string[];
  published_on: string | null;
  supersedes_id: string | null;
  import_format: string;
  tags: string[];
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

const SUMMARY_COLS =
  "id, organization_id, title, category, status, version, source_name, effective_from, effective_until, last_verified_on, next_review_on, updated_at";

export async function listKnowledgeDocs(opts: {
  orgId: string;
  scope: "private" | "common";
  status?: KnowledgeStatus | "all";
  category?: KnowledgeCategory;
  q?: string;
}): Promise<KnowledgeDocSummary[]> {
  const supabase = await createClient();
  let query = supabase.from("knowledge_documents").select(SUMMARY_COLS).order("updated_at", { ascending: false }).limit(200);
  query = opts.scope === "common" ? query.is("organization_id", null) : query.eq("organization_id", opts.orgId);
  if (opts.status && opts.status !== "all") query = query.eq("status", opts.status);
  else query = query.neq("status", "archived");
  if (opts.category) query = query.eq("category", opts.category);
  if (opts.q) query = query.ilike("title", `%${opts.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as KnowledgeDocSummary[];
}

/** Contagens para o cabeçalho: o que espera revisão e o que está com revisão em atraso. */
export async function knowledgeCounters(orgId: string) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [review, overdue] = await Promise.all([
    supabase
      .from("knowledge_documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "in_review"),
    supabase
      .from("knowledge_documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "approved")
      .lt("next_review_on", today),
  ]);
  return { inReview: review.count ?? 0, overdue: overdue.count ?? 0 };
}

export async function getKnowledgeDoc(id: string): Promise<KnowledgeDoc | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("knowledge_documents").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as KnowledgeDoc | null;
}

export async function getKnowledgeChunks(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_chunks")
    .select("id, position, heading, content")
    .eq("document_id", id)
    .order("position")
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

/** Cadeia de versões (anteriores e seguintes) visíveis ao utilizador. */
export async function getVersionChain(doc: KnowledgeDoc) {
  const supabase = await createClient();
  const chain: { id: string; version: number; status: KnowledgeStatus }[] = [];
  let prev = doc.supersedes_id;
  for (let i = 0; prev && i < 20; i++) {
    const { data } = await supabase.from("knowledge_documents").select("id, version, status, supersedes_id").eq("id", prev).maybeSingle();
    if (!data) break;
    chain.unshift({ id: data.id, version: data.version, status: data.status });
    prev = data.supersedes_id;
  }
  chain.push({ id: doc.id, version: doc.version, status: doc.status });
  let next: string | null = doc.id;
  for (let i = 0; next && i < 20; i++) {
    const { data }: { data: { id: string; version: number; status: KnowledgeStatus } | null } = await supabase
      .from("knowledge_documents")
      .select("id, version, status")
      .eq("supersedes_id", next)
      .neq("status", "archived")
      .maybeSingle();
    if (!data) break;
    chain.push(data);
    next = data.id;
  }
  return chain;
}

export type SearchHit = {
  chunk_id: string;
  document_id: string;
  title: string;
  heading: string | null;
  content: string;
  category: KnowledgeCategory;
  scope: "common" | "private";
  version: number;
  source_name: string | null;
  source_url: string | null;
  legal_references: string[];
  effective_from: string | null;
  effective_until: string | null;
  last_verified_on: string | null;
  next_review_on: string | null;
  rank: number;
};

export async function searchKnowledge(orgId: string, q: string): Promise<SearchHit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_knowledge", { p_org: orgId, p_query: q, p_limit: 10 });
  if (error) throw error;
  return (data ?? []) as SearchHit[];
}
