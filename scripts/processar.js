#!/usr/bin/env node
// Processa as planilhas exportadas do Protheus e grava uma nova medição em dados/.
//
// Uso:
//   node scripts/processar.js planilhas
//   node scripts/processar.js SB1.xlsx SBZ.xlsx SALDO_FISICO_02.xlsx SALDO_FISICO_10.xlsx
//
// O PUBLICAR.bat usa a função processarPasta (modo conferido): só grava a medição se tiver
// SB1, SBZ e Saldo Físico de todas as empresas, e depois guarda as planilhas em
// planilhas/processadas/<data>/ para não processar de novo.
//
// Requer Node.js 20.12 ou mais novo. Usa o mesmo motor do site (js/), então o resultado é idêntico.
"use strict";
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
global.SimCore = require(path.join(raiz, "js/simcore.js"));
global.XlsxStream = require(path.join(raiz, "js/xlsxstream.js"));
const DupAnalysis = require(path.join(raiz, "js/analise.js"));

const EXT = /\.(xlsx|csv|txt)$/i;
const KIND_NOME = { SB1: "SB1 (cadastro de produtos)", SBZ: "SBZ (ponto de pedido)", SB2: "Saldo Físico (SB2)" };

function listarArquivos(args) {
  const out = [];
  args.forEach((a) => {
    const p = path.resolve(a);
    if (!fs.existsSync(p)) { console.warn("Não encontrado:", a); return; }
    if (fs.statSync(p).isDirectory()) {
      fs.readdirSync(p).sort().forEach((f) => {
        const full = path.join(p, f);
        if (EXT.test(f) && !f.startsWith("~$") && fs.statSync(full).isFile()) out.push(full);
      });
    } else out.push(p);
  });
  return out;
}

// mesma regra do site: filial com quantidade ímpar de dígitos ganha um zero à esquerda; empresa = 2 primeiros dígitos
function empresaDe(v) {
  let s = String(v == null ? "" : v).trim().replace(/\.0+$/, "");
  if (/^\d+$/.test(s) && s.length % 2 === 1) s = "0" + s;
  return s.slice(0, 2);
}
function empresasDa(t) {
  const c = {};
  ((t.data && t.data.filial) || []).forEach((f) => { const e = empresaDe(f); if (e) c[e] = (c[e] || 0) + 1; });
  return c;
}

async function lerPlanilhas(arquivos) {
  const tabelas = [], falhas = [];
  for (const arq of arquivos) {
    const nome = path.basename(arq);
    const blob = new Blob([fs.readFileSync(arq)]);
    try {
      const t = await DupAnalysis.readTable(blob, nome);
      if (t.kind) { t.arquivo = arq; t.empresas = empresasDa(t); tabelas.push(t); console.log(`  ✓ ${nome}: ${t.label} · ${t.rows.toLocaleString("pt-BR")} linhas · empresa ${Object.keys(t.empresas).sort().join(", ") || "?"}`); }
      else { falhas.push(nome); console.log(`  ✗ ${nome}: ${t.error}`); }
    } catch (e) { falhas.push(nome); console.log(`  ✗ ${nome}: não consegui ler (${e.message})`); }
  }
  return { tabelas, falhas };
}

// Confere se dá para gravar uma medição confiável. Devolve a lista de problemas (vazia = ok).
function conferir(tabelas) {
  const problemas = [];
  const porTipo = { SB1: [], SBZ: [], SB2: [] };
  tabelas.forEach((t) => porTipo[t.kind].push(t));
  if (!porTipo.SB1.length) { problemas.push("Falta a planilha " + KIND_NOME.SB1 + "."); return problemas; }
  const empresas = new Set();
  porTipo.SB1.forEach((t) => Object.keys(t.empresas).forEach((e) => empresas.add(e)));
  ["SB1", "SBZ", "SB2"].forEach((k) => {
    const dono = {};
    porTipo[k].forEach((t) => Object.keys(t.empresas).forEach((e) => {
      if (dono[e]) problemas.push(`Há duas planilhas ${KIND_NOME[k]} com a empresa ${e}: ${path.basename(dono[e])} e ${path.basename(t.arquivo)}. Deixe só a mais nova na pasta.`);
      else dono[e] = t.arquivo;
    }));
    if (k === "SB1") return;
    Array.from(empresas).sort().forEach((e) => {
      if (!dono[e]) problemas.push(`Falta a planilha ${KIND_NOME[k]} da empresa ${e}. Sem ela, produtos ${k === "SBZ" ? "com ponto de pedido" : "com saldo ou previsão de chegada"} apareceriam como livres para bloquear.`);
    });
  });
  return problemas;
}

async function gravarMedicao(tabelas) {
  const D = await DupAnalysis.build(tabelas, async (u, T, prog) => SimCore.join(u, T, prog), (msg) => { if (msg) console.log("  …", msg); });
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

  const n = (x) => (x || 0).toLocaleString("pt-BR");
  console.log(`\n  Medição ${id} gravada em dados/.`);
  D.empresas.forEach((e) => {
    const A = summary.emp[e];
    if (!A) return;
    console.log(`  Empresa ${e}: ${n(A.prod)} ativos · ${n(A.comSim)} com similar (95–100%: ${n(A.b95)} · 80–94%: ${n(A.b80)}) · não bloquear: ${n(A.S + A.P + A.R)} · podem ser bloqueados: ${n(A.L1 + A.L2)}`);
  });
  return doc;
}

// Arquivo aberto no Excel não pode ser movido depois; melhor avisar antes de processar.
function arquivoLivre(arq) {
  try { const fd = fs.openSync(arq, "r+"); fs.closeSync(fd); return true; } catch (e) { return !(e && e.code === "EBUSY"); }
}
function carimbo() {
  const d = new Date(), p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// Modo do PUBLICAR. Devolve "gravou", "vazio" ou lança erro (nada é gravado).
async function processarPasta(pasta) {
  const arquivos = listarArquivos([pasta]);
  if (!arquivos.length) return "vazio";
  const presos = arquivos.filter((a) => !arquivoLivre(a));
  if (presos.length) throw new Error("Feche no Excel: " + presos.map((a) => path.basename(a)).join(", ") + ". Depois rode o PUBLICAR de novo.");
  const { tabelas, falhas } = await lerPlanilhas(arquivos);
  if (!tabelas.length) { console.log("  Nenhuma planilha do Protheus reconhecida na pasta (" + falhas.join(", ") + " ficou de fora)."); return "vazio"; }
  const problemas = conferir(tabelas);
  if (problemas.length) throw new Error(problemas.join("\n  "));
  await gravarMedicao(tabelas);
  const destino = path.join(path.resolve(pasta), "processadas", carimbo());
  fs.mkdirSync(destino, { recursive: true });
  tabelas.forEach((t) => {
    const alvo = path.join(destino, path.basename(t.arquivo));
    try { fs.renameSync(t.arquivo, alvo); }
    catch (e) { fs.copyFileSync(t.arquivo, alvo); try { fs.unlinkSync(t.arquivo); } catch (e2) { console.log(`  Aviso: não consegui tirar ${path.basename(t.arquivo)} da pasta; apague-o antes da próxima atualização.`); } }
  });
  console.log(`  Planilhas guardadas em ${path.relative(raiz, destino).replace(/\\/g, "/")}/`);
  return "gravou";
}

module.exports = { processarPasta, listarArquivos, lerPlanilhas, conferir, gravarMedicao };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (!args.length) {
      console.log("Uso: node scripts/processar.js <pasta ou arquivos .xlsx/.csv>");
      process.exit(1);
    }
    const arquivos = listarArquivos(args);
    if (!arquivos.length) { console.log("Nenhuma planilha .xlsx ou .csv encontrada. Nada a fazer."); return; }
    const { tabelas } = await lerPlanilhas(arquivos);
    const tipos = new Set(tabelas.map((t) => t.kind));
    if (!tipos.has("SB1") && !tipos.has("SB2")) { console.log("Preciso ao menos da SB1 (ou do Saldo Físico). Nada foi gravado."); process.exit(1); }
    conferir(tabelas).forEach((p) => console.log("Aviso: " + p));
    await gravarMedicao(tabelas);
  })().catch((e) => { console.error(e); process.exit(1); });
}
