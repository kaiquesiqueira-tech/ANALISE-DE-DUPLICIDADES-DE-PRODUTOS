// ===== Protheus duplicate analysis: table reading, building, summarizing =====
var DupAnalysis = (function () {
  var T_MIN = 80;
  var BANDS = [
    { k: "b95", min: 95, max: 100, label: "95–100%" },
    { k: "b80", min: 80, max: 94, label: "80–94%" }
  ];
  function bandOf(s) { return s >= 95 ? "b95" : s >= T_MIN ? "b80" : null; }

  function normLabel(s) {
    return String(s == null ? "" : s).normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }
  var SPECS = {
    SB1: { label: "SB1 · Cadastro de produtos", need: ["cod", "desc"], cols: {
      filial: ["filial", "b1_filial"], cod: ["codigo", "b1_cod", "cod. produto", "produto"],
      desc: ["descricao", "b1_desc", "desc. produto"], tipo: ["tipo", "b1_tipo"], grupo: ["grupo", "b1_grupo"],
      um: ["unidade", "b1_um"], ucom: ["ult. compra", "b1_ucom"],
      blq: ["bloqueado", "blq. de tela", "blq.de tela", "b1_msblql", "bloqueio", "bloqueado?"],
      ativo: ["ativo", "b1_ativo", "ativo?"] } },
    SBZ: { label: "SBZ · Indicadores (ponto de pedido)", need: ["cod", "pp"], cols: {
      filial: ["filial", "bz_filial"], cod: ["codigo", "bz_cod", "produto"], pp: ["ponto pedido", "bz_emin"] } },
    SB2: { label: "SB2 · Saldo físico", need: ["cod", "saldo"], cols: {
      filial: ["filial", "b2_filial"], cod: ["produto", "b2_cod", "codigo"], saldo: ["saldo atual", "b2_qatu"],
      prev: ["qtd.prevista", "qtd. prevista", "b2_salpedi"], empenho: ["empenho", "b2_qemp"],
      desc: ["nome cientif", "descricao", "desc. produto"] } }
  };

  function classify(alias, headers) {
    var h = headers.map(normLabel);
    var has = function (arr) { return arr.some(function (x) { return h.indexOf(x) >= 0; }); };
    if (alias && SPECS[alias]) return alias;
    if (has(SPECS.SB1.cols.desc) && has(SPECS.SB1.cols.cod) && !has(SPECS.SB2.cols.saldo)) return "SB1";
    if (has(SPECS.SB2.cols.saldo)) return "SB2";
    if (has(SPECS.SBZ.cols.pp)) return "SBZ";
    return null;
  }

  function parseNum(v) {
    if (v == null || v === "") return 0;
    var s = String(v).trim();
    if (/^-?[\d.]*,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }
  function parseDate(v) {
    if (v == null) return "";
    var s = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(s)) {
      var n = Number(s);
      if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
      if (/^\d{8}$/.test(s)) return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
      return "";
    }
    var m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    if (m) return m[3] + "-" + m[2] + "-" + m[1];
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? m[0] : "";
  }
  function cleanCode(v) {
    var s = String(v == null ? "" : v).trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
    if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(s)) s = Number(s).toFixed(0);
    return s;
  }
  function cleanFilial(v) {
    var s = cleanCode(v);
    if (/^\d+$/.test(s) && s.length % 2 === 1) s = "0" + s;
    return s;
  }
  function empOf(fil) { return !fil ? "*" : fil.length <= 2 ? fil : fil.slice(0, 2); }
  function isBlocked(v) {
    var s = normLabel(v);
    return s === "1" || s === "sim" || s === "s" || s === "bloqueado" || s === "true";
  }
  // B1_ATIVO = N (não ativo) também conta como bloqueado. Vazio = ativo.
  function isInactive(v) {
    var s = normLabel(v);
    return s === "n" || s === "nao" || s === "2" || s === "false" || s === "inativo";
  }

  // Reads one file; returns {kind, label, name, rows, data}
  async function readTable(blob, name, onProgress) {
    var alias = null, headers = null, kind = null, map = null, rows = 0, nonEmpty = 0;
    var data = null;
    var visitor = {
      onRow: function (cells) {
        if (!headers) {
          var filled = 0;
          for (var i = 0; i < cells.length; i++) if (cells[i] != null && String(cells[i]).trim() !== "") filled++;
          if (filled === 0) return;
          nonEmpty++;
          if (filled <= 2 && nonEmpty === 1) {
            var a = String(cells[0] || "").trim().toUpperCase();
            if (/^S[A-Z0-9]{2}$/.test(a)) alias = a;
            return;
          }
          if (filled >= 3) {
            headers = [];
            for (var j = 0; j < cells.length; j++) headers[j] = cells[j] == null ? "" : String(cells[j]);
            kind = classify(alias, headers);
            if (!kind) return;
            var spec = SPECS[kind], h = headers.map(normLabel);
            map = {};
            Object.keys(spec.cols).forEach(function (f) {
              var idx = -1;
              spec.cols[f].some(function (lab) { idx = h.indexOf(lab); return idx >= 0; });
              map[f] = idx;
            });
            var missing = spec.need.filter(function (f) { return map[f] < 0; });
            if (missing.length) { kind = null; return; }
            data = {};
            Object.keys(map).forEach(function (f) { if (map[f] >= 0) data[f] = []; });
          }
          return;
        }
        if (!kind) return;
        var keyCell = cells[map.cod];
        if (keyCell == null || String(keyCell).trim() === "") return;
        for (var f in data) data[f].push(cells[map[f]] == null ? "" : cells[map[f]]);
        rows++;
      }
    };
    await XlsxStream.read(blob, name, visitor, onProgress);
    if (!kind) return { kind: null, name: name, rows: 0, error: "Não reconheci esta planilha (esperava SB1, SBZ ou SB2/Saldo físico)." };
    return { kind: kind, label: SPECS[kind].label, name: name, rows: rows, data: data,
      hasBlq: kind === "SB1" && map.blq >= 0, hasAtivo: kind === "SB1" && map.ativo >= 0 };
  }

  // tables: array of readTable results. runJoin(strings, T, onProgress) -> Promise<{a,b,s,n}>
  async function build(tables, runJoin, onStep) {
    onStep = onStep || function () {};
    var sb1 = tables.filter(function (t) { return t.kind === "SB1"; });
    var sbz = tables.filter(function (t) { return t.kind === "SBZ"; });
    var sb2 = tables.filter(function (t) { return t.kind === "SB2"; });

    var filSet = {}, known = {};
    function addKnown(fil, cod) { var e = empOf(fil); (known[e] = known[e] || new Set()).add(cod); }
    var stock = new Map(); // emp|cod -> Map(fil -> [saldo, prev, pp, present])
    function rec(fil, cod) {
      var k = empOf(fil) + "|" + cod, m = stock.get(k);
      if (!m) { m = new Map(); stock.set(k, m); }
      var r = m.get(fil);
      if (!r) { r = [0, 0, 0]; m.set(fil, r); }
      return r;
    }
    var sb2desc = new Map();
    sb2.forEach(function (t) {
      var d = t.data;
      for (var i = 0; i < d.cod.length; i++) {
        var fil = cleanFilial(d.filial ? d.filial[i] : ""), cod = cleanCode(d.cod[i]);
        if (!cod) continue;
        filSet[fil] = 1; addKnown(fil, cod);
        var r = rec(fil, cod);
        r[0] += parseNum(d.saldo[i]);
        if (d.prev) r[1] += parseNum(d.prev[i]);
        if (d.desc && d.desc[i]) { var k2 = empOf(fil) + "|" + cod; if (!sb2desc.has(k2)) sb2desc.set(k2, String(d.desc[i]).trim()); }
      }
    });
    sbz.forEach(function (t) {
      var d = t.data;
      for (var i = 0; i < d.cod.length; i++) {
        var fil = cleanFilial(d.filial ? d.filial[i] : ""), cod = cleanCode(d.cod[i]);
        if (!cod) continue;
        filSet[fil] = 1; addKnown(fil, cod);
        var r = rec(fil, cod);
        r[2] = Math.max(r[2], parseNum(d.pp[i]));
      }
    });
    var filiais = Object.keys(filSet).filter(Boolean).sort();
    var filIdx = {}; filiais.forEach(function (f, i) { filIdx[f] = i; });

    // products
    onStep("Montando cadastro de produtos");
    var prods = [], seen = new Set(), excl = { bloqueados: 0, inativos: 0, semDescricao: 0, repetidos: 0 };
    var inativos = [], seenInat = new Set();
    var descSource = sb1.length ? "SB1" : "SB2";
    if (sb1.length) {
      sb1.forEach(function (t) {
        var d = t.data;
        for (var i = 0; i < d.cod.length; i++) {
          var fil = cleanFilial(d.filial ? d.filial[i] : ""), emp = fil ? empOf(fil.length === 1 ? "0" + fil : fil) : "*";
          if (emp.length === 1) emp = "0" + emp;
          var cod = cleanCode(d.cod[i]);
          if (/^\d+$/.test(cod) && cod.length < 9) {
            var ks = known[emp];
            var c9 = ("000000000" + cod).slice(-9), c8 = ("00000000" + cod).slice(-8);
            if (ks && ks.has(cod)) { /* keep */ } else if (ks && ks.has(c9)) cod = c9; else if (ks && ks.has(c8)) cod = c8; else cod = c9;
          }
          var bloq = d.blq && isBlocked(d.blq[i]), inat = d.ativo && isInactive(d.ativo[i]);
          if (bloq || inat) {
            if (bloq) excl.bloqueados++; else excl.inativos++;
            if (!seenInat.has(emp + "|" + cod)) {
              seenInat.add(emp + "|" + cod);
              inativos.push({ emp: emp, cod: cod, desc: String(d.desc[i] == null ? "" : d.desc[i]).trim(),
                tipo: d.tipo ? String(d.tipo[i]).trim() : "", grupo: d.grupo ? cleanCode(d.grupo[i]) : "",
                um: d.um ? String(d.um[i]).trim() : "", ucom: d.ucom ? parseDate(d.ucom[i]) : "",
                motivo: bloq ? "Bloqueado" : "Ativo = N" });
            }
            continue;
          }
          var key = emp + "|" + cod;
          if (seen.has(key)) { excl.repetidos++; continue; }
          seen.add(key);
          var desc = String(d.desc[i] == null ? "" : d.desc[i]).trim();
          prods.push({ emp: emp, cod: cod, desc: desc, tipo: d.tipo ? String(d.tipo[i]).trim() : "",
            grupo: d.grupo ? cleanCode(d.grupo[i]) : "", um: d.um ? String(d.um[i]).trim() : "",
            ucom: d.ucom ? parseDate(d.ucom[i]) : "" });
        }
      });
    } else {
      stock.forEach(function (m, key) {
        var p = key.split("|");
        prods.push({ emp: p[0], cod: p[1], desc: sb2desc.get(key) || "", tipo: "", grupo: "", um: "", ucom: "" });
      });
    }
    var empresas = Array.from(new Set(prods.map(function (p) { return p.emp; }))).sort();
    var allEmps = Array.from(new Set(filiais.map(empOf))).sort();

    function stockOf(p) {
      if (p.emp !== "*") return stock.get(p.emp + "|" + p.cod) || null;
      var out = null;
      allEmps.forEach(function (e) {
        var m = stock.get(e + "|" + p.cod);
        if (m) { out = out || new Map(); m.forEach(function (v, f) { out.set(f, v); }); }
      });
      return out;
    }

    // per filial active product counts
    var prodPorFilial = {}, prodPorEmp = {};
    filiais.forEach(function (f) { prodPorFilial[f] = 0; });
    prods.forEach(function (p) {
      p.norm = SimCore.normalize(p.desc);
      if (!p.norm) excl.semDescricao++;
      prodPorEmp[p.emp] = (prodPorEmp[p.emp] || 0) + 1;
      var m = stockOf(p);
      p.st = m;
      if (m) m.forEach(function (v, f) { if (f in prodPorFilial) prodPorFilial[f]++; });
    });

    // similarity per empresa
    var pairsOut = [], inPair = new Map();
    function pidx(i) { var x = inPair.get(i); if (x == null) { x = inPair.size; inPair.set(i, x); } return x; }
    for (var e = 0; e < empresas.length; e++) {
      var emp = empresas[e];
      var groups = new Map();
      prods.forEach(function (p, i) {
        if (p.emp !== emp || !p.norm) return;
        var g = groups.get(p.norm);
        if (!g) { g = []; groups.set(p.norm, g); }
        g.push(i);
      });
      var uniq = Array.from(groups.keys()), members = uniq.map(function (u) { return groups.get(u); });
      onStep("Comparando descrições · empresa " + emp + " (" + uniq.length.toLocaleString("pt-BR") + " descrições)", 0);
      members.forEach(function (g) {
        for (var a = 0; a < g.length; a++) for (var b = a + 1; b < g.length; b++) pairsOut.push(pidx(g[a]), pidx(g[b]), 100);
      });
      var res = await runJoin(uniq, T_MIN, function (f) { onStep(null, f); });
      var refs = uniq.map(SimCore.refTokens);
      for (var k = 0; k < res.n; k++) {
        var ua = res.a[k], ub = res.b[k];
        var sc = Math.floor(res.s[k] * SimCore.refFactor(refs[ua], refs[ub]) + 1e-9);
        if (sc < T_MIN) continue;
        var ga = members[ua], gb = members[ub];
        for (var x = 0; x < ga.length; x++) for (var y = 0; y < gb.length; y++) pairsOut.push(pidx(ga[x]), pidx(gb[y]), sc);
      }
    }
    onStep("Organizando resultado");
    var P = new Array(inPair.size);
    inPair.forEach(function (pi, i) {
      var p = prods[i], pres = [], st = [];
      if (p.st) p.st.forEach(function (v, f) {
        var fi = filIdx[f];
        if (fi == null) return;
        pres.push(fi);
        if (v[0] || v[1] || v[2]) st.push([fi, round3(v[0]), round3(v[1]), round3(v[2])]);
      });
      P[pi] = [p.emp, p.cod, p.desc, p.tipo, p.grupo, p.um, p.ucom, pres, st];
    });
    function rowOf(p) {
      var pres = [], st = [], m = stockOf(p);
      if (m) m.forEach(function (v, f) {
        var fi = filIdx[f];
        if (fi == null) return;
        pres.push(fi);
        if (v[0] || v[1] || v[2]) st.push([fi, round3(v[0]), round3(v[1]), round3(v[2])]);
      });
      return [p.emp, p.cod, p.desc, p.tipo, p.grupo, p.um, p.ucom, pres, st, p.motivo];
    }
    var INAT = inativos.map(rowOf);
    return {
      v: 2, T: T_MIN, at: new Date().toISOString(), descSource: descSource,
      files: tables.map(function (t) { return { name: t.name, kind: t.kind, rows: t.rows }; }),
      empresas: empresas, filiais: filiais,
      totals: { prodPorEmp: prodPorEmp, prodPorFilial: prodPorFilial, excl: excl,
        hasBlq: sb1.some(function (t) { return t.hasBlq; }), hasAtivo: sb1.some(function (t) { return t.hasAtivo; }) },
      P: P, pairs: pairsOut, I: INAT
    };
  }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  // Derives per-product info + summary from a detail object
  function summarize(D) {
    var n = D.P.length, F = D.filiais.length;
    var best = new Uint8Array(n), bestP = new Int32Array(n).fill(-1), cnt = BANDS.map(function () { return new Int32Array(n); });
    var bIdx = {}; BANDS.forEach(function (b, x) { bIdx[b.k] = x; });
    var saldo = new Float64Array(n), prev = new Float64Array(n), pp = new Float64Array(n), prot = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var st = D.P[i][8];
      for (var j = 0; j < st.length; j++) { saldo[i] += st[j][1]; prev[i] += st[j][2]; pp[i] = Math.max(pp[i], st[j][3]); }
      prot[i] = saldo[i] !== 0 || prev[i] > 0 || pp[i] > 0 ? 1 : 0;
    }
    var pr = D.pairs, hasProtPartner = new Uint8Array(n);
    for (var k = 0; k < pr.length; k += 3) {
      var a = pr[k], b = pr[k + 1], s = pr[k + 2];
      if (!bandOf(s)) continue; // abaixo do mínimo (medições antigas)
      if (s > best[a] || (s === best[a] && prot[b] && bestP[a] >= 0 && !prot[bestP[a]])) { best[a] = s; bestP[a] = b; }
      if (s > best[b] || (s === best[b] && prot[a] && bestP[b] >= 0 && !prot[bestP[b]])) { best[b] = s; bestP[b] = a; }
      var bi = bIdx[bandOf(s)];
      cnt[bi][a]++; cnt[bi][b]++;
      if (prot[b]) hasProtPartner[a] = 1;
      if (prot[a]) hasProtPartner[b] = 1;
    }
    var cat = new Array(n);
    for (i = 0; i < n; i++) {
      cat[i] = saldo[i] !== 0 ? "S" : prev[i] > 0 ? "P" : pp[i] > 0 ? "R" : hasProtPartner[i] ? "L1" : "L2";
    }
    function agg(prod) {
      var o = { prod: prod || 0, comSim: 0, S: 0, P: 0, R: 0, L1: 0, L2: 0, fS: 0, fP: 0, fR: 0, inat: 0, inatMov: 0, m: {}, pairs: {} };
      BANDS.forEach(function (bd) { o[bd.k] = 0; o.pairs[bd.k] = 0; o.m[bd.k] = { S: 0, P: 0, R: 0, L1: 0, L2: 0 }; });
      return o;
    }
    var totProd = 0;
    Object.keys(D.totals.prodPorEmp).forEach(function (e) { totProd += D.totals.prodPorEmp[e]; });
    var S = { g: agg(totProd), emp: {}, fil: {} };
    D.empresas.forEach(function (e) { S.emp[e] = agg(D.totals.prodPorEmp[e]); });
    D.filiais.forEach(function (f) { S.fil[f] = agg(D.totals.prodPorFilial[f]); });
    function add(A, b, c, i) {
      A.comSim++; A[b]++; A[c]++; A.m[b][c]++;
      if (saldo[i] !== 0) A.fS++;
      if (prev[i] > 0) A.fP++;
      if (pp[i] > 0) A.fR++;
    }
    var band = new Array(n);
    for (i = 0; i < n; i++) {
      var b = bandOf(best[i]);
      band[i] = b;
      if (!b) continue; // sem similar acima do mínimo
      var c = cat[i], e = D.P[i][0];
      add(S.g, b, c, i);
      if (S.emp[e]) add(S.emp[e], b, c, i);
      var pres = D.P[i][7];
      for (j = 0; j < pres.length; j++) add(S.fil[D.filiais[pres[j]]], b, c, i);
    }
    // produtos inativos / bloqueados (fora da comparação)
    var IN = D.I || [], inSaldo = new Float64Array(IN.length), inPrev = new Float64Array(IN.length), inPP = new Float64Array(IN.length);
    for (i = 0; i < IN.length; i++) {
      var sti = IN[i][8] || [];
      for (j = 0; j < sti.length; j++) { inSaldo[i] += sti[j][1]; inPrev[i] += sti[j][2]; inPP[i] = Math.max(inPP[i], sti[j][3]); }
      var mov = inSaldo[i] !== 0 || inPrev[i] > 0 || inPP[i] > 0 ? 1 : 0;
      S.g.inat++; S.g.inatMov += mov;
      if (S.emp[IN[i][0]]) { S.emp[IN[i][0]].inat++; S.emp[IN[i][0]].inatMov += mov; }
      (IN[i][7] || []).forEach(function (fi) { var A = S.fil[D.filiais[fi]]; if (A) { A.inat++; A.inatMov += mov; } });
    }
    for (k = 0; k < pr.length; k += 3) {
      var pb = bandOf(pr[k + 2]), ea = D.P[pr[k]][0];
      if (!pb) continue;
      S.g.pairs[pb]++;
      if (S.emp[ea]) S.emp[ea].pairs[pb]++;
      var seenF = {};
      [D.P[pr[k]][7], D.P[pr[k + 1]][7]].forEach(function (ps) {
        ps.forEach(function (fi) { if (!seenF[fi]) { seenF[fi] = 1; S.fil[D.filiais[fi]].pairs[pb]++; } });
      });
    }
    return {
      info: { best: best, bestP: bestP, cnt: cnt, saldo: saldo, prev: prev, pp: pp, prot: prot, cat: cat, band: band },
      inat: { saldo: inSaldo, prev: inPrev, pp: inPP },
      summary: S
    };
  }

  function snapshotDoc(D, S, extra) {
    var o = { at: D.at, T: D.T, descSource: D.descSource, files: D.files, empresas: D.empresas, filiais: D.filiais,
      excl: D.totals.excl, hasBlq: D.totals.hasBlq, hasAtivo: !!D.totals.hasAtivo, g: S.g, emp: S.emp, fil: S.fil };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  return { readTable: readTable, build: build, summarize: summarize, snapshotDoc: snapshotDoc,
    BANDS: BANDS, bandOf: bandOf, SPECS: SPECS, T_MIN: T_MIN };
})();
if (typeof module !== "undefined") module.exports = DupAnalysis;
