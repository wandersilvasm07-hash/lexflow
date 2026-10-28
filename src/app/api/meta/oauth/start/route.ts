import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { signState } from "@/lib/ads/crypto";
import { MetaAds, isMetaConfigured } from "@/lib/ads/meta";
import { can, getOrgContext } from "@/lib/auth/dal";
import { getAppUrl } from "@/lib/env";

/** Início da ligação da conta de anúncios da Meta (só quem pode publicar). */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  const ctx = await getOrgContext(slug);
  const back = `${getAppUrl()}/app/${slug}/trafego-pago/conta`;
  if (!can(ctx, "campaigns.publish")) return NextResponse.redirect(`${back}?meta=sem_permissao`);
  if (!isMetaConfigured()) return NextResponse.redirect(`${back}?meta=nao_configurado`);

  const nonce = randomBytes(16).toString("base64url");
  const state = signState({ org: slug, uid: ctx.user.id, nonce, exp: Date.now() + 10 * 60_000 });
  const res = NextResponse.redirect(MetaAds.authorizeUrl(`${getAppUrl()}/api/meta/oauth/callback`, state));
  res.cookies.set("meta_oauth_nonce", nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/meta" });
  return res;
}
