#!/usr/bin/env node
// Processa as planilhas exportadas do Protheus e grava uma nova medição em dados/.
//
// Uso:
//   node scripts/processar.js planilhas
//   node scripts/processar.js SB1.xlsx SBZ.xlsx SALDO_FISICO_02.xlsx SALDO_FISICO_10.xlsx
//
// Requer Node.js 18 ou mais novo. Usa o mesmo motor do site (js/), então o resultado é idêntico.
"use strict";
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
global.SimCore = require(path.join(raiz, "js/simcore.js"));
global.XlsxStream = require(path.join(raiz, "js/xlsxstream.js"));
const DupAnalysis = require(path.join(raiz, "js/analise.js"));

function listarArquivos(args) {
  const out = [];
  args.forEach((a) => {
    const p = path.resolve(a);
    if (!fs.existsSync(p)) { console.warn("Não encontrado:", a); return; }
    if (fs.statSync(p).isDirectory()) {
      fs.readdirSync(p).sort().forEach((f) => {
        if (/\.(xlsx|csv|txt)$/i.test(f) && !f.startsWith("~$")) out.push(path.join(p, f));
      });
    } else out.push(p);
  });
  return out;
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log("Uso: node scripts/processar.js <pasta ou arquivos .xlsx/.csv>");
    process.exit(1);
  }
  const arquivos = listarArquivos(args);
  if (!arquivos.length) { console.log("Nenhuma planilha .xlsx ou .csv encontrada. Nada a fazer."); return; }

  const tabelas = [];
  for (const arq of arquivos) {
    const nome = path.basename(arq);
    const blob = new Blob([fs.readFileSync(arq)]);
    try {
      const t = await DupAnalysis.readTable(blob, nome);
      if (t.kind) { tabelas.push(t); console.log(`✓ ${nome}: ${t.label} · ${t.rows} linhas`); }
      else console.log(`✗ ${nome}: ${t.error}`);
    } catch (e) { console.log(`✗ ${nome}: não consegui ler (${e.message})`); }
  }
  const tipos = new Set(tabelas.map((t) => t.kind));
  if (!tipos.has("SB1") && !tipos.has("SB2")) { console.log("Preciso ao menos da SB1 (ou do Saldo Físico). Nada foi gravado."); process.exit(1); }
  if (!tipos.has("SB1")) console.log("Aviso: sem SB1 — usando a descrição do Saldo Físico.");
  if (!tipos.has("SBZ")) console.log("Aviso: sem SBZ — ponto de pedido não será considerado.");
  if (!tipos.has("SB2")) console.log("Aviso: sem Saldo Físico — saldo e previsão de chegada não serão considerados.");

  const D = await DupAnalysis.build(tabelas, async (u, T, prog) => SimCore.join(u, T, prog), (msg) => { if (msg) console.log("…", msg); });
  const { summary } = DupAnalysis.summarize(D);
  const id = "s" + D.at.replace(/[^0-9]/g, "").slice(0, 14);
  const doc = Object.assign({ id, at: D.at, arquivo: id + ".json" }, DupAnalysis.snapshotDoc(D, summary));

  const pastaMed = path.join(raiz, "dados", "medicoes");
  fs.mkdirSync(pastaMed, { recursive: true });
  fs.writeFileSync(path.join(pastaMed, doc.arquivo), JSON.stringify(D));

  const arqHist = path.join(raiz, "dados", "historico.json");
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(arqHist, "utf8")); } catch (e) { hist = []; }
  if (!Array.isArray(hist)) hist = hist.medicoes || [];
  hist = hist.filter((m) => m.id !== id).concat([doc]).sort((a, b) => (a.at < b.at ? -1 : 1));
  fs.writeFileSync(arqHist, JSON.stringify(hist, null, 1));

  const g = summary.g;
  console.log(`\nMedição ${id} gravada.`);
  console.log(`Produtos ativos: ${g.prod} · com similar: ${g.comSim} (95–100%: ${g.b95} · 80–94%: ${g.b80})`);
  console.log(`Não bloquear: ${g.S + g.P + g.R} · candidatos a bloqueio: ${g.L1 + g.L2}`);
})().catch((e) => { console.error(e); process.exit(1); });
