/**
 * Rotina Familiar: guarda as tarefas marcadas em uma planilha do Google.
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
 * A aba "Marcacoes" é criada sozinha. Cada linha é uma tarefa marcada em um dia.
 * Se mudar este código depois, use Implantar > Gerenciar implantações > Editar > Nova versão.
 */
const ABA = "Marcacoes";

function aba_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(ABA);
  if (!s) {
    s = ss.insertSheet(ABA);
    s.appendRow(["chave", "feito", "atualizado_em"]);
    s.setFrozenRows(1);
    s.setColumnWidth(1, 460);
  }
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Lê: devolve as chaves marcadas a partir de uma data (?desde=AAAA-MM-DD)
function doGet(e) {
  const desde = (e && e.parameter && e.parameter.desde) || "0000-00-00";
  const s = aba_(), n = s.getLastRow();
  const feitos = [];
  if (n > 1) {
    s.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
      if (r[1] === true && String(r[0]).slice(0, 10) >= desde) feitos.push(String(r[0]));
    });
  }
  return json_({ ok: true, feitos: feitos });
}

// Grava: {chave, feito}. Cria a linha ou atualiza a que já existe.
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const b = JSON.parse(e.postData.contents);
    if (!b.chave) return json_({ ok: false, erro: "sem chave" });
    const s = aba_(), n = s.getLastRow();
    const agora = new Date();
    let linha = -1;
    if (n > 1) {
      const chaves = s.getRange(2, 1, n - 1, 1).getValues();
      for (let i = 0; i < chaves.length; i++) if (String(chaves[i][0]) === b.chave) { linha = i + 2; break; }
    }
    if (linha > 0) s.getRange(linha, 2, 1, 2).setValues([[!!b.feito, agora]]);
    else s.appendRow([b.chave, !!b.feito, agora]);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}
