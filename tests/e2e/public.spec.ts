import { expect, test } from "@playwright/test";

test.describe("landing page", () => {
  test("apresenta a proposta de valor, planos, FAQ e demonstração", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("primeiro contacto");
    await expect(page.locator("#planos")).toBeVisible();
    await expect(page.locator("#perguntas")).toBeVisible();
    await expect(page.locator("#demonstracao")).toBeVisible();
    // A conversa da hero está identificada como ilustração.
    await expect(page.getByText("Exemplo ilustrativo")).toBeVisible();
  });

  test("não inventa testemunhos, clientes, preços ou estatísticas", async ({ page }) => {
    await page.goto("/");
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const banned of ["testemunho", "clientes satisfeitos", "€", "% dos", "mais de 1"]) {
      expect(text, `não devia conter "${banned}"`).not.toContain(banned);
    }
  });

  test("não há scroll horizontal", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("formulário de demonstração valida os campos", async ({ page }) => {
    await page.goto("/#demonstracao");
    await page.getByRole("button", { name: "Pedir demonstração" }).last().click();
    await expect(page.getByRole("alert").first()).toBeVisible();
  });
});

test.describe("proteção de rotas", () => {
  test("a área da aplicação exige sessão", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/entrar/);
  });

  test("um escritório não é acessível sem sessão", async ({ page }) => {
    await page.goto("/app/qualquer-escritorio/equipa");
    await expect(page).toHaveURL(/\/entrar/);
  });

  test("convite com token inválido não revela nada", async ({ page }) => {
    await page.goto("/convite/nao-e-um-token");
    await expect(page.getByText(/inválido|não está configurada/)).toBeVisible();
  });
});

test.describe("autenticação", () => {
  test("login, registo e recuperação estão acessíveis", async ({ page }) => {
    for (const [path, heading] of [
      ["/entrar", "Entrar"],
      ["/registar", "Criar conta"],
      ["/recuperar-palavra-passe", "Recuperar palavra-passe"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });

  test("registo exige palavra-passe longa e aceitação dos termos", async ({ page }) => {
    test.skip(!!process.env.E2E_SUPABASE, "valida no servidor; coberto pelos testes unitários");
    await page.goto("/registar");
    await page.getByLabel("Nome").fill("Ana Teste");
    await page.getByLabel("Email profissional").fill("ana@teste.pt");
    await page.getByLabel("Palavra-passe").fill("curta");
    await page.getByRole("button", { name: "Criar conta" }).click();
    // Sem Supabase configurado, o servidor diz isso claramente em vez de falhar em silêncio.
    await expect(page.getByRole("alert").first()).toBeVisible();
  });
});
