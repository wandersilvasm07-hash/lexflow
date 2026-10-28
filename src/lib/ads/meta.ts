import "server-only";

/**
 * Cliente da Marketing API da Meta (Graph API).
 *
 * ATENÇÃO: implementado segundo a documentação oficial e testado com respostas
 * simuladas, mas ainda NÃO validado com uma conta de anúncios real. Antes de
 * vender, fazer uma publicação de teste com orçamento mínimo (ver docs/ADS.md).
 */

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v26.0";
const BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export const META_SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list", "pages_read_engagement", "pages_manage_ads"];

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly userMessage: string | null,
    readonly status: number,
  ) {
    super(message);
  }
  /** Erros de política/revisão (não adianta repetir). */
  get isPolicy(): boolean {
    return this.code === 1487390 || this.subcode === 1885183 || /policy|pol[ií]tica|special ad categor|social issue/i.test(this.message);
  }
  get isAuth(): boolean {
    return this.code === 190 || this.status === 401;
  }
}

type Fetch = typeof fetch;

export function isMetaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.ADS_TOKEN_KEY);
}

export class MetaAds {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      body.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    body.set("access_token", this.token);
    const url = method === "GET" ? `${BASE}/${path}?${body}` : `${BASE}/${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
      body: method === "POST" ? body : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
    } & T;
    if (!res.ok || json.error) {
      const e = json.error ?? {};
      throw new MetaApiError(e.message ?? `HTTP ${res.status}`, e.code ?? null, e.error_subcode ?? null, e.error_user_msg ?? null, res.status);
    }
    return json;
  }

  // ---- OAuth -------------------------------------------------------------
  static authorizeUrl(redirectUri: string, state: string): string {
    const p = new URLSearchParams({
      client_id: process.env.META_APP_ID ?? "",
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      scope: META_SCOPES.join(","),
    });
    return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${p}`;
  }

  static async exchangeCode(code: string, redirectUri: string, fetchImpl: Fetch = fetch): Promise<{ token: string; expiresAt: Date | null }> {
    const short = await new MetaAds("", fetchImpl).callNoToken<{ access_token: string }>("oauth/access_token", {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    });
    const long = await new MetaAds("", fetchImpl).callNoToken<{ access_token: string; expires_in?: number }>("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: short.access_token,
    });
    return {
      token: long.access_token,
      expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
    };
  }

  private async callNoToken<T>(path: string, params: Record<string, unknown>): Promise<T> {
    const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v ?? "")]));
    const res = await this.fetchImpl(`${BASE}/${path}?${q}`, { signal: AbortSignal.timeout(30_000) });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
    if (!res.ok || json.error) {
      throw new MetaApiError(json.error?.message ?? `HTTP ${res.status}`, json.error?.code ?? null, null, null, res.status);
    }
    return json;
  }

  async listAdAccounts() {
    const r = await this.call<{ data: { id: string; name: string; currency: string; account_status: number }[] }>(
      "GET",
      "me/adaccounts",
      { fields: "id,name,currency,account_status", limit: 50 },
    );
    return r.data.filter((a) => a.account_status === 1);
  }

  async listPages() {
    const r = await this.call<{ data: { id: string; name: string }[] }>("GET", "me/accounts", { fields: "id,name", limit: 50 });
    return r.data;
  }

  // ---- Segmentação -------------------------------------------------------
  /** Converte nomes de locais (ex.: "Lisboa") em chaves de segmentação da Meta, em Portugal. */
  async resolveLocations(names: string[]): Promise<{ countries: string[]; regions: { key: string }[]; cities: { key: string; radius?: number; distance_unit?: string }[]; resolved: { name: string; type: string; label: string }[]; missing: string[] }> {
    const out = { countries: [] as string[], regions: [] as { key: string }[], cities: [] as { key: string }[], resolved: [] as { name: string; type: string; label: string }[], missing: [] as string[] };
    for (const name of names) {
      if (/^portugal$/i.test(name.trim())) {
        out.countries.push("PT");
        out.resolved.push({ name, type: "country", label: "Portugal" });
        continue;
      }
      const r = await this.call<{ data: { key: string; name: string; type: string; country_code: string; region?: string }[] }>(
        "GET",
        "search",
        { type: "adgeolocation", q: name, location_types: ["city", "region"], country_code: "PT", limit: 5 },
      );
      const hit = r.data.find((d) => d.country_code === "PT");
      if (!hit) {
        out.missing.push(name);
        continue;
      }
      if (hit.type === "region") out.regions.push({ key: hit.key });
      else out.cities.push({ key: hit.key });
      out.resolved.push({ name, type: hit.type, label: hit.region ? `${hit.name}, ${hit.region}` : hit.name });
    }
    return out;
  }

  // ---- Publicação ----------------------------------------------------------
  createCampaign(account: string, p: { name: string; objective: string; spendCapCents?: number | null }) {
    return this.call<{ id: string }>("POST", `${account}/campaigns`, {
      name: p.name,
      objective: p.objective,
      status: "PAUSED",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      ...(p.spendCapCents ? { spend_cap: p.spendCapCents } : {}),
    });
  }

  createAdSet(account: string, p: Record<string, unknown>) {
    return this.call<{ id: string }>("POST", `${account}/adsets`, { status: "ACTIVE", ...p });
  }

  uploadImage(account: string, bytesBase64: string) {
    return this.call<{ images: Record<string, { hash: string }> }>("POST", `${account}/adimages`, { bytes: bytesBase64 }).then(
      (r) => Object.values(r.images)[0]?.hash ?? null,
    );
  }

  createCreative(account: string, p: { name: string; object_story_spec: unknown }) {
    return this.call<{ id: string }>("POST", `${account}/adcreatives`, p);
  }

  createAd(account: string, p: { name: string; adset_id: string; creative_id: string }) {
    return this.call<{ id: string }>("POST", `${account}/ads`, {
      name: p.name,
      adset_id: p.adset_id,
      creative: { creative_id: p.creative_id },
      status: "ACTIVE",
    });
  }

  setStatus(objectId: string, status: "ACTIVE" | "PAUSED") {
    return this.call<{ success: boolean }>("POST", objectId, { status });
  }

  getCampaign(id: string) {
    return this.call<{ id: string; status: string; effective_status: string }>("GET", id, { fields: "id,status,effective_status" });
  }

  getAdStatuses(campaignId: string) {
    return this.call<{ data: { id: string; effective_status: string; ad_review_feedback?: unknown }[] }>("GET", `${campaignId}/ads`, {
      fields: "id,effective_status,ad_review_feedback",
      limit: 50,
    }).then((r) => r.data);
  }

  async insights(campaignId: string, since: string, until: string) {
    const r = await this.call<{
      data: { date_start: string; impressions?: string; reach?: string; clicks?: string; spend?: string; actions?: { action_type: string; value: string }[] }[];
    }>("GET", `${campaignId}/insights`, {
      fields: "impressions,reach,clicks,spend,actions",
      time_increment: 1,
      time_range: { since, until },
      limit: 100,
    });
    return r.data.map(toMetricsRow);
  }
}

/** Converte uma linha de insights da Meta no formato guardado (cêntimos). */
export function toMetricsRow(d: {
  date_start: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  spend?: string;
  actions?: { action_type: string; value: string }[];
}) {
  const action = (types: string[]) =>
    (d.actions ?? []).filter((a) => types.includes(a.action_type)).reduce((n, a) => n + Number(a.value || 0), 0);
  return {
    day: d.date_start,
    impressions: Number(d.impressions ?? 0),
    reach: Number(d.reach ?? 0),
    clicks: Number(d.clicks ?? 0),
    conversations_started: action(["onsite_conversion.messaging_conversation_started_7d"]),
    leads: action(["lead", "onsite_conversion.lead_grouped"]),
    spend_cents: Math.round(Number(d.spend ?? 0) * 100),
  };
}

export const META_OBJECTIVE: Record<string, { objective: string; optimization: string; destination_type?: string }> = {
  messages: { objective: "OUTCOME_ENGAGEMENT", optimization: "CONVERSATIONS", destination_type: "WHATSAPP" },
  traffic: { objective: "OUTCOME_TRAFFIC", optimization: "LINK_CLICKS", destination_type: "WEBSITE" },
  awareness: { objective: "OUTCOME_AWARENESS", optimization: "REACH" },
  leads: { objective: "OUTCOME_LEADS", optimization: "CONVERSATIONS", destination_type: "WHATSAPP" },
};
