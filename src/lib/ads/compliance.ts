/**
 * Revisão de conformidade dos anúncios (verificação de regras, determinística).
 *
 * Base (confirmada em outubro de 2026; ver docs/ADS.md):
 *  - Estatuto da Ordem dos Advogados: o art. 94.º (publicidade) foi revogado
 *    pela Lei n.º 6/2024, mas continuam a aplicar-se a proibição de angariação
 *    de clientes (art. 90.º, n.º 2, al. h), a dignidade da profissão e o
 *    segredo profissional (não divulgar casos ou clientes).
 *  - Regime geral da publicidade: proibida a publicidade enganosa (promessas
 *    de resultados, taxas de sucesso não verificáveis, superlativos sem prova).
 *  - Meta: desde 6/10/2025 não entrega na UE anúncios sobre temas sociais,
 *    eleitorais ou políticos; anúncios não podem afirmar ou insinuar
 *    características pessoais de quem os vê.
 *
 * Não substitui a revisão por um advogado: a aprovação pede essa confirmação.
 */

export const COMPLIANCE_VERSION = "2026-10-28.1";

export type Severity = "block" | "warn";
export type ComplianceIssue = { severity: Severity; code: string; message: string; where: string; excerpt?: string };
export type ComplianceResult = { version: string; checked_at: string; issues: ComplianceIssue[] };

export type AdContent = {
  primary_text: string;
  headline: string;
  description?: string | null;
  cta: string;
  image_brief?: string | null;
};

type Rule = { code: string; severity: Severity; pattern: RegExp; message: string };

const RULES: Rule[] = [
  // Promessas e garantias de resultado (publicidade enganosa)
  {
    code: "promessa_resultado",
    severity: "block",
    pattern: /\b(garanti(do|da|dos|das|mos|a|r)|garantia de|100\s?%|sem risco|resultado certo|aprova[çc][aã]o (certa|garantida)|sucesso garantido|de certeza que (consegue|obt[eé]m))/i,
    message: "Promete ou garante resultados. A decisão é sempre das autoridades; prometer resultados é publicidade enganosa.",
  },
  {
    code: "taxa_sucesso",
    severity: "block",
    pattern: /\b(\d{1,3}\s?%\s?(de )?(sucesso|aprova[çc][aã]o|casos ganhos)|taxa de (sucesso|aprova[çc][aã]o)|casos ganhos|processos ganhos|nunca perdemos)/i,
    message: "Indica taxas de sucesso ou casos ganhos, que não são verificáveis e podem ser enganosos.",
  },
  {
    code: "promessa_documento",
    severity: "warn",
    pattern: /\b(consiga|obtenha|tenha) (j[aá] )?(o seu|a sua|seu|sua) (visto|autoriza[çc][aã]o de resid[eê]ncia|t[ií]tulo|nacionalidade|passaporte|green card)/i,
    message: "Sugere que o leitor vai obter o documento. Prefira descrever o apoio (ex.: \"apoio no pedido de…\").",
  },
  {
    code: "prazo_prometido",
    severity: "warn",
    pattern: /\b(em (apenas )?\d+ (dias|semanas|meses)|r[aá]pido e garantido|resolvemos (j[aá]|hoje))/i,
    message: "Indica prazos de resolução. Os prazos dependem das entidades públicas e não podem ser prometidos.",
  },
  // Dignidade, comparação e superlativos
  {
    code: "superlativo",
    severity: "warn",
    pattern: /\b(o melhor|os melhores|a melhor|n[uú]mero 1|n\.?º ?1|l[ií]der|o mais (barato|r[aá]pido|eficaz)|imbat[ií]vel)\b/i,
    message: "Superlativo ou comparação sem prova. Pode ser publicidade enganosa e afetar a dignidade da profissão.",
  },
  {
    code: "comparacao_colegas",
    severity: "block",
    pattern: /\b(ao contr[aá]rio d(os|e) outros (advogados|escrit[oó]rios)|outros advogados (n[aã]o|falham|cobram)|melhor do que (os )?outros)/i,
    message: "Compara-se negativamente com outros advogados, o que contraria os deveres de correção entre colegas.",
  },
  {
    code: "testemunho_cliente",
    severity: "block",
    pattern: /\b(cliente(s)? satisfeit|testemunho|depoimento|o nosso cliente [A-ZÁÉÍÓÚ]|caso d[oa] (sr|sra|senhor|senhora)\.? [A-ZÁÉÍÓÚ])/,
    message: "Refere clientes ou casos concretos. O segredo profissional impede divulgar casos e clientes.",
  },
  // Angariação e pressão
  {
    code: "pressao",
    severity: "warn",
    pattern: /\b([uú]ltimas vagas|s[oó] hoje|[uú]ltima oportunidade|n[aã]o perca|antes que seja tarde|corra)\b/i,
    message: "Linguagem de pressão comercial. Pode ser vista como angariação e não é adequada à profissão.",
  },
  {
    code: "gratuito",
    severity: "warn",
    pattern: /\b(gr[aá]tis|gratuit[oa]|sem custos?)\b/i,
    message: "Menciona gratuitidade. Confirme que é verdade e indique as condições, para não ser enganoso.",
  },
  // Ligação a entidades oficiais
  {
    code: "entidade_oficial",
    severity: "block",
    pattern: /\b(parceir[oa]s? (oficia(l|is) )?d[ao] (AIMA|SEF|governo|Estado|consulado)|(servi[çc]o|canal|site) oficial|em nome d[ao] (AIMA|governo))/i,
    message: "Sugere ligação a uma entidade oficial. O escritório não pode apresentar-se como serviço público.",
  },
  // Política e temas sociais (Meta não entrega estes anúncios na UE)
  {
    code: "tema_politico",
    severity: "block",
    pattern: /\b(vot(e|em|ar) (em|no|na)|elei[çc][oõ]es|partido|campanha eleitoral|manifesta[çc][aã]o|lei injusta|contra o governo|pol[ií]tica de imigra[çc][aã]o (do governo|injusta))/i,
    message: "Conteúdo político ou de opinião sobre imigração. A Meta não entrega anúncios de temas sociais ou políticos na UE.",
  },
  {
    code: "opiniao_social",
    severity: "warn",
    pattern: /\b(governo|ministr[oa]|deputad|parlamento|direitos dos imigrantes|xenofobia|racismo)\b/i,
    message: "Toca em temas políticos ou sociais. Mantenha o anúncio centrado no serviço jurídico para não ser classificado como anúncio político.",
  },
  // Características pessoais (política da Meta)
  {
    code: "atributo_pessoal",
    severity: "warn",
    pattern: /\b(voc[eê]|est[aá]s?|[eé]s) (est[aá] )?(ilegal|em situa[çc][aã]o irregular|sem documentos|indocumentad|imigrante|estrangeir[oa]|doente|endividad)/i,
    message: "Afirma ou insinua uma característica pessoal do leitor (ex.: situação irregular). A Meta proíbe este tipo de frase.",
  },
];

// `\b` do JavaScript só conhece letras ASCII ("Últimas" falharia). Usa-se uma
// fronteira que reconhece letras acentuadas.
function unicodeWords(re: RegExp): RegExp {
  const source = re.source.replace(/^\\b/, "(?<![\\p{L}\\d])").replace(/\\b$/, "(?![\\p{L}\\d])");
  return new RegExp(source, re.flags.includes("u") ? re.flags : `${re.flags}u`);
}
for (const rule of RULES) rule.pattern = unicodeWords(rule.pattern);

const LIMITS = { primary_text: 125, headline: 40, description: 30 };

function excerpt(text: string, match: RegExpMatchArray): string {
  const i = match.index ?? 0;
  return text.slice(Math.max(0, i - 20), Math.min(text.length, i + match[0].length + 20)).trim();
}

export function checkCompliance(ads: AdContent[], opts: { destination?: string; now?: Date } = {}): ComplianceResult {
  const issues: ComplianceIssue[] = [];
  ads.forEach((ad, i) => {
    const label = `Anúncio ${String.fromCharCode(65 + i)}`;
    const fields: [string, string][] = [
      ["texto", ad.primary_text ?? ""],
      ["título", ad.headline ?? ""],
      ["descrição", ad.description ?? ""],
      ["imagem", ad.image_brief ?? ""],
    ];
    for (const [field, text] of fields) {
      if (!text) continue;
      for (const rule of RULES) {
        const m = text.match(rule.pattern);
        if (m) {
          // O briefing da imagem não é publicado (e costuma listar o que evitar):
          // serve de aviso para quem cria a imagem, nunca bloqueia.
          const brief = field === "imagem";
          issues.push({
            severity: brief ? "warn" : rule.severity,
            code: rule.code,
            message: brief ? `No briefing da imagem (não publicado): confirme que a imagem final não o faz. ${rule.message}` : rule.message,
            where: `${label} · ${field}`,
            excerpt: excerpt(text, m),
          });
        }
      }
    }
    if ((ad.primary_text ?? "").length > LIMITS.primary_text) {
      issues.push({
        severity: "warn",
        code: "texto_longo",
        message: `O texto tem ${ad.primary_text.length} caracteres. Acima de ${LIMITS.primary_text}, a Meta corta-o com "Ver mais" no telemóvel.`,
        where: `${label} · texto`,
      });
    }
    if ((ad.headline ?? "").length > LIMITS.headline) {
      issues.push({
        severity: "warn",
        code: "titulo_longo",
        message: `O título tem ${ad.headline.length} caracteres; recomenda-se até ${LIMITS.headline}.`,
        where: `${label} · título`,
      });
    }
    if (opts.destination === "whatsapp" && ad.cta !== "WHATSAPP_MESSAGE") {
      issues.push({
        severity: "warn",
        code: "cta_destino",
        message: "O destino é o WhatsApp; o botão \"Enviar mensagem\" é o mais adequado.",
        where: `${label} · botão`,
      });
    }
    if (/\b(envie|mande|anexe) (o seu |a sua )?(passaporte|documento|t[ií]tulo|cart[aã]o)/i.test(ad.primary_text ?? "")) {
      issues.push({
        severity: "block",
        code: "dados_sensiveis",
        message: "Pede documentos pessoais através do anúncio/WhatsApp. Documentos só por canal seguro.",
        where: `${label} · texto`,
      });
    }
  });
  if (!ads.length) {
    issues.push({ severity: "block", code: "sem_anuncios", message: "A campanha não tem anúncios.", where: "Campanha" });
  }
  return { version: COMPLIANCE_VERSION, checked_at: (opts.now ?? new Date()).toISOString(), issues };
}

export function hasBlocking(result: Pick<ComplianceResult, "issues"> | null | undefined): boolean {
  return Boolean(result?.issues?.some((i) => i.severity === "block"));
}
