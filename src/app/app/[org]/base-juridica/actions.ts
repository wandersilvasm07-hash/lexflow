"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { orgAction } from "@/lib/auth/action";
import { isPlatformAdmin } from "@/lib/auth/dal";
import type { ActionResult } from "@/lib/errors";
import { CATEGORY_KEYS, isOfficialSource } from "@/lib/knowledge/categories";
import { chunkText } from "@/lib/knowledge/chunk";
import { ExtractionError, extractFromFile, extractFromOfficialUrl, type ImportFormat } from "@/lib/knowledge/extract";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation";
import { t } from "@/i18n";

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida.")
  .nullable()
  .optional();

const list = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(/[\n;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, max),
    );

const metaSchema = z
  .object({
    title: z.string().trim().min(3, "Indique um título.").max(300),
    category: z.enum(CATEGORY_KEYS as [string, ...string[]], { error: "Escolha uma categoria." }),
    summary: z.string().trim().max(2000).optional(),
    jurisdiction: z.string().trim().min(2).max(20).default("PT"),
    source_name: z.string().trim().max(200).optional(),
    source_url: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || /^https:\/\/\S+$/.test(v), "Use um endereço https completo."),
    legal_references: list(30),
    tags: list(20),
    published_on: optionalDate,
    effective_from: optionalDate,
    effective_until: optionalDate,
    last_verified_on: optionalDate,
    next_review_on: optionalDate,
  })
  .refine((m) => !m.effective_from || !m.effective_until || m.effective_until >= m.effective_from, {
    path: ["effective_until"],
    message: "O fim de vigência não pode ser anterior ao início.",
  });

const KNOWLEDGE_ERRORS: Record<string, string> = {
  not_editable: "Só documentos em rascunho ou em revisão podem ser editados. Crie uma nova versão.",
  invalid_transition: "Essa mudança de estado não é permitida a partir do estado atual.",
  approval_requires_source: "Para aprovar, indique a fonte oficial (nome ou endereço).",
  approval_requires_review_dates: "Para aprovar, indique a data da última verificação e a da próxima revisão.",
  approval_requires_future_review: "A data da próxima revisão tem de ser posterior a hoje.",
  approval_document_expired: "O fim de vigência já passou: este documento não pode ser aprovado como vigente.",
  version_requires_approved: "Só se cria nova versão de um documento aprovado ou desatualizado.",
  version_already_exists: "Já existe uma nova versão em preparação deste documento.",
  chunks_required: "O documento não tem texto para indexar.",
};

function knowledgeError(error: { message?: string }): ActionResult<never> | null {
  for (const [key, msg] of Object.entries(KNOWLEDGE_ERRORS)) {
    if (error.message?.includes(key)) return { ok: false, error: msg };
  }
  return null;
}

/** Erros conhecidos viram mensagens; os restantes seguem para o tratamento geral. */
function handleDbError(error: { message?: string }): ActionResult<never> {
  const known = knowledgeError(error);
  if (known) return known;
  throw error;
}

function metaFromForm(form: FormData) {
  const raw = Object.fromEntries(form);
  return metaSchema.safeParse(raw);
}

export async function createKnowledgeDocumentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let createdPath: string | null = null;
  const result = await orgAction(form, "knowledge.write", async (ctx) => {
    const scope = form.get("scope") === "common" ? "common" : "private";
    if (scope === "common" && !(await isPlatformAdmin())) return { ok: false, error: t.errors.forbidden };

    const parsed = metaFromForm(form);
    if (!parsed.success) {
      return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
    }
    const meta = { ...parsed.data };

    // Conteúdo: ficheiro, texto colado ou endereço de fonte oficial.
    const method = String(form.get("method") ?? "file");
    let text: string;
    let format: ImportFormat;
    try {
      if (method === "url") {
        const url = String(form.get("import_url") ?? "").trim();
        if (!isOfficialSource(url)) {
          return {
            ok: false,
            error: "Reveja os campos assinalados.",
            fieldErrors: { import_url: "Use um endereço https de uma fonte oficial (Diário da República, AIMA, gov.pt, …)." },
          };
        }
        const r = await extractFromOfficialUrl(url);
        text = r.text;
        format = "url";
        meta.source_url ||= r.finalUrl;
      } else if (method === "text") {
        const pasted = String(form.get("text") ?? "");
        if (pasted.trim().length < 20) {
          return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: { text: "Cole o texto do documento." } };
        }
        const r = await extractFromFile(new File([pasted], "texto.txt", { type: "text/plain" }));
        text = r.text;
        format = "text";
      } else {
        const file = form.get("file");
        if (!(file instanceof File) || file.size === 0) {
          return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: { file: "Escolha um ficheiro." } };
        }
        const r = await extractFromFile(file);
        text = r.text;
        format = r.format;
      }
    } catch (err) {
      if (err instanceof ExtractionError) return { ok: false, error: err.userMessage };
      throw err;
    }

    const chunks = chunkText(text);
    const supabase = await createClient();
    const { data: id, error } = await supabase.rpc("create_knowledge_document", {
      p_org: scope === "common" ? null : ctx.org.id,
      p_meta: { ...meta, import_format: format },
      p_content: text,
      p_chunks: chunks,
    });
    if (error) return handleDbError(error);

    revalidatePath(`/app/${ctx.org.slug}/base-juridica`);
    createdPath = `/app/${ctx.org.slug}/base-juridica/${id}?criado=1`;
    return { ok: true };
  });
  if (result.ok && createdPath) redirect(createdPath);
  return result;
}

export async function updateKnowledgeMetaAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "knowledge.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const parsed = metaFromForm(form);
    if (!parsed.success) {
      return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
    }
    const newText = String(form.get("text") ?? "");
    let content: string | null = null;
    let chunks: ReturnType<typeof chunkText> | null = null;
    if (newText.trim()) {
      try {
        content = (await extractFromFile(new File([newText], "texto.txt", { type: "text/plain" }))).text;
      } catch (err) {
        if (err instanceof ExtractionError) return { ok: false, error: err.userMessage };
        throw err;
      }
      chunks = chunkText(content);
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_knowledge_document", {
      p_doc: id,
      p_meta: parsed.data,
      p_content: content,
      p_chunks: chunks,
    });
    if (error) return handleDbError(error);
    revalidatePath(`/app/${ctx.org.slug}/base-juridica/${id}`);
    return { ok: true, message: "Alterações guardadas." };
  });
}

const STATUS_MESSAGES: Record<string, string> = {
  in_review: "Enviado para revisão.",
  draft: "Devolvido a rascunho.",
  approved: "Aprovado. O assistente já pode usar este documento.",
  outdated: "Marcado como desatualizado. O assistente deixa de o usar.",
  archived: "Arquivado.",
};

export async function setKnowledgeStatusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  // A permissão fina (escrever vs aprovar; base comum) é verificada na base de dados.
  return orgAction(form, "knowledge.read", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const status = z.enum(["draft", "in_review", "approved", "outdated", "archived"]).parse(form.get("status"));
    const note = String(form.get("note") ?? "").slice(0, 300);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_knowledge_status", { p_doc: id, p_status: status, p_note: note || null });
    if (error) return handleDbError(error);
    revalidatePath(`/app/${ctx.org.slug}/base-juridica`, "layout");
    return { ok: true, message: STATUS_MESSAGES[status] };
  });
}

export async function newKnowledgeVersionAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const result = await orgAction(form, "knowledge.read", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const supabase = await createClient();
    const { data: newId, error } = await supabase.rpc("new_knowledge_version", { p_doc: id });
    if (error) return handleDbError(error);
    target = `/app/${ctx.org.slug}/base-juridica/${newId}?versao=1`;
    return { ok: true };
  });
  if (result.ok && target) redirect(target);
  return result;
}
