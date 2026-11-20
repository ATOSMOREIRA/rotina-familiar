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
 *   - "avisos" no rotina.json (cada um pode ser removido para desligar):
 *       lembretePendencias "21:00"  resumo do que ainda falta fazer hoje
 *       atrasoMinutos 30            avisa quando uma tarefa com horário passou do horário e não foi marcada
 *       prazoTarefasCasa "20:30"    prazo das tarefas sem horário (zonas, fixas...): avisa o que não foi marcado
 *       resumoManha "07:00"         o que ficou sem fazer ontem
 *       resumoSemana {dia, hora}    resultado da semana (dia: 0=domingo ... 6=sábado)
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
function ymdDe_(n) { const d = new Date(n * 864e5); return d.getUTCFullYear() + "-" + pad2_(d.getUTCMonth() + 1) + "-" + pad2_(d.getUTCDate()); }
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
    lista.push({ k: ymd + "|i|" + i.titulo + "|" + i._chave, nome: i.titulo, hora: i.aviso || i.hora || null });
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
    out.push({ id: i.titulo + "|" + hora, hora: hora, nome: i.titulo, marcavel: marcavel_(i), k: ymd + "|i|" + i.titulo + "|" + i._chave,
      titulo: (i.icone ? i.icone + " " : "") + i.titulo, mensagem: i.detalhe || ("Agora: " + i.titulo) });
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

// Tarefas sem horário (zonas, fixas, "ao longo do dia") que não foram marcadas
function mensagemPrazo_(dados, ymd, feitosSet) {
  const falta = tarefasDoDia_(dados, ymd).filter(function (t) { return !t.hora && !feitosSet[t.k]; });
  if (!falta.length) return null;
  const linhas = falta.slice(0, 10).map(function (t) { return "• " + t.nome + (t.pessoa ? " (" + t.pessoa + ")" : ""); });
  if (falta.length > 10) linhas.push("… e mais " + (falta.length - 10));
  return { titulo: "⚠️ Passou do prazo: " + falta.length + " tarefa" + (falta.length > 1 ? "s" : ""), mensagem: linhas.join("\n") };
}

// Resumo do dia anterior (ymd = ontem); null se nada ficou pendente
function mensagemOntem_(dados, ymd, feitosSet) {
  const todas = tarefasDoDia_(dados, ymd), falta = todas.filter(function (t) { return !feitosSet[t.k]; });
  if (!falta.length) return null;
  if (falta.length === todas.length) return { titulo: "📋 Ontem não teve marcações", mensagem: "Nenhuma das " + todas.length + " tarefas foi marcada. Se foram feitas, vale marcar no app." };
  const linhas = falta.slice(0, 10).map(function (t) { return "• " + t.nome + (t.pessoa ? " (" + t.pessoa + ")" : ""); });
  if (falta.length > 10) linhas.push("… e mais " + (falta.length - 10));
  return { titulo: "📋 Ontem ficaram " + falta.length + " sem fazer", mensagem: linhas.join("\n") };
}

// Resultado da semana de segunda até ymd (inclusive)
function mensagemSemana_(dados, ymd, feitosSet) {
  const n = diaNum_(ymd), seg = n - mod_(diaSemana_(ymd) + 6, 7);
  let total = 0, ok = 0; const pessoas = {}, falt = {};
  for (let d = seg; d <= n; d++) {
    tarefasDoDia_(dados, ymdDe_(d)).forEach(function (t) {
      const f = !!feitosSet[t.k]; total++; if (f) ok++;
      if (t.pessoa) { if (!pessoas[t.pessoa]) pessoas[t.pessoa] = { ok: 0, total: 0 }; pessoas[t.pessoa].total++; if (f) pessoas[t.pessoa].ok++; }
      if (!f) falt[t.nome] = (falt[t.nome] || 0) + 1;
    });
  }
  const pct = total ? Math.round(100 * ok / total) : 0;
  const linhas = [ok + " de " + total + " tarefas feitas"];
  const ps = Object.keys(pessoas).map(function (p) { return p + " " + Math.round(100 * pessoas[p].ok / pessoas[p].total) + "%"; });
  if (ps.length) linhas.push(ps.join(" · "));
  const esq = Object.keys(falt).filter(function (k) { return falt[k] >= 2; }).sort(function (a, b) { return falt[b] - falt[a]; }).slice(0, 3);
  if (esq.length) linhas.push("Mais esquecidas: " + esq.map(function (k) { return k + " (" + falt[k] + "x)"; }).join(", "));
  return { titulo: (pct >= 80 ? "🌟" : "📊") + " Semana: " + pct + "% feito", mensagem: linhas.join("\n"), segunda: ymdDe_(seg) };
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

// Chaves marcadas entre duas datas (AAAA-MM-DD, inclusive)
function feitosEntre_(ini, fim) {
  const s = aba_(), n = s.getLastRow(), set = {};
  if (n > 1) s.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
    const d = String(r[0]).slice(0, 10);
    if (r[1] === true && d >= ini && d <= fim) set[String(r[0])] = 1;
  });
  return set;
}

// Envia pelo ntfy. Devolve true se o ntfy aceitou; registra o motivo no log se não aceitou.
function enviar_(titulo, mensagem, click) {
  try {
    const r = UrlFetchApp.fetch("https://ntfy.sh/", {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      payload: JSON.stringify({ topic: NTFY_TOPICO, title: titulo, message: mensagem, click: click || SITE, priority: 3 })
    });
    const cod = r.getResponseCode();
    if (cod >= 200 && cod < 300) return true;
    Logger.log("ntfy recusou o aviso (" + cod + "): " + r.getContentText().slice(0, 300));
  } catch (e) {
    Logger.log("Falha ao falar com o ntfy: " + e);
  }
  return false;
}

// Roda a cada 5 minutos (ligado por configurarAvisos)
function verificar() {
  const agora = Utilities.formatDate(new Date(), FUSO, "yyyy-MM-dd HH:mm");
  const ymd = agora.slice(0, 10), min = hhmm_(agora.slice(11));
  const dados = carregarRotina_(); if (!dados) return;
  const props = PropertiesService.getScriptProperties();
  const devido = function (hora, extra) { const m = hhmm_(hora) + (extra || 0); return min >= m && min - m <= 20; };
  const jaFoi = function (id) { return props.getProperty("env|" + ymd + "|" + id) === "1"; };
  const marcar = function (id) { props.setProperty("env|" + ymd + "|" + id, "1"); };
  // só dá o aviso como enviado se o ntfy aceitou; senão tenta de novo na próxima rodada (dentro da janela)
  const mandar = function (id, titulo, msg, click) { if (enviar_(titulo, msg, click)) marcar(id); };

  avisosDoDia_(dados, ymd).forEach(function (a) {
    if (devido(a.hora) && !jaFoi(a.id)) mandar(a.id, a.titulo, a.mensagem);
  });

  const cfg = dados.avisos || {};
  const feitosHoje = feitosEntre_(ymd, ymd);

  // 1) tarefa com horário que passou do horário e não foi marcada
  const atraso = cfg.atrasoMinutos === undefined ? 30 : cfg.atrasoMinutos;
  if (atraso !== false && atraso !== null) {
    avisosDoDia_(dados, ymd).forEach(function (a) {
      if (a.marcavel && devido(a.hora, atraso) && !feitosHoje[a.k] && !jaFoi("atraso|" + a.id)) {
        mandar("atraso|" + a.id, "⏰ Atrasado: " + a.nome, "Era às " + a.hora + " e ainda não foi marcado como feito.");
      }
    });
  }

  // 2) prazo das tarefas sem horário (zonas, fixas...)
  if (cfg.prazoTarefasCasa && devido(cfg.prazoTarefasCasa) && !jaFoi("prazo")) {
    const m = mensagemPrazo_(dados, ymd, feitosHoje);
    if (m) mandar("prazo", m.titulo, m.mensagem); else marcar("prazo");
  }

  // 3) lembrete geral do que falta no dia
  if (cfg.lembretePendencias && devido(cfg.lembretePendencias) && !jaFoi("pendencias")) {
    const m = mensagemPendencias_(dados, ymd, feitosHoje);
    mandar("pendencias", m.titulo, m.mensagem);
  }

  // 4) resumo de ontem, logo cedo
  if (cfg.resumoManha && devido(cfg.resumoManha) && !jaFoi("ontem")) {
    const y = ymdDe_(diaNum_(ymd) - 1), m = mensagemOntem_(dados, y, feitosEntre_(y, y));
    if (m) mandar("ontem", m.titulo, m.mensagem, SITE + "#v=dia&d=" + y); else marcar("ontem");
  }

  // 5) resultado da semana
  const rs = cfg.resumoSemana;
  if (rs && diaSemana_(ymd) === rs.dia && devido(rs.hora) && !jaFoi("semana")) {
    const seg = ymdDe_(diaNum_(ymd) - mod_(diaSemana_(ymd) + 6, 7));
    const m = mensagemSemana_(dados, ymd, feitosEntre_(seg, ymd));
    mandar("semana", m.titulo, m.mensagem, SITE + "#v=resumo&d=" + ymd);
  }

  // limpa o controle de dias antigos
  const corte = "env|" + Utilities.formatDate(new Date(Date.now() - 3 * 864e5), FUSO, "yyyy-MM-dd");
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf("env|") === 0 && k < corte) props.deleteProperty(k); });
}

// Mostra no "Registro de execução" o que aconteceu. Se der erro aqui, o problema é de envio.
function testarAviso() {
  if (NTFY_TOPICO.indexOf("troque-por") === 0) throw new Error("Troque NTFY_TOPICO no topo do arquivo pelo nome do seu tópico.");
  const ok = enviar_("🏡 Rotina Familiar", "Teste de aviso: se você leu isto, as notificações estão funcionando.");
  if (!ok) throw new Error("O ntfy não aceitou o aviso. Veja a linha acima no Registro de execução.");
  Logger.log("OK: o ntfy aceitou o aviso para o tópico " + NTFY_TOPICO + ". Se não chegou no celular, confira se o nome do tópico no app é idêntico.");
}

function configurarAvisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "verificar") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("verificar").timeBased().everyMinutes(5).create();
}

function desligarAvisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "verificar") ScriptApp.deleteTrigger(t); });
}
