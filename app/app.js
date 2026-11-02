import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from "./config.js";

// =============================================================
// Utilidades
// =============================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const PRIORIDADE = { 1: "Alta", 2: "Média", 3: "Baixa" };
const STATUS = { a_fazer: "A fazer", andamento: "Em andamento", feito: "Feito" };

const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const instalado = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function quando(data) {
  if (!data) return "";
  const d = new Date(data);
  const agora = new Date();
  const min = Math.round((agora - d) / 60000);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dias = Math.round((hoje - dia) / 86400000);
  if (dias === 0) return `hoje ${hora}`;
  if (dias === 1) return `ontem ${hora}`;
  const opc = { day: "2-digit", month: "2-digit" };
  if (d.getFullYear() !== agora.getFullYear()) opc.year = "2-digit";
  return `${d.toLocaleDateString("pt-BR", opc)} ${hora}`;
}

function tamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function falha(e, msg = "Algo deu errado") {
  console.error(e);
  toast(navigator.onLine ? msg : "Sem internet no momento");
}

// =============================================================
// Configuração
// =============================================================
const configurado = !SUPABASE_URL.startsWith("COLE_AQUI") && !SUPABASE_ANON_KEY.startsWith("COLE_AQUI");
const sb = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const estado = {
  usuario: null,
  perfis: {},
  demandas: [],
  aba: "a_fazer",
  busca: "",
  aberta: null, // id da demanda aberta no detalhe
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.abrir) abrirDetalhe(e.data.abrir);
  });
}

// =============================================================
// Folhas (janelas) com suporte ao botão "voltar" do Android
// =============================================================
const pilha = [];
function abrirFolha(id) {
  const el = document.getElementById(id);
  if (!el.hidden) return;
  el.hidden = false;
  pilha.push(id);
  history.pushState({ folha: id }, "");
  document.body.style.overflow = "hidden";
}
function esconderTopo() {
  const id = pilha.pop();
  if (id) document.getElementById(id).hidden = true;
  if (id === "folha-detalhe") estado.aberta = null;
  if (!pilha.length) document.body.style.overflow = "";
}
function fecharFolha() {
  if (pilha.length) history.back();
}
window.addEventListener("popstate", () => { if (pilha.length) esconderTopo(); });

$$("[data-fechar]").forEach((b) => b.addEventListener("click", fecharFolha));
$$(".fundo").forEach((f) => f.addEventListener("click", (e) => { if (e.target === f) fecharFolha(); }));

// =============================================================
// Login
// =============================================================
$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("#erro-login");
  erro.hidden = true;
  if (!sb) {
    erro.textContent = "O app ainda não foi configurado (arquivo config.js).";
    erro.hidden = false;
    return;
  }
  const f = new FormData(e.target);
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: f.get("email").trim(), password: f.get("senha") });
  btn.disabled = false;
  if (error) {
    erro.textContent = error.message.includes("Invalid") ? "E-mail ou senha incorretos." : error.message;
    erro.hidden = false;
  }
});

$("#btn-sair").addEventListener("click", async () => {
  if (!confirm("Sair da sua conta neste celular?")) return;
  await removerInscricaoPush();
  await sb.auth.signOut();
  fecharFolha();
});

function mostrarTela(qual) {
  $("#tela-login").hidden = qual !== "login";
  $("#tela-principal").hidden = qual !== "principal";
}

async function iniciar() {
  if (!sb) {
    mostrarTela("login");
    const erro = $("#erro-login");
    erro.textContent = "Falta configurar o app: preencha o arquivo config.js com os dados do Supabase.";
    erro.hidden = false;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  await aoMudarSessao(session);
  sb.auth.onAuthStateChange((_ev, s) => {
    if ((s?.user?.id ?? null) !== (estado.usuario?.id ?? null)) aoMudarSessao(s);
  });
}

let canal = null;
async function aoMudarSessao(sessao) {
  estado.usuario = sessao?.user ?? null;
  if (!estado.usuario) {
    if (canal) { sb.removeChannel(canal); canal = null; }
    estado.demandas = [];
    mostrarTela("login");
    return;
  }
  mostrarTela("principal");
  $("#lista").innerHTML = `<div class="carregando">Carregando…</div>`;
  await Promise.all([carregarPerfis(), carregarDemandas()]);
  assinarTempoReal();
  mostrarAvisoInstalar();
  atualizarStatusNotif();

  // Abriu pelo toque numa notificação?
  const d = new URLSearchParams(location.search).get("d");
  if (d) {
    history.replaceState(null, "", location.pathname);
    abrirDetalhe(d);
  }
}

// =============================================================
// Dados
// =============================================================
async function carregarPerfis() {
  const { data, error } = await sb.from("perfis").select("id, nome");
  if (error) return falha(error, "Não consegui carregar os perfis");
  estado.perfis = Object.fromEntries(data.map((p) => [p.id, p.nome]));
}
const nome = (id) => (id === estado.usuario?.id ? "Você" : estado.perfis[id] || "—");

async function carregarDemandas() {
  const { data, error } = await sb
    .from("demandas")
    .select("*, comentarios(count), anexos(count)")
    .order("criado_em", { ascending: true });
  if (error) return falha(error, "Não consegui carregar as demandas");
  estado.demandas = data.map((d) => ({
    ...d,
    n_coment: d.comentarios?.[0]?.count ?? 0,
    n_anexos: d.anexos?.[0]?.count ?? 0,
  }));
  renderLista();
}

let recarregarTimer;
function agendarRecarga(tabela, registro) {
  clearTimeout(recarregarTimer);
  recarregarTimer = setTimeout(async () => {
    await carregarDemandas();
    if (estado.aberta) {
      const id = estado.aberta;
      if (!estado.demandas.find((d) => d.id === id)) {
        toast("Esta demanda foi excluída");
        fecharFolha();
        return;
      }
      const afetada = registro?.demanda_id ?? registro?.id;
      if (!afetada || afetada === id) {
        if (tabela === "demandas") renderCabecalho();
        if (tabela === "comentarios") carregarComentarios();
        if (tabela === "anexos") carregarAnexos();
      }
    }
  }, 250);
}

function assinarTempoReal() {
  if (canal) sb.removeChannel(canal);
  canal = sb.channel("mudancas");
  for (const t of ["demandas", "comentarios", "anexos"]) {
    canal.on("postgres_changes", { event: "*", schema: "public", table: t }, (p) => agendarRecarga(t, p.new?.id ? p.new : p.old));
  }
  canal.subscribe();
}

// iPhone desliga a conexão em segundo plano: recarrega ao voltar para o app.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && estado.usuario) {
    carregarDemandas();
    if (estado.aberta) { renderCabecalho(); carregarComentarios(); carregarAnexos(); }
  }
});

function avisar(evento, demanda_id, texto) {
  sb.functions.invoke("notificar", { body: { evento, demanda_id, texto } })
    .then(({ error }) => error && console.warn("notificar", error))
    .catch((e) => console.warn("notificar", e));
}

// =============================================================
// Lista
// =============================================================
$$(".abas button").forEach((b) =>
  b.addEventListener("click", () => {
    estado.aba = b.dataset.aba;
    $$(".abas button").forEach((x) => x.classList.toggle("ativa", x === b));
    renderLista();
    window.scrollTo({ top: 0 });
  }),
);
$("#busca").addEventListener("input", (e) => { estado.busca = e.target.value; renderLista(); });

function renderLista() {
  const termo = semAcento(estado.busca.trim());
  const filtradas = estado.demandas.filter((d) => !termo || semAcento(`${d.titulo} ${d.descricao}`).includes(termo));

  for (const s of Object.keys(STATUS)) {
    $(`#cont-${s}`).textContent = filtradas.filter((d) => d.status === s).length;
  }
  const pendentes = estado.demandas.filter((d) => d.status === "a_fazer").length;
  try { navigator.setAppBadge?.(pendentes).catch?.(() => {}); } catch {}

  let lista = filtradas.filter((d) => d.status === estado.aba);
  const el = $("#lista");

  if (!lista.length) {
    const msg = termo
      ? ["🔎", "Nada encontrado com essa busca."]
      : { a_fazer: ["🎉", "Nenhuma demanda pendente."], andamento: ["☕", "Nada em andamento agora."], feito: ["📋", "Nada concluído ainda."] }[estado.aba];
    el.innerHTML = `<div class="vazio"><span class="emoji">${msg[0]}</span>${msg[1]}</div>`;
    return;
  }

  if (estado.aba === "feito") {
    lista.sort((a, b) => new Date(b.concluido_em) - new Date(a.concluido_em));
    el.innerHTML = lista.map(cartao).join("");
  } else {
    // Mais urgente primeiro; dentro da mesma prioridade, a mais antiga primeiro.
    lista.sort((a, b) => a.prioridade - b.prioridade || new Date(a.criado_em) - new Date(b.criado_em));
    let html = "";
    for (const p of [1, 2, 3]) {
      const grupo = lista.filter((d) => d.prioridade === p);
      if (grupo.length) html += `<h2 class="grupo-titulo">Prioridade ${PRIORIDADE[p].toLowerCase()} · ${grupo.length}</h2>` + grupo.map(cartao).join("");
    }
    el.innerHTML = html;
  }
  $$(".cartao", el).forEach((c) => c.addEventListener("click", () => abrirDetalhe(c.dataset.id)));
}

function cartao(d) {
  const feito = d.status === "feito";
  const info = feito
    ? `✅ ${esc(nome(d.concluido_por))} · ${quando(d.concluido_em)}`
    : `${esc(nome(d.criado_por))} · ${quando(d.criado_em)}`;
  return `
    <button class="cartao p${d.prioridade} ${feito ? "feito" : ""}" data-id="${d.id}">
      <h3>${esc(d.titulo)}</h3>
      ${d.descricao ? `<p class="resumo">${esc(d.descricao)}</p>` : ""}
      <div class="meta">
        <span class="selo p${d.prioridade}">${PRIORIDADE[d.prioridade]}</span>
        <span>${info}</span>
        ${d.n_coment ? `<span>💬 ${d.n_coment}</span>` : ""}
        ${d.n_anexos ? `<span>📎 ${d.n_anexos}</span>` : ""}
      </div>
    </button>`;
}

// =============================================================
// Nova demanda
// =============================================================
$("#btn-nova").addEventListener("click", () => {
  const f = $("#form-nova");
  f.reset();
  $("#arquivos-escolhidos").innerHTML = "";
  abrirFolha("folha-nova");
  setTimeout(() => f.titulo.focus(), 250);
});

$("#form-nova").arquivos.addEventListener("change", (e) => {
  $("#arquivos-escolhidos").innerHTML = [...e.target.files].map((a) => `<li>📄 ${esc(a.name)} (${tamanho(a.size)})</li>`).join("");
});

$("#form-nova").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Criando…";
  try {
    const { data, error } = await sb
      .from("demandas")
      .insert({ titulo: f.titulo.value.trim(), descricao: f.descricao.value.trim(), prioridade: Number(f.prioridade.value) })
      .select()
      .single();
    if (error) throw error;
    const arquivos = [...f.arquivos.files];
    if (arquivos.length) {
      btn.textContent = "Enviando anexos…";
      await enviarArquivos(data.id, arquivos);
    }
    avisar("nova", data.id);
    fecharFolha();
    toast("Demanda criada");
    if (estado.aba !== "a_fazer") $('.abas button[data-aba="a_fazer"]').click();
    await carregarDemandas();
  } catch (err) {
    falha(err, "Não consegui criar a demanda");
  } finally {
    btn.disabled = false;
    btn.textContent = "Criar demanda";
  }
});

async function enviarArquivos(demandaId, arquivos) {
  let falhas = 0;
  for (const a of arquivos) {
    const limpo = a.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
    const caminho = `${demandaId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${limpo}`;
    const { error: e1 } = await sb.storage.from("anexos").upload(caminho, a, { contentType: a.type || undefined });
    if (e1) { console.error(e1); falhas++; continue; }
    const { error: e2 } = await sb.from("anexos").insert({ demanda_id: demandaId, caminho, nome: a.name, tipo: a.type, tamanho: a.size });
    if (e2) { console.error(e2); falhas++; }
  }
  if (falhas) toast(`${falhas} arquivo(s) não foram enviados (limite de 20 MB cada)`);
  return arquivos.length - falhas;
}

// =============================================================
// Detalhe da demanda
// =============================================================
const demandaAberta = () => estado.demandas.find((d) => d.id === estado.aberta);

async function abrirDetalhe(id) {
  if (!estado.demandas.find((d) => d.id === id)) await carregarDemandas();
  if (!estado.demandas.find((d) => d.id === id)) return toast("Demanda não encontrada");
  estado.aberta = id; // se outra já estiver aberta, a folha é reaproveitada
  $("#detalhe").innerHTML = `
    <div id="det-cab"></div>
    <div class="secao"><h3>Anexos</h3><div id="det-anexos" class="anexos"></div></div>
    <div class="secao"><h3>Comentários</h3><div id="det-coment" class="comentarios"></div>
      <form class="novo-comentario" id="form-coment">
        <textarea name="texto" rows="1" placeholder="Escreva um comentário…" required></textarea>
        <button class="btn primario" type="submit" aria-label="Enviar">➤</button>
      </form>
    </div>`;
  renderCabecalho();
  abrirFolha("folha-detalhe");
  $("#folha-detalhe .folha-corpo").scrollTop = 0;
  carregarAnexos();
  carregarComentarios();

  const fc = $("#form-coment");
  const ta = fc.texto;
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; });
  fc.addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = ta.value.trim();
    if (!texto) return;
    const btn = fc.querySelector("button");
    btn.disabled = true;
    const { error } = await sb.from("comentarios").insert({ demanda_id: id, texto, autor: estado.usuario.id });
    btn.disabled = false;
    if (error) return falha(error, "Não consegui enviar o comentário");
    ta.value = "";
    ta.style.height = "auto";
    avisar("comentario", id, texto);
    carregarComentarios();
    carregarDemandas();
  });
}

function autoAltura(el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }

function renderCabecalho() {
  const d = demandaAberta();
  const cab = $("#det-cab");
  if (!d || !cab) return;
  // Não atrapalha quem está digitando
  if (cab.contains(document.activeElement) && document.activeElement.matches("textarea")) return;

  cab.innerHTML = `
    <textarea class="det-titulo" rows="1" maxlength="200" aria-label="Título">${esc(d.titulo)}</textarea>
    <div class="det-meta">
      Criada por ${esc(nome(d.criado_por))} · ${quando(d.criado_em)}
      ${d.status === "feito" ? `<br>✅ Concluída por ${esc(nome(d.concluido_por))} · ${quando(d.concluido_em)}` : ""}
    </div>
    <textarea class="det-desc" rows="2" placeholder="Toque para adicionar detalhes…" aria-label="Detalhes">${esc(d.descricao)}</textarea>
    <div class="secao"><h3>Situação</h3>
      <div class="status-btns">
        ${Object.entries(STATUS).map(([k, v]) => `<button data-status="${k}" class="${d.status === k ? "ativo" : ""}">${v}</button>`).join("")}
      </div>
    </div>
    <div class="secao"><h3>Prioridade</h3>
      <div class="prioridades">
        ${[1, 2, 3].map((p) => `<label class="pri p${p}"><input type="radio" name="det-pri" value="${p}" ${d.prioridade === p ? "checked" : ""}><span>${PRIORIDADE[p]}</span></label>`).join("")}
      </div>
    </div>`;

  const titulo = $(".det-titulo", cab);
  const desc = $(".det-desc", cab);
  requestAnimationFrame(() => { autoAltura(titulo); autoAltura(desc); });
  titulo.addEventListener("input", () => autoAltura(titulo));
  desc.addEventListener("input", () => autoAltura(desc));
  titulo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); titulo.blur(); } });
  titulo.addEventListener("change", () => {
    const v = titulo.value.trim();
    if (!v) { titulo.value = d.titulo; return; }
    salvar({ titulo: v });
  });
  desc.addEventListener("change", () => salvar({ descricao: desc.value.trim() }));

  $$("[data-status]", cab).forEach((b) =>
    b.addEventListener("click", async () => {
      const novo = b.dataset.status;
      if (novo === d.status) return;
      if (await salvar({ status: novo })) {
        avisar("status", d.id);
        toast(novo === "feito" ? "✅ Concluída!" : `Movida para ${STATUS[novo]}`);
      }
    }),
  );
  $$("input[name=det-pri]", cab).forEach((r) => r.addEventListener("change", () => salvar({ prioridade: Number(r.value) })));
}

async function salvar(campos) {
  const id = estado.aberta;
  const { error } = await sb.from("demandas").update(campos).eq("id", id);
  if (error) { falha(error, "Não consegui salvar"); return false; }
  await carregarDemandas();
  if (estado.aberta === id) renderCabecalho();
  return true;
}

async function carregarComentarios() {
  const id = estado.aberta;
  const el = $("#det-coment");
  if (!id || !el) return;
  const { data, error } = await sb.from("comentarios").select("*").eq("demanda_id", id).order("criado_em");
  if (error) return falha(error, "Não consegui carregar os comentários");
  if (estado.aberta !== id) return;
  el.innerHTML = data.length
    ? data.map((c) => {
        const meu = c.autor === estado.usuario.id;
        return `<div class="comentario ${meu ? "meu" : ""}">
          ${meu ? "" : `<div class="quem">${esc(nome(c.autor))}</div>`}
          <div class="txt">${esc(c.texto)}</div>
          <div class="quando">${quando(c.criado_em)}${meu ? ` · <button class="link" style="color:inherit;padding:0;font-size:11px" data-apagar="${c.id}">apagar</button>` : ""}</div>
        </div>`;
      }).join("")
    : `<p class="sub">Nenhum comentário ainda.</p>`;
  $$("[data-apagar]", el).forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Apagar este comentário?")) return;
      const { error } = await sb.from("comentarios").delete().eq("id", b.dataset.apagar);
      if (error) return falha(error);
      carregarComentarios();
      carregarDemandas();
    }),
  );
}

async function carregarAnexos() {
  const id = estado.aberta;
  const el = $("#det-anexos");
  if (!id || !el) return;
  const { data, error } = await sb.from("anexos").select("*").eq("demanda_id", id).order("criado_em");
  if (error) return falha(error, "Não consegui carregar os anexos");
  let urls = {};
  if (data.length) {
    const { data: assinadas } = await sb.storage.from("anexos").createSignedUrls(data.map((a) => a.caminho), 3600);
    urls = Object.fromEntries((assinadas ?? []).map((s) => [s.path, s.signedUrl]));
  }
  if (estado.aberta !== id) return;
  el.innerHTML =
    data.map((a) => {
      const url = urls[a.caminho] || "#";
      const img = a.tipo.startsWith("image/");
      const ext = (a.nome.split(".").pop() || "").toUpperCase().slice(0, 4);
      return `<a class="anexo" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(a.nome)}">
        <button class="x" data-remover="${a.id}" aria-label="Remover anexo">×</button>
        ${img ? `<img src="${esc(url)}" alt="${esc(a.nome)}" loading="lazy">` : `<span class="ext">${a.tipo === "application/pdf" ? "📕" : "📄"}</span><span>${esc(ext)}</span><span>${esc(a.nome.slice(0, 30))}</span>`}
      </a>`;
    }).join("") +
    `<label class="anexo novo"><input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"><span>＋<br>Anexar</span></label>`;

  $$("[data-remover]", el).forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const a = data.find((x) => x.id === b.dataset.remover);
      if (!confirm(`Remover o anexo "${a.nome}"?`)) return;
      await sb.storage.from("anexos").remove([a.caminho]);
      const { error } = await sb.from("anexos").delete().eq("id", a.id);
      if (error) return falha(error);
      carregarAnexos();
      carregarDemandas();
    }),
  );
  $(".anexo.novo input", el).addEventListener("change", async (e) => {
    const arquivos = [...e.target.files];
    if (!arquivos.length) return;
    toast("Enviando…");
    const ok = await enviarArquivos(id, arquivos);
    if (ok) { toast("Anexo enviado"); avisar("anexo", id); }
    carregarAnexos();
    carregarDemandas();
  });
}

$("#btn-excluir").addEventListener("click", async () => {
  const d = demandaAberta();
  if (!d || !confirm(`Excluir a demanda "${d.titulo}"?\nIsso apaga também os comentários e anexos.`)) return;
  const { data: anexos } = await sb.from("anexos").select("caminho").eq("demanda_id", d.id);
  if (anexos?.length) await sb.storage.from("anexos").remove(anexos.map((a) => a.caminho));
  const { error } = await sb.from("demandas").delete().eq("id", d.id);
  if (error) return falha(error, "Não consegui excluir");
  fecharFolha();
  toast("Demanda excluída");
  carregarDemandas();
});

// =============================================================
// Ajustes, notificações e instalação
// =============================================================
$("#btn-ajustes").addEventListener("click", () => {
  $("#form-nome").nome.value = estado.perfis[estado.usuario.id] || "";
  $("#usuario-email").textContent = `Conectada como ${estado.usuario.email}`;
  $("#bloco-instalar").hidden = !eventoInstalar;
  atualizarStatusNotif();
  abrirFolha("folha-ajustes");
});

$("#form-nome").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = e.target.nome.value.trim();
  const { error } = await sb.from("perfis").update({ nome: v }).eq("id", estado.usuario.id);
  if (error) return falha(error);
  estado.perfis[estado.usuario.id] = v;
  toast("Nome salvo");
});

const suportaPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function atualizarStatusNotif() {
  const st = $("#status-notif");
  const btn = $("#btn-notif");
  btn.hidden = false;
  if (!suportaPush) {
    st.textContent = ehIOS && !instalado
      ? "No iPhone, primeiro adicione o app à tela inicial (Compartilhar → Adicionar à Tela de Início) e abra por lá."
      : "Este navegador não permite notificações.";
    btn.hidden = true;
    return;
  }
  if (Notification.permission === "denied") {
    st.textContent = "As notificações foram bloqueadas. Libere nos ajustes do celular para este app.";
    btn.hidden = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub && Notification.permission === "granted") {
    st.textContent = "✅ Ativadas neste celular.";
    btn.textContent = "Desativar notificações";
    btn.classList.remove("primario");
  } else {
    st.textContent = "Receba um aviso quando chegar demanda nova, comentário ou conclusão.";
    btn.textContent = "Ativar notificações neste celular";
    btn.classList.add("primario");
  }
}

function chaveVapid(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function ativarNotificacoes() {
  if (VAPID_PUBLIC_KEY.startsWith("COLE_AQUI")) return toast("Falta configurar a chave de notificação (config.js)");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { atualizarStatusNotif(); return toast("Permissão não concedida"); }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveVapid(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    const { error } = await sb.from("inscricoes_push").upsert(
      { usuario: estado.usuario.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: "endpoint" },
    );
    if (error) throw error;
    toast("🔔 Notificações ativadas");
  } catch (e) {
    falha(e, "Não consegui ativar as notificações");
  }
  atualizarStatusNotif();
}

async function removerInscricaoPush() {
  if (!suportaPush) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sb.from("inscricoes_push").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) { console.warn(e); }
}

$("#btn-notif").addEventListener("click", async () => {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub && Notification.permission === "granted") {
    await removerInscricaoPush();
    toast("Notificações desativadas");
    atualizarStatusNotif();
  } else {
    ativarNotificacoes();
  }
});

// Instalação: Android mostra o convite do sistema; iPhone precisa do passo manual.
let eventoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  eventoInstalar = e;
  mostrarAvisoInstalar();
});
async function instalar() {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice;
  eventoInstalar = null;
  mostrarAvisoInstalar();
  $("#bloco-instalar").hidden = true;
}
$("#btn-instalar").addEventListener("click", instalar);

function mostrarAvisoInstalar() {
  const av = $("#aviso-instalar");
  let dispensado = false;
  try { dispensado = localStorage.getItem("aviso-instalar") === "nao"; } catch {}
  if (instalado || dispensado || !estado.usuario) { av.hidden = true; return; }
  if (ehIOS) {
    av.innerHTML = `📲 <b>Instale o app no iPhone:</b> toque em <b>Compartilhar</b> (quadrado com seta ↑) e depois em <b>Adicionar à Tela de Início</b>.<br><button class="link" id="dispensar">Agora não</button>`;
  } else if (eventoInstalar) {
    av.innerHTML = `📲 <b>Instale o app</b> para abrir direto da tela inicial.<br><button class="btn primario" id="aviso-instalar-btn">Instalar</button> <button class="link" id="dispensar">Agora não</button>`;
  } else {
    av.hidden = true;
    return;
  }
  av.hidden = false;
  $("#aviso-instalar-btn")?.addEventListener("click", instalar);
  $("#dispensar").addEventListener("click", () => {
    try { localStorage.setItem("aviso-instalar", "nao"); } catch {}
    av.hidden = true;
  });
}

iniciar();
