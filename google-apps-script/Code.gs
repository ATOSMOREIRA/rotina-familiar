/**
 * Rotina Familiar: guarda tarefas marcadas e dados compartilhados em uma planilha do Google.
 *
 * COMO INSTALAR (uma vez só)
 * 1. Crie uma planilha em sheets.google.com (pode chamar "Rotina Familiar").
 * 2. Menu Extensões > Apps Script. Apague o que estiver lá e cole este arquivo inteiro.
 * 3. Clique em Implantar > Nova implantação > tipo "App da Web".
 *      Executar como: Eu
 *      Quem pode acessar: Qualquer pessoa
 *    Autorize quando o Google pedir e copie o URL que termina em /exec.
 * 4. No GitHub, abra rotina.json e cole o URL em "planilha": "...".
 *
 * As abas "Marcacoes" e "Dados" são criadas sozinhas.
 *   Marcacoes: uma linha por tarefa de um dia (chave | feito | atualizado_em | quem).
 *              feito = TRUE (feita) ou "dispensado".
 *   Dados:     eventos, tarefas extras, tarefas adiadas, cardápio e lista de compras (tipo | id | json | atualizado_em).
 *
 * SE VOCÊ ATUALIZAR ESTE CÓDIGO depois: Implantar > Gerenciar implantações > lápis > Versão: Nova versão > Implantar.
 * (O endereço /exec continua o mesmo.)
 */
const ABA = "Marcacoes";
const ABA_DADOS = "Dados";

function aba_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(ABA);
  if (!s) {
    s = ss.insertSheet(ABA);
    s.appendRow(["chave", "feito", "atualizado_em", "quem"]);
    s.setFrozenRows(1);
    s.setColumnWidth(1, 460);
  } else if (!s.getRange(1, 4).getValue()) {
    s.getRange(1, 4).setValue("quem");
  }
  return s;
}

function abaDados_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(ABA_DADOS);
  if (!s) {
    s = ss.insertSheet(ABA_DADOS);
    s.appendRow(["tipo", "id", "json", "atualizado_em"]);
    s.setFrozenRows(1);
    s.setColumnWidth(3, 460);
  }
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Todos os dados compartilhados: [{tipo, id, valor}]
function lerDados_() {
  const s = abaDados_(), n = s.getLastRow(), out = [];
  if (n > 1) s.getRange(2, 1, n - 1, 3).getValues().forEach(function (r) {
    if (!r[0] || !r[1]) return;
    try { out.push({ tipo: String(r[0]), id: String(r[1]), valor: JSON.parse(r[2]) }); } catch (e) {}
  });
  return out;
}

// Lê: marcações a partir de uma data (?desde=AAAA-MM-DD) e todos os dados compartilhados
function doGet(e) {
  const desde = (e && e.parameter && e.parameter.desde) || "0000-00-00";
  const s = aba_(), n = s.getLastRow();
  const feitos = [], dispensados = [], quem = {};
  if (n > 1) {
    s.getRange(2, 1, n - 1, 4).getValues().forEach(function (r) {
      const k = String(r[0]);
      if (k.slice(0, 10) < desde) return;
      if (r[1] === true) { feitos.push(k); if (r[3]) quem[k] = String(r[3]); }
      else if (r[1] === "dispensado") { dispensados.push(k); if (r[3]) quem[k] = String(r[3]); }
    });
  }
  return json_({ ok: true, feitos: feitos, dispensados: dispensados, quem: quem, dados: lerDados_() });
}

// Grava uma marcação {chave, feito: true|false|"dispensado", quem}
// ou um dado compartilhado {acao: "dado", tipo, id, valor} (valor null apaga).
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.acao === "dado") return json_(gravarDado_(b));
    if (!b.chave) return json_({ ok: false, erro: "sem chave" });
    const s = aba_(), n = s.getLastRow(), agora = new Date();
    const valor = b.feito === "dispensado" ? "dispensado" : !!b.feito;
    let linha = -1;
    if (n > 1) {
      const chaves = s.getRange(2, 1, n - 1, 1).getValues();
      for (let i = 0; i < chaves.length; i++) if (String(chaves[i][0]) === b.chave) { linha = i + 2; break; }
    }
    if (linha > 0) s.getRange(linha, 2, 1, 3).setValues([[valor, agora, b.quem || ""]]);
    else s.appendRow([b.chave, valor, agora, b.quem || ""]);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function gravarDado_(b) {
  if (!b.tipo || !b.id) return { ok: false, erro: "sem tipo/id" };
  const s = abaDados_(), n = s.getLastRow(), agora = new Date();
  let linha = -1;
  if (n > 1) {
    const ch = s.getRange(2, 1, n - 1, 2).getValues();
    for (let i = 0; i < ch.length; i++) if (String(ch[i][0]) === b.tipo && String(ch[i][1]) === String(b.id)) { linha = i + 2; break; }
  }
  if (b.valor === null || b.valor === undefined) { if (linha > 0) s.deleteRow(linha); return { ok: true }; }
  const txt = JSON.stringify(b.valor);
  if (linha > 0) s.getRange(linha, 3, 1, 2).setValues([[txt, agora]]);
  else s.appendRow([b.tipo, String(b.id), txt, agora]);
  return { ok: true };
}
