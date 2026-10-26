import { describe, expect, it } from "vitest";
import {
  createOrgSchema,
  inviteSchema,
  isValidPortugueseNif,
  newPasswordSchema,
  safeNextPath,
  signUpSchema,
  slugify,
  SLUG_REGEX,
} from "./validation";
import { roleHasPermission } from "./authz/permissions";
import { toUserMessage } from "./errors";

describe("slugify", () => {
  it("remove acentos e símbolos", () => {
    expect(slugify("Silva & Conceição, Advogados Lda.")).toBe("silva-conceicao-advogados-lda");
  });
  it("gera sempre um slug válido para nomes razoáveis", () => {
    for (const name of ["Ana Sá", "Escritório Ômega 2026", "  A.B.C  Advogados  "]) {
      expect(slugify(name)).toMatch(SLUG_REGEX);
    }
  });
  it("respeita o limite de 48 caracteres sem terminar em hífen", () => {
    const s = slugify("a".repeat(30) + " " + "b".repeat(30));
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("NIF", () => {
  it("aceita NIFs válidos e rejeita inválidos", () => {
    expect(isValidPortugueseNif("123456789")).toBe(true);
    expect(isValidPortugueseNif("501964843")).toBe(true);
    expect(isValidPortugueseNif("123456780")).toBe(false);
    expect(isValidPortugueseNif("12345678")).toBe(false);
    expect(isValidPortugueseNif("312345678")).toBe(false);
  });
});

describe("esquemas", () => {
  it("registo exige palavra-passe longa e aceitação de termos", () => {
    const r = signUpSchema.safeParse({ fullName: "Ana", email: "ana@x.pt", password: "curta" });
    expect(r.success).toBe(false);
    const ok = signUpSchema.safeParse({
      fullName: "Ana",
      email: " ANA@X.PT ",
      password: "uma frase longa e segura",
      acceptTerms: "on",
    });
    expect(ok.success && ok.data.email).toBe("ana@x.pt");
  });

  it("confirmação de palavra-passe tem de coincidir", () => {
    expect(
      newPasswordSchema.safeParse({ password: "frase-passe-longa", confirm: "outra" }).success,
    ).toBe(false);
  });

  it("slug de escritório inválido é rejeitado", () => {
    expect(createOrgSchema.safeParse({ name: "X Lda", slug: "Com Espaço" }).success).toBe(false);
    expect(createOrgSchema.safeParse({ name: "X Lda", slug: "x-lda" }).success).toBe(true);
  });

  it("convite só aceita papéis conhecidos", () => {
    expect(inviteSchema.safeParse({ email: "a@b.pt", role: "superadmin" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@b.pt", role: "lawyer" }).success).toBe(true);
  });
});

describe("redirecionamento seguro", () => {
  it("bloqueia redirecionamentos para outros domínios", () => {
    expect(safeNextPath("https://evil.com")).toBe("/app");
    expect(safeNextPath("//evil.com")).toBe("/app");
    expect(safeNextPath("/\\evil.com")).toBe("/app");
    expect(safeNextPath("/app/escritorio/equipa")).toBe("/app/escritorio/equipa");
  });
});

describe("permissões", () => {
  it("gestor de marketing não acede a dados de atendimento", () => {
    expect(roleHasPermission("marketing_manager", "conversations.read")).toBe(false);
    expect(roleHasPermission("marketing_manager", "contacts.read")).toBe(false);
    expect(roleHasPermission("marketing_manager", "campaigns.publish")).toBe(true);
  });
  it("só administradores gerem equipa e faturação", () => {
    for (const role of ["lawyer", "legal_assistant", "marketing_manager", "viewer"] as const) {
      expect(roleHasPermission(role, "team.manage")).toBe(false);
      expect(roleHasPermission(role, "billing.manage")).toBe(false);
    }
  });
  it("assistente jurídico não aprova conteúdos jurídicos", () => {
    expect(roleHasPermission("legal_assistant", "knowledge.approve")).toBe(false);
  });
});

describe("mensagens de erro", () => {
  it("traduz erros conhecidos e esconde os desconhecidos", () => {
    expect(toUserMessage({ message: "last_admin" })).toMatch(/administrador/);
    expect(toUserMessage({ code: "invalid_credentials" })).toMatch(/incorretos/);
    expect(toUserMessage({ message: 'relation "x" does not exist' })).not.toMatch(/relation/);
  });
});
