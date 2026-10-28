import "server-only";
import { MetaAds, MetaApiError, META_OBJECTIVE } from "./meta";

/**
 * Publicação de uma campanha aprovada na Meta, de forma retomável:
 * cada objeto criado (campanha, conjunto, imagem, criativo, anúncio) é
 * guardado logo a seguir; se algo falhar, o pedido seguinte continua de onde
 * ficou, sem criar duplicados. Tudo é criado em pausa e só no fim a campanha
 * é ativada. O estado final é lido de volta da Meta (não se assume).
 */

export type PublishCampaign = {
  id: string;
  name: string;
  objective: string;
  destination: string;
  destination_url: string | null;
  locations: string[];
  daily_budget_cents: number;
  total_budget_cents: number;
  starts_on: string;
  ends_on: string | null;
  external_ids: Record<string, string>;
  account: { external_id: string; page_id: string | null; whatsapp_number: string | null; token: string };
  ads: { position: number; primary_text: string; headline: string; description: string | null; cta: string; image_path: string | null }[];
};

export type PublishStore = {
  progress(ids: Record<string, string>): Promise<void>;
  imageBase64(path: string): Promise<string>;
  published(externalStatus: string, ads: { position: number; creative_id: string; ad_id: string }[]): Promise<void>;
  failed(message: string, rejected: boolean): Promise<void>;
};

/** Converte uma data local (Lisboa) em ISO para a Meta. */
function lisbonMidnight(date: string, endOfDay = false): string {
  // A Meta aceita ISO 8601 com fuso; usamos o fuso de Lisboa explicitamente.
  return `${date}T${endOfDay ? "23:59:00" : "00:00:00"}+0000`.replace("+0000", lisbonOffset(date));
}
function lisbonOffset(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Lisbon" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const mins = Math.round((local.getTime() - utc.getTime()) / 60000);
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
}

export async function publishCampaign(c: PublishCampaign, store: PublishStore, fetchImpl?: typeof fetch): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const meta = new MetaAds(c.account.token, fetchImpl);
  const act = c.account.external_id;
  const ids = { ...c.external_ids };
  const save = async (patch: Record<string, string>) => {
    Object.assign(ids, patch);
    await store.progress(patch);
  };

  try {
    if (!c.account.page_id) throw new Error("Falta indicar a Página do Facebook da conta de anúncios.");
    if (c.destination === "form") throw new Error("O formulário instantâneo ainda não é suportado. Use WhatsApp ou página de destino.");
    if (c.destination === "landing_page" && !c.destination_url) throw new Error("Falta o endereço da página de destino.");
    const map = META_OBJECTIVE[c.objective];
    if (!map) throw new Error("Objetivo não suportado.");

    if (!ids.campaign) {
      const r = await meta.createCampaign(act, {
        name: c.name,
        objective: map.objective,
        // Teto de gasto da campanha na Meta (proteção adicional ao nosso limite).
        spendCapCents: c.total_budget_cents,
      });
      await save({ campaign: r.id });
    }

    if (!ids.adset) {
      const geo = await meta.resolveLocations(c.locations);
      if (geo.missing.length) throw new Error(`Localizações não encontradas na Meta: ${geo.missing.join(", ")}.`);
      const destinationType = c.destination === "whatsapp" ? "WHATSAPP" : c.destination === "landing_page" ? "WEBSITE" : map.destination_type;
      const optimization = c.destination === "whatsapp" ? "CONVERSATIONS" : c.objective === "awareness" ? "REACH" : "LINK_CLICKS";
      const r = await meta.createAdSet(act, {
        name: `${c.name} · conjunto`,
        campaign_id: ids.campaign,
        daily_budget: c.daily_budget_cents,
        billing_event: "IMPRESSIONS",
        optimization_goal: optimization,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        ...(destinationType ? { destination_type: destinationType } : {}),
        promoted_object: {
          page_id: c.account.page_id,
          ...(c.destination === "whatsapp" && c.account.whatsapp_number ? { whatsapp_phone_number: c.account.whatsapp_number } : {}),
        },
        targeting: {
          geo_locations: {
            ...(geo.countries.length ? { countries: geo.countries } : {}),
            ...(geo.regions.length ? { regions: geo.regions } : {}),
            ...(geo.cities.length ? { cities: geo.cities } : {}),
          },
          age_min: 18,
        },
        start_time: lisbonMidnight(c.starts_on),
        ...(c.ends_on ? { end_time: lisbonMidnight(c.ends_on, true) } : {}),
      });
      await save({ adset: r.id });
    }

    const created: { position: number; creative_id: string; ad_id: string }[] = [];
    for (const ad of c.ads) {
      const k = String(ad.position);
      if (!ids[`img_${k}`]) {
        if (!ad.image_path) throw new Error(`O anúncio ${ad.position + 1} não tem imagem.`);
        const hash = await meta.uploadImage(act, await store.imageBase64(ad.image_path));
        if (!hash) throw new Error("A Meta não devolveu a imagem carregada.");
        await save({ [`img_${k}`]: hash });
      }
      if (!ids[`creative_${k}`]) {
        const isWhats = c.destination === "whatsapp";
        const r = await meta.createCreative(act, {
          name: `${c.name} · criativo ${ad.position + 1}`,
          object_story_spec: {
            page_id: c.account.page_id,
            link_data: {
              message: ad.primary_text,
              name: ad.headline,
              ...(ad.description ? { description: ad.description } : {}),
              image_hash: ids[`img_${k}`],
              link: isWhats ? "https://api.whatsapp.com/send" : c.destination_url,
              call_to_action: isWhats
                ? { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } }
                : { type: ad.cta, value: { link: c.destination_url } },
            },
          },
        });
        await save({ [`creative_${k}`]: r.id });
      }
      if (!ids[`ad_${k}`]) {
        const r = await meta.createAd(act, { name: `${c.name} · anúncio ${ad.position + 1}`, adset_id: ids.adset, creative_id: ids[`creative_${k}`] });
        await save({ [`ad_${k}`]: r.id });
      }
      created.push({ position: ad.position, creative_id: ids[`creative_${k}`], ad_id: ids[`ad_${k}`] });
    }

    await meta.setStatus(ids.campaign, "ACTIVE");
    const real = await meta.getCampaign(ids.campaign);
    await store.published(real.effective_status ?? real.status, created);
    return { ok: true, status: real.effective_status ?? real.status };
  } catch (err) {
    const msg =
      err instanceof MetaApiError
        ? `Meta: ${err.userMessage ?? err.message}`
        : err instanceof Error
          ? err.message
          : "Erro desconhecido";
    const rejected = err instanceof MetaApiError && err.isPolicy;
    await store.failed(msg, rejected).catch(() => {});
    return { ok: false, error: msg };
  }
}
