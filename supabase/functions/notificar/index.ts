// Função "notificar" — envia notificação para o celular da outra pessoa.
// Cole este arquivo em: Supabase > Edge Functions > Deploy a new function > Via Editor
// Nome da função: notificar
//
// Segredos necessários (Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex.: mailto:seu@email.com)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PRIORIDADE: Record<number, string> = { 1: "🔴 Alta", 2: "🟡 Média", 3: "🟢 Baixa" };
const STATUS: Record<string, string> = { a_fazer: "A fazer", andamento: "Em andamento", feito: "Feito" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Quem está pedindo? (precisa estar logada)
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return resposta({ erro: "não autenticado" }, 401);

    const { evento, demanda_id, texto } = await req.json();
    const { data: demanda } = await admin.from("demandas").select("*").eq("id", demanda_id).single();
    if (!demanda) return resposta({ erro: "demanda não encontrada" }, 404);

    const { data: perfil } = await admin.from("perfis").select("nome").eq("id", user.id).single();
    const quem = perfil?.nome || "Alguém";

    let titulo = "";
    let corpo = "";
    switch (evento) {
      case "nova":
        titulo = `Nova demanda · ${PRIORIDADE[demanda.prioridade]}`;
        corpo = `${quem}: ${demanda.titulo}`;
        break;
      case "comentario":
        titulo = `💬 ${quem} comentou`;
        corpo = `${demanda.titulo}: ${String(texto ?? "").slice(0, 120)}`;
        break;
      case "anexo":
        titulo = `📎 ${quem} anexou um arquivo`;
        corpo = demanda.titulo;
        break;
      case "status":
        titulo = demanda.status === "feito" ? `✅ ${quem} concluiu` : `${quem} moveu para ${STATUS[demanda.status]}`;
        corpo = demanda.titulo;
        break;
      default:
        return resposta({ erro: "evento inválido" }, 400);
    }

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    // Envia para todos os celulares, menos os de quem fez a ação
    const { data: inscricoes } = await admin.from("inscricoes_push").select("*").neq("usuario", user.id);
    const payload = JSON.stringify({ titulo, corpo, demanda_id, tag: `${demanda_id}-${evento}` });

    let enviadas = 0;
    await Promise.all((inscricoes ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        enviadas++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("inscricoes_push").delete().eq("id", s.id);
        else console.error("falha ao enviar push", code, e);
      }
    }));

    return resposta({ enviadas });
  } catch (e) {
    console.error(e);
    return resposta({ erro: String(e) }, 500);
  }
});
