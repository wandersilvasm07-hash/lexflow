import { NextResponse, type NextRequest } from "next/server";
import { syncCampaign } from "@/lib/ads/service";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Sincronização diária (Vercel Cron): estado real e métricas das campanhas
 * publicadas; pausa as que atingiram o orçamento total. Protegida por CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const { data } = await admin.from("campaigns").select("id").in("status", ["active", "paused"]).limit(200);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const { id } of data ?? []) {
    try {
      await syncCampaign(id);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: (err as Error).message.slice(0, 200) });
    }
  }
  return NextResponse.json({ synced: results.length, failed: results.filter((r) => !r.ok).length });
}
