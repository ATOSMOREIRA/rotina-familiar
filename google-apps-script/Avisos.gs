/**
 * Rotina Familiar: avisos no celular pelo ntfy (https://ntfy.sh).
 *
 * COMO INSTALAR (uma vez só)
 * 1. No mesmo projeto do Apps Script (onde está o Code.gs), crie um arquivo novo
 *    (+ ao lado de "Arquivos" > Script) chamado Avisos e cole este conteúdo.
 * 2. Troque NTFY_TOPICO abaixo por um nome longo e secreto, sem espaços
 *    (ex.: rotina-familia-8f3k2x9qv7). Quem souber o nome recebe os avisos.
 * 3. No menu do editor, escolha a função "testarAviso" e clique em Executar.
 *    Autorize quando o Google pedir. Isso envia um aviso de teste.
 * 4. Escolha a função "configurarAvisos" e clique em Executar. Isso liga a
 *    verificação automática a cada 5 minutos.
 * 5. No celular de cada pessoa: instale o app "ntfy" (Android ou iPhone),
 *    toque em "+" e assine o mesmo tópico do passo 2.
 *
 * O que é avisado vem do rotina.json:
 *   - itens com "hora": avisados na hora (use "avisar": false para não avisar);
 *   - itens com "aviso": "HH:MM": avisados nesse horário (ex.: Lixo pra fora);
 *   - "avisos": { "lembretePendencias": "21:00" }: resumo do que ainda falta fazer.
 *
 * Importante: as chaves das tarefas aqui espelham as do index.html. Se mudar a regra
 * de tarefas lá (zonas, quinzenais...), mude aqui também.
 */
const NTFY_TOPICO = "troque-por-um-nome-longo-e-secreto";
const SITE = "https://atosmoreira.github.io/rotina-familiar/";
const FUSO = "America/Araguaina";
const URL_ROTINA = "https://raw.githubusercontent.com/ATOSMOREIRA/rotina-familiar/main/rotina.json";
const PERIODO_CHAVE_ = { manha: "08:00", tarde: "14:00", noite: "20:00" };

/* ---------- lógica pura (sem APIs do Google, testável) ---------- */
function pad2_(n) { return (n < 10 ? "0" : "") + n; }
function mod_(a, n) { return ((a % n) + n) % n; }
function diaNum_(ymd) { const p = ymd.split("-").map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5); }
function diaSemana_(ymd) { return new Date(diaNum_(ymd) * 864e5).getUTCDay(); }
function hhmm_(s) { const p = s.split(":"); return Number(p[0]) * 60 + Number(p[1]); }
function marcavel_(i) { return i.marcar != null ? i.marcar : (i.tipo === "casa" || i.tipo === "pet"); }

function itensDoDia_(dados, ymd) {
  const dow = diaSemana_(ymd), n = diaNum_(ymd);
  const lista = dados.itens.filter(function (i) { return i.dias.indexOf(dow) >= 0; }).map(function (i) { return Object.assign({}, i); });
  const q = dados.quinzenal;
  if (q && dow === 6) {
    const dd = n - diaNum_(q.ancora);
    if (dd % 14 === 0) {
      const mensal = mod_(dd / 14, 2) === 0;
      lista.push({ periodo: "tarde", icone: "🧽", tipo: "casa", titulo: mensal ? "Tarefas quinzenais e mensais" : "Tarefas quinzenais" });
    }
  }
  lista.forEach(function (i) { i._chave = i.hora || PERIODO_CHAVE_[i.periodo] || ""; });
  return lista;
}

function zonasDaSemana_(dados, ymd) {
  const r = dados.rodizio, n = diaNum_(ymd), seg = n - mod_(diaSemana_(ymd) + 6, 7);
  const w = Math.floor((seg - diaNum_(r.inicio)) / 7);
  return r.pessoas.map(function (nome, idx) { return { nome: nome, zona: r.zonas[mod_(w + idx, r.zonas.length)] }; });
}

// Mesmas chaves que o index.html grava na planilha
function tarefasDoDia_(dados, ymd) {
  const lista = [];
  itensDoDia_(dados, ymd).filter(marcavel_).forEach(function (i) {
    lista.push({ k: ymd + "|i|" + i.titulo + "|" + i._chave, nome: i.titulo });
  });
  zonasDaSemana_(dados, ymd).forEach(function (p) {
    p.zona.areas.forEach(function (a) { lista.push({ k: ymd + "|area|" + a.nome, nome: a.nome, pessoa: p.nome }); });
  });
  dados.fixas.forEach(function (f) { lista.push({ k: ymd + "|fixa|" + f.titulo, nome: f.titulo }); });
  return lista;
}

function avisosDoDia_(dados, ymd) {
  const out = [];
  itensDoDia_(dados, ymd).forEach(function (i) {
    const hora = i.aviso || (i.hora && i.avisar !== false ? i.hora : null);
    if (!hora) return;
    out.push({ id: i.titulo + "|" + hora, hora: hora, titulo: (i.icone ? i.icone + " " : "") + i.titulo, mensagem: i.detalhe || ("Agora: " + i.titulo) });
  });
  return out;
}

function mensagemPendencias_(dados, ymd, feitosSet) {
  const falta = tarefasDoDia_(dados, ymd).filter(function (t) { return !feitosSet[t.k]; });
  if (!falta.length) return { titulo: "🎉 Tudo feito hoje!", mensagem: "Todas as tarefas de hoje foram marcadas. Parabéns, família!" };
  const linhas = falta.slice(0, 10).map(function (t) { return "• " + t.nome + (t.pessoa ? " (" + t.pessoa + ")" : ""); });
  if (falta.length > 10) linhas.push("… e mais " + (falta.length - 10));
  return { titulo: "⏳ Faltam " + falta.length + " tarefa" + (falta.length > 1 ? "s" : "") + " hoje", mensagem: linhas.join("\n") };
}

/* ---------- com as APIs do Google ---------- */
function carregarRotina_() {
  const cache = CacheService.getScriptCache();
  let txt = cache.get("rotina.json");
  if (!txt) {
    const r = UrlFetchApp.fetch(URL_ROTINA + "?t=" + Date.now(), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    txt = r.getContentText();
    cache.put("rotina.json", txt, 300);
  }
  return JSON.parse(txt);
}

function feitosDoDia_(ymd) {
  const s = aba_(), n = s.getLastRow(), set = {};
  if (n > 1) s.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
    if (r[1] === true && String(r[0]).slice(0, 10) === ymd) set[String(r[0])] = 1;
  });
  return set;
}

function enviar_(titulo, mensagem) {
  UrlFetchApp.fetch("https://ntfy.sh/", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ topic: NTFY_TOPICO, title: titulo, message: mensagem, click: SITE, priority: 3 })
  });
}

// Roda a cada 5 minutos (ligado por configurarAvisos)
function verificar() {
  const agora = Utilities.formatDate(new Date(), FUSO, "yyyy-MM-dd HH:mm");
  const ymd = agora.slice(0, 10), min = hhmm_(agora.slice(11));
  const dados = carregarRotina_(); if (!dados) return;
  const props = PropertiesService.getScriptProperties();
  const devido = function (hora) { const m = hhmm_(hora); return min >= m && min - m <= 20; };
  const jaFoi = function (id) { return props.getProperty("env|" + ymd + "|" + id) === "1"; };
  const marcar = function (id) { props.setProperty("env|" + ymd + "|" + id, "1"); };

  avisosDoDia_(dados, ymd).forEach(function (a) {
    if (devido(a.hora) && !jaFoi(a.id)) { marcar(a.id); enviar_(a.titulo, a.mensagem); }
  });

  const lp = dados.avisos && dados.avisos.lembretePendencias;
  if (lp && devido(lp) && !jaFoi("pendencias")) {
    marcar("pendencias");
    const m = mensagemPendencias_(dados, ymd, feitosDoDia_(ymd));
    enviar_(m.titulo, m.mensagem);
  }

  // limpa o controle de dias antigos
  const corte = "env|" + Utilities.formatDate(new Date(Date.now() - 3 * 864e5), FUSO, "yyyy-MM-dd");
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf("env|") === 0 && k < corte) props.deleteProperty(k); });
}

function testarAviso() {
  enviar_("🏡 Rotina Familiar", "Teste de aviso: se você leu isto, as notificações estão funcionando.");
}

function configurarAvisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "verificar") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("verificar").timeBased().everyMinutes(5).create();
}

function desligarAvisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "verificar") ScriptApp.deleteTrigger(t); });
}
