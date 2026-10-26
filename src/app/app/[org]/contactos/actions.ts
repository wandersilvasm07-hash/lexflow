"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/lib/auth/action";
import type { ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

const statusEnum = z.enum([
  "new",
  "in_progress",
  "awaiting_info",
  "consultation_proposed",
  "consultation_booked",
  "converted",
  "closed",
]);

export async function updateContactStatusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "contacts.write", async (ctx) => {
    const supabase = await createClient();
    const { error, count } = await supabase
      .from("contacts")
      .update({ status: statusEnum.parse(form.get("status")) }, { count: "exact" })
      .eq("id", z.uuid().parse(form.get("id")))
      .eq("organization_id", ctx.org.id);
    if (error) throw error;
    if (!count) return { ok: false, error: "Contacto não encontrado." };
    revalidatePath(`/app/${ctx.org.slug}/contactos`);
    return { ok: true };
  });
}
