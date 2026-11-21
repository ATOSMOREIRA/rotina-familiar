"use strict";
const REPO = "ATOSMOREIRA/rotina-familiar";
const ARQUIVO = "rotina.json";

/* ---------- datas e utilidades ---------- */
const DIA_MS = 864e5;
const NOMES = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const CURTOS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const pad = n => String(n).padStart(2, "0");
const mk = (y, m, d) => new Date(y, m, d, 12);
const hojeData = () => { const n = new Date(); return mk(n.getFullYear(), n.getMonth(), n.getDate()); };
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [a,b,c] = s.split("-").map(Number); return mk(a, b-1, c); };
const soma = (d, n) => mk(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dif = (a, b) => Math.round((a - b) / DIA_MS);
const segunda = d => soma(d, -((d.getDay() + 6) % 7));
const mod = (a, n) => ((a % n) + n) % n;
const longa = d => d.toLocaleDateString("pt-BR", { day:"numeric", month:"long" });
const curta = d => d.toLocaleDateString("pt-BR", { day:"numeric", month:"short" }).replace(".", "");
const dm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const $ = id => document.getElementById(id);

const guardado = (k, padrao) => { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch (_) { return padrao; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

/* ---------- estado ---------- */
let dados = null;                       // rotina.json (base)
let estado = { v:"dia", data:hojeData() };
let ultimaCarga = 0;
let eu = guardado("rotina-eu", "");     // quem usa este aparelho
let soMinhas = guardado("rotina-minhas", false);

const TIPOS_DADO = ["evento", "item", "adiada", "cardapio", "compra"];
const extrasVazio = () => Object.fromEntries(TIPOS_DADO.map(t => [t, {}]));
let extras = Object.assign(extrasVazio(), guardado("rotina-extras", {}));
let feitos = guardado("rotina-feitos", {});     // chave -> 1 (feita) | 2 (dispensada)
let quemDe = guardado("rotina-quemde", {});     // chave -> nome
let pend = guardado("rotina-pend", {});         // chave -> {v, q}   (ainda não enviado)
let pendDados = guardado("rotina-pend-dados", {}); // "tipo|id" -> valor | null

(function limparAntigos() {
  const corte = iso(soma(hojeData(), -130));
  Object.keys(feitos).forEach(k => { if (k.slice(0, 10) < corte) { delete feitos[k]; delete quemDe[k]; } });
  Object.keys(pend).forEach(k => { if (typeof pend[k] !== "object") pend[k] = { v: pend[k] ? 1 : 0, q: "" }; });
})();
const salvarTudo = () => { guardar("rotina-feitos", feitos); guardar("rotina-quemde", quemDe); guardar("rotina-extras", extras);
  guardar("rotina-pend", pend); guardar("rotina-pend-dados", pendDados); };

function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (["dia","semana","resumo","mais"].includes(p.get("v"))) estado.v = p.get("v");
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get("d") || "")) estado.data = parse(p.get("d"));
}
const gravarHash = () => history.replaceState(null, "", `#v=${estado.v}&d=${iso(estado.data)}`);

/* ---------- marcações ---------- */
const estadoDe = k => feitos[k] || 0;
const padraoMarcavel = i => i.marcar ?? (i.tipo === "casa" || i.tipo === "pet");
const temSubs = i => !!i.subitens?.length;
const subsMarcaveis = i => temSubs(i) && padraoMarcavel(i);      // cada subitem tem a própria caixinha
const marcavel = i => !temSubs(i) && padraoMarcavel(i);          // o grupo em si não é marcado
const kItem = (d, i) => `${iso(d)}|i|${i.titulo}|${i._chave}`;
const kSub = (d, i, s) => `${iso(d)}|sub|${i.titulo}|${s}`;
const kExtra = (d, tipo, nome) => `${iso(d)}|${tipo}|${nome}`;

function setEstado(k, v) {
  if (v) { feitos[k] = v; if (eu) quemDe[k] = eu; } else { delete feitos[k]; delete quemDe[k]; }
  pend[k] = { v, q: eu };
  salvarTudo(); enviarPend();
}

function salvarDado(tipo, id, valor) {
  if (valor == null) delete extras[tipo][id]; else extras[tipo][id] = valor;
  pendDados[`${tipo}|${id}`] = valor ?? null;
  salvarTudo(); enviarPend();
}

/* ---------- sincronização com a planilha do Google (opcional) ---------- */
const mostrarSync = t => { const el = $("sync"); if (el) el.textContent = t; };
let enviando = false;

async function post(obj) {
  const r = await fetch(dados.planilha, { method:"POST", body: JSON.stringify(obj) });
  const j = await r.json(); if (!j.ok) throw new Error("recusado");
}

async function enviarPend() {
  if (!dados?.planilha || enviando) return;
  enviando = true;
  try {
    for (const k of Object.keys(pend)) {
      const p = pend[k];
      await post({ chave:k, feito: p.v === 1 ? true : p.v === 2 ? "dispensado" : false, quem: p.q });
      if (pend[k] === p) delete pend[k];
    }
    for (const kd of Object.keys(pendDados)) {
      const v = pendDados[kd], i = kd.indexOf("|");
      await post({ acao:"dado", tipo: kd.slice(0, i), id: kd.slice(i + 1), valor: v });
      if (pendDados[kd] === v) delete pendDados[kd];
    }
  } catch (_) { mostrarSync(" · sem conexão com a planilha"); }
  finally { enviando = false; salvarTudo(); }
}

async function sincronizar() {
  if (!dados?.planilha) return;
  await enviarPend();
  try {
    const r = await fetch(`${dados.planilha}?desde=${iso(soma(hojeData(), -120))}`, { cache:"no-store" });
    const j = await r.json(); if (!j.ok) throw new Error("recusado");
    const nf = {}, nq = Object.assign({}, j.quem || {});
    (j.feitos || []).forEach(k => { nf[k] = 1; });
    (j.dispensados || []).forEach(k => { nf[k] = 2; });
    Object.keys(pend).forEach(k => { const p = pend[k]; if (p.v) { nf[k] = p.v; if (p.q) nq[k] = p.q; } else { delete nf[k]; delete nq[k]; } });
    const ne = extrasVazio();
    (j.dados || []).forEach(x => { if (ne[x.tipo]) ne[x.tipo][x.id] = x.valor; });
    Object.keys(pendDados).forEach(kd => { const i = kd.indexOf("|"), t = kd.slice(0, i), id = kd.slice(i + 1);
      if (!ne[t]) return; if (pendDados[kd] == null) delete ne[t][id]; else ne[t][id] = pendDados[kd]; });
    const mudou = JSON.stringify([nf, nq, ne]) !== JSON.stringify([feitos, quemDe, extras]);
    if (mudou) {
      feitos = nf; quemDe = nq; extras = ne; salvarTudo();
      if (!editando()) desenhar();
    }
    mostrarSync(" · planilha sincronizada");
  } catch (_) { mostrarSync(" · sem conexão com a planilha"); }
}
const editando = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") && $("app").contains(document.activeElement)
  && document.activeElement.type !== "checkbox";

/* ---------- rotina.json ---------- */
async function buscar() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${ARQUIVO}`, {
      headers: { Accept: "application/vnd.github.raw+json" }, cache: "no-store" });
    if (r.ok) { const j = await r.json(); guardar("rotina-base", j); return { j, offline:false }; }
  } catch (_) {}
  try {
    const r2 = await fetch(`${ARQUIVO}?t=${Date.now()}`, { cache: "no-store" });
    if (r2.ok) { const j = await r2.json(); guardar("rotina-base", j); return { j, offline:false }; }
  } catch (_) {}
  const copia = guardado("rotina-base", null);
  if (copia) return { j: copia, offline:true };
  throw new Error("Não foi possível carregar a rotina.");
}

/* ---------- regras ---------- */
const PERIODO_CHAVE = { manha:"08:00", tarde:"14:00", noite:"20:00" };
const PERIODO_ROTULO = { manha:"Manhã", tarde:"Tarde", noite:"Noite", dia:"Dia" };

const ocorre = (i, d) => i.mensal
  ? d.getDay() === i.mensal.dia && Math.ceil(d.getDate() / 7) === i.mensal.semana
  : (i.dias || []).includes(d.getDay());

function itensDoDia(d) {
  const ymd = iso(d);
  const base = dados.itens.concat(Object.entries(extras.item).map(([id, r]) => ({ ...r, _custom:id })));
  const lista = base.filter(i => ocorre(i, d)).map(i => ({ ...i }));
  const q = dados.quinzenal;
  if (q && d.getDay() === 6) {
    const dd = dif(d, parse(q.ancora));
    if (dd % 14 === 0) {
      const mensal = mod(dd / 14, 2) === 0;
      lista.push({ periodo:"tarde", icone:"🧽", tipo:"casa",
        titulo: mensal ? "Tarefas quinzenais e mensais" : "Tarefas quinzenais",
        detalhe: "Sábado à tarde (domingo fica livre)",
        subitens: mensal ? q.quinzenais.concat(q.mensais) : q.quinzenais });
    }
  }
  Object.entries(extras.evento).forEach(([id, e]) => {
    if (e.data !== ymd) return;
    lista.push({ icone:"📌", titulo:e.titulo, detalhe:e.detalhe, tipo:"rotina", marcar:false, hora:e.hora || undefined, periodo:e.hora ? undefined : "dia", _evento:id });
  });
  Object.entries(extras.adiada).forEach(([id, a]) => {
    if (a.para !== ymd) return;
    lista.push({ periodo:"dia", icone:"↪️", titulo:`${a.nome} (adiada)`, detalhe:`Adiada de ${dm(a.de)}`, tipo:"casa", marcar:true, _adiada:id });
  });
  lista.forEach(i => { i._chave = i.hora || PERIODO_CHAVE[i.periodo] || ""; });
  return lista.sort((a, b) => a._chave.localeCompare(b._chave));
}

function grupoDe(i) {
  if (!i.hora && i.periodo === "dia") return 0;
  const h = parseInt(i._chave, 10);
  return h < 12 ? 1 : h < 18 ? 2 : 3;
}
const GRUPOS = ["Ao longo do dia", "Manhã", "Tarde", "Noite"];

function zonasDaSemana(d) {
  const r = dados.rodizio, w = Math.floor(dif(segunda(d), parse(r.inicio)) / 7);
  return r.pessoas.map((nome, idx) => ({ nome, zona: r.zonas[mod(w + idx, r.zonas.length)] }));
}
const iniciais = nome => nome.split(" ").map(w => w[0]).join("").slice(0, 2);

/* ---------- peças de tela: caixinhas e "⋯" ---------- */
const caixa = k => `<input type="checkbox" data-chk="${esc(k)}" ${estadoDe(k) === 1 ? "checked" : ""}>`;
const maisBtn = (k, nome, dia) => `<button type="button" class="pular" data-skip="${esc(k)}" data-nome="${esc(nome)}" data-dia="${dia}" aria-label="Dispensar ou adiar">⋯</button>`;
const quemTxt = k => estadoDe(k) === 1 && quemDe[k] ? `<small class="quem">✓ ${esc(quemDe[k])}</small>` : "";

const botaoPular = (k, nome, d) => estadoDe(k) === 2
  ? `<button type="button" class="pular" data-skip="${esc(k)}" data-nome="${esc(nome)}" data-dia="${iso(d)}" aria-label="Restaurar tarefa">↩</button>`
  : maisBtn(k, nome, iso(d));

function controles(k, nome, d) {
  if (estadoDe(k) === 2) return `<span class="acoes">${botaoPular(k, nome, d)}</span>`;
  return `<span class="acoes">${botaoPular(k, nome, d)}<label class="chk" aria-label="Marcar como feito">${caixa(k)}</label></span>`;
}

/* ---------- visão do dia ---------- */
function subLista(i, d) {
  const feitas = i.subitens.filter(s => estadoDe(kSub(d, i, s)) === 1).length;
  return `<small class="sub-prog">${feitas} de ${i.subitens.length} feitas</small>
    <ul class="subs">${i.subitens.map(s => { const k = kSub(d, i, s), e = estadoDe(k);
      return `<li class="${e === 1 ? "feito" : ""} ${e === 2 ? "dispensada" : ""}"><label class="mk">${e === 2 ? '<span class="sem-caixa">⏭</span>' : caixa(k)}<span>${esc(s)}${e === 2 ? ' <small class="quem">dispensada</small>' : ""}${quemTxt(k)}</span></label>
        <span class="acoes">${botaoPular(k, s, d)}</span></li>`; }).join("")}</ul>`;
}

function itemHtml(i, d, agora, ehHoje, proximoRef) {
  const passou = ehHoje && i.hora && i.hora < agora;
  const eh = i === proximoRef, k = kItem(d, i), m = marcavel(i);
  const disp = m && estadoDe(k) === 2;
  const rot = i.hora || PERIODO_ROTULO[i.periodo] || "";
  return `<li class="item ${esc(i.tipo)} ${passou ? "passou" : ""} ${eh ? "proximo" : ""} ${m && estadoDe(k) === 1 ? "feito" : ""} ${disp ? "dispensada" : ""} ${subsMarcaveis(i) && i.subitens.every(s => estadoDe(kSub(d, i, s)) === 1) ? "feito" : ""}">
    <div class="hora">${esc(rot)}</div>
    <div class="corpo"><b><span class="ic">${esc(i.icone)}</span>${esc(i.titulo)}</b>
      ${disp ? '<small class="quem">dispensada</small>' : ""}
      ${i.detalhe ? `<small>${esc(i.detalhe)}</small>` : ""}
      ${subsMarcaveis(i) ? subLista(i, d) : (i.subitens ? `<ul>${i.subitens.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : "")}
      ${m ? quemTxt(k) : ""}
    </div>${m ? controles(k, i.titulo, d) : (i._evento ? `<span class="acoes"><button type="button" class="pular" data-del="evento|${esc(i._evento)}" aria-label="Apagar evento">✕</button></span>` : "<span></span>")}</li>`;
}

function faixaSemana(d) {
  const seg = segunda(d), hj = iso(hojeData());
  return `<nav class="faixa" aria-label="Dias da semana">` + [0,1,2,3,4,5,6].map(n => {
    const x = soma(seg, n);
    return `<button type="button" data-go="${iso(x)}" ${iso(x) === iso(d) ? 'aria-current="true"' : ""} class="${iso(x) === hj ? "hoje" : ""}">
      <small>${CURTOS[x.getDay()]}</small><b>${x.getDate()}</b></button>`;
  }).join("") + `</nav>`;
}

function seloRelativo(d) {
  const n = dif(d, hojeData());
  if (n === 0) return `<span class="selo hojeSelo">Hoje</span>`;
  if (n === 1) return `<span class="selo">Amanhã</span>`;
  if (n === -1) return `<span class="selo">Ontem</span>`;
  return `<span class="selo">${n > 0 ? `em ${n} dias` : `há ${-n} dias`}</span>`;
}

function linhaTarefa(k, nome, detalhe, d) {
  const e = estadoDe(k);
  return `<li class="tarefa ${e === 1 ? "feito" : ""} ${e === 2 ? "dispensada" : ""}">
    <label class="mk">${e === 2 ? '<span class="sem-caixa">⏭</span>' : caixa(k)}<span><b>${esc(nome)}</b>${detalhe ? " · " + esc(detalhe) : ""}${e === 2 ? ' <small class="quem">dispensada</small>' : ""}${quemTxt(k)}</span></label>
    <span class="acoes">${botaoPular(k, nome, d)}</span>
  </li>`;
}

function cardCasa(d) {
  let zs = zonasDaSemana(d);
  const minha = soMinhas && zs.some(p => p.nome === eu);
  if (minha) zs = zs.filter(p => p.nome === eu);
  return `<section class="card"><h2>🏡 Casa hoje</h2>
    ${eu && zonasDaSemana(d).some(p => p.nome === eu) ? `<div class="seg mini-seg" role="group" aria-label="Filtro">
      <button type="button" data-filtro="todas" aria-pressed="${!soMinhas}">Todas</button>
      <button type="button" data-filtro="minhas" aria-pressed="${soMinhas}">Só as minhas</button></div>` : ""}
    ${zs.map(p => `<div class="pessoa"><div class="avatar">${esc(iniciais(p.nome))}</div><div>
      <b>${esc(p.nome)}</b><span class="z">${esc(p.zona.nome)}</span>
      <ul>${p.zona.areas.map(a => linhaTarefa(kExtra(d, "area", a.nome), a.nome, a.detalhe, d)).join("")}</ul>
    </div></div>`).join("")}
    ${dados.fixas.map(f => `<div class="fixa"><ul class="un">${linhaTarefa(kExtra(d, "fixa", f.titulo), `${f.icone} ${f.titulo}`, `${f.detalhe} · ${f.quem}`, d)}</ul></div>`).join("")}
  </section>`;
}

function cardCardapioDia(d) {
  const c = extras.cardapio[iso(d)];
  return c?.txt ? `<section class="card"><h2>🍽️ Cardápio</h2><div class="cardapio-dia">${esc(c.txt)}</div></section>` : "";
}

function cardMetas() {
  if (!dados.semana?.length) return "";
  return `<section class="card"><h2>🎯 Metas da semana</h2><ul class="metas">
    ${dados.semana.map(m => `<li><span>${esc(m.icone)}</span><div><b>${esc(m.titulo)}</b><small>${esc(m.detalhe)}</small></div></li>`).join("")}
  </ul></section>`;
}

function cardCombinados() {
  return `<section class="card"><h2>🤝 Combinados</h2><div class="chips">
    ${dados.combinados.map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div></section>`;
}

function renderDia() {
  const d = estado.data, ehHoje = iso(d) === iso(hojeData());
  const n = new Date(), agora = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
  const itens = itensDoDia(d);
  const proximo = ehHoje ? itens.find(i => i.hora && i.hora >= agora) : null;
  const grupos = [0,1,2,3].map(g => ({ g, itens: itens.filter(i => grupoDe(i) === g) })).filter(x => x.itens.length);
  return faixaSemana(d) + `<div class="grade-dia">
    <section class="card">
      <div class="dia-cab"><div><h2>${NOMES[d.getDay()]}${d.getDay() > 0 && d.getDay() < 6 ? "-feira" : ""}</h2>
        <div class="data">${longa(d)} de ${d.getFullYear()}</div></div>${seloRelativo(d)}</div>
      <div class="prog" id="prog"><span></span><div><i></i></div></div>
      ${grupos.length ? grupos.map(x => `<div class="grupo"><h3>${GRUPOS[x.g]}</h3>
        <ul class="lista">${x.itens.map(i => itemHtml(i, d, agora, ehHoje, proximo)).join("")}</ul></div>`).join("")
        : `<div class="vazio">Nada programado para este dia.</div>`}
    </section>
    <div class="coluna">${cardCasa(d)}${cardCardapioDia(d)}${cardMetas()}${cardCombinados()}</div>
  </div>`;
}

function atualizaProgresso() {
  const el = $("prog"); if (!el) return;
  const todas = document.querySelectorAll("#app input[data-chk]"), ok = [...todas].filter(c => c.checked).length;
  el.querySelector("span").textContent = todas.length ? `${ok} de ${todas.length} tarefas feitas` : "";
  el.querySelector("i").style.width = todas.length ? `${100 * ok / todas.length}%` : "0";
  el.hidden = !todas.length;
}

/* ---------- visão da semana ---------- */
function renderSemana() {
  const seg = segunda(estado.data), hj = iso(hojeData());
  const fim = soma(seg, 6), zs = zonasDaSemana(seg);
  const cards = [0,1,2,3,4,5,6].map(n => {
    const x = soma(seg, n), itens = itensDoDia(x), c = extras.cardapio[iso(x)];
    return `<div role="button" tabindex="0" class="dia-card ${iso(x) === hj ? "hoje" : ""}" data-go="${iso(x)}" data-abrir="1">
      <header><h3>${NOMES[x.getDay()]}</h3><span>${curta(x)}</span></header>
      ${c?.txt ? `<div class="mini-cardapio">🍽️ ${esc(c.txt)}</div>` : ""}
      ${itens.map(i => { const e = marcavel(i) ? estadoDe(kItem(x, i)) : (subsMarcaveis(i) && i.subitens.every(s => estadoDe(kSub(x, i, s)) === 1) ? 1 : 0);
        return `<div class="mini ${esc(i.tipo)} ${e === 1 ? "feito" : ""} ${e === 2 ? "dispensada" : ""}"><i>${esc(i.hora || PERIODO_ROTULO[i.periodo])}</i><span>${esc(i.icone)} ${esc(i.titulo)}</span></div>`; }).join("")}
    </div>`;
  }).join("");
  return `<div class="sem-cab"><h2>Semana de ${curta(seg)} a ${curta(fim)}</h2>
      <span>${iso(segunda(hojeData())) === iso(seg) ? "Esta semana" : dif(seg, segunda(hojeData())) > 0 ? "Semana futura" : "Semana passada"}</span></div>
    <div class="zonas-sem">${zs.map(p => `<span class="chip"><b>${esc(p.nome)}</b> · ${esc(p.zona.nome)}: ${esc(p.zona.areas.map(a => a.nome).join(", "))}</span>`).join("")}</div>
    <div class="grade-sem">${cards}</div>
    <div class="sem-baixo">${cardMetas()}${cardCombinados()}</div>`;
}

/* ---------- resumo / supervisão ---------- */
function tarefasDoDia(d) {
  const lista = [];
  itensDoDia(d).forEach(i => {
    const cat = i.tipo === "pet" ? "Pets" : i.tipo === "casa" ? "Casa" : "Rotina";
    if (subsMarcaveis(i)) i.subitens.forEach(s => lista.push({ k:kSub(d, i, s), nome:s, cat }));
    else if (marcavel(i)) lista.push({ k:kItem(d, i), nome:i.titulo, cat });
  });
  zonasDaSemana(d).forEach(p => p.zona.areas.forEach(a => lista.push({ k:kExtra(d, "area", a.nome), nome:a.nome, cat:"Zonas", pessoa:p.nome })));
  dados.fixas.forEach(f => lista.push({ k:kExtra(d, "fixa", f.titulo), nome:f.titulo, cat:"Tarefas fixas" }));
  return lista.map(t => ({ ...t, feito: estadoDe(t.k) === 1, disp: estadoDe(t.k) === 2 }));
}

function resumoSemana(seg) {
  const hj = hojeData(), dias = [];
  for (let n = 0; n < 7; n++) {
    const d = soma(seg, n), ts = tarefasDoDia(d).filter(t => !t.disp), c = dif(d, hj);
    dias.push({ d, hoje: c === 0, futuro: c > 0, passado: c < 0, ts, feitas: ts.filter(t => t.feito).length });
  }
  const contados = dias.filter(x => x.passado);   // o dia de hoje ainda está em andamento
  const total = contados.reduce((s, x) => s + x.ts.length, 0), feitas = contados.reduce((s, x) => s + x.feitas, 0);
  return { dias, contados, total, feitas, pct: total ? Math.round(100 * feitas / total) : null };
}

const nivel = p => p >= 80 ? "bom" : p >= 50 ? "medio" : "ruim";
const barra = p => `<div class="bar ${nivel(p)}"><i style="width:${p}%"></i></div>`;
const agrupar = (ts, chave) => { const m = {}; ts.forEach(t => { const k = chave(t); if (k == null) return;
  (m[k] ||= { feitas:0, total:0 }).total++; if (t.feito) m[k].feitas++; }); return m; };

function cardEvolucao(seg) {
  const semanas = [];
  for (let n = 7; n >= 0; n--) { const s = soma(seg, -7 * n), r = resumoSemana(s); semanas.push({ s, pct: r.pct, usado: r.feitas > 0 }); }
  const cols = semanas.map(w => `<div class="col ${w.s.getTime() === seg.getTime() ? "atual" : ""}">
    <div class="topo-col">${w.usado ? w.pct + "%" : "–"}</div>
    <div class="trilho"><i class="${w.pct == null ? "" : nivel(w.pct)}" style="height:${w.usado ? w.pct : 0}%"></i></div>
    <small>${pad(w.s.getDate())}/${pad(w.s.getMonth() + 1)}</small></div>`).join("");
  // mês da semana escolhida, do dia 1 até o último dia já encerrado
  const hj = hojeData(), ref = soma(seg, 3);
  let tot = 0, ok = 0;
  for (let d = mk(ref.getFullYear(), ref.getMonth(), 1); d.getMonth() === ref.getMonth() && dif(d, hj) < 0; d = soma(d, 1)) {
    const ts = tarefasDoDia(d).filter(t => !t.disp); tot += ts.length; ok += ts.filter(t => t.feito).length;
  }
  const nomeMes = ref.toLocaleDateString("pt-BR", { month:"long" });
  return `<section class="card"><h2>📈 Evolução · 8 semanas</h2><div class="evolucao">${cols}</div>
    <div class="mes">${tot && ok ? `Em ${nomeMes}: <b class="${nivel(Math.round(100 * ok / tot))}">${Math.round(100 * ok / tot)}%</b> (${ok} de ${tot} tarefas)` : `Sem marcações em ${nomeMes} até agora.`}</div></section>`;
}

function renderResumo() {
  const seg = segunda(estado.data), fim = soma(seg, 6), hj = hojeData();
  const r = resumoSemana(seg), ant = resumoSemana(soma(seg, -7));
  const ts = r.contados.flatMap(x => x.ts);
  const antigo = dif(hj, fim) > 120;
  const eh = iso(segunda(hj)) === iso(seg) ? "Esta semana" : dif(seg, segunda(hj)) > 0 ? "Semana futura" : "Semana passada";
  const dispTotal = r.dias.reduce((s, x) => s + tarefasDoDia(x.d).filter(t => t.disp).length, 0);

  let nota;
  if (r.pct == null) {
    const h = r.dias.find(x => x.hoje);
    nota = h ? `<div class="pct">${h.feitas}<small>/${h.ts.length}</small></div><p>tarefas feitas hoje. O resumo da semana começa a contar a partir de amanhã.</p>`
             : `<div class="pct">—</div><p>${r.dias[0].futuro ? "Semana que ainda não começou." : "Sem dados nesta semana."}</p>`;
  } else {
    const dp = ant.pct == null || ant.feitas === 0 ? "" : r.pct - ant.pct;  // semana anterior sem nenhuma marcação não serve de comparação
    nota = `<div class="pct ${nivel(r.pct)}">${r.pct}<small>%</small></div>
      <p>${r.feitas} de ${r.total} tarefas feitas${iso(segunda(hj)) === iso(seg) ? " (sem contar hoje)" : ""}</p>
      ${dp === "" ? "" : `<div class="var ${dp >= 0 ? "bom" : "ruim"}">${dp > 0 ? "▲" : dp < 0 ? "▼" : "="} ${Math.abs(dp)} pontos em relação à semana anterior (${ant.pct}%)</div>`}`;
  }
  if (dispTotal) nota += `<p class="disp-nota">${dispTotal} tarefa${dispTotal > 1 ? "s" : ""} dispensada${dispTotal > 1 ? "s" : ""} (não contam na nota)</p>`;

  const porDia = r.dias.map(x => {
    const p = x.ts.length ? Math.round(100 * x.feitas / x.ts.length) : 0;
    return `<button type="button" class="linha ${x.futuro ? "futuro" : ""}" data-go="${iso(x.d)}" data-abrir="1">
      <span><b>${CURTOS[x.d.getDay()]}</b><small>${x.hoje ? "hoje" : curta(x.d)}</small></span>
      ${x.futuro ? '<span class="vazio" style="padding:0">a fazer</span>' : barra(p)}
      <span class="n">${x.futuro ? x.ts.length : `${x.feitas}/${x.ts.length}`}</span></button>`;
  }).join("");

  const zs = zonasDaSemana(seg), pp = agrupar(ts, t => t.pessoa);
  const pessoas = zs.map(p => { const g = pp[p.nome] || { feitas:0, total:0 }, pc = g.total ? Math.round(100 * g.feitas / g.total) : 0;
    return `<div class="cartao-p"><header><b>${esc(p.nome)} <span>${esc(p.zona.nome)}</span></b><span>${g.feitas}/${g.total}</span></header>${g.total ? barra(pc) : '<span class="vazio">Sem dias para contar</span>'}</div>`; }).join("");

  // quem marcou de fato (a partir do nome de cada aparelho)
  const qm = {}; r.dias.forEach(x => x.ts.forEach(t => { if (t.feito) { const q = quemDe[t.k] || "Não identificado"; qm[q] = (qm[q] || 0) + 1; } }));
  const quemHtml = Object.keys(qm).length ? Object.entries(qm).sort((a, b) => b[1] - a[1]).map(([n, q]) => `<div class="esq">${esc(n)}<span style="color:var(--accent)">${q} marcada${q > 1 ? "s" : ""}</span></div>`).join("")
    : '<div class="vazio">Ninguém marcou tarefas nesta semana.</div>';

  const cats = agrupar(ts, t => t.cat);
  const catHtml = Object.keys(cats).map(c => { const g = cats[c], pc = Math.round(100 * g.feitas / g.total);
    return `<div class="cartao-p"><header><b>${esc(c)}</b><span>${g.feitas}/${g.total} · ${pc}%</span></header>${barra(pc)}</div>`; }).join("");

  const pend = r.contados.map(x => ({ x, falta: x.ts.filter(t => !t.feito) })).filter(o => o.falta.length);
  const naoFeito = pend.length ? pend.map((o, i) => `<details ${i === pend.length - 1 ? "open" : ""}><summary>${NOMES[o.x.d.getDay()]}, ${curta(o.x.d)} <span>${o.falta.length} não feita${o.falta.length > 1 ? "s" : ""}</span></summary>
      <ul>${o.falta.map(t => `<li>${esc(t.nome)}${t.pessoa ? ` <small>(${esc(t.pessoa)})</small>` : ""}</li>`).join("")}</ul></details>`).join("")
    : `<div class="tudo-ok">${r.contados.length ? "🎉 Tudo feito nos dias contados." : "Nenhum dia para contar ainda."}</div>`;

  const cont = {}; ts.filter(t => !t.feito).forEach(t => { cont[t.nome] = (cont[t.nome] || 0) + 1; });
  const esq = Object.entries(cont).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return `<div class="sem-cab"><h2>Resumo · ${curta(seg)} a ${curta(fim)}</h2><span>${eh}</span></div>
    ${antigo ? '<div class="erro" style="margin-bottom:12px">Esta semana é muito antiga: só as marcações dos últimos 120 dias ficam sincronizadas.</div>' : ""}
    <div class="res-topo">
      <section class="card nota">${nota}</section>
      <section class="card"><h2>📆 Dia a dia</h2>${porDia}</section>
    </div>
    <div class="res-grid">
      ${cardEvolucao(seg)}
      <section class="card"><h2>✋ Quem marcou</h2>${quemHtml}</section>
      <section class="card"><h2>👥 Por zona <span class="sub" style="font:400 12px var(--sans);color:var(--mut)">· tarefas da zona de cada um</span></h2>${r.contados.length ? pessoas : '<div class="vazio">Aparece depois do primeiro dia completo.</div>'}</section>
      <section class="card"><h2>🧩 Por tipo de tarefa</h2>${r.contados.length ? catHtml : '<div class="vazio">Aparece depois do primeiro dia completo.</div>'}</section>
      <section class="card"><h2>⚠️ O que não foi feito</h2>${naoFeito}</section>
      <section class="card"><h2>🔁 Mais esquecidas</h2>${esq.length ? esq.map(([n, q]) => `<div class="esq">${esc(n)}<span>${q}x</span></div>`).join("") : '<div class="tudo-ok">Nenhuma tarefa esquecida mais de uma vez.</div>'}</section>
    </div>`;
}

/* ---------- aba "Mais": eventos, tarefas extras, cardápio, compras ---------- */
function renderMais() {
  const seg = segunda(estado.data), hj = iso(hojeData());
  const pessoas = dados.rodizio.pessoas;
  const eventos = Object.entries(extras.evento).filter(([, e]) => e.data >= hj).sort((a, b) => (a[1].data + (a[1].hora || "")).localeCompare(b[1].data + (b[1].hora || "")));
  const itensX = Object.entries(extras.item);
  const compras = Object.entries(extras.compra).sort((a, b) => (a[1].ok - b[1].ok) || a[1].nome.localeCompare(b[1].nome));
  const diasChips = [1,2,3,4,5,6,0].map(n => `<label class="chipbox"><input type="checkbox" name="dia" value="${n}"><span>${CURTOS[n]}</span></label>`).join("");
  return `<div class="sem-cab"><h2>Mais</h2><span>${esc(eu ? "Você: " + eu : "Quem é você?")}</span></div>
  <div class="res-grid">
    <section class="card"><h2>👤 Quem usa este aparelho</h2>
      <p class="ajuda">O nome aparece em cada tarefa que você marca e permite ver só as suas tarefas.</p>
      <div class="chips">${pessoas.map(p => `<button type="button" class="chip btn-chip ${p === eu ? "ativo" : ""}" data-eu="${esc(p)}">${esc(p)}</button>`).join("")}
        <button type="button" class="chip btn-chip" data-eu="*">Outra pessoa…</button></div>
    </section>

    <section class="card"><h2>📅 Eventos</h2>
      <form data-form="evento" class="form">
        <div class="par">
          <label class="campo">Data<input type="date" name="data" required value="${iso(estado.data)}"></label>
          <label class="campo">Hora (opcional)<input type="time" name="hora"></label>
        </div>
        <input type="text" name="titulo" placeholder="Ex.: Reunião de pais, consulta, aniversário" required maxlength="80">
        <input type="text" name="detalhe" placeholder="Detalhe (opcional)" maxlength="120">
        <button class="btn">Adicionar evento</button>
      </form>
      ${eventos.length ? eventos.map(([id, e]) => `<div class="linha-edit"><span><b>${dm(e.data)}${e.hora ? " " + esc(e.hora) : ""}</b> ${esc(e.titulo)}${e.detalhe ? `<small>${esc(e.detalhe)}</small>` : ""}</span>
        <button type="button" class="apagar" data-del="evento|${esc(id)}" aria-label="Apagar">✕</button></div>`).join("") : '<div class="vazio">Nenhum evento marcado.</div>'}
    </section>

    <section class="card"><h2>➕ Tarefas e horários extras</h2>
      <p class="ajuda">Entram na rotina e nos avisos, sem editar o arquivo no GitHub.</p>
      <form data-form="item" class="form">
        <input type="text" name="titulo" placeholder="Ex.: Regar as plantas" required maxlength="80">
        <label class="campo">Hora (opcional)<input type="time" name="hora"></label>
        <div class="campo">Dias da semana<div class="chipbox-row">${diasChips}</div></div>
        <label class="campo">Tipo<select name="tipo"><option value="casa">Casa</option><option value="rotina">Rotina</option><option value="pet">Pet</option></select></label>
        <label class="mk"><input type="checkbox" name="marcar" checked><span>Pode marcar como feita</span></label>
        <input type="text" name="detalhe" placeholder="Detalhe (opcional)" maxlength="120">
        <button class="btn">Adicionar tarefa</button>
      </form>
      ${itensX.length ? itensX.map(([id, r]) => `<div class="linha-edit"><span><b>${esc(r.titulo)}</b><small>${(r.dias || []).map(d => CURTOS[d]).join(", ")}${r.hora ? " · " + esc(r.hora) : ""}</small></span>
        <button type="button" class="apagar" data-del="item|${esc(id)}" aria-label="Apagar">✕</button></div>`).join("") : '<div class="vazio">Nenhuma tarefa extra.</div>'}
    </section>

    <section class="card"><h2>🍽️ Cardápio · ${curta(seg)} a ${curta(soma(seg, 6))}</h2>
      <p class="ajuda">Use as setas para mudar de semana. Aparece no dia e na semana.</p>
      ${[0,1,2,3,4,5,6].map(n => { const x = soma(seg, n), c = extras.cardapio[iso(x)];
        return `<label class="cardapio-linha"><b>${CURTOS[x.getDay()]} ${x.getDate()}</b><input type="text" data-cardapio="${iso(x)}" value="${esc(c?.txt || "")}" placeholder="O que vai ser servido?" maxlength="120"></label>`; }).join("")}
    </section>

    <section class="card"><h2>🛒 Lista de compras</h2>
      <form data-form="compra" class="form linha-form">
        <input type="text" name="nome" placeholder="Adicionar item" required maxlength="60">
        <button class="btn">+</button>
      </form>
      ${compras.length ? compras.map(([id, c]) => `<div class="linha-edit ${c.ok ? "feito" : ""}"><label class="mk"><input type="checkbox" data-compra="${esc(id)}" ${c.ok ? "checked" : ""}><span>${esc(c.nome)}</span></label>
        <button type="button" class="apagar" data-del="compra|${esc(id)}" aria-label="Apagar">✕</button></div>`).join("") : '<div class="vazio">A lista está vazia.</div>'}
      ${compras.some(([, c]) => c.ok) ? '<button type="button" class="btn sec" data-limpar-compras="1">Limpar comprados</button>' : ""}
    </section>
  </div>`;
}

/* ---------- parabéns ao concluir o dia ---------- */
let celebrado = guardado("rotina-celebrado", {});
(function () { const corte = iso(soma(hojeData(), -30)); Object.keys(celebrado).forEach(k => { if (k < corte) delete celebrado[k]; }); })();

function diaCompleto(d) {
  const ts = tarefasDoDia(d).filter(t => !t.disp);
  return ts.length > 0 && ts.every(t => t.feito);
}

const FRASES = [
  ["Missão cumprida!", "Todas as tarefas {dia} foram concluídas. A família está de parabéns!"],
  ["Dia fechado com chave de ouro!", "Tudo {dia} está feito. Bom descanso, vocês merecem!"],
  ["Que equipe!", "Nenhuma tarefa ficou para trás {dia}. Orgulho da família!"],
  ["Tudo em ordem!", "Casa em dia, rotina cumprida {dia}. Parabéns a todos!"],
];
let festaTimer = null;
function festejar(d) {
  const ymd = iso(d); if (celebrado[ymd]) return;
  celebrado[ymd] = 1; guardar("rotina-celebrado", celebrado);
  const hoje = ymd === iso(hojeData());
  const [titulo, texto] = FRASES[Math.floor(Math.random() * FRASES.length)];
  const dia = hoje ? "de hoje" : `de ${NOMES[d.getDay()].toLowerCase()}, ${longa(d)}`;
  const el = $("festa");
  const confete = Array.from({ length: 32 }, () => `<span class="confete" style="left:${Math.random() * 100}%;animation-duration:${2.6 + Math.random() * 2.4}s;animation-delay:${Math.random() * 0.9}s">${["🎉","🎊","⭐","✨","💚","🌟"][Math.floor(Math.random() * 6)]}</span>`).join("");
  el.innerHTML = `${confete}<div class="festa-card" role="alert"><div class="grande">🏆</div>
    <h2>${esc(titulo)}</h2><p>${esc(eu ? `${eu}, ${texto.replace("{dia}", dia).replace(/^./, c => c.toLowerCase())}` : texto.replace("{dia}", dia))}</p>
    <button type="button" class="btn" data-fechar-festa="1">Valeu!</button></div>`;
  el.hidden = false;
  try { navigator.vibrate?.([120, 60, 120, 60, 240]); } catch (_) {}
  clearTimeout(festaTimer); festaTimer = setTimeout(fecharFesta, 9000);
}
function fecharFesta() { clearTimeout(festaTimer); $("festa").hidden = true; $("festa").innerHTML = ""; }
$("festa").addEventListener("click", e => { if (e.target === $("festa") || e.target.closest("[data-fechar-festa]")) fecharFesta(); });

/* ---------- janelinha (dispensar/adiar, quem é você) ---------- */
function folha(html, aoEscolher) {
  const dlg = $("folha");
  dlg.innerHTML = `<div class="folha-corpo">${html}<button type="button" class="btn sec" data-fechar="1">Cancelar</button></div>`;
  dlg.onclick = e => {
    if (e.target === dlg) { dlg.close(); return; }
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.fechar) { dlg.close(); return; }
    if (b.dataset.opcao) { dlg.close(); aoEscolher(b.dataset.opcao); }
  };
  if (!dlg.open) dlg.showModal();
}

function perguntarEu() {
  const nomes = dados.rodizio.pessoas;
  folha(`<h3>Quem é você?</h3><p class="ajuda">O nome fica gravado em cada tarefa que você marcar neste aparelho.</p>
    ${nomes.map(n => `<button type="button" class="btn" data-opcao="${esc(n)}">${esc(n)}</button>`).join("")}
    <button type="button" class="btn sec" data-opcao="*">Outra pessoa…</button>`, escolherEu);
}
function escolherEu(nome) {
  if (nome === "*") { nome = (prompt("Qual é o seu nome?") || "").trim().slice(0, 30); if (!nome) return; }
  eu = nome; guardar("rotina-eu", eu); desenharTopo(); if (dados) desenhar();
}

function abrirPular(botao) {
  const k = botao.dataset.skip, nome = botao.dataset.nome, dia = botao.dataset.dia;
  if (estadoDe(k) === 2) {
    folha(`<h3>${esc(nome)}</h3><p class="ajuda">Esta tarefa foi dispensada.</p>
      <button type="button" class="btn" data-opcao="restaurar">Voltar a contar a tarefa</button>`, () => { restaurar(k); });
    return;
  }
  folha(`<h3>${esc(nome)}</h3>
    <button type="button" class="btn" data-opcao="adiar">Adiar para amanhã</button>
    <button type="button" class="btn" data-opcao="dispensar">Dispensar hoje (não conta na nota)</button>`, op => {
    const d = estado.data, antes = diaCompleto(d);
    setEstado(k, 2);
    if (op === "adiar") salvarDado("adiada", uid(), { nome, de: dia, para: iso(soma(parse(dia), 1)), k });
    desenhar();
    if (!antes && diaCompleto(d)) festejar(d);
  });
}
function restaurar(k) {
  setEstado(k, 0);
  Object.entries(extras.adiada).forEach(([id, a]) => { if (a.k === k) salvarDado("adiada", id, null); });
  desenhar();
}

/* ---------- desenho geral ---------- */
function desenharTopo() {
  $("euBtn").textContent = eu ? `👤 ${eu}` : "👤 Quem é você?";
}

function desenhar() {
  $("titulo").textContent = dados.titulo;
  $("subtitulo").textContent = dados.subtitulo || "";
  document.querySelectorAll(".seg:not(.mini-seg) button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === estado.v));
  $("seletor").value = iso(estado.data);
  const y = scrollY;
  $("app").innerHTML = ({ dia: renderDia, semana: renderSemana, resumo: renderResumo, mais: renderMais })[estado.v]();
  scrollTo(0, y);
  gravarHash();
  atualizaProgresso();
  desenharTopo();
}

function mudar(novo) { Object.assign(estado, novo); if (dados) desenhar(); }
function passo(sinal) { mudar({ data: soma(estado.data, sinal * (estado.v === "dia" ? 1 : 7)) }); }

async function atualizar() {
  const btn = $("btnAtualizar"), rot = btn.querySelector("span");
  btn.disabled = true; btn.classList.add("girando"); rot.textContent = "Atualizando…";
  try {
    const { j, offline } = await buscar(); dados = j; ultimaCarga = Date.now();
    desenhar();
    $("rodape").innerHTML = (offline ? "Sem conexão: mostrando a última versão salva" : "Atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" })) + '<span id="sync"></span>';
    if (!eu && !guardado("rotina-eu-recusou", false)) { guardar("rotina-eu-recusou", true); perguntarEu(); }
    sincronizar();
  } catch (e) {
    $("app").innerHTML = `<div class="erro">${esc(e.message)} Tente atualizar de novo.</div>`;
  } finally { btn.disabled = false; btn.classList.remove("girando"); rot.textContent = "Atualizar"; }
}

/* ---------- eventos da tela ---------- */
$("btnAtualizar").addEventListener("click", atualizar);
$("euBtn").addEventListener("click", () => { if (dados) perguntarEu(); });
$("ant").addEventListener("click", () => passo(-1));
$("prox").addEventListener("click", () => passo(1));
$("hoje").addEventListener("click", () => mudar({ data: hojeData() }));
$("seletor").addEventListener("change", e => { if (e.target.value) mudar({ data: parse(e.target.value) }); });
document.querySelector(".controles .seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) mudar({ v: b.dataset.v }); });

$("app").addEventListener("change", e => {
  const c = e.target;
  if (c.matches("input[data-chk]")) {
    const d = estado.data, antes = diaCompleto(d);
    setEstado(c.dataset.chk, c.checked ? 1 : 0); desenhar();
    if (!antes && diaCompleto(d)) festejar(d);
    return;
  }
  if (c.matches("input[data-cardapio]")) { const t = c.value.trim(); salvarDado("cardapio", c.dataset.cardapio, t ? { txt: t } : null); return; }
  if (c.matches("input[data-compra]")) { const id = c.dataset.compra; salvarDado("compra", id, { ...extras.compra[id], ok: c.checked }); desenhar(); }
});

$("app").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, v = new FormData(f), tipo = f.dataset.form;
  if (tipo === "evento") salvarDado("evento", uid(), { data: v.get("data"), hora: v.get("hora") || "", titulo: v.get("titulo").trim(), detalhe: (v.get("detalhe") || "").trim() });
  if (tipo === "item") {
    const dias = v.getAll("dia").map(Number);
    if (!dias.length) { alert("Escolha pelo menos um dia da semana."); return; }
    salvarDado("item", uid(), { titulo: v.get("titulo").trim(), hora: v.get("hora") || undefined, periodo: v.get("hora") ? undefined : "dia", dias, tipo: v.get("tipo"), marcar: v.get("marcar") === "on",
      detalhe: (v.get("detalhe") || "").trim() || undefined, icone: v.get("tipo") === "pet" ? "🐾" : v.get("tipo") === "casa" ? "🧹" : "⭐" });
  }
  if (tipo === "compra") salvarDado("compra", uid(), { nome: v.get("nome").trim(), ok: false });
  desenhar();
});

$("app").addEventListener("click", e => {
  const t = e.target;
  const skip = t.closest("[data-skip]"); if (skip) { abrirPular(skip); return; }
  const del = t.closest("[data-del]");
  if (del) { const [tipo, id] = del.dataset.del.split("|"); if (confirm("Apagar este item?")) { salvarDado(tipo, id, null); desenhar(); } return; }
  const eb = t.closest("[data-eu]"); if (eb) { escolherEu(eb.dataset.eu); return; }
  const fl = t.closest("[data-filtro]"); if (fl) { soMinhas = fl.dataset.filtro === "minhas"; guardar("rotina-minhas", soMinhas); desenhar(); return; }
  if (t.closest("[data-limpar-compras]")) { Object.entries(extras.compra).forEach(([id, c]) => { if (c.ok) salvarDado("compra", id, null); }); desenhar(); return; }
  const b = t.closest("[data-go]"); if (!b) return;
  mudar({ data: parse(b.dataset.go), v: b.dataset.abrir ? "dia" : estado.v });
  if (b.dataset.abrir) scrollTo({ top: 0, behavior: "smooth" });
});
$("app").addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".dia-card")) { e.preventDefault(); e.target.click(); }
});

/* deslizar o dedo: esquerda = próximo, direita = anterior (só nas visões de dia, semana e resumo) */
let toque = null;
$("app").addEventListener("touchstart", e => { const t = e.touches[0]; toque = { x:t.clientX, y:t.clientY, alvo:e.target }; }, { passive:true });
$("app").addEventListener("touchend", e => {
  if (!toque) return; const t = e.changedTouches[0], dx = t.clientX - toque.x, dy = t.clientY - toque.y, alvo = toque.alvo; toque = null;
  if (estado.v === "mais" || alvo.closest?.("input,textarea,select")) return;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 45) passo(dx < 0 ? 1 : -1);
}, { passive:true });

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (Date.now() - ultimaCarga > 5 * 60 * 1000) atualizar(); else sincronizar();
});
setInterval(() => { if (!document.hidden) sincronizar(); }, 30000);
addEventListener("hashchange", () => { lerHash(); if (dados) desenhar(); });
addEventListener("online", () => { if (dados) sincronizar(); });

/* ---------- uso sem internet: guarda o app no aparelho ---------- */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

lerHash();
atualizar();
