import { z } from "zod";
import { ORG_ROLES } from "@/lib/authz/permissions";

/** Converte um nome num endereço válido: "Silva & Costa, Lda." → "silva-costa-lda". */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

/** Endereços reservados para rotas da aplicação (igual à restrição na base de dados). */
export const RESERVED_SLUGS = [
  "conta",
  "novo-escritorio",
  "admin",
  "api",
  "auth",
  "convite",
  "definicoes",
  "suporte",
  "app",
] as const;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Indique um email válido." }))
  .refine((v) => v.length <= 254, "Email demasiado longo.");

/** Mínimo 12 caracteres: frases-passe longas são mais seguras e mais fáceis de lembrar. */
export const password = z
  .string()
  .min(12, "A palavra-passe precisa de pelo menos 12 caracteres.")
  .max(128, "A palavra-passe pode ter no máximo 128 caracteres.");

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Indique o seu nome.").max(120),
  email,
  password,
  acceptTerms: z.literal("on", { error: "Precisa de aceitar os termos e a política de privacidade." }),
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Indique a palavra-passe."),
  next: z.string().optional(),
});

export const emailOnlySchema = z.object({ email });
export const newPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "As palavras-passe não coincidem.",
  });

export const createOrgSchema = z.object({
  name: z.string().trim().min(2, "Indique o nome do escritório.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_REGEX, "Use 3 a 48 caracteres: letras minúsculas, números e hífenes.")
    .refine((v) => !(RESERVED_SLUGS as readonly string[]).includes(v), "Esse endereço está reservado. Escolha outro."),
});

export const inviteSchema = z.object({
  email,
  role: z.enum(ORG_ROLES, { error: "Escolha um papel." }),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const orgProfileSchema = z.object({
  name: z.string().trim().min(2, "Indique o nome do escritório.").max(120),
  legal_name: optionalText(200),
  nif: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => v === "" || isValidPortugueseNif(v), "NIF inválido.")
    .transform((v) => (v === "" ? null : v)),
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || z.email().safeParse(v).success, "Email inválido."),
  phone: optionalText(32),
  address: optionalText(300),
  timezone: z.string().trim().min(1).max(64),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Indique o seu nome.").max(120),
});

/** Validação do dígito de controlo do NIF português (módulo 11). */
export function isValidPortugueseNif(nif: string): boolean {
  if (!/^[0-9]{9}$/.test(nif)) return false;
  if (!"125689".includes(nif[0]) && !["45", "70", "71", "72", "74", "75", "77", "79", "90", "91", "98", "99"].includes(nif.slice(0, 2))) {
    return false;
  }
  const sum = nif
    .slice(0, 8)
    .split("")
    .reduce((acc, d, i) => acc + Number(d) * (9 - i), 0);
  const mod = sum % 11;
  const check = mod < 2 ? 0 : 11 - mod;
  return check === Number(nif[8]);
}

/** Transforma os erros do zod num mapa campo → primeira mensagem. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    out[key] ??= issue.message;
  }
  return out;
}

/** Só aceita caminhos internos para evitar redirecionamentos abertos. */
export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
