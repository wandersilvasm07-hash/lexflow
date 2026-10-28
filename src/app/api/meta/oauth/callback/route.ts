import { NextResponse, type NextRequest } from "next/server";
import { encryptToken, verifyState } from "@/lib/ads/crypto";
import { MetaAds } from "@/lib/ads/meta";
import { getCurrentUser } from "@/lib/auth/dal";
import { getAppUrl } from "@/lib/env";

/**
 * Regresso da Meta. Verifica o estado assinado, o nonce e o utilizador, troca
 * o código por um token de longa duração e guarda-o cifrado num cookie de 10
 * minutos, só até a pessoa escolher a conta de anúncios e a Página.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const state = verifyState<{ org: string; uid: string; nonce: string }>(sp.get("state"));
  const fail = (slug: string | undefined, reason: string) =>
    NextResponse.redirect(slug ? `${getAppUrl()}/app/${slug}/trafego-pago/conta?meta=${reason}` : `${getAppUrl()}/app`);

  if (!state) return fail(undefined, "estado_invalido");
  const user = await getCurrentUser();
  if (!user || user.id !== state.uid || request.cookies.get("meta_oauth_nonce")?.value !== state.nonce) {
    return fail(state.org, "estado_invalido");
  }
  if (sp.get("error") || !sp.get("code")) return fail(state.org, "cancelado");

  try {
    const { token, expiresAt } = await MetaAds.exchangeCode(sp.get("code")!, `${getAppUrl()}/api/meta/oauth/callback`);
    const res = NextResponse.redirect(`${getAppUrl()}/app/${state.org}/trafego-pago/conta?escolher=1`);
    res.cookies.set("meta_pending", encryptToken(JSON.stringify({ token, exp: expiresAt?.toISOString() ?? null, org: state.org, uid: user.id })), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    res.cookies.delete({ name: "meta_oauth_nonce", path: "/api/meta" });
    return res;
  } catch (err) {
    console.error("[meta] troca do código falhou", (err as Error).message);
    return fail(state.org, "falhou");
  }
}
