#!/usr/bin/env node
// Usado pelo PUBLICAR.bat antes de enviar ao GitHub:
//   1) traz da pasta Downloads o que o site baixou (historico.json, bloqueios.json, s….json),
//      juntando com o que já está em dados/ (nada do repositório se perde);
//   2) processa as planilhas da pasta planilhas/ e grava a nova medição em dados/.
//
// Uso: node scripts/publicar.js --downloads "C:\Users\...\Downloads" --planilhas planilhas
// Sai com código 1 se algo impedir a publicação (nada é gravado nesse caso).
"use strict";
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
const dados = path.join(raiz, "dados");

function arg(nome) { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : null; }
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
  if (!n && !hs.length && !bs.length && !ns.length) console.log("  Nenhum arquivo baixado pelo site.");
  return n;
}

(async () => {
  console.log("\n  Arquivos baixados pelo site (pasta Downloads):");
  importarDownloads(arg("--downloads"));

  const pasta = path.resolve(raiz, arg("--planilhas") || "planilhas");
  fs.mkdirSync(pasta, { recursive: true });
  console.log("\n  Planilhas do Protheus (pasta " + path.relative(raiz, pasta).replace(/\\/g, "/") + "):");
  const { processarPasta } = require("./processar.js");
  const r = await processarPasta(pasta);
  if (r === "vazio") console.log("  Nenhuma planilha nova na pasta.");
  if (r === "ncm") console.log("  Só a tabela de NCM foi atualizada (nenhuma medição nova).");
})().catch((e) => {
  console.log("\n  [ERRO] Nada foi publicado:\n  " + (e && e.message ? e.message : e));
  console.log("  As planilhas continuam na pasta. Corrija e rode o PUBLICAR de novo.");
  process.exit(1);
});
