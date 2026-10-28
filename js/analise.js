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
      ativo: ["ativo", "b1_ativo", "ativo?"],
      dtinc: ["dt referenc.", "dt referenc", "dt referencia", "dt. referencia", "data referencia", "data de referencia", "b1_datref"],
      dtrev: ["ult. revisao", "ult revisao", "ult.revisao", "ultima revisao", "b1_urev"],
      ncm: ["pos.ipi/ncm", "pos. ipi/ncm", "pos.ipi / ncm", "b1_posipi", "ncm", "cod. ncm", "codigo ncm"] } },
    SBZ: { label: "SBZ · Indicadores (ponto de pedido)", need: ["cod", "pp"], cols: {
      filial: ["filial", "bz_filial"], cod: ["codigo", "bz_cod", "produto"], pp: ["ponto pedido", "bz_emin"] } },
    SB2: { label: "SB2 · Saldo físico", need: ["cod", "saldo"], cols: {
      filial: ["filial", "b2_filial"], cod: ["produto", "b2_cod", "codigo"], saldo: ["saldo atual", "b2_qatu"],
      prev: ["qtd.prevista", "qtd. prevista", "b2_salpedi"], empenho: ["empenho", "b2_qemp"],
      desc: ["nome cientif", "descricao", "desc. produto"] } },
    // tabela de NCM do Protheus (rotina mata010 / tabela SYD): código + descrição
    NCM: { label: "Tabela de NCM", need: ["cod", "desc"], cols: {
      cod: ["tec", "yd_tec", "ncm", "cod. ncm", "codigo ncm", "nbm"], desc: ["descricao", "yd_desc_p", "desc. ncm", "descricao ncm"],
      ex: ["ex-ncm", "yd_ex_ncm"] } },
    // tabela de grupos de produto do Protheus (SBM: Codigo, Descricao, Marca) — uma por empresa;
    // a empresa vem do nome do arquivo ("mata010 02.xlsx") e é conferida com os grupos dos produtos
    GRP: { label: "Tabela de grupos", need: ["cod", "desc"], cols: {
      cod: ["bm_grupo", "cod. grupo", "codigo", "grupo"], desc: ["bm_desc", "descricao", "desc. grupo", "descricao grupo"] } }
  };

  function classify(alias, headers) {
    var h = headers.map(normLabel);
    var has = function (arr) { return arr.some(function (x) { return h.indexOf(x) >= 0; }); };
    if (alias && SPECS[alias]) return alias;
    if (alias === "SBM") return "GRP";
    // tabela de grupos: código + descrição e nada de produto, saldo, ponto de pedido ou NCM
    var grpCod = has(["bm_grupo", "cod. grupo"]) || (has(["codigo"]) && !has(["grupo", "b1_grupo"])) || (has(["grupo"]) && !has(["codigo", "b1_cod", "produto"]));
    var prodCols = ["tipo", "b1_tipo", "unidade", "b1_um", "filial", "b1_filial", "ult. compra", "b1_ucom", "ativo", "b1_ativo"].concat(SPECS.SB1.cols.ncm);
    if (grpCod && has(SPECS.GRP.cols.desc) && !has(prodCols) && !has(SPECS.SB2.cols.saldo) && !has(SPECS.SBZ.cols.pp) && !has(SPECS.NCM.cols.cod)) return "GRP";
    if (has(SPECS.SB1.cols.desc) && has(SPECS.SB1.cols.cod) && !has(SPECS.SB2.cols.saldo)) return "SB1";
    if (has(SPECS.SB2.cols.saldo)) return "SB2";
    if (has(SPECS.SBZ.cols.pp)) return "SBZ";
    if (has(SPECS.NCM.cols.cod) && has(SPECS.NCM.cols.desc)) return "NCM";
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
  // NCM: 8 dígitos no formato 0000.00.00 (o Excel pode ter tirado o zero à esquerda ou os pontos)
  function cleanNcm(v) {
    var s = String(v == null ? "" : v).trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
    var d = s.replace(/\D/g, "");
    if (!d || /^0+$/.test(d)) return "";
    if (d.length === 7 && /^\d+$/.test(s)) d = "0" + d;
    return d.length === 8 ? d.slice(0, 4) + "." + d.slice(4, 6) + "." + d.slice(6) : s;
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
  // B1_ATIVO = N (não ativo) conta como bloqueado. Vazio também, quando a coluna está preenchida (tem "S" nos ativos).
  function isInactive(v) {
    var s = normLabel(v);
    return s === "n" || s === "nao" || s === "2" || s === "false" || s === "inativo";
  }
  function isActiveYes(v) {
    var s = normLabel(v);
    return s === "s" || s === "sim" || s === "1" || s === "true" || s === "ativo";
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
          if (filled >= 3 || (filled === 2 && nonEmpty <= 10)) {
            headers = [];
            for (var j = 0; j < cells.length; j++) headers[j] = cells[j] == null ? "" : String(cells[j]);
            kind = classify(alias, headers);
            if (!kind) { if (nonEmpty < 10) headers = null; return; }
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
    if (!kind) return { kind: null, name: name, rows: 0, error: "Não reconheci esta planilha (esperava SB1, SBZ, SB2/Saldo físico ou a tabela de NCM)." };
    return { kind: kind, label: SPECS[kind].label, name: name, rows: rows, data: data,
      hasBlq: kind === "SB1" && map.blq >= 0, hasAtivo: kind === "SB1" && map.ativo >= 0, hasNcm: kind === "SB1" && map.ncm >= 0,
      hasDatas: kind === "SB1" && (map.dtinc >= 0 || map.dtrev >= 0) };
  }

  // Tabela de NCM (mata010): código 0000.00.00 → descrição. A linha sem Ex-NCM tem preferência.
  function ncmTabela(tables) {
    var m = {}, linhas = 0, nomes = [];
    tables.forEach(function (t) {
      nomes.push(t.name);
      var d = t.data;
      for (var i = 0; i < d.cod.length; i++) {
        var c = cleanNcm(d.cod[i]), ds = String(d.desc[i] == null ? "" : d.desc[i]).trim().replace(/\s+/g, " ");
        if (!c || !ds) continue;
        var ex = d.ex ? cleanCode(d.ex[i]) : "";
        if (m[c] && ex) continue;
        if (!m[c]) linhas++;
        m[c] = ds;
      }
    });
    return { v: 1, at: new Date().toISOString(), arquivo: nomes.join(", "), linhas: linhas, m: m };
  }

  // ---- grupos de produto (descrição por empresa) ----
  // Código do grupo como no Protheus: 2 dígitos (categoria) ou 4 (grupo); o Excel tira o zero da frente.
  function normGrupo(v) {
    var s = cleanCode(v);
    if (/^\d+$/.test(s) && s.length % 2 === 1) s = "0" + s;
    return s;
  }
  function grupoTabela(t) {
    var m = {}, linhas = 0, d = t.data;
    for (var i = 0; i < d.cod.length; i++) {
      var c = normGrupo(d.cod[i]), ds = String(d.desc[i] == null ? "" : d.desc[i]).trim().replace(/\s+/g, " ");
      if (!c || !ds) continue;
      if (!m[c]) linhas++;
      m[c] = ds;
    }
    return { v: 1, at: new Date().toISOString(), arquivo: t.name, linhas: linhas, m: m };
  }
  // Empresa escrita no nome do arquivo: um número de 2 dígitos solto ("mata010 02.xlsx" → 02).
  function empresaDoNome(nome, conhecidas) {
    var base = String(nome || "").replace(/\.[^.]+$/, ""), re = /(?:^|\D)(\d{2})(?!\d)/g, achou = [], m;
    while ((m = re.exec(base))) { if (achou.indexOf(m[1]) < 0) achou.push(m[1]); re.lastIndex = m.index + 1; }
    if (conhecidas && conhecidas.length) achou = achou.filter(function (e) { return conhecidas.indexOf(e) >= 0; });
    return achou.length === 1 ? achou[0] : null;
  }
  // Grupos usados pelos produtos de cada empresa: {emp: {grupo: 1}}
  function gruposDaSB1(tables) {
    var u = {};
    tables.forEach(function (t) {
      if (t.kind !== "SB1" || !t.data.grupo) return;
      var f = t.data.filial || [];
      for (var i = 0; i < t.data.grupo.length; i++) {
        var e = empOf(cleanFilial(f[i])), g = normGrupo(t.data.grupo[i]);
        if (!g || e === "*") continue;
        (u[e] = u[e] || {})[g] = 1;
      }
    });
    return u;
  }
  function gruposDaMedicao(D) {
    var u = {};
    [D && D.P, D && D.I].forEach(function (L) {
      (L || []).forEach(function (p) { var g = normGrupo(p[4]); if (g) (u[p[0]] = u[p[0]] || {})[g] = 1; });
    });
    return u;
  }
  // Decide a empresa de cada tabela de grupos: nome do arquivo + conferência com os grupos dos produtos.
  // Uma tabela da empresa certa tem quase todos os grupos usados por ela (02: 100%; com a tabela trocada, 53%).
  // Devolve { tabelas: {emp: tab}, erros: [texto], avisos: [texto] }.
  function decidirGrupos(grpTables, usados) {
    usados = usados || {};
    var conhecidas = Object.keys(usados).filter(function (e) { return Object.keys(usados[e]).length >= 5; }).sort();
    var out = { tabelas: {}, erros: [], avisos: [] }, origem = {};
    var pct = function (x) { return Math.round(x * 100) + "%"; };
    grpTables.forEach(function (t) {
      var tab = grupoTabela(t), cov = {}, best = null, second = null;
      conhecidas.forEach(function (e) {
        var gs = Object.keys(usados[e]), ok = 0;
        gs.forEach(function (g) { if (tab.m[g]) ok++; });
        cov[e] = ok / gs.length;
        if (best === null || cov[e] > cov[best]) { second = best; best = e; }
        else if (second === null || cov[e] > cov[second]) second = e;
      });
      var claro = best !== null && cov[best] >= 0.9 && (second === null || cov[best] - cov[second] >= 0.1);
      var nomeEmp = empresaDoNome(t.name, conhecidas.length ? conhecidas : null), emp = null;
      if (nomeEmp) {
        if (claro && best !== nomeEmp && (cov[nomeEmp] || 0) < 0.9) {
          out.erros.push(t.name + ": o nome diz empresa " + nomeEmp + ", mas os grupos batem com a empresa " + best + " (" + pct(cov[best]) +
            " dos grupos dos produtos da " + best + " estão nela, contra " + pct(cov[nomeEmp] || 0) + " da " + nomeEmp + "). Confira se o arquivo não foi trocado.");
          return;
        }
        emp = nomeEmp;
        if (cov[emp] != null && cov[emp] < 0.9) out.avisos.push(t.name + ": só " + pct(cov[emp]) + " dos grupos dos produtos da empresa " + emp + " estão nesta tabela.");
      } else if (claro) {
        emp = best;
        out.avisos.push(t.name + ": sem a empresa no nome; pelos grupos dos produtos é da empresa " + emp + " (" + pct(cov[emp]) + ").");
      } else {
        out.erros.push(t.name + ": não sei de qual empresa é esta tabela de grupos. Coloque a empresa no nome do arquivo, por exemplo \"grupos 02.xlsx\".");
        return;
      }
      if (origem[emp]) { out.erros.push("Há duas tabelas de grupos da empresa " + emp + ": " + origem[emp] + " e " + t.name + ". Deixe só uma."); delete out.tabelas[emp]; return; }
      origem[emp] = t.name;
      tab.emp = emp; tab.cobertura = cov[emp] != null ? Math.round(cov[emp] * 1000) / 1000 : null;
      out.tabelas[emp] = tab;
      t.label = "Tabela de grupos · empresa " + emp;
    });
    if (out.erros.length) out.tabelas = {};
    return out;
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
    // datas do cadastro por empresa: dia (AAAAMMDD) → [ativos, bloqueados]
    var datas = { emp: {} };
    function contaData(emp, v, campo, bloq) {
      var E = datas.emp[emp] || (datas.emp[emp] = { inc: {}, rev: {}, semInc: [0, 0], semRev: [0, 0] });
      var dd = parseDate(v), x = bloq ? 1 : 0;
      if (!dd) { E[campo === "inc" ? "semInc" : "semRev"][x]++; return; }
      var k = dd.replace(/-/g, ""), m = E[campo];
      (m[k] || (m[k] = [0, 0]))[x]++;
    }
    function contaDatas(d, i, emp, bloq) {
      if (d.dtinc) contaData(emp, d.dtinc[i], "inc", bloq);
      if (d.dtrev) contaData(emp, d.dtrev[i], "rev", bloq);
    }
    if (sb1.length) {
      sb1.forEach(function (t) {
        var d = t.data;
        var ativoVazioBloq = !!d.ativo && d.ativo.some(isActiveYes);
        for (var i = 0; i < d.cod.length; i++) {
          var fil = cleanFilial(d.filial ? d.filial[i] : ""), emp = fil ? empOf(fil.length === 1 ? "0" + fil : fil) : "*";
          if (emp.length === 1) emp = "0" + emp;
          var cod = cleanCode(d.cod[i]);
          if (/^\d+$/.test(cod) && cod.length < 9) {
            var ks = known[emp];
            var c9 = ("000000000" + cod).slice(-9), c8 = ("00000000" + cod).slice(-8);
            if (ks && ks.has(cod)) { /* keep */ } else if (ks && ks.has(c9)) cod = c9; else if (ks && ks.has(c8)) cod = c8; else cod = c9;
          }
          var bloq = d.blq && isBlocked(d.blq[i]), vazio = ativoVazioBloq && normLabel(d.ativo[i]) === "";
          var inat = d.ativo && (isInactive(d.ativo[i]) || vazio);
          if (bloq || inat) {
            if (bloq) excl.bloqueados++; else excl.inativos++;
            if (!seenInat.has(emp + "|" + cod)) {
              seenInat.add(emp + "|" + cod);
              contaDatas(d, i, emp, true);
              inativos.push({ emp: emp, cod: cod, desc: String(d.desc[i] == null ? "" : d.desc[i]).trim(),
                tipo: d.tipo ? String(d.tipo[i]).trim() : "", grupo: d.grupo ? cleanCode(d.grupo[i]) : "",
                um: d.um ? String(d.um[i]).trim() : "", ucom: d.ucom ? parseDate(d.ucom[i]) : "",
                motivo: bloq ? "Bloqueado" : vazio ? "Ativo vazio" : "Ativo = N", ncm: d.ncm ? cleanNcm(d.ncm[i]) : "" });
            }
            continue;
          }
          var key = emp + "|" + cod;
          if (seen.has(key)) { excl.repetidos++; continue; }
          seen.add(key);
          contaDatas(d, i, emp, false);
          var desc = String(d.desc[i] == null ? "" : d.desc[i]).trim();
          prods.push({ emp: emp, cod: cod, desc: desc, tipo: d.tipo ? String(d.tipo[i]).trim() : "",
            grupo: d.grupo ? cleanCode(d.grupo[i]) : "", um: d.um ? String(d.um[i]).trim() : "",
            ucom: d.ucom ? parseDate(d.ucom[i]) : "", ncm: d.ncm ? cleanNcm(d.ncm[i]) : "" });
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
    var pairsOut = [], pairsI = [], inPair = new Map();
    function pidx(i) { var x = inPair.get(i); if (x == null) { x = inPair.size; inPair.set(i, x); } return x; }
    // índice >= 0: produto ativo (prods); < 0: bloqueado (inativos[-i - 1])
    function par(x, y, sc) {
      if (x >= 0 && y >= 0) pairsOut.push(pidx(x), pidx(y), sc);
      else if (x >= 0) pairsI.push(-y - 1, pidx(x), sc);
      else if (y >= 0) pairsI.push(-x - 1, pidx(y), sc);
    }
    inativos.forEach(function (p) { p.norm = SimCore.normalize(p.desc); });
    for (var e = 0; e < empresas.length; e++) {
      var emp = empresas[e];
      var groups = new Map();
      prods.forEach(function (p, i) {
        if (p.emp !== emp || !p.norm) return;
        var g = groups.get(p.norm);
        if (!g) { g = []; groups.set(p.norm, g); }
        g.push(i);
      });
      inativos.forEach(function (p, j) {
        if (p.emp !== emp || !p.norm) return;
        var g = groups.get(p.norm);
        if (!g) { g = []; groups.set(p.norm, g); }
        g.push(-j - 1);
      });
      var uniq = Array.from(groups.keys()), members = uniq.map(function (u) { return groups.get(u); });
      onStep("Comparando descrições · empresa " + emp + " (" + uniq.length.toLocaleString("pt-BR") + " descrições)", 0);
      members.forEach(function (g) {
        for (var a = 0; a < g.length; a++) for (var b = a + 1; b < g.length; b++) par(g[a], g[b], 100);
      });
      var res = await runJoin(uniq, T_MIN, function (f) { onStep(null, f); });
      var refs = uniq.map(SimCore.refTokens);
      for (var k = 0; k < res.n; k++) {
        var ua = res.a[k], ub = res.b[k];
        var sc = Math.floor(res.s[k] * SimCore.refFactor(refs[ua], refs[ub]) + 1e-9);
        if (sc < T_MIN) continue;
        var ga = members[ua], gb = members[ub];
        for (var x = 0; x < ga.length; x++) for (var y = 0; y < gb.length; y++) par(ga[x], gb[y], sc);
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
      P[pi] = [p.emp, p.cod, p.desc, p.tipo, p.grupo, p.um, p.ucom, pres, st, p.ncm || ""];
    });
    function rowOf(p) {
      var pres = [], st = [], m = stockOf(p);
      if (m) m.forEach(function (v, f) {
        var fi = filIdx[f];
        if (fi == null) return;
        pres.push(fi);
        if (v[0] || v[1] || v[2]) st.push([fi, round3(v[0]), round3(v[1]), round3(v[2])]);
      });
      return [p.emp, p.cod, p.desc, p.tipo, p.grupo, p.um, p.ucom, pres, st, p.motivo, p.ncm || ""];
    }
    var INAT = inativos.map(rowOf);
    return {
      v: 2, T: T_MIN, at: new Date().toISOString(), descSource: descSource,
      files: tables.map(function (t) { return { name: t.name, kind: t.kind, rows: t.rows }; }),
      empresas: empresas, filiais: filiais,
      totals: { prodPorEmp: prodPorEmp, prodPorFilial: prodPorFilial, excl: excl,
        hasBlq: sb1.some(function (t) { return t.hasBlq; }), hasAtivo: sb1.some(function (t) { return t.hasAtivo; }),
        hasNcm: sb1.some(function (t) { return t.hasNcm; }) },
      P: P, pairs: pairsOut, I: INAT, pairsI: pairsI,
      datas: sb1.some(function (t) { return t.hasDatas; }) ? datas : null
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
    // Lista "Bloquear" sem considerar marcações: para cada produto livre, qual similar fica.
    // Mesma regra da tela: similar em uso fica; se os dois estão livres, fica o de compra mais recente
    // (senão o código mais antigo). filaKeep[i] = quem fica quando i deve ser bloqueado; -1 = não entra.
    var deg = new Int32Array(n + 1);
    for (k = 0; k < pr.length; k += 3) { deg[pr[k]]++; deg[pr[k + 1]]++; }
    var off = new Int32Array(n + 1);
    for (i = 0; i < n; i++) off[i + 1] = off[i] + deg[i];
    var nbA = new Int32Array(off[n]), nbS = new Uint8Array(off[n]), pos = off.slice(0, n);
    for (k = 0; k < pr.length; k += 3) { var xa = pr[k], xb = pr[k + 1], xs = pr[k + 2]; nbA[pos[xa]] = xb; nbS[pos[xa]++] = xs; nbA[pos[xb]] = xa; nbS[pos[xb]++] = xs; }
    var filaKeep = new Int32Array(n).fill(-1), filaSc = new Uint8Array(n);
    S.g.fila = { n: 0 }; BANDS.forEach(function (bd) { S.g.fila[bd.k] = 0; });
    D.empresas.forEach(function (e) { var f = { n: 0 }; BANDS.forEach(function (bd) { f[bd.k] = 0; }); S.emp[e].fila = f; });
    for (i = 0; i < n; i++) {
      if (prot[i]) continue;
      var kp = -1, kps = -1, ko = -1, kos = -1;
      for (var q = off[i]; q < off[i + 1]; q++) {
        var sc = nbS[q], o = nbA[q];
        if (!bandOf(sc)) continue;
        if (prot[o] && sc > kps) { kp = o; kps = sc; }
        if (sc > kos || (sc === kos && prot[o] && !prot[ko])) { ko = o; kos = sc; }
      }
      var keep = -1, ksc = 0;
      if (kp >= 0) { keep = kp; ksc = kps; }
      else if (ko >= 0) {
        var ua = D.P[i][6] || "", ub = D.P[ko][6] || "";
        var fica = ua !== ub ? (ua > ub ? i : ko) : (D.P[i][1] <= D.P[ko][1] ? i : ko);
        if (fica !== i) { keep = ko; ksc = kos; }
      }
      if (keep < 0) continue;
      filaKeep[i] = keep; filaSc[i] = ksc;
      var fb = bandOf(ksc) || BANDS[BANDS.length - 1].k, fe = S.emp[D.P[i][0]];
      S.g.fila.n++; S.g.fila[fb]++;
      if (fe) { fe.fila.n++; fe.fila[fb]++; }
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
      info: { best: best, bestP: bestP, cnt: cnt, saldo: saldo, prev: prev, pp: pp, prot: prot, cat: cat, band: band, filaKeep: filaKeep, filaSc: filaSc },
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

  return { readTable: readTable, build: build, summarize: summarize, snapshotDoc: snapshotDoc, ncmTabela: ncmTabela,
    normGrupo: normGrupo, grupoTabela: grupoTabela, empresaDoNome: empresaDoNome, gruposDaSB1: gruposDaSB1,
    gruposDaMedicao: gruposDaMedicao, decidirGrupos: decidirGrupos,
    BANDS: BANDS, bandOf: bandOf, SPECS: SPECS, T_MIN: T_MIN };
})();
if (typeof module !== "undefined") module.exports = DupAnalysis;
