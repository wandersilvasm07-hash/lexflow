import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.ADS_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

const { publishCampaign } = await import("./publish");
const { toMetricsRow, MetaApiError } = await import("./meta");
const { encryptToken, decryptToken, signState, verifyState } = await import("./crypto");

type Call = { method: string; path: string; params: Record<string, string> };

/** Meta simulada: regista os pedidos e responde por caminho. */
function fakeMeta(handlers: Record<string, (p: Record<string, string>) => unknown>, failOn?: { path: RegExp; times: number; body: unknown }) {
  const calls: Call[] = [];
  let fails = failOn?.times ?? 0;
  const impl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v\d+\.\d+\//, "");
    const params = Object.fromEntries((init?.body ? new URLSearchParams(String(init.body)) : u.searchParams).entries());
    calls.push({ method: init?.method ?? "GET", path, params });
    if (failOn && fails > 0 && failOn.path.test(path)) {
      fails--;
      return new Response(JSON.stringify(failOn.body), { status: 400 });
    }
    const key = Object.keys(handlers).find((k) => new RegExp(k).test(`${init?.method ?? "GET"} ${path}`));
    if (!key) return new Response(JSON.stringify({ error: { message: `sem handler ${path}` } }), { status: 404 });
    return new Response(JSON.stringify(handlers[key](params)), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const handlers = {
  "POST act_1/campaigns": () => ({ id: "C1" }),
  "GET search": (p: Record<string, string>) => ({ data: p.q === "Lisboa" ? [{ key: "2735", name: "Lisboa", type: "city", country_code: "PT" }] : [] }),
  "POST act_1/adsets": () => ({ id: "S1" }),
  "POST act_1/adimages": () => ({ images: { x: { hash: "H" } } }),
  "POST act_1/adcreatives": () => ({ id: `CR${Math.random()}` }),
  "POST act_1/ads": () => ({ id: `AD${Math.random()}` }),
  "POST C1$": () => ({ success: true }),
  "GET C1$": () => ({ id: "C1", status: "ACTIVE", effective_status: "IN_PROCESS" }),
};

const campaign = (over = {}) => ({
  id: "c",
  name: "Reagrupamento",
  objective: "messages",
  destination: "whatsapp",
  destination_url: null,
  locations: ["Lisboa"],
  daily_budget_cents: 1000,
  total_budget_cents: 20000,
  starts_on: "2026-11-02",
  ends_on: "2026-11-21",
  external_ids: {} as Record<string, string>,
  account: { external_id: "act_1", page_id: "123", whatsapp_number: "+351910000000", token: "tok" },
  ads: [
    { position: 0, primary_text: "Texto A", headline: "Título A", description: null, cta: "WHATSAPP_MESSAGE", image_path: "a.jpg" },
    { position: 1, primary_text: "Texto B", headline: "Título B", description: null, cta: "WHATSAPP_MESSAGE", image_path: "b.jpg" },
  ],
  ...over,
});

function store() {
  const saved: Record<string, string> = {};
  const s = {
    saved,
    result: null as null | { status?: string; error?: string; rejected?: boolean },
    progress: async (ids: Record<string, string>) => void Object.assign(saved, ids),
    imageBase64: async () => "aW1n",
    published: async (status: string) => void (s.result = { status }),
    failed: async (error: string, rejected: boolean) => void (s.result = { error, rejected }),
  };
  return s;
}

describe("publicação na Meta (respostas simuladas)", () => {
  it("cria tudo em pausa, guarda cada passo, ativa no fim e lê o estado real", async () => {
    const { calls, impl } = fakeMeta(handlers);
    const st = store();
    const r = await publishCampaign(campaign(), st, impl);
    expect(r).toEqual({ ok: true, status: "IN_PROCESS" });
    const camp = calls.find((c) => c.path === "act_1/campaigns")!;
    expect(camp.params).toMatchObject({ status: "PAUSED", objective: "OUTCOME_ENGAGEMENT", special_ad_categories: "[]", spend_cap: "20000" });
    const adset = calls.find((c) => c.path === "act_1/adsets")!;
    expect(adset.params).toMatchObject({ daily_budget: "1000", destination_type: "WHATSAPP", optimization_goal: "CONVERSATIONS" });
    expect(JSON.parse(adset.params.targeting)).toEqual({ geo_locations: { cities: [{ key: "2735" }] }, age_min: 18 });
    expect(adset.params.start_time).toBe("2026-11-02T00:00:00+0000"); // inverno em Lisboa = UTC
    expect(calls.filter((c) => c.path === "act_1/ads")).toHaveLength(2);
    // A ativação é o último passo de escrita.
    const writes = calls.filter((c) => c.method === "POST");
    expect(writes[writes.length - 1]).toMatchObject({ path: "C1", params: { status: "ACTIVE" } });
    expect(st.saved).toMatchObject({ campaign: "C1", adset: "S1", img_0: "H", img_1: "H" });
    expect(st.result).toEqual({ status: "IN_PROCESS" });
  });

  it("depois de uma falha, retoma sem criar outra campanha nem outro conjunto", async () => {
    const first = fakeMeta(handlers, { path: /act_1\/ads$/, times: 1, body: { error: { message: "Temporário", code: 2 } } });
    const st = store();
    const r1 = await publishCampaign(campaign(), st, first.impl);
    expect(r1.ok).toBe(false);
    expect(st.result).toMatchObject({ rejected: false });

    const second = fakeMeta(handlers);
    const r2 = await publishCampaign(campaign({ external_ids: { ...st.saved } }), store(), second.impl);
    expect(r2.ok).toBe(true);
    expect(second.calls.filter((c) => c.path === "act_1/campaigns")).toHaveLength(0);
    expect(second.calls.filter((c) => c.path === "act_1/adsets")).toHaveLength(0);
    expect(second.calls.filter((c) => c.path === "act_1/adcreatives")).toHaveLength(1); // só o que faltava
  });

  it("rejeição por política fica como rejeitada (não se repete às cegas)", async () => {
    const { impl } = fakeMeta(handlers, {
      path: /act_1\/campaigns/,
      times: 1,
      body: { error: { message: "Ads about social issues are not allowed in the EU", code: 100, error_user_msg: "Anúncio sobre tema social" } },
    });
    const st = store();
    const r = await publishCampaign(campaign(), st, impl);
    expect(r).toEqual({ ok: false, error: "Meta: Anúncio sobre tema social" });
    expect(st.result).toMatchObject({ rejected: true });
  });

  it("localização desconhecida falha antes de gastar", async () => {
    const { calls, impl } = fakeMeta(handlers);
    const r = await publishCampaign(campaign({ locations: ["Atlântida"] }), store(), impl);
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.path === "act_1/adsets")).toBe(false);
    expect(calls.some((c) => c.path === "C1" && c.method === "POST")).toBe(false);
  });

  it("formulário instantâneo e falta de página são recusados sem chamar a Meta", async () => {
    const { calls, impl } = fakeMeta(handlers);
    expect((await publishCampaign(campaign({ destination: "form" }), store(), impl)).ok).toBe(false);
    expect((await publishCampaign(campaign({ account: { external_id: "act_1", page_id: null, whatsapp_number: null, token: "t" } }), store(), impl)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("página de destino usa o link e o botão escolhidos", async () => {
    const { calls, impl } = fakeMeta(handlers);
    await publishCampaign(
      campaign({
        destination: "landing_page",
        objective: "traffic",
        destination_url: "https://escritorio.pt/reagrupamento",
        ads: [{ position: 0, primary_text: "T", headline: "H", description: null, cta: "LEARN_MORE", image_path: "a.jpg" }],
      }),
      store(),
      impl,
    );
    const cr = JSON.parse(calls.find((c) => c.path === "act_1/adcreatives")!.params.object_story_spec);
    expect(cr.link_data).toMatchObject({ link: "https://escritorio.pt/reagrupamento", call_to_action: { type: "LEARN_MORE" } });
    expect(calls.find((c) => c.path === "act_1/adsets")!.params).toMatchObject({ destination_type: "WEBSITE", optimization_goal: "LINK_CLICKS" });
  });
});

describe("métricas e segurança dos tokens", () => {
  it("converte insights (gasto em cêntimos, conversas iniciadas)", () => {
    expect(
      toMetricsRow({
        date_start: "2026-11-02",
        impressions: "1200",
        reach: "900",
        clicks: "31",
        spend: "9.87",
        actions: [
          { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "4" },
          { action_type: "link_click", value: "31" },
        ],
      }),
    ).toEqual({ day: "2026-11-02", impressions: 1200, reach: 900, clicks: 31, conversations_started: 4, leads: 0, spend_cents: 987 });
  });

  it("o token é cifrado (não aparece em claro) e adulterações são detetadas", () => {
    const enc = encryptToken("EAAB-segredo");
    expect(enc).not.toContain("segredo");
    expect(decryptToken(enc)).toBe("EAAB-segredo");
    const parts = enc.split(".");
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "BB" : "AA");
    expect(() => decryptToken(parts.join("."))).toThrow();
  });

  it("estado do OAuth assinado e com validade", () => {
    const s = signState({ org: "a", exp: Date.now() + 60_000 });
    expect(verifyState<{ org: string }>(s)?.org).toBe("a");
    expect(verifyState(s.replace(/.$/, s.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(verifyState(signState({ org: "a", exp: Date.now() - 1 }))).toBeNull();
  });

  it("classifica erros de política e autenticação", () => {
    expect(new MetaApiError("Invalid OAuth access token", 190, null, null, 400).isAuth).toBe(true);
    expect(new MetaApiError("social issue ads", 100, null, null, 400).isPolicy).toBe(true);
  });
});
