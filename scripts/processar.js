#!/usr/bin/env node
// Processa as planilhas exportadas do Protheus e grava uma nova medição em dados/.
//
// Uso:
//   node scripts/processar.js planilhas
//   node scripts/processar.js SB1.xlsx SBZ.xlsx SALDO_FISICO_02.xlsx SALDO_FISICO_10.xlsx
//
// O PUBLICAR.bat usa a função processarPasta (modo conferido): só grava a medição se tiver
// SB1, SBZ e Saldo Físico de todas as empresas, e depois guarda as planilhas em
// planilhas/processadas/<data>/ para não processar de novo. Procura também nas subpastas de
// planilhas/ e recolhe planilhas deixadas na pasta principal do app.
//
// Requer Node.js 20.12 ou mais novo. Usa o mesmo motor do site (js/), então o resultado é idêntico.
"use strict";
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
global.SimCore = require(path.join(raiz, "js/simcore.js"));
global.XlsxStream = require(path.join(raiz, "js/xlsxstream.js"));
const DupAnalysis = require(path.join(raiz, "js/analise.js"));

const EXT = /\.(xlsx|xlsm|csv|txt)$/i;
// Planilhas que o app não lê: o PUBLICAR avisa em vez de ignorar calado.
const OUTRAS = [
  [/\.xls$/i, "formato antigo do Excel (.xls)"],
  [/\.xlsb$/i, "pasta de trabalho binária do Excel (.xlsb)"],
  [/\.xml$/i, "planilha em XML"],
  [/\.ods$/i, "planilha do LibreOffice (.ods)"],
  [/\.zip$/i, "arquivo compactado (.zip) — extraia as planilhas"],
];
const KIND_NOME = { SB1: "SB1 (cadastro de produtos)", SBZ: "SBZ (ponto de pedido)", SB2: "Saldo Físico (SB2)" };

// Pasta: entra nas subpastas (menos "processadas", que guarda o que já foi usado).
function varrer(pasta, out, fora) {
  fs.readdirSync(pasta).sort().forEach((f) => {
    const full = path.join(pasta, f);
    let st; try { st = fs.statSync(full); } catch (e) { return; }
    if (st.isDirectory()) { if (!/^processadas$/i.test(f) && !f.startsWith(".")) varrer(full, out, fora); return; }
    if (!st.isFile() || f.startsWith("~$") || /^leia-me\.md$/i.test(f) || /^desktop\.ini$/i.test(f) || f.startsWith(".")) return;
    if (EXT.test(f)) out.push(full);
    else if (fora) fora.push(full);
  });
}
function listarArquivos(args, fora) {
  const out = [];
  args.forEach((a) => {
    const p = path.resolve(a);
    if (!fs.existsSync(p)) { console.warn("Não encontrado:", a); return; }
    if (fs.statSync(p).isDirectory()) varrer(p, out, fora);
    else out.push(p);
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
      if (t.kind) {
        const tabelaAux = t.kind === "NCM" || t.kind === "GRP";
        t.arquivo = arq; t.empresas = tabelaAux ? {} : empresasDa(t); tabelas.push(t);
        console.log(`  ✓ ${nome}: ${t.label} · ${t.rows.toLocaleString("pt-BR")} linhas` + (tabelaAux ? "" : ` · empresa ${Object.keys(t.empresas).sort().join(", ") || "?"}`));
      }
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

// Tabela de NCM (mata010) → dados/ncm.json, usada para mostrar a descrição de cada NCM.
function gravarTabelaNcm(ncmTabs) {
  const tab = DupAnalysis.ncmTabela(ncmTabs);
  fs.mkdirSync(path.join(raiz, "dados"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "dados", "ncm.json"), JSON.stringify(tab));
  console.log(`  Tabela de NCM gravada em dados/ncm.json: ${tab.linhas.toLocaleString("pt-BR")} códigos com descrição.`);
  return tab;
}

// Tabelas de grupos (uma por empresa) → dados/grupos.json, usada para mostrar a descrição do grupo.
// A empresa vem do nome do arquivo e é conferida com os grupos dos produtos (SB1 junto ou última medição):
// se o nome disser 02 e os grupos forem da 10, nada é gravado.
function gruposDaUltimaMedicao() {
  try {
    const hist = JSON.parse(fs.readFileSync(path.join(raiz, "dados", "historico.json"), "utf8").replace(/^\uFEFF/, ""));
    const lista = (Array.isArray(hist) ? hist : hist.medicoes || []).filter((m) => m && m.arquivo).sort((a, b) => (a.at < b.at ? -1 : 1));
    for (let k = lista.length - 1; k >= 0; k--) {
      const arq = path.join(raiz, "dados", "medicoes", lista[k].arquivo);
      if (fs.existsSync(arq)) return DupAnalysis.gruposDaMedicao(JSON.parse(fs.readFileSync(arq, "utf8")));
    }
  } catch (e) { /* sem medição: vale só o nome do arquivo */ }
  return {};
}
function decidirGrupos(grpTabs, med) {
  const temSB1 = med.some((t) => t.kind === "SB1");
  const r = DupAnalysis.decidirGrupos(grpTabs, temSB1 ? DupAnalysis.gruposDaSB1(med) : gruposDaUltimaMedicao());
  r.avisos.forEach((a) => console.log("  Aviso: " + a));
  return r;
}
function gravarTabelaGrupos(tabelas) {
  const arq = path.join(raiz, "dados", "grupos.json");
  let atual = { v: 1, emp: {} };
  try { const j = JSON.parse(fs.readFileSync(arq, "utf8").replace(/^\uFEFF/, "")); if (j && j.emp) atual = j; } catch (e) { /* novo */ }
  Object.keys(tabelas).sort().forEach((e) => {
    atual.emp[e] = tabelas[e];
    const c = tabelas[e].cobertura;
    console.log(`  Grupos da empresa ${e} gravados em dados/grupos.json: ${tabelas[e].linhas.toLocaleString("pt-BR")} grupos (${tabelas[e].arquivo}` + (c != null ? `; tem ${Math.round(c * 100)}% dos grupos usados pelos produtos da ${e})` : ")"));
  });
  atual.at = new Date().toISOString();
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify(atual));
  return atual;
}

// Arquivo aberto no Excel não pode ser movido depois; melhor avisar antes de processar.
function arquivoLivre(arq) {
  try { const fd = fs.openSync(arq, "r+"); fs.closeSync(fd); return true; } catch (e) { return !(e && e.code === "EBUSY"); }
}
function carimbo() {
  const d = new Date(), p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function rel(arq) { return path.relative(raiz, arq).replace(/\\/g, "/"); }
function dataBR(iso) {
  const d = new Date(iso), p = (x) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Planilha deixada na pasta principal do app vai para a pasta planilhas
// (senão ela não é processada e ainda iria para o GitHub junto com o resto).
function recolherDaRaiz(pasta) {
  const movidos = [];
  fs.readdirSync(raiz).forEach((f) => {
    const full = path.join(raiz, f);
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(f) || f.startsWith("~$")) return;
    try { if (!fs.statSync(full).isFile()) return; } catch (e) { return; }
    const alvo = path.join(pasta, f);
    if (fs.existsSync(alvo)) { console.log(`  Aviso: ${f} está na pasta principal do app e também em planilhas/; usei o da pasta planilhas.`); return; }
    try { fs.renameSync(full, alvo); movidos.push(f); }
    catch (e) { console.log(`  Aviso: ${f} está na pasta principal do app; mova-o para a pasta planilhas (${e.code === "EBUSY" ? "está aberto no Excel" : e.message}).`); }
  });
  if (movidos.length) console.log("  Movi da pasta principal do app para planilhas/: " + movidos.join(", "));
}

function ultimaProcessada(pasta) {
  const proc = path.join(pasta, "processadas");
  if (!fs.existsSync(proc)) return null;
  const subs = fs.readdirSync(proc).filter((f) => { try { return fs.statSync(path.join(proc, f)).isDirectory(); } catch (e) { return false; } }).sort();
  if (!subs.length) return null;
  const ult = subs[subs.length - 1];
  return { pasta: ult, arquivos: fs.readdirSync(path.join(proc, ult)) };
}

// Gráficos "Cadastro por data" do site: dados/datas.json sai só da SB1 (DT Referenc. e Ult. Revisao).
function gravarDatas(sb1, origem) {
  const datas = DupAnalysis.datasCadastro(sb1);
  if (!datas) { console.log("  Aviso: a SB1 não tem as colunas DT Referenc. e Ult. Revisao; os gráficos de data não mudaram."); return null; }
  const obj = Object.assign({ at: new Date().toISOString(), arquivo: sb1.map((t) => path.basename(t.arquivo || t.name)).join(", "), origem: origem || "planilhas" }, datas);
  const arq = path.join(raiz, "dados", "datas.json");
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify(obj));
  let inc = 0;
  Object.keys(datas.emp).forEach((e) => { const m = datas.emp[e].inc; Object.keys(m).forEach((k) => { inc += m[k][0] + m[k][1]; }); });
  console.log(`  Gráficos de data (Cadastro por data) atualizados com ${obj.arquivo}${origem && origem !== "planilhas" ? " de " + origem : ""}: ${inc.toLocaleString("pt-BR")} produtos com data de inclusão.`);
  return obj;
}
// Primeira vez (ainda sem dados/datas.json): usa a SB1 da última atualização guardada em planilhas/processadas
async function datasDaUltimaProcessada(pasta) {
  if (fs.existsSync(path.join(raiz, "dados", "datas.json"))) return null;
  const proc = path.join(pasta, "processadas");
  if (!fs.existsSync(proc)) return null;
  const subs = fs.readdirSync(proc).filter((f) => { try { return fs.statSync(path.join(proc, f)).isDirectory(); } catch (e) { return false; } }).sort().reverse();
  for (const sub of subs) {
    const arqs = fs.readdirSync(path.join(proc, sub)).filter((f) => EXT.test(f) && !f.startsWith("~$")).map((f) => path.join(proc, sub, f));
    // a SB1 costuma ter "SB1" no nome; lê essas primeiro para não abrir as planilhas de saldo à toa
    const prov = arqs.filter((a) => /sb1/i.test(path.basename(a)));
    for (const lote of [prov, arqs.filter((a) => prov.indexOf(a) < 0)]) {
      if (!lote.length) continue;
      const sb1 = (await lerPlanilhas(lote)).tabelas.filter((t) => t.kind === "SB1");
      if (sb1.length) return gravarDatas(sb1, "planilhas/processadas/" + sub);
    }
  }
  return null;
}

// Modo do PUBLICAR. Devolve { status, doc, ncm, grupos, datas, motivo }:
//   status "gravou" (medição nova), "tabelas" (só tabela de NCM e/ou de grupos) ou "vazio" (nada para processar).
// Lança erro (nada é gravado) se as planilhas tiverem problema.
async function processarPasta(pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  recolherDaRaiz(pasta);
  const fora = [];
  const arquivos = listarArquivos([pasta], fora);
  fora.forEach((a) => {
    const n = path.basename(a), o = OUTRAS.find((x) => x[0].test(n));
    if (o) console.log(`  ✗ ${rel(a)}: ${o[1]} — abra no Excel e use Salvar como → "Pasta de Trabalho do Excel (.xlsx)".`);
    else console.log(`  · ${rel(a)}: não é planilha; ignorado.`);
  });
  if (!arquivos.length) {
    const ult = ultimaProcessada(pasta);
    const motivo = fora.length ? "Nenhuma planilha .xlsx ou .csv na pasta planilhas (veja os arquivos ✗ acima)." : "A pasta planilhas está vazia.";
    console.log("  " + motivo);
    console.log(`  Pasta conferida: ${pasta}`);
    if (ult) console.log(`  Última atualização processada: planilhas/processadas/${ult.pasta}/ (${ult.arquivos.join(", ")})`);
    const datas = await datasDaUltimaProcessada(pasta);
    return { status: datas ? "tabelas" : "vazio", motivo, datas };
  }
  const presos = arquivos.filter((a) => !arquivoLivre(a));
  if (presos.length) throw new Error("Feche no Excel: " + presos.map((a) => path.basename(a)).join(", ") + ". Depois rode o PUBLICAR de novo.");
  const { tabelas, falhas } = await lerPlanilhas(arquivos);
  if (!tabelas.length) {
    throw new Error("Nenhuma das planilhas da pasta foi reconhecida (" + falhas.join(", ") + "). Confira se são as exportações SB1, SBZ e Saldo Físico do Protheus, com a linha de títulos das colunas.");
  }
  const ncmTabs = tabelas.filter((t) => t.kind === "NCM"), grpTabs = tabelas.filter((t) => t.kind === "GRP");
  let med = tabelas.filter((t) => t.kind !== "NCM" && t.kind !== "GRP");
  // Só a SB1 na pasta (sem SBZ e sem Saldo Físico): atualiza só os gráficos de data, sem medição nova
  const soSb1 = med.length > 0 && med.every((t) => t.kind === "SB1");
  const sb1 = med.filter((t) => t.kind === "SB1");
  if (soSb1) { console.log("  Só a SB1 na pasta: atualizo os gráficos de data; para uma medição nova, coloque também a SBZ e o Saldo Físico."); med = []; }
  if (med.length) {
    const problemas = conferir(med);
    if (problemas.length) throw new Error(problemas.join("\n  "));
  }
  const dg = grpTabs.length ? decidirGrupos(grpTabs, med.length ? med : sb1) : null;
  if (dg && dg.erros.length) throw new Error(dg.erros.join("\n  "));
  if (falhas.length) console.log(`  Aviso: ${falhas.join(", ")} não ${falhas.length > 1 ? "foram reconhecidos e ficaram" : "foi reconhecido e ficou"} na pasta.`);
  let ncm = null, doc = null, grupos = null, datas = null;
  if (ncmTabs.length) ncm = gravarTabelaNcm(ncmTabs);
  if (sb1.length) datas = gravarDatas(sb1);
  if (dg) { gravarTabelaGrupos(dg.tabelas); grupos = Object.keys(dg.tabelas).sort(); }
  if (med.length) doc = await gravarMedicao(med);
  const destino = path.join(path.resolve(pasta), "processadas", carimbo());
  fs.mkdirSync(destino, { recursive: true });
  const subpastas = new Set();
  tabelas.forEach((t) => {
    const dir = path.dirname(t.arquivo);
    if (path.resolve(dir) !== path.resolve(pasta)) subpastas.add(dir);
    let alvo = path.join(destino, path.basename(t.arquivo));
    if (fs.existsSync(alvo)) alvo = path.join(destino, path.basename(dir) + " - " + path.basename(t.arquivo)); // mesmo nome em subpastas diferentes
    try { fs.renameSync(t.arquivo, alvo); }
    catch (e) { fs.copyFileSync(t.arquivo, alvo); try { fs.unlinkSync(t.arquivo); } catch (e2) { console.log(`  Aviso: não consegui tirar ${path.basename(t.arquivo)} da pasta; apague-o antes da próxima atualização.`); } }
  });
  // subpasta que ficou vazia sai também
  Array.from(subpastas).sort((a, b) => b.length - a.length).forEach((d) => { try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch (e) { /* fica */ } });
  console.log(`  Planilhas guardadas em ${rel(destino)}/`);
  return { status: med.length ? "gravou" : "tabelas", doc, ncm, grupos, datas };
}

module.exports = { processarPasta, listarArquivos, lerPlanilhas, conferir, gravarMedicao, gravarTabelaNcm, gravarTabelaGrupos, gravarDatas, dataBR };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (!args.length) {
      console.log("Uso: node scripts/processar.js <pasta ou arquivos .xlsx/.csv>");
      process.exit(1);
    }
    const arquivos = listarArquivos(args);
    if (!arquivos.length) { console.log("Nenhuma planilha .xlsx ou .csv encontrada. Nada a fazer."); return; }
    const lidas = (await lerPlanilhas(arquivos)).tabelas;
    const ncmTabs = lidas.filter((t) => t.kind === "NCM"), grpTabs = lidas.filter((t) => t.kind === "GRP");
    const tabelas = lidas.filter((t) => t.kind !== "NCM" && t.kind !== "GRP");
    if (ncmTabs.length) gravarTabelaNcm(ncmTabs);
    if (grpTabs.length) {
      const dg = decidirGrupos(grpTabs, tabelas);
      if (dg.erros.length) { dg.erros.forEach((e) => console.log("Erro: " + e)); process.exit(1); }
      gravarTabelaGrupos(dg.tabelas);
    }
    if (!tabelas.length && (ncmTabs.length || grpTabs.length)) return;
    const sb1 = tabelas.filter((t) => t.kind === "SB1");
    if (sb1.length) gravarDatas(sb1);
    if (sb1.length && sb1.length === tabelas.length) { console.log("Só a SB1: atualizei os gráficos de data; medição nova precisa também da SBZ e do Saldo Físico."); return; }
    const tipos = new Set(tabelas.map((t) => t.kind));
    if (!tipos.has("SB1") && !tipos.has("SB2")) { console.log("Preciso ao menos da SB1 (ou do Saldo Físico). Nada foi gravado."); process.exit(1); }
    conferir(tabelas).forEach((p) => console.log("Aviso: " + p));
    await gravarMedicao(tabelas);
  })().catch((e) => { console.error(e); process.exit(1); });
}
