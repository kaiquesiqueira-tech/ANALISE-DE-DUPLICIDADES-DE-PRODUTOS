#!/usr/bin/env node
// Usado pelo PUBLICAR.bat antes de enviar ao GitHub:
//   1) traz da pasta Downloads o que o site baixou (historico.json, bloqueios.json, ncm.json, grupos.json, s….json),
//      juntando com o que já está em dados/ (nada do repositório se perde);
//   2) devolve ao historico.json as medições de dados/medicoes que tinham sumido dele;
//   3) processa as planilhas da pasta planilhas/ e grava a nova medição em dados/.
//
// Uso: node scripts/publicar.js --downloads "C:\Users\...\Downloads" --planilhas planilhas [--log arq] [--resumo arq]
"use strict";
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
const dados = path.join(raiz, "dados");

function arg(nome) { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : null; }

// Tudo o que aparece na janela também vai para o PUBLICAR-log.txt (para mandar no chat se algo der errado).
const arqLog = arg("--log");
if (arqLog) {
  const orig = console.log.bind(console);
  console.log = (...a) => {
    orig(...a);
    try { fs.appendFileSync(arqLog, a.map((x) => (typeof x === "string" ? x : String(x))).join(" ") + "\r\n"); } catch (e) { /* log é só ajuda */ }
  };
  console.warn = console.log;
}
// Resumo de uma linha que o PUBLICAR.bat mostra na faixa final.
// Só ASCII (sem acento) e sem & | < > ^ % " ( ), que o cmd do Windows entenderia como comandos.
function resumo(txt) {
  const a = arg("--resumo");
  if (!a) return;
  const t = String(txt).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2013\u2014]/g, "-").replace(/\u2192/g, "->").replace(/[\u201c\u201d]/g, "'")
    .replace(/%/g, " por cento").replace(/[&|<>^"()]/g, " ").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").replace(/ ([.,])/g, "$1").trim().slice(0, 400);
  try { fs.writeFileSync(a, t + "\r\n"); } catch (e) { /* idem */ }
}
function lerJson(arq) { return JSON.parse(fs.readFileSync(arq, "utf8").replace(/^\uFEFF/, "")); }
function gravarJson(arq, obj, recuo) { fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.writeFileSync(arq, JSON.stringify(obj, null, recuo)); }
function listaHist(j) { return (Array.isArray(j) ? j : (j && j.medicoes) || []).filter((m) => m && m.id && m.at); }

function importarDownloads(dl) {
  if (!dl || !fs.existsSync(dl)) { console.log("  Pasta Downloads não encontrada; pulando."); return 0; }
  const nomes = fs.readdirSync(dl).filter((f) => fs.statSync(path.join(dl, f)).isFile());
  let n = 0;

  // medições (s + 14 dígitos)
  const pastaMed = path.join(dados, "medicoes");
  nomes.filter((f) => /^s\d{14}( \(\d+\))?\.json$/i.test(f)).forEach((f) => {
    const src = path.join(dl, f), nome = f.replace(/ \(\d+\)/, "");
    try { lerJson(src); } catch (e) { console.log(`  Aviso: ${f} está incompleto; ficou na pasta Downloads.`); return; }
    fs.mkdirSync(pastaMed, { recursive: true });
    fs.copyFileSync(src, path.join(pastaMed, nome)); fs.unlinkSync(src);
    console.log("  + dados/medicoes/" + nome); n++;
  });

  // histórico: junta as medições pelo id
  const hs = nomes.filter((f) => /^historico( \(\d+\))?\.json$/i.test(f));
  if (hs.length) {
    const arq = path.join(dados, "historico.json");
    let atual = []; try { atual = listaHist(lerJson(arq)); } catch (e) { atual = []; }
    const mapa = new Map(atual.map((m) => [m.id, m])), antes = mapa.size;
    let lidos = 0;
    hs.forEach((f) => {
      const src = path.join(dl, f);
      let j; try { j = lerJson(src); } catch (e) { console.log(`  Aviso: ${f} está incompleto; ficou na pasta Downloads.`); return; }
      lidos++;
      listaHist(j).forEach((m) => { const c = Object.assign({}, m); delete c.origem; if (!mapa.has(c.id)) mapa.set(c.id, c); });
      fs.unlinkSync(src);
    });
    const lista = Array.from(mapa.values()).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (mapa.size !== antes) { gravarJson(arq, lista, 1); console.log(`  + dados/historico.json (${mapa.size - antes} medição(ões) nova(s))`); n++; }
    else if (lidos) console.log("  historico.json baixado já estava no repositório.");
    lista.forEach((m) => { if (m.arquivo && !fs.existsSync(path.join(pastaMed, m.arquivo))) console.log(`  Aviso: falta dados/medicoes/${m.arquivo}; baixe-o pela janela "Enviar ao GitHub" do site.`); });
  }

  // marcações de bloqueio: por produto, vale a alteração mais recente
  const bs = nomes.filter((f) => /^bloqueios( \(\d+\))?\.json$/i.test(f));
  if (bs.length) {
    const arq = path.join(dados, "bloqueios.json");
    let m = {}; try { m = lerJson(arq).m || {}; } catch (e) { m = {}; }
    let mudou = 0, lidos = 0;
    bs.forEach((f) => {
      const src = path.join(dl, f);
      let j; try { j = lerJson(src); } catch (e) { console.log(`  Aviso: ${f} está incompleto; ficou na pasta Downloads.`); return; }
      lidos++;
      const novo = (j && j.m) || {};
      Object.keys(novo).forEach((k) => {
        const e = novo[k];
        if (!e || typeof e.t !== "string") return;
        if (!m[k] || e.t > m[k].t) { m[k] = e; mudou++; }
      });
      fs.unlinkSync(src);
    });
    if (mudou) { gravarJson(arq, { v: 1, at: new Date().toISOString(), m: m }); console.log(`  + dados/bloqueios.json (${mudou} marcação(ões) atualizada(s))`); n++; }
    else if (lidos) console.log("  bloqueios.json baixado já estava no repositório.");
  }
  // tabela de NCM: fica a mais nova (campo "at")
  const ns = nomes.filter((f) => /^ncm( \(\d+\))?\.json$/i.test(f));
  if (ns.length) {
    const arq = path.join(dados, "ncm.json");
    let atual = null; try { atual = lerJson(arq); } catch (e) { atual = null; }
    let melhor = null;
    ns.forEach((f) => {
      const src = path.join(dl, f);
      let j; try { j = lerJson(src); } catch (e) { console.log(`  Aviso: ${f} está incompleto; ficou na pasta Downloads.`); return; }
      if (j && j.m && (!melhor || j.at > melhor.at)) melhor = j;
      fs.unlinkSync(src);
    });
    if (melhor && (!atual || !atual.at || melhor.at > atual.at)) { gravarJson(arq, melhor); console.log(`  + dados/ncm.json (${melhor.linhas} códigos)`); n++; }
    else if (melhor) console.log("  ncm.json baixado já estava no repositório.");
  }
  // tabelas de grupos: por empresa fica a mais nova (campo "at" de cada empresa)
  const gs = nomes.filter((f) => /^grupos( \(\d+\))?\.json$/i.test(f));
  if (gs.length) {
    const arq = path.join(dados, "grupos.json");
    let atual = { v: 1, emp: {} }; try { const j = lerJson(arq); if (j && j.emp) atual = j; } catch (e) { /* novo */ }
    const mudou = [];
    gs.forEach((f) => {
      const src = path.join(dl, f);
      let j; try { j = lerJson(src); } catch (e) { console.log(`  Aviso: ${f} está incompleto; ficou na pasta Downloads.`); return; }
      Object.keys((j && j.emp) || {}).forEach((e) => {
        const t = j.emp[e];
        if (t && t.m && (!atual.emp[e] || !atual.emp[e].at || t.at > atual.emp[e].at)) { atual.emp[e] = t; if (mudou.indexOf(e) < 0) mudou.push(e); }
      });
      fs.unlinkSync(src);
    });
    if (mudou.length) { atual.at = new Date().toISOString(); gravarJson(arq, atual); console.log(`  + dados/grupos.json (empresa ${mudou.sort().join(" e ")})`); n++; }
    else console.log("  grupos.json baixado já estava no repositório.");
  }
  if (!n && !hs.length && !bs.length && !ns.length && !gs.length) console.log("  Nenhum arquivo baixado pelo site.");
  return n;
}

// Medições apagadas por engano voltam (o histórico do git guarda tudo):
//   1) arquivos de dados/ apagados nesta pasta e ainda não enviados → voltam da última versão;
//   2) medições apagadas em publicações anteriores → voltam da versão de antes de apagar
//      (só as do mínimo de similaridade atual; as antigas de 70% ficam de fora de propósito).
function recuperarApagados() {
  const { execFileSync } = require("child_process");
  const git = (args) => execFileSync("git", args, { cwd: raiz, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  try { git(["rev-parse", "--is-inside-work-tree"]); } catch (e) { return 0; }
  let n = 0;
  try {
    git(["ls-files", "--deleted", "--", "dados"]).split(/\r?\n/).filter(Boolean).forEach((f) => {
      try { git(["checkout", "--", f]); n++; console.log(`  + ${f} (tinha sido apagado nesta pasta; voltou)`); } catch (e) { /* segue */ }
    });
  } catch (e) { /* sem git */ }
  try {
    global.SimCore = global.SimCore || require(path.join(raiz, "js/simcore.js"));
    global.XlsxStream = global.XlsxStream || require(path.join(raiz, "js/xlsxstream.js"));
    const T_MIN = require(path.join(raiz, "js/analise.js")).T_MIN, { dataBR } = require("./processar.js");
    const vistos = new Set();
    let sha = null;
    git(["log", "--diff-filter=D", "--name-only", "--format=@%H", "--", "dados/medicoes"]).split(/\r?\n/).forEach((l) => {
      if (l.startsWith("@")) { sha = l.slice(1).trim(); return; }
      const f = l.trim();
      if (!f || !sha || vistos.has(f) || !/^dados\/medicoes\/s\d{14}\.json$/.test(f)) return;
      vistos.add(f);
      const alvo = path.join(raiz, f);
      if (fs.existsSync(alvo)) return;
      let txt, D;
      try { txt = git(["show", sha + "^:" + f]); D = JSON.parse(txt); } catch (e) { return; }
      if (!D || (D.T || 0) !== T_MIN || !Array.isArray(D.P)) return;
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.writeFileSync(alvo, txt);
      n++;
      console.log(`  + ${f} (medição de ${dataBR(D.at)} tinha sido apagada; voltou)`);
    });
  } catch (e) { /* sem histórico */ }
  return n;
}

// Medição que está em dados/medicoes mas sumiu do historico.json (acontece quando a pasta dados
// é substituída por uma cópia antiga, por exemplo ao copiar o zip do app por cima) volta para o histórico.
// Só as do mesmo mínimo de similaridade atual; as antigas de 70% ficam de fora de propósito.
function repararHistorico() {
  const pastaMed = path.join(dados, "medicoes"), arq = path.join(dados, "historico.json");
  if (!fs.existsSync(pastaMed)) return 0;
  let lista = []; try { lista = listaHist(lerJson(arq)); } catch (e) { lista = []; }
  const ids = new Set(lista.map((m) => m.id));
  const orfas = fs.readdirSync(pastaMed).filter((f) => /^s\d{14}\.json$/.test(f) && !ids.has(f.slice(0, -5)));
  if (!orfas.length) return 0;
  global.SimCore = global.SimCore || require(path.join(raiz, "js/simcore.js"));
  global.XlsxStream = global.XlsxStream || require(path.join(raiz, "js/xlsxstream.js"));
  const DupAnalysis = require(path.join(raiz, "js/analise.js"));
  const { dataBR } = require("./processar.js");
  const voltaram = [];
  orfas.forEach((f) => {
    let D; try { D = lerJson(path.join(pastaMed, f)); } catch (e) { return; }
    if (!D || !D.at || !Array.isArray(D.P) || (D.T || 0) !== DupAnalysis.T_MIN) return;
    try {
      const id = f.slice(0, -5), { summary } = DupAnalysis.summarize(D);
      lista.push(Object.assign({ id, at: D.at, arquivo: f }, DupAnalysis.snapshotDoc(D, summary)));
      voltaram.push(dataBR(D.at));
    } catch (e) { console.log(`  Aviso: não consegui ler dados/medicoes/${f} (${e.message}).`); }
  });
  if (!voltaram.length) return 0;
  lista.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  gravarJson(arq, lista, 1);
  console.log(`  + dados/historico.json: ${voltaram.length} medição(ões) tinham sumido do histórico e voltaram (${voltaram.join("; ")}).`);
  return voltaram.length;
}

// Código de saída lido pelo PUBLICAR.bat:
//   0 = medição nova gravada · 10 = nenhuma planilha nova · 11 = só tabelas de descrição (NCM, grupos)
//   12 = planilhas com problema (o resto é publicado) · 1 = erro inesperado (nada é publicado)
(async () => {
  console.log("\n  Arquivos baixados pelo site (pasta Downloads):");
  importarDownloads(arg("--downloads"));
  recuperarApagados();
  repararHistorico();

  const pasta = path.resolve(raiz, arg("--planilhas") || "planilhas");
  fs.mkdirSync(pasta, { recursive: true });
  console.log("\n  Planilhas do Protheus (pasta " + path.relative(raiz, pasta).replace(/\\/g, "/") + "):");
  const { processarPasta, dataBR } = require("./processar.js");
  let r;
  try { r = await processarPasta(pasta); }
  catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.log("\n  [PROBLEMA NAS PLANILHAS] A base NÃO foi atualizada:\n  " + msg);
    console.log("  As planilhas continuam na pasta planilhas. Corrija e rode o PUBLICAR de novo.");
    const linhas = msg.split("\n").map((x) => x.trim()).filter(Boolean);
    resumo(linhas[0] + (linhas.length > 1 ? ` E mais ${linhas.length - 1} problema${linhas.length > 2 ? "s" : ""} - veja acima.` : ""));
    process.exitCode = 12;
    return;
  }
  const extras = [r.ncm ? "tabela de NCM" : "", r.grupos ? "grupos da empresa " + r.grupos.join(" e ") : "", r.datas ? "graficos de data da SB1" : ""].filter(Boolean);
  if (r.status === "gravou") { resumo("Medição de " + dataBR(r.doc.at) + (extras.length ? " + " + extras.join(" + ") : "")); process.exitCode = 0; }
  else if (r.status === "tabelas") { console.log("  Só tabelas foram atualizadas (descrições e/ou gráficos de data; nenhuma medição nova)."); resumo("Atualizado: " + extras.join(" + ")); process.exitCode = 11; }
  else { resumo(r.motivo || "Nenhuma planilha nova na pasta planilhas."); process.exitCode = 10; }
})().catch((e) => {
  console.log("\n  [ERRO] Nada foi publicado:\n  " + (e && e.message ? e.message : e));
  console.log("  Corrija e rode o PUBLICAR de novo.");
  process.exitCode = 1;
});
