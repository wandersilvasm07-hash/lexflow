import { Field, Input, Select, Textarea, describedBy } from "@/components/ui";
import { CATEGORY_KEYS, KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";

export type MetaDefaults = {
  title?: string;
  category?: string;
  summary?: string | null;
  jurisdiction?: string;
  source_name?: string | null;
  source_url?: string | null;
  legal_references?: string[];
  tags?: string[];
  published_on?: string | null;
  effective_from?: string | null;
  effective_until?: string | null;
  last_verified_on?: string | null;
  next_review_on?: string | null;
};

/** Campos de metadados de um documento da base jurídica (secção 9). */
export function MetaFields({ d = {}, e }: { d?: MetaDefaults; e?: Record<string, string> }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id="title" label="Título" error={e?.title}>
          <Input {...describedBy("title", e?.title)} defaultValue={d.title} required />
        </Field>
      </div>
      <Field id="category" label="Categoria" error={e?.category}>
        <Select {...describedBy("category", e?.category)} defaultValue={d.category ?? ""} required>
          <option value="" disabled>
            Escolha…
          </option>
          {CATEGORY_KEYS.map((c) => (
            <option key={c} value={c}>
              {KNOWLEDGE_CATEGORIES[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="jurisdiction" label="Jurisdição" error={e?.jurisdiction}>
        <Input {...describedBy("jurisdiction", e?.jurisdiction)} defaultValue={d.jurisdiction ?? "PT"} />
      </Field>
      <Field id="source_name" label="Fonte oficial" hint="Ex.: AIMA, Diário da República, portal gov.pt." error={e?.source_name}>
        <Input {...describedBy("source_name", e?.source_name, true)} defaultValue={d.source_name ?? ""} />
      </Field>
      <Field id="source_url" label="Endereço da fonte" error={e?.source_url}>
        <Input {...describedBy("source_url", e?.source_url)} type="url" defaultValue={d.source_url ?? ""} placeholder="https://" />
      </Field>
      <div className="sm:col-span-2">
        <Field
          id="legal_references"
          label="Referências legislativas"
          hint="Uma por linha, tal como constam da fonte. Não acrescente referências que não tenha confirmado."
          error={e?.legal_references}
        >
          <Textarea
            {...describedBy("legal_references", e?.legal_references, true)}
            rows={2}
            defaultValue={(d.legal_references ?? []).join("\n")}
          />
        </Field>
      </div>
      <Field id="published_on" label="Data de publicação" error={e?.published_on}>
        <Input {...describedBy("published_on", e?.published_on)} type="date" defaultValue={d.published_on ?? ""} />
      </Field>
      <Field id="effective_from" label="Em vigor desde" error={e?.effective_from}>
        <Input {...describedBy("effective_from", e?.effective_from)} type="date" defaultValue={d.effective_from ?? ""} />
      </Field>
      <Field id="effective_until" label="Fim de vigência" hint="Deixe vazio se continua em vigor." error={e?.effective_until}>
        <Input
          {...describedBy("effective_until", e?.effective_until, true)}
          type="date"
          defaultValue={d.effective_until ?? ""}
        />
      </Field>
      <Field id="last_verified_on" label="Última verificação na fonte" error={e?.last_verified_on}>
        <Input {...describedBy("last_verified_on", e?.last_verified_on)} type="date" defaultValue={d.last_verified_on ?? ""} />
      </Field>
      <Field
        id="next_review_on"
        label="Próxima revisão"
        hint="Depois desta data o assistente deixa de usar o documento até alguém o verificar."
        error={e?.next_review_on}
      >
        <Input {...describedBy("next_review_on", e?.next_review_on, true)} type="date" defaultValue={d.next_review_on ?? ""} />
      </Field>
      <Field id="tags" label="Etiquetas" hint="Separadas por ponto e vírgula." error={e?.tags}>
        <Input {...describedBy("tags", e?.tags, true)} defaultValue={(d.tags ?? []).join("; ")} />
      </Field>
      <div className="sm:col-span-2">
        <Field id="summary" label="Resumo (opcional)" error={e?.summary}>
          <Textarea {...describedBy("summary", e?.summary)} rows={2} defaultValue={d.summary ?? ""} />
        </Field>
      </div>
    </div>
  );
}
