import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Manutenção diária (Vercel Cron): aplica os prazos de conservação de dados
 * de cada escritório e limpa registos técnicos antigos. Protegida por CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const { data, error } = await admin.rpc("apply_retention");
  if (error) {
    console.error("[cron] retenção falhou", error.message);
    return NextResponse.json({ error: "retention_failed" }, { status: 500 });
  }
  return NextResponse.json({ retention: data });
}
