// ============================================================
// Edge Function: receber-cotacoes
// O n8n faz POST aqui com as cotações; a função valida e grava no banco.
//
// IMPORTANTE ao publicar no Supabase:
//   - "Verify JWT" / "Enforce JWT" => DESLIGADO (o n8n não é usuário logado).
//   - Crie o segredo WEBHOOK_SECRET nos Secrets das Edge Functions.
//   - SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados pelo Supabase.
//
// A service_role key SÓ existe aqui no servidor. Nunca vai pro front.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  // 1) Autenticação por segredo compartilhado (o n8n manda este header).
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== Deno.env.get("WEBHOOK_SECRET")) {
    return json({ error: "Não autorizado" }, 401);
  }

  // 2) Corpo + validação.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const rates = body?.rates;
  if (!rates || typeof rates !== "object" || Array.isArray(rates)) {
    return json({ error: "Campo 'rates' ausente ou inválido" }, 400);
  }

  // Mantém só valores numéricos válidos (validação de input).
  const limpo: Record<string, number> = {};
  for (const [code, value] of Object.entries(rates as Record<string, unknown>)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) limpo[code.toUpperCase()] = n;
  }
  if (Object.keys(limpo).length === 0) {
    return json({ error: "Nenhuma cotação válida em 'rates'" }, 400);
  }

  // 3) Grava com a service_role (roda só aqui no servidor).
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const capturedAt = typeof body?.captured_at === "string" ? body.captured_at : new Date().toISOString();

  const { error } = await supabaseAdmin.from("rate_snapshots").insert({
    rates: limpo,
    captured_at: capturedAt,
    source: "n8n",
  });

  if (error) {
    console.error("Falha ao inserir:", error.message);
    return json({ error: "Falha ao salvar" }, 500);
  }

  return json({ ok: true, saved: Object.keys(limpo).length });
});
