(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var NF = new Intl.NumberFormat("pt-BR");
  var QF = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
  var PF = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  function n(x) { return NF.format(Math.round(x || 0)); }
  function pct(a, b) { return b ? PF.format(100 * a / b) + "%" : "–"; }
  function dt(iso, withTime) {
    var d = new Date(iso);
    var s = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    return withTime ? s + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : s;
  }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "text") e.textContent = v;
      else if (k === "cls") e.className = v;
      else if (k === "style") e.setAttribute("style", v);
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function sw(color) { return h("span", { cls: "sw", style: "background:" + color }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem("dup:" + k); localStorage.setItem("dup:" + k, v); } catch (e) { return null; } }

  var BANDS = [
    { k: "b95", label: "95–100%", name: "provável duplicidade", color: "var(--b95)" },
    { k: "b80", label: "80–94%", name: "alta semelhança", color: "var(--b80)" }
  ];
  var BAND = {}; BANDS.forEach(function (b) { BAND[b.k] = b; });
  var SITS = [
    { k: "S", label: "Com saldo", color: "var(--cS)" },
    { k: "P", label: "Previsão de chegada", color: "var(--cP)" },
    { k: "R", label: "Ponto de pedido", color: "var(--cR)" },
    { k: "L1", label: "Livre · similar em uso", color: "var(--cL1)" },
    { k: "L2", label: "Livre · similar também livre", color: "var(--cL2)" }
  ];
  var SIT = {}; SITS.forEach(function (x) { SIT[x.k] = x; });
  function bandOf(sc) { return sc >= 95 ? "b95" : sc >= 80 ? "b80" : null; }
  function allBands() { var o = {}; BANDS.forEach(function (b) { o[b.k] = true; }); return o; }
  function onlyOf(k) { var o = {}; BANDS.forEach(function (b) { o[b.k] = b.k === k; }); return o; }

  var ST = {
    snaps: [], viewId: null, cur: null, saved: null, preview: null, loadingId: null,
    scope: store("scope") || "all", tab: store("tab") || "saldo",
    bands: { b95: true, b80: true }, q: "", sit: "", tipo: "", page: 0, expanded: null
  };
  var PAGE = 50;

  // ---------- tooltip ----------
  var tip = $("tip");
  function showTip(title, rows, ev) {
    tip.textContent = "";
    if (title) tip.appendChild(h("div", null, [h("b", { text: title })]));
    rows.forEach(function (r) {
      tip.appendChild(h("div", { cls: "row" }, [h("span", null, [r.color ? sw(r.color) : null, r.label]), h("span", { cls: "num", text: r.value })]));
    });
    tip.hidden = false;
    moveTip(ev);
  }
  function moveTip(ev) {
    var w = tip.offsetWidth, hh = tip.offsetHeight, x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + hh > window.innerHeight - 8) y = ev.clientY - hh - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() { tip.hidden = true; }

  // ---------- boot ----------
  function showLoading(msg) {
    var m = $("main");
    m.textContent = "";
    m.appendChild(h("div", { cls: "loading" }, [h("div", { cls: "eyebrow", text: "Duplicidade de Cadastro" }), h("div", { text: msg })]));
  }
  function temDetalhe(m) { return m && (m.origem === "local" || !!m.arquivo); }
  async function boot() {
    $("btnUpload").hidden = false;
    await recarregar();
  }
  async function recarregar() {
    try { ST.snaps = await Armazem.listar(); } catch (e) { ST.snaps = []; }
    onSnaps();
  }
  function onSnaps() {
    if (!ST.snaps.length) {
      if (!ST.preview) {
        mounted = false;
        showLoading("Nenhuma medição ainda. Clique em “Atualizar base” e carregue a SB1, a SBZ e o Saldo Físico exportados do Protheus.");
        $("meta").textContent = "Sem medições.";
      }
      return;
    }
    var withDetail = ST.snaps.filter(temDetalhe);
    if (!ST.viewId || !ST.snaps.some(function (x) { return x.id === ST.viewId && temDetalhe(x); })) {
      ST.viewId = withDetail.length ? withDetail[withDetail.length - 1].id : null;
    }
    if (ST.preview) { renderAll(); return; }
    if (ST.cur && ST.cur.id === ST.viewId) { ST.cur.doc = findSnap(ST.viewId); renderAll(); return; }
    if (ST.viewId) loadSnapshot(ST.viewId);
    else { mounted = false; showLoading("O histórico tem só resumos (os arquivos de dados/medicoes foram apagados). Atualize a base para gerar uma medição nova."); }
  }
  function findSnap(id) { for (var i = 0; i < ST.snaps.length; i++) if (ST.snaps[i].id === id) return ST.snaps[i]; return null; }
  async function loadSnapshot(id) {
    var doc = findSnap(id);
    if (!doc || !temDetalhe(doc)) return;
    if (ST.loadingId === id) return;
    ST.loadingId = id;
    if (!ST.cur) showLoading("Carregando a medição de " + dt(doc.at, true) + "…");
    try {
      var D = await Armazem.detalhe(doc);
      ST.loadingId = null;
      setCurrent({ id: id, doc: doc, D: D });
    } catch (e) {
      ST.loadingId = null;
      showLoading("Não consegui abrir os detalhes desta medição (" + e.message + ").");
    }
  }
  function setCurrent(obj, isPreview) {
    obj.R = DupAnalysis.summarize(obj.D);
    buildAdj(obj);
    obj.D.I = obj.D.I || [];
    obj.tipos = Array.from(new Set(obj.D.P.concat(obj.D.I).map(function (p) { return p[3]; }).filter(Boolean))).sort();
    obj.inSearch = obj.D.I.map(function (p) { return (p[1] + " " + p[2]).toUpperCase(); });
    obj.search = obj.D.P.map(function (p) { return (p[1] + " " + p[2]).toUpperCase(); });
    obj.filIndex = {}; obj.D.filiais.forEach(function (f, i) { obj.filIndex[f] = i; });
    if (isPreview) { ST.preview = obj; } else { ST.saved = obj; }
    ST.cur = obj;
    ST.page = 0; ST.expanded = null;
    if (!validScope(ST.scope)) ST.scope = "e:" + obj.D.empresas[0];
    mountMain();
    renderAll();
  }
  function buildAdj(obj) {
    var P = obj.D.P, pr = obj.D.pairs, N = P.length, deg = new Int32Array(N + 1);
    for (var k = 0; k < pr.length; k += 3) { deg[pr[k]]++; deg[pr[k + 1]]++; }
    var off = new Int32Array(N + 1);
    for (var i = 0; i < N; i++) off[i + 1] = off[i] + deg[i];
    var nb = new Int32Array(off[N]), sc = new Uint8Array(off[N]), pos = off.slice(0, N);
    for (k = 0; k < pr.length; k += 3) {
      var a = pr[k], b = pr[k + 1], v = pr[k + 2];
      nb[pos[a]] = b; sc[pos[a]++] = v; nb[pos[b]] = a; sc[pos[b]++] = v;
    }
    obj.adj = { off: off, nb: nb, sc: sc };
  }
  function nSim(i) { var c = ST.cur.R.info.cnt, t = 0; for (var x = 0; x < c.length; x++) t += c[x][i]; return t; }
  function neighbors(i) {
    var A = ST.cur.adj, out = [];
    for (var k = A.off[i]; k < A.off[i + 1]; k++) if (bandOf(A.sc[k])) out.push([A.nb[k], A.sc[k]]);
    out.sort(function (x, y) { return y[1] - x[1] || (ST.cur.R.info.prot[y[0]] - ST.cur.R.info.prot[x[0]]); });
    return out;
  }

  var mounted = false;
  function mountMain() {
    if (mounted) return;
    var m = $("main");
    m.textContent = "";
    m.appendChild($("tplMain").content.cloneNode(true));
    mounted = true;
    $("q").addEventListener("input", debounce(function () { ST.q = $("q").value.trim().toUpperCase(); ST.page = 0; ST.expanded = null; renderTabs(); renderTable(); }, 200));
    $("fSit").addEventListener("change", function () { ST.sit = $("fSit").value; ST.page = 0; refreshFilters(false); });
    $("fTipo").addEventListener("change", function () { ST.tipo = $("fTipo").value; ST.page = 0; renderTabs(); renderTable(); });
    $("btnCsv").addEventListener("click", exportXlsx);
    $("btnCsv").hidden = false;
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(debounce(function () { renderCharts(); }, 120));
      ro.observe($("kpis"));
    }
  }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  // ---------- scope ----------
  // A visão é sempre por empresa: cada empresa tem o próprio cadastro (SB1).
  function validScope(sc) {
    if (!ST.cur || !sc) return false;
    return sc.slice(0, 2) === "e:" && ST.cur.D.empresas.indexOf(sc.slice(2)) >= 0;
  }
  function aggFor(doc, sc) {
    if (!doc) return null;
    if (sc === "all") return doc.g || null;
    if (sc.slice(0, 2) === "e:") return (doc.emp || {})[sc.slice(2)] || null;
    return (doc.fil || {})[sc.slice(2)] || null;
  }
  function scopeName(sc) {
    if (sc === "all") return "todas as filiais";
    if (sc.slice(0, 2) === "e:") return "empresa " + sc.slice(2);
    return "filial " + sc.slice(2);
  }
  function setScope(sc) {
    ST.scope = sc; store("scope", sc); ST.page = 0; ST.expanded = null;
    renderAll();
  }
  function renderScope() {
    var nav = $("scope");
    nav.textContent = "";
    if (!ST.cur) return;
    nav.appendChild(h("span", { cls: "lbl", text: "Ver:" }));
    function seg(sc, label, mono) {
      nav.appendChild(h("button", { cls: "seg", type: "button", "aria-pressed": String(ST.scope === sc), onclick: function () { setScope(sc); } },
        [mono ? h("span", { cls: "mono", text: label }) : label]));
    }
    ST.cur.D.empresas.forEach(function (e) { seg("e:" + e, "Empresa " + e); });
  }

  // ---------- render all ----------
  function renderAll() {
    if (!ST.cur) return;
    renderMeta();
    renderScope();
    renderKpis();
    renderMatrix();
    renderCharts();
    renderTabs();
    renderTable();
    renderHist();
  }
  function renderMeta() {
    var D = ST.cur.D, txt = (ST.preview ? "Prévia de " : "Medição de ") + dt(D.at, true);
    var kinds = {};
    D.files.forEach(function (f) { if (f.kind) kinds[f.kind] = (kinds[f.kind] || 0) + 1; });
    txt += " · " + Object.keys(kinds).sort().map(function (k) { return kinds[k] > 1 ? k + " (" + kinds[k] + " arquivos)" : k; }).join(", ");
    if (D.descSource === "SB2") txt += " · descrição do Saldo Físico (sem SB1)";
    if (!ST.preview && ST.cur.doc && ST.cur.doc.origem === "local") txt += " · salva só neste navegador (falta enviar ao GitHub)";
    $("meta").textContent = txt;
    $("previewBanner").hidden = !ST.preview;
  }
  function prevDocFor() {
    var T = ST.cur.D.T || 80;
    var same = ST.snaps.filter(function (d) { return (d.T || 70) === T; });
    if (ST.preview) return same.length ? same[same.length - 1] : null;
    var idx = -1;
    for (var i = 0; i < same.length; i++) if (same[i].id === ST.cur.id) idx = i;
    return idx > 0 ? same[idx - 1] : null;
  }

  // ---------- KPIs ----------
  function delta(cur, prev, prevDoc, lowerIsGood) {
    if (prev == null || !prevDoc) return null;
    var d = cur - prev, cls = d === 0 ? "d-flat" : ((d < 0) === lowerIsGood ? "d-good" : "d-bad");
    var sign = d > 0 ? "▲ " : d < 0 ? "▼ " : "= ";
    return h("div", { cls: "k-delta " + cls, text: sign + (d ? n(Math.abs(d)) + " " : "") + "vs " + dt(prevDoc.at) });
  }
  function renderKpis() {
    var box = $("kpis"); box.textContent = "";
    var A = aggFor(ST.cur.R.summary, ST.scope); if (!A) return;
    var pd = prevDocFor(), PA = aggFor(pd, ST.scope);
    var only = onlyBand();
    var act = null;
    function tile(cls, label, val, sub, dl, extra) {
      var a = act; act = null;
      var el = h("div", { cls: "kpi click " + (cls || ""), role: "button", tabindex: "0", "aria-pressed": a ? String(!!a.pressed) : null, title: a ? a.title : null,
        onclick: a ? a.fn : null,
        onkeydown: a ? function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); a.fn(); } } : null },
        [h("div", { cls: "k-label" }, label), h("div", { cls: "k-val", text: val }), sub ? h("div", { cls: "k-sub", text: sub }) : null, extra || null, dl]);
      box.appendChild(el);
    }
    act = { fn: function () { goTab("prod", ""); }, pressed: ST.tab === "prod" && !only && !ST.sit, title: "Listar todos os produtos com similar" };
    tile("hero", ["Produtos com similar ≥ " + (ST.cur.D.T || 80) + "%"], n(A.comSim), "de " + n(A.prod) + " produtos ativos · " + pct(A.comSim, A.prod), delta(A.comSim, PA && PA.comSim, pd, true));
    BANDS.forEach(function (b) {
      act = { fn: function () { goBand(b.k); }, pressed: only === b.k, title: only === b.k ? "Mostrar todas as faixas" : "Listar só " + b.label };
      tile("", [sw(b.color), b.label + " · " + b.name], n(A[b.k]), n(A.pairs[b.k]) + " pares de produtos", delta(A[b.k], PA && PA[b.k], pd, true));
    });
    var prot = A.S + A.P + A.R;
    act = { fn: function () { goTab("prod", "prot"); }, pressed: ST.tab === "prod" && ST.sit === "prot", title: "Listar os produtos que não podem ser bloqueados" };
    tile("", ["Não bloquear"], n(prot), null, delta(prot, PA && (PA.S + PA.P + PA.R), pd, false),
      h("div", { cls: "flags" }, [
        h("span", null, [sw("var(--cS)"), "saldo " + n(A.fS)]),
        h("span", null, [sw("var(--cP)"), "previsão " + n(A.fP)]),
        h("span", null, [sw("var(--cR)"), "ponto de pedido " + n(A.fR)])]));
    act = { fn: function () { goTab("cand", ""); }, pressed: ST.tab === "cand", title: "Listar os candidatos a bloqueio" };
    tile("", ["Candidatos a bloqueio"], n(A.L1 + A.L2), n(A.L1) + " com similar em uso · " + n(A.L2) + " com similar livre", delta(A.L1 + A.L2, PA && (PA.L1 + PA.L2), pd, true));
    var inat = A.inat || 0;
    act = { fn: function () { goTab("inat", ""); }, pressed: ST.tab === "inat", title: "Listar os inativos (bloqueados)" };
    tile("", ["Inativos (bloqueados)"], n(inat), A.inatMov ? n(A.inatMov) + " ainda com saldo, previsão ou ponto de pedido — conferir" : "fora da análise de duplicidade",
      delta(inat, PA && PA.inat, pd, false));
  }

  // ---------- matrix ----------
  function renderMatrix() {
    var box = $("matrix"); box.textContent = "";
    var A = aggFor(ST.cur.R.summary, ST.scope); if (!A) return;
    var thead = h("tr", null, [h("th", { text: "Faixa" })].concat(SITS.map(function (x) { return h("th", null, [sw(x.color), x.label]); })).concat([h("th", { text: "Total" })]));
    var rows = BANDS.map(function (b) {
      return h("tr", { style: ST.bands[b.k] ? null : "opacity:.4" }, [h("td", { cls: "rowh" }, [sw(b.color), " " + b.label])].concat(SITS.map(function (x) {
        var v = A.m[b.k][x.k];
        return h("td", null, [h("button", { cls: "cell" + (v ? "" : " zero"), type: "button", "aria-label": b.label + ", " + x.label + ": " + v, text: n(v),
          onclick: function () { goList(b.k, x.k); } })]);
      })).concat([h("td", { cls: "tot", text: n(A[b.k]) })]));
    });
    var tot = h("tr", { cls: "sum" }, [h("td", { cls: "rowh", text: "Total" })].concat(SITS.map(function (x) { return h("td", { cls: "tot", text: n(A[x.k]) }); })).concat([h("td", { cls: "tot", text: n(A.comSim) })]));
    box.appendChild(h("table", { cls: "mx" }, [h("thead", null, [thead]), h("tbody", null, rows.concat([tot]))]));
  }
  function goList(bk, sk) {
    ST.tab = "prod"; store("tab", "prod");
    ST.bands = onlyOf(bk);
    ST.sit = sk; ST.page = 0; ST.expanded = null;
    refreshFilters(true);
  }
  function onlyBand() {
    var on = BANDS.filter(function (b) { return ST.bands[b.k]; });
    return on.length === 1 ? on[0].k : null;
  }
  // Clique num indicador de faixa: lista só aquela faixa (clicar de novo volta para todas)
  function goBand(bk) {
    if (onlyBand() === bk) ST.bands = allBands();
    else ST.bands = onlyOf(bk);
    // a lista mostra o mesmo total do indicador: todos os produtos daquela faixa
    if (ST.tab === "inat" || ST.tab === "saldo") { ST.tab = "prod"; ST.sit = ""; store("tab", "prod"); }
    ST.page = 0; ST.expanded = null;
    refreshFilters(true);
  }
  function goTab(tab, sit) {
    ST.tab = tab; store("tab", tab); ST.sit = sit || "";
    ST.bands = allBands();
    ST.page = 0; ST.expanded = null;
    refreshFilters(true);
  }
  function refreshFilters(scroll) {
    renderKpis(); renderMatrix(); renderTabs(); renderTable();
    if (scroll) $("pTables").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- charts ----------
  // axis: a clean step (1, 2, 2.5, 5 × 10^k) and a max that is a whole number of steps
  function niceAxis(v) {
    if (v <= 0) return { max: 4, step: 1, n: 4 };
    var raw = v / 5, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
    if (step < 1) step = 1;
    var k = Math.max(1, Math.ceil(v / step));
    return { max: k * step, step: step, n: k };
  }
  function legend(boxId, items) {
    var b = $(boxId); b.textContent = "";
    items.forEach(function (it) { b.appendChild(h("span", null, [it.line ? h("span", { cls: "sw", style: "height:3px;width:14px;border-radius:2px;background:" + it.color }) : sw(it.color), it.label])); });
  }
  function renderCharts() {
    if (!ST.cur || !mounted) return;
    legend("filBandLegend", BANDS.map(function (b) { return { color: b.color, label: b.label }; }));
    legend("filSitLegend", SITS.map(function (x) { return { color: x.color, label: x.label }; }));
    var S = ST.cur.R.summary, D = ST.cur.D;
    function rowsFor(segDefs) {
      return D.empresas.map(function (e) {
        var A = S.emp[e];
        var dim = ST.scope !== "e:" + e;
        return { key: e, label: "Empresa " + e, A: A, dim: dim, total: A.comSim, base: A.prod,
          segs: segDefs.map(function (sd) { return { label: sd.label, color: sd.color, value: A[sd.k] }; }) };
      });
    }
    stackedBars($("filBandChart"), rowsFor(BANDS.map(function (b) { return { k: b.k, label: b.label, color: b.color }; })));
    stackedBars($("filSitChart"), rowsFor(SITS));
    renderEvo();
  }
  function stackedBars(box, rows) {
    box.textContent = "";
    var W = Math.max(280, box.clientWidth || 600), LW = 92, RW = 112, RH = 40, BT = 20, top = 4;
    var H = top + rows.length * RH + 22;
    var ax = niceAxis(Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]))), max = ax.max;
    var plotW = W - LW - RW;
    var x = function (v) { return LW + plotW * v / max; };
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img" });
    var tickEvery = plotW / ax.n < 46 ? 2 : 1;
    for (var t = 0; t <= ax.n; t++) {
      var tv = ax.step * t, tx = x(tv);
      svg.appendChild(s("line", { x1: tx, x2: tx, y1: top, y2: top + rows.length * RH, class: t ? "grid" : "base" }));
      if (t % tickEvery === 0) svg.appendChild(s("text", { x: tx, y: H - 4, "text-anchor": "middle", class: "tick" }, NF.format(tv)));
    }
    rows.forEach(function (r, i) {
      var y = top + i * RH + (RH - BT) / 2;
      var g = s("g", { style: "cursor:pointer;opacity:" + (r.dim ? 0.35 : 1) });
      g.appendChild(s("rect", { x: 0, y: top + i * RH, width: W, height: RH, fill: "transparent" }));
      g.appendChild(s("text", { x: 0, y: y + BT / 2 + 4, style: "font-size:12.5px;font-weight:600;fill:var(--ink)" }, r.label));
      var acc = 0, segs = r.segs.filter(function (sg) { return sg.value > 0; });
      segs.forEach(function (sg, j) {
        var x0 = x(acc), x1 = x(acc + sg.value);
        acc += sg.value;
        var a = x0 + (j > 0 ? 1 : 0), b = x1 - (j < segs.length - 1 ? 1 : 0), w = Math.max(0.5, b - a);
        if (j === segs.length - 1) {
          var rr = Math.min(4, w, BT / 2);
          g.appendChild(s("path", { d: "M" + a + "," + y + "H" + (a + w - rr) + "Q" + (a + w) + "," + y + " " + (a + w) + "," + (y + rr) + "V" + (y + BT - rr) + "Q" + (a + w) + "," + (y + BT) + " " + (a + w - rr) + "," + (y + BT) + "H" + a + "Z", fill: sg.color }));
        } else {
          g.appendChild(s("rect", { x: a, y: y, width: w, height: BT, fill: sg.color }));
        }
      });
      g.appendChild(s("text", { x: x(r.total) + 8, y: y + BT / 2 + 4, class: "num", style: "fill:var(--ink);font-weight:600" }, n(r.total)));
      var tw = n(r.total).length * 7.4 + 14;
      g.appendChild(s("text", { x: x(r.total) + 8 + tw, y: y + BT / 2 + 4, class: "tick" }, pct(r.total, r.base)));
      g.addEventListener("mousemove", function (ev) {
        showTip(r.label + " · " + n(r.base) + " produtos ativos", r.segs.map(function (sg) {
          return { color: sg.color, label: sg.label, value: n(sg.value) + " · " + pct(sg.value, r.total) };
        }).concat([{ label: "Com similar", value: n(r.total) + " · " + pct(r.total, r.base) }]), ev);
      });
      g.addEventListener("mouseleave", hideTip);
      g.addEventListener("click", function () { hideTip(); setScope("e:" + r.key); });
      svg.appendChild(g);
    });
    box.appendChild(svg);
  }

  function evoSeries() {
    var T = ST.cur.D.T || 80;
    var pts = ST.snaps.filter(function (d) { return (d.T || 70) === T; }).map(function (d) { return { at: d.at, A: aggFor(d, ST.scope), id: d.id, preview: false }; });
    if (ST.preview) pts.push({ at: ST.preview.D.at, A: aggFor(ST.preview.R.summary, ST.scope), id: null, preview: true });
    return pts;
  }
  function renderEvo() {
    var box = $("evoChart"); box.textContent = "";
    var SER = [{ k: "comSim", label: "Com similar (total)", color: "var(--total)" }].concat(BANDS.map(function (b) { return { k: b.k, label: b.label, color: b.color }; }));
    legend("evoLegend", SER.map(function (x) { return { color: x.color, label: x.label, line: true }; }));
    $("evoSub").textContent = "Produtos com similar, por faixa · " + scopeName(ST.scope);
    var pts = evoSeries();
    $("evoNote").textContent = pts.length < 2 ? "A evolução aparece a partir da 2ª medição. Atualize a base sempre que exportar o Protheus." : "";
    var W = Math.max(280, box.clientWidth || 600), H = 230, L = 52, R = 16, T = 12, B = 28;
    var max = 1;
    pts.forEach(function (p) { if (p.A) SER.forEach(function (sr) { max = Math.max(max, p.A[sr.k] || 0); }); });
    var ax = niceAxis(max); max = ax.max;
    var px = function (i) { return pts.length === 1 ? (L + (W - R)) / 2 : L + (W - L - R) * i / (pts.length - 1); };
    var py = function (v) { return T + (H - T - B) * (1 - v / max); };
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img" });
    for (var t = 0; t <= ax.n; t++) {
      var tv = ax.step * t;
      svg.appendChild(s("line", { x1: L, x2: W - R, y1: py(tv), y2: py(tv), class: t ? "grid" : "base" }));
      svg.appendChild(s("text", { x: L - 8, y: py(tv) + 4, "text-anchor": "end", class: "tick" }, NF.format(tv)));
    }
    var every = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor((W - L - R) / 90))));
    var sameDay = {};
    pts.forEach(function (p) { var k = dt(p.at); sameDay[k] = (sameDay[k] || 0) + 1; });
    pts.forEach(function (p, i) {
      if (i % every && i !== pts.length - 1) return;
      var lab = new Date(p.at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      if (sameDay[dt(p.at)] > 1) lab += " " + new Date(p.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      if (p.preview) lab += " (prévia)";
      svg.appendChild(s("text", { x: px(i), y: H - 8, "text-anchor": pts.length === 1 ? "middle" : i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle", class: "tick" }, lab));
    });
    SER.forEach(function (sr) {
      var d = "", started = false;
      pts.forEach(function (p, i) {
        if (!p.A) { started = false; return; }
        d += (started ? "L" : "M") + px(i) + "," + py(p.A[sr.k] || 0);
        started = true;
      });
      if (d) svg.appendChild(s("path", { d: d, fill: "none", stroke: sr.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      pts.forEach(function (p, i) {
        if (!p.A) return;
        svg.appendChild(s("circle", { cx: px(i), cy: py(p.A[sr.k] || 0), r: i === pts.length - 1 ? 4.5 : 3.5, fill: sr.color, stroke: "var(--surface)", "stroke-width": 2 }));
      });
    });
    var cross = s("line", { x1: 0, x2: 0, y1: T, y2: H - B, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" });
    svg.appendChild(cross);
    var hit = s("rect", { x: L - 10, y: 0, width: W - L - R + 20, height: H, fill: "transparent" });
    hit.addEventListener("mousemove", function (ev) {
      var rect = svg.getBoundingClientRect(), mx = (ev.clientX - rect.left) * W / rect.width, bi = 0, bd = 1e9;
      pts.forEach(function (p, i) { var dd = Math.abs(px(i) - mx); if (dd < bd) { bd = dd; bi = i; } });
      var p = pts[bi];
      cross.setAttribute("x1", px(bi)); cross.setAttribute("x2", px(bi)); cross.setAttribute("visibility", "visible");
      if (!p.A) { showTip(dt(p.at, true), [{ label: "Sem dados para " + scopeName(ST.scope), value: "" }], ev); return; }
      showTip((p.preview ? "Prévia · " : "") + dt(p.at, true), SER.map(function (sr) { return { color: sr.color, label: sr.label, value: n(p.A[sr.k]) }; }).concat([
        { label: "Não bloquear", value: n(p.A.S + p.A.P + p.A.R) },
        { label: "Candidatos a bloqueio", value: n(p.A.L1 + p.A.L2) },
        { label: "Inativos (bloqueados)", value: p.A.inat == null ? "–" : n(p.A.inat) }]), ev);
    });
    hit.addEventListener("mouseleave", function () { cross.setAttribute("visibility", "hidden"); hideTip(); });
    svg.appendChild(hit);
    box.appendChild(svg);
  }

  // ---------- tables ----------
  var TABS = [
    { k: "saldo", label: "Com saldo e similar" },
    { k: "cand", label: "Candidatos a bloqueio" },
    { k: "prod", label: "Todos os produtos" },
    { k: "pares", label: "Pares" },
    { k: "inat", label: "Inativos (bloqueados)" }
  ];
  function inScopeFn() {
    var sc = ST.scope, P = ST.cur.D.P;
    if (sc === "all") return function () { return true; };
    if (sc.slice(0, 2) === "e:") { var e = sc.slice(2); return function (i) { return P[i][0] === e; }; }
    var fi = ST.cur.filIndex[sc.slice(2)];
    return function (i) { return P[i][7].indexOf(fi) >= 0; };
  }
  function productList(tab, sit) {
    var cur = ST.cur, P = cur.D.P, I = cur.R.info, inS = inScopeFn(), out = [];
    for (var i = 0; i < P.length; i++) {
      if (!inS(i) || !ST.bands[I.band[i]]) continue;
      if (tab === "saldo" && I.saldo[i] === 0) continue;
      if (tab === "cand" && I.prot[i]) continue;
      if (sit && tab !== "saldo") { if (sit === "prot") { if (!I.prot[i]) continue; } else if (I.cat[i] !== sit) continue; }
      if (ST.tipo && P[i][3] !== ST.tipo) continue;
      if (ST.q && cur.search[i].indexOf(ST.q) < 0) continue;
      out.push(i);
    }
    out.sort(function (a, b) {
      return (I.best[b] - I.best[a]) || (tab === "saldo" ? I.saldo[b] - I.saldo[a] : 0) || (P[a][1] < P[b][1] ? -1 : 1);
    });
    return out;
  }
  function pairList(sit) {
    var cur = ST.cur, P = cur.D.P, I = cur.R.info, pr = cur.D.pairs, inS = inScopeFn(), out = [];
    for (var k = 0; k < pr.length; k += 3) {
      var a = pr[k], b = pr[k + 1], sc = pr[k + 2];
      if (!ST.bands[bandOf(sc)]) continue;
      if (!inS(a) && !inS(b)) continue;
      if (ST.tipo && P[a][3] !== ST.tipo && P[b][3] !== ST.tipo) continue;
      if (ST.q && cur.search[a].indexOf(ST.q) < 0 && cur.search[b].indexOf(ST.q) < 0) continue;
      if (sit) {
        var np = I.prot[a] + I.prot[b];
        if ((sit === "both" && np !== 2) || (sit === "one" && np !== 1) || (sit === "none" && np !== 0)) continue;
      }
      out.push(k);
    }
    out.sort(function (x, y) { return pr[y + 2] - pr[x + 2] || (P[pr[x]][1] < P[pr[y]][1] ? -1 : 1); });
    return out;
  }
  function inactiveList(sit) {
    var cur = ST.cur, IN = cur.D.I, X = cur.R.inat, sc = ST.scope, out = [];
    var emp = sc.slice(0, 2) === "e:" ? sc.slice(2) : null, fi = sc.slice(0, 2) === "f:" ? cur.filIndex[sc.slice(2)] : null;
    for (var i = 0; i < IN.length; i++) {
      if (emp && IN[i][0] !== emp) continue;
      if (fi != null && (IN[i][7] || []).indexOf(fi) < 0) continue;
      var mov = X.saldo[i] !== 0 || X.prev[i] > 0 || X.pp[i] > 0;
      if ((sit === "mov" && !mov) || (sit === "sem" && mov)) continue;
      if (ST.tipo && IN[i][3] !== ST.tipo) continue;
      if (ST.q && cur.inSearch[i].indexOf(ST.q) < 0) continue;
      out.push(i);
    }
    function m(i) { return X.saldo[i] !== 0 || X.prev[i] > 0 || X.pp[i] > 0 ? 1 : 0; }
    out.sort(function (a, b) { return m(b) - m(a) || (IN[a][1] < IN[b][1] ? -1 : 1); });
    return out;
  }
  function listFor(tab, sit) { return tab === "pares" ? pairList(sit) : tab === "inat" ? inactiveList(sit) : productList(tab, sit); }
  function currentList() { return listFor(ST.tab, ST.sit); }
  function countFor(tab) { return listFor(tab, tab === ST.tab ? ST.sit : "").length; }

  function renderTabs() {
    var box = $("tabs"); box.textContent = "";
    TABS.forEach(function (t) {
      box.appendChild(h("button", { cls: "tab", role: "tab", type: "button", "aria-selected": String(ST.tab === t.k),
        onclick: function () { if (ST.tab !== t.k) ST.sit = ""; ST.tab = t.k; store("tab", t.k); ST.page = 0; ST.expanded = null; refreshFilters(false); } },
        [t.label, h("span", { cls: "cnt", text: n(countFor(t.k)) })]));
    });
    // band toggles
    var bt = $("bandToggles"); bt.textContent = ""; bt.hidden = ST.tab === "inat";
    BANDS.forEach(function (b) {
      bt.appendChild(h("button", { cls: "chip-toggle", type: "button", "aria-pressed": String(!!ST.bands[b.k]),
        onclick: function () { ST.bands[b.k] = !ST.bands[b.k]; ST.page = 0; refreshFilters(false); } }, [sw(b.color), b.label]));
    });
    // situação select
    var fs = $("fSit"); fs.textContent = "";
    var opts;
    if (ST.tab === "pares") opts = [["", "Todos os pares"], ["one", "Um com movimento, outro livre"], ["none", "Nenhum com movimento"], ["both", "Ambos com movimento"]];
    else if (ST.tab === "cand") opts = [["", "Todos os candidatos"], ["L1", SIT.L1.label], ["L2", SIT.L2.label]];
    else if (ST.tab === "prod") opts = [["", "Todas as situações"], ["prot", "Não bloquear (saldo, previsão ou PP)"]].concat(SITS.map(function (x) { return [x.k, x.label]; }));
    else if (ST.tab === "inat") opts = [["", "Todos os inativos"], ["mov", "Ainda com saldo, previsão ou PP"], ["sem", "Sem movimento"]];
    else opts = null;
    fs.hidden = !opts;
    if (opts) {
      if (!opts.some(function (o) { return o[0] === ST.sit; })) ST.sit = "";
      opts.forEach(function (o) { fs.appendChild(h("option", { value: o[0], text: o[1] })); });
      fs.value = ST.sit;
    }
    var ft = $("fTipo"); ft.textContent = "";
    ft.appendChild(h("option", { value: "", text: "Todos os tipos" }));
    ST.cur.tipos.forEach(function (t) { ft.appendChild(h("option", { value: t, text: "Tipo " + t })); });
    if (ST.cur.tipos.indexOf(ST.tipo) < 0) ST.tipo = "";
    ft.value = ST.tipo;
    var fx = BANDS.filter(function (b) { return ST.bands[b.k]; }).map(function (b) { return b.label; });
    $("tblSub").textContent = "Escopo: " + scopeName(ST.scope) + (ST.tab !== "inat" && fx.length < 3 ? " · Faixa: " + (fx.length ? fx.join(", ") : "nenhuma") : "") + ". Clique num produto para ver todos os similares.";
  }
  function prodCell(i, compact) {
    var cur = ST.cur, p = cur.D.P[i];
    var kids = [h("span", { cls: "p-cod", text: p[1] }), h("span", { cls: "p-desc", text: p[2] })];
    if (!compact) {
      var meta = [p[3] ? "Tipo " + p[3] : "", p[5], p[4] ? "Grupo " + p[4] : "", "Emp. " + p[0]].filter(Boolean).join(" · ");
      kids.push(h("span", { cls: "p-meta", text: meta }));
    }
    return h("div", null, kids);
  }
  function statusTags(i, withFil) {
    var I = ST.cur.R.info, D = ST.cur.D, tags = [];
    if (I.saldo[i] !== 0) tags.push(h("span", { cls: "tag" }, [sw("var(--cS)"), "Saldo " + QF.format(I.saldo[i])]));
    if (I.prev[i] > 0) tags.push(h("span", { cls: "tag" }, [sw("var(--cP)"), "Prev. chegada " + QF.format(I.prev[i])]));
    if (I.pp[i] > 0) tags.push(h("span", { cls: "tag" }, [sw("var(--cR)"), "Ponto pedido " + QF.format(I.pp[i])]));
    if (!tags.length) tags.push(h("span", { cls: "tag free", text: "Sem saldo, previsão ou PP" }));
    var box = h("div", { cls: "tags" }, tags);
    if (!withFil) return box;
    var st = D.P[i][8].filter(function (x) { return x[1] !== 0 || x[2] > 0; });
    if (!st.length) return box;
    var fil = st.map(function (x) { return D.filiais[x[0]] + ": " + (x[1] ? "saldo " + QF.format(x[1]) : "") + (x[1] && x[2] ? ", " : "") + (x[2] ? "prev. " + QF.format(x[2]) : ""); }).join(" · ");
    return h("div", null, [box, h("span", { cls: "p-meta", text: fil })]);
  }
  function scorePill(sc) { return h("span", { cls: "pill" }, [sw(BAND[bandOf(sc)].color), sc + "%"]); }
  function keepChoice(a, b) {
    var P = ST.cur.D.P, ua = P[a][6] || "", ub = P[b][6] || "";
    if (ua !== ub) return ua > ub ? a : b;
    return P[a][1] <= P[b][1] ? a : b;
  }
  function productAction(i) {
    var I = ST.cur.R.info, P = ST.cur.D.P;
    if (I.prot[i]) {
      var why = I.saldo[i] !== 0 ? "tem saldo" : I.prev[i] > 0 ? "tem previsão de chegada" : "tem ponto de pedido";
      return h("div", { cls: "act keep" }, [h("strong", { text: "Não bloquear" }), h("span", { cls: "p-meta", text: why })]);
    }
    var nbs = neighbors(i), keep = null;
    for (var k = 0; k < nbs.length; k++) if (I.prot[nbs[k][0]]) { keep = nbs[k][0]; break; }
    if (keep != null) return h("div", { cls: "act block" }, [h("strong", { text: "Bloquear" }), h("span", { cls: "p-meta", text: "manter " + P[keep][1] + " (em uso)" })]);
    return h("div", { cls: "act" }, [h("strong", { text: "Escolher qual manter" }), h("span", { cls: "p-meta", text: "similares também sem movimento" })]);
  }
  function pairSuggestion(a, b) {
    var I = ST.cur.R.info, P = ST.cur.D.P;
    if (I.prot[a] && I.prot[b]) return { cls: "act keep", main: "Ambos em uso", sub: "unificar exige transferir saldo/pedidos" };
    if (I.prot[a] || I.prot[b]) { var bl = I.prot[a] ? b : a, kp = I.prot[a] ? a : b; return { cls: "act block", main: "Bloquear " + P[bl][1], sub: "manter " + P[kp][1] + " (em uso)" }; }
    var keep = keepChoice(a, b), blk = keep === a ? b : a;
    return { cls: "act", main: "Bloquear " + P[blk][1], sub: "manter " + P[keep][1] + (P[keep][6] ? " (compra mais recente)" : " (código mais antigo)") };
  }

  function renderTable() {
    var tbl = $("tbl"); tbl.textContent = "";
    var list = currentList(), I = ST.cur.R.info, P = ST.cur.D.P, pr = ST.cur.D.pairs;
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (ST.page >= pages) ST.page = pages - 1;
    var slice = list.slice(ST.page * PAGE, ST.page * PAGE + PAGE);
    var head, body = h("tbody");
    if (ST.tab === "inat") {
      var IN = ST.cur.D.I, X = ST.cur.R.inat, DD = ST.cur.D;
      head = ["Produto", "Situação", "Motivo", "O que fazer"];
      slice.forEach(function (i) {
        var p = IN[i], tags = [];
        if (X.saldo[i] !== 0) tags.push(h("span", { cls: "tag" }, [sw("var(--cS)"), "Saldo " + QF.format(X.saldo[i])]));
        if (X.prev[i] > 0) tags.push(h("span", { cls: "tag" }, [sw("var(--cP)"), "Prev. chegada " + QF.format(X.prev[i])]));
        if (X.pp[i] > 0) tags.push(h("span", { cls: "tag" }, [sw("var(--cR)"), "Ponto pedido " + QF.format(X.pp[i])]));
        var mov = tags.length > 0;
        if (!mov) tags.push(h("span", { cls: "tag free", text: "Sem saldo, previsão ou PP" }));
        var fil = (p[8] || []).filter(function (x) { return x[1] !== 0 || x[2] > 0; }).map(function (x) {
          return DD.filiais[x[0]] + ": " + (x[1] ? "saldo " + QF.format(x[1]) : "") + (x[1] && x[2] ? ", " : "") + (x[2] ? "prev. " + QF.format(x[2]) : ""); }).join(" · ");
        var meta = [p[3] ? "Tipo " + p[3] : "", p[5], p[4] ? "Grupo " + p[4] : "", "Emp. " + p[0]].filter(Boolean).join(" · ");
        body.appendChild(h("tr", null, [
          h("td", null, [h("span", { cls: "p-cod", text: p[1] }), h("span", { cls: "p-desc", text: p[2] }), h("span", { cls: "p-meta", text: meta })]),
          h("td", null, [h("div", { cls: "tags" }, tags), h("span", { cls: "p-meta", text: fil })]),
          h("td", { text: p[9] || "Bloqueado" }),
          h("td", null, [mov ? h("div", { cls: "act warn" }, [h("strong", { text: "Conferir" }), h("span", { cls: "p-meta", text: "está inativo, mas ainda tem movimento" })])
            : h("div", { cls: "act keep" }, [h("strong", { text: "Ok" }), h("span", { cls: "p-meta", text: "bloqueado e sem movimento" })])])
        ]));
      });
    } else if (ST.tab === "pares") {
      head = ["Similaridade", "Produto A", "Produto B", "Sugestão"];
      slice.forEach(function (k) {
        var a = pr[k], b = pr[k + 1], sg = pairSuggestion(a, b);
        body.appendChild(h("tr", null, [
          h("td", null, [scorePill(pr[k + 2])]),
          h("td", null, [prodCell(a, true), statusTags(a)]),
          h("td", null, [prodCell(b, true), statusTags(b)]),
          h("td", null, [h("div", { cls: sg.cls }, [h("strong", { text: sg.main }), h("span", { cls: "p-meta", text: sg.sub })])])
        ]));
      });
    } else {
      head = ["Produto", "Situação", "Similar mais próximo", "Similares", "Ação sugerida"];
      slice.forEach(function (i) {
        var bp = I.bestP[i];
        var tr = h("tr", { cls: "prod-row", tabindex: "0", "aria-expanded": String(ST.expanded === i),
          onclick: function () { ST.expanded = ST.expanded === i ? null : i; renderTable(); },
          onkeydown: function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ST.expanded = ST.expanded === i ? null : i; renderTable(); } } }, [
          h("td", null, [prodCell(i)]),
          h("td", null, [statusTags(i, true)]),
          h("td", null, bp >= 0 ? [h("div", { style: "display:flex;gap:8px;align-items:flex-start" }, [scorePill(I.best[i]), h("div", { style: "min-width:0" }, [prodCell(bp, true), statusTags(bp)])])] : []),
          h("td", { cls: "r num", text: n(nSim(i)) }),
          h("td", null, [productAction(i)])
        ]);
        body.appendChild(tr);
        if (ST.expanded === i) {
          var nbs = neighbors(i).slice(0, 40);
          var sims = h("div", { cls: "sims" }, nbs.map(function (x) {
            return h("div", { cls: "s" }, [h("div", null, [scorePill(x[1])]), h("div", null, [prodCell(x[0], false), statusTags(x[0], true)])]);
          }));
          var more = neighbors(i).length > 40 ? h("p", { cls: "note", text: "Mostrando os 40 mais parecidos de " + n(neighbors(i).length) + "." }) : null;
          body.appendChild(h("tr", { cls: "expand" }, [h("td", { colspan: "5" }, [h("div", { cls: "eyebrow", style: "margin-bottom:8px", text: "Todos os similares de " + P[i][1] }), sims, more])]));
        }
      });
    }
    tbl.appendChild(h("thead", null, [h("tr", null, head.map(function (x, j) { return h("th", { cls: (ST.tab !== "pares" && ST.tab !== "inat" && j === 3) ? "r" : null, text: x }); }))]));
    if (!slice.length) body.appendChild(h("tr", null, [h("td", { colspan: String(head.length), cls: "empty", text: "Nenhum item com estes filtros." })]));
    tbl.appendChild(body);
    var pg = $("pager"); pg.textContent = "";
    pg.appendChild(h("span", { cls: "num", text: list.length ? (n(ST.page * PAGE + 1) + "–" + n(Math.min(list.length, (ST.page + 1) * PAGE)) + " de " + n(list.length)) : "0 itens" }));
    pg.appendChild(h("div", { cls: "actions" }, [
      h("button", { cls: "btn small", type: "button", disabled: ST.page === 0, text: "Anterior", onclick: function () { ST.page--; ST.expanded = null; renderTable(); } }),
      h("button", { cls: "btn small", type: "button", disabled: ST.page >= pages - 1, text: "Próxima", onclick: function () { ST.page++; ST.expanded = null; renderTable(); } })
    ]));
  }

  // ---------- exportar Excel ----------
  function sitText(i) { var I = ST.cur.R.info; return SIT[I.cat[i]].label; }
  function r3(x) { return Math.round(x * 1000) / 1000; }
  async function salvarArquivo(nome, blob) { Armazem.baixar(nome, blob); }
  function tabelaExportar() {
    var list = currentList(), I = ST.cur.R.info, P = ST.cur.D.P, pr = ST.cur.D.pairs, D = ST.cur.D, rows = [], headers;
    function ondeTem(st) {
      return (st || []).filter(function (x) { return x[1] !== 0 || x[2] > 0; }).map(function (x) {
        return D.filiais[x[0]] + ": " + (x[1] ? "saldo " + r3(x[1]) : "") + (x[1] && x[2] ? ", " : "") + (x[2] ? "prev. " + r3(x[2]) : ""); }).join(" · ");
    }
    if (ST.tab === "inat") {
      var X = ST.cur.R.inat;
      headers = ["Empresa", "Código", "Descrição", "Tipo", "Grupo", "UM", "Motivo", "Saldo", "Previsão de chegada", "Ponto de pedido", "Situação", "Onde tem saldo/previsão"];
      list.forEach(function (i) {
        var p = D.I[i], mov = X.saldo[i] !== 0 || X.prev[i] > 0 || X.pp[i] > 0;
        rows.push([p[0], p[1], p[2], p[3], p[4], p[5], p[9] || "Bloqueado", r3(X.saldo[i]), r3(X.prev[i]), r3(X.pp[i]),
          mov ? "Conferir: inativo com movimento" : "Ok: bloqueado sem movimento", ondeTem(p[8])]);
      });
    } else if (ST.tab === "pares") {
      headers = ["Empresa", "Similaridade %", "Faixa", "Código A", "Descrição A", "Situação A", "Código B", "Descrição B", "Situação B", "Sugestão"];
      list.forEach(function (k) {
        var a = pr[k], b = pr[k + 1], sg = pairSuggestion(a, b);
        rows.push([P[a][0], pr[k + 2], BAND[bandOf(pr[k + 2])].label, P[a][1], P[a][2], sitText(a), P[b][1], P[b][2], sitText(b), sg.main + " — " + sg.sub]);
      });
    } else {
      headers = ["Empresa", "Código", "Descrição", "Tipo", "Grupo", "UM", "Saldo", "Previsão de chegada", "Ponto de pedido", "Situação",
        "Maior similaridade %", "Faixa", "Código similar", "Descrição similar", "Situação similar", "Qtd. similares", "Ação sugerida", "Onde tem saldo/previsão"];
      list.forEach(function (i) {
        var bp = I.bestP[i], act = productAction(i), acao = Array.prototype.map.call(act.childNodes, function (c) { return c.textContent; }).join(" — ");
        rows.push([P[i][0], P[i][1], P[i][2], P[i][3], P[i][4], P[i][5], r3(I.saldo[i]), r3(I.prev[i]), r3(I.pp[i]), sitText(i), I.best[i], BAND[I.band[i]].label,
          bp >= 0 ? P[bp][1] : "", bp >= 0 ? P[bp][2] : "", bp >= 0 ? sitText(bp) : "", nSim(i), acao, ondeTem(P[i][8])]);
      });
    }
    return { headers: headers, rows: rows };
  }
  async function exportXlsx() {
    if (!ST.cur) return;
    var btn = $("btnCsv"), label = "Exportar Excel";
    btn.disabled = true; btn.textContent = "Gerando…";
    try {
      var t = tabelaExportar();
      var nomes = { saldo: ["com_saldo", "Com saldo e similar"], cand: ["candidatos_bloqueio", "Candidatos a bloqueio"], prod: ["produtos", "Produtos com similar"], pares: ["pares", "Pares similares"], inat: ["inativos", "Inativos (bloqueados)"] }[ST.tab];
      var scopeTag = "empresa" + ST.scope.slice(2);
      var blob = await XlsxWriter.build({ sheet: nomes[1], headers: t.headers, rows: t.rows });
      await salvarArquivo("duplicidade_" + nomes[0] + "_" + scopeTag + "_" + ST.cur.D.at.slice(0, 10) + ".xlsx", blob);
      btn.textContent = label;
    } catch (e) {
      btn.textContent = e && e.code === "declined" ? label : "Não consegui exportar";
      if (btn.textContent !== label) setTimeout(function () { btn.textContent = label; }, 3000);
    } finally { btn.disabled = false; }
  }

  // ---------- history ----------
  function renderHist() {
    var box = $("hist"); box.textContent = "";
    var list = ST.snaps.slice().reverse();
    var locais = ST.snaps.filter(function (x) { return x.origem === "local"; });
    if (locais.length) {
      box.appendChild(h("div", { cls: "banner", style: "margin-bottom:8px" }, [
        h("p", { text: (locais.length === 1 ? "1 medição está" : locais.length + " medições estão") + " só neste navegador. Envie os arquivos ao GitHub para todo mundo ver." }),
        h("button", { cls: "btn primary small", type: "button", text: "Enviar ao GitHub", onclick: function () { openPublish(); } })]));
    }
    if (ST.preview) {
      var A0 = ST.preview.R.summary.g;
      box.appendChild(h("div", { cls: "h" }, [h("strong", { text: dt(ST.preview.D.at, true) }), h("span", { cls: "muted", text: n(A0.comSim) + " com similar · " + n(A0.b95) + " em 95–100% · prévia não salva" }), h("span", { cls: "cur-badge", text: "prévia" })]));
    }
    if (!list.length && !ST.preview) { box.appendChild(h("p", { cls: "note", text: "Nenhuma medição salva." })); return; }
    list.forEach(function (d) {
      var A = d.g || {}, isCur = !ST.preview && ST.cur && ST.cur.id === d.id;
      var acts = [];
      if (isCur) acts.push(h("span", { cls: "cur-badge", text: "em exibição" }));
      else if (temDetalhe(d)) acts.push(h("button", { cls: "btn small", type: "button", text: "Ver", onclick: function () { if (ST.preview) return; ST.viewId = d.id; loadSnapshot(d.id); } }));
      else acts.push(h("span", { cls: "muted", style: "font-size:12px", text: "só resumo" }));
      if (d.origem === "local") acts.push(h("button", { cls: "btn small", type: "button", text: "Excluir", title: "Apagar esta medição deste navegador",
        onclick: async function () {
          if (!window.confirm("Apagar a medição de " + dt(d.at, true) + " deste navegador?")) return;
          await Armazem.excluirLocal(d.id);
          if (ST.cur && ST.cur.id === d.id) { ST.cur = null; ST.saved = null; ST.viewId = null; }
          await recarregar();
        } }));
      box.appendChild(h("div", { cls: "h" }, [h("strong", { cls: "num", text: dt(d.at, true) }),
        h("span", { cls: "muted", text: n(A.comSim) + " com similar · " + n(A.b95) + " em 95–100% · " + n((A.L1 || 0) + (A.L2 || 0)) + " candidatos · " + (A.inat != null ? n(A.inat) + " inativos · " : "") + (d.origem === "local" ? "só neste navegador" : "no GitHub") }),
        h("div", { cls: "actions" }, acts)]));
    });
  }

  // ---------- upload / processing ----------
  function workerSrc() {
    return "var SimCore=(" + SimCoreFactory.toString() + ")();\n" +
      "onmessage=function(e){var d=e.data;var r=SimCore.join(d.strings,d.T,function(f){postMessage({p:f});},d.stride,d.offset);" +
      "var a=r.a.slice(),b=r.b.slice(),s=r.s.slice();postMessage({done:1,a:a,b:b,s:s,n:r.n},[a.buffer,b.buffer,s.buffer]);};";
  }
  function mergeRes(parts) {
    var tot = 0; parts.forEach(function (p) { tot += p.n; });
    var a = new Int32Array(tot), b = new Int32Array(tot), sc = new Uint8Array(tot), o = 0;
    parts.forEach(function (p) { a.set(p.a, o); b.set(p.b, o); sc.set(p.s, o); o += p.n; });
    return { a: a, b: b, s: sc, n: tot };
  }
  function runJoinParallel(strings, T, onProgress) {
    var N = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    if (strings.length < 4000) N = 1;
    return new Promise(function (resolve) {
      var fallback = function () { setTimeout(function () { resolve(SimCore.join(strings, T, onProgress)); }, 30); };
      var url, workers = [], prog = [], parts = [], done = 0, failed = false;
      try { url = URL.createObjectURL(new Blob([workerSrc()], { type: "text/javascript" })); } catch (e) { return fallback(); }
      function fail() {
        if (failed) return; failed = true;
        workers.forEach(function (w) { try { w.terminate(); } catch (e) {} });
        fallback();
      }
      for (var w = 0; w < N; w++) {
        try { workers.push(new Worker(url)); } catch (e) { return fail(); }
      }
      workers.forEach(function (wk, idx) {
        prog[idx] = 0;
        wk.onmessage = function (ev) {
          var m = ev.data;
          if (m.done) {
            parts[idx] = m; done++; wk.terminate();
            if (done === N && !failed) { try { URL.revokeObjectURL(url); } catch (e) {} resolve(mergeRes(parts)); }
          } else { prog[idx] = m.p; onProgress(prog.reduce(function (x, y) { return x + y; }, 0) / N); }
        };
        wk.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); fail(); };
        wk.postMessage({ strings: strings, T: T, stride: N, offset: idx });
      });
    });
  }

  var UP = null;
  function openDrawer() {
    UP = { files: [], results: {}, running: false };
    var host = $("drawerHost"); host.textContent = "";
    var input = h("input", { type: "file", id: "fileInput", multiple: true, accept: ".xlsx,.csv,.txt", style: "display:none" });
    var drop = h("label", { cls: "drop", for: "fileInput" }, [
      h("strong", { text: "Solte as planilhas aqui ou clique para escolher" }),
      h("span", { cls: "muted", text: "SB1 (cadastro), SBZ (indicadores) e Saldo Físico de cada empresa · .xlsx ou .csv" })]);
    var list = h("div", { cls: "flist", id: "flist" });
    var warns = h("ul", { cls: "warnlist", id: "upWarn" });
    var steps = h("div", { cls: "steps", id: "upSteps" });
    var go = h("button", { cls: "btn primary", type: "button", id: "btnGo", text: "Processar", disabled: true, onclick: processFiles });
    var cancel = h("button", { cls: "btn", type: "button", text: "Cancelar", onclick: closeDrawer });
    var panel = h("div", { cls: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Atualizar base" }, [
      h("div", { cls: "eyebrow", text: "Nova medição" }),
      h("h2", { text: "Atualizar base" }),
      h("p", { cls: "note", style: "font-size:13px", text: "Exporte do Protheus e carregue juntas: a SB1, a SBZ e o Saldo Físico (SB2) de todas as empresas. O painel identifica cada planilha sozinho, compara as descrições e mostra uma prévia antes de salvar no histórico." }),
      input, drop, list, warns, steps, h("div", { cls: "actions" }, [cancel, go])]);
    var bg = h("div", { cls: "drawer-bg", onclick: function (ev) { if (ev.target === bg && !UP.running) closeDrawer(); } }, [panel]);
    host.appendChild(bg);
    input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (ev) { if (ev.dataTransfer && ev.dataTransfer.files) addFiles(ev.dataTransfer.files); });
    document.addEventListener("keydown", escClose);
  }
  function escClose(ev) { if (ev.key === "Escape" && UP && !UP.running) closeDrawer(); }
  function closeDrawer() { $("drawerHost").textContent = ""; document.removeEventListener("keydown", escClose); UP = null; }
  function addFiles(fl) {
    Array.from(fl).forEach(function (f) {
      if (!UP.files.some(function (x) { return x.name === f.name && x.size === f.size; })) UP.files.push(f);
    });
    drawFileList();
  }
  function fmtSize(b) { return b > 1e6 ? PF.format(b / 1e6) + " MB" : PF.format(b / 1e3) + " KB"; }
  function drawFileList() {
    var list = $("flist"); if (!list) return;
    list.textContent = "";
    UP.files.forEach(function (f, idx) {
      var r = UP.results[idx];
      var status = r ? (r.error ? "" : r.label + " · " + n(r.rows) + " linhas") : (UP.running ? "aguardando" : fmtSize(f.size));
      var rm = UP.running ? null : h("button", { cls: "btn small", type: "button", text: "Remover", onclick: function () { UP.files.splice(idx, 1); UP.results = {}; drawFileList(); } });
      var bar = h("div", { cls: "bar", style: "grid-column:1/-1" }, [h("i", { id: "fbar" + idx, style: "width:" + (r ? 100 : 0) + "%" })]);
      list.appendChild(h("div", { cls: "fitem" }, [h("span", { cls: "fname", text: f.name }), rm || h("span"),
        h("span", { cls: "fkind", id: "fkind" + idx, text: status }), h("span"), UP.running || r ? bar : null, r && r.error ? h("span", { cls: "ferr", text: r.error }) : null]));
    });
    $("btnGo").disabled = !UP.files.length || UP.running;
  }
  function setStep(txt, frac) {
    var st = $("upSteps"); if (!st) return;
    if (txt != null) { st.textContent = ""; st.appendChild(h("div", { text: txt })); st.appendChild(h("div", { cls: "bar" }, [h("i", { id: "stepBar" })])); }
    var b = $("stepBar"); if (b && frac != null) b.style.width = Math.round(frac * 100) + "%";
  }
  async function processFiles() {
    if (!UP || UP.running || !UP.files.length) return;
    UP.running = true; UP.results = {};
    drawFileList();
    var tables = [];
    for (var i = 0; i < UP.files.length; i++) {
      var f = UP.files[i];
      setStep("Lendo " + f.name + "…", 0);
      try {
        var t = await DupAnalysis.readTable(f, f.name, (function (idx) { return function (p) { var b = $("fbar" + idx); if (b) b.style.width = Math.round(p * 100) + "%"; setStep(null, p); }; })(i));
        UP.results[i] = t;
        if (t.kind) tables.push(t);
      } catch (e) {
        UP.results[i] = { error: "Não consegui ler: " + (e && e.message ? e.message : e) };
      }
      drawFileList();
    }
    var kinds = {}; tables.forEach(function (t) { kinds[t.kind] = 1; });
    var w = $("upWarn"); w.textContent = "";
    var warn = function (t) { w.appendChild(h("li", { text: t })); };
    if (!kinds.SB1 && !kinds.SB2) { warn("Preciso ao menos da SB1 (ou do Saldo Físico) para comparar as descrições."); UP.running = false; drawFileList(); setStep("", 0); return; }
    if (!kinds.SB1) warn("Sem SB1: vou usar a descrição do Saldo Físico, e só os produtos que aparecem nele.");
    if (!kinds.SBZ) warn("Sem SBZ: o ponto de pedido não será considerado.");
    if (!kinds.SB2) warn("Sem Saldo Físico: saldo e previsão de chegada não serão considerados.");
    try {
      var D = await DupAnalysis.build(tables, runJoinParallel, function (txt, frac) { setStep(txt, frac); });
      setStep("Pronto. Abrindo a prévia…", 1);
      UP.running = false;
      closeDrawer();
      setCurrent({ id: null, doc: null, D: D }, true);
      $("previewText").textContent = "Ainda não foi salva no histórico. Confira os números e salve para registrar o ponto na evolução.";
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      UP.running = false; drawFileList();
      warn("Falhou ao processar: " + (e && e.message ? e.message : e));
    }
  }
  async function savePreview() {
    var pv = ST.preview; if (!pv) return;
    var btn = $("btnSave"); btn.disabled = true; btn.textContent = "Salvando…";
    try {
      var sid = "s" + pv.D.at.replace(/[^0-9]/g, "").slice(0, 14);
      var doc = DupAnalysis.snapshotDoc(pv.D, pv.R.summary, { arquivo: sid + ".json" });
      doc.id = sid;
      var gravou = await Armazem.salvarLocal(doc, pv.D);
      doc.origem = "local";
      pv.id = sid; pv.doc = doc;
      ST.preview = null; ST.saved = pv; ST.viewId = sid;
      $("previewText").textContent = "";
      try { ST.snaps = await Armazem.listar(); } catch (e) { /* mantém a lista atual */ }
      if (!ST.snaps.some(function (x) { return x.id === sid; })) ST.snaps.push(doc);
      ST.cur.doc = findSnap(sid) || doc;
      renderAll();
      openPublish(gravou ? null : "Este navegador não deixou guardar a medição. Baixe os arquivos agora, antes de fechar a página.");
    } catch (e) {
      $("previewText").textContent = "Não consegui salvar: " + ((e && e.message) || e) + ".";
    } finally { btn.disabled = false; btn.textContent = "Salvar medição"; }
  }

  // Janela com os arquivos para enviar ao repositório
  async function openPublish(aviso) {
    var locais = ST.snaps.filter(function (x) { return x.origem === "local"; });
    var host = $("drawerHost"); host.textContent = "";
    var lista = h("div", { cls: "flist" });
    var historico = await Armazem.historicoParaPublicar();
    function linhaArquivo(nome, pasta, onBaixar) {
      return h("div", { cls: "fitem" }, [h("span", { cls: "fname", text: nome }),
        h("button", { cls: "btn small primary", type: "button", text: "Baixar", onclick: onBaixar }),
        h("span", { cls: "fkind", text: "vai na pasta " + pasta })]);
    }
    lista.appendChild(linhaArquivo("historico.json", "dados/", function () {
      Armazem.baixar("historico.json", JSON.stringify(historico, null, 1), "application/json");
    }));
    locais.forEach(function (m) {
      lista.appendChild(linhaArquivo(m.arquivo, "dados/medicoes/", async function () {
        try { var D = await Armazem.detalhe(m); Armazem.baixar(m.arquivo, JSON.stringify(D), "application/json"); }
        catch (e) { window.alert("Não encontrei o detalhe desta medição: " + e.message); }
      }));
    });
    var close = function () { host.textContent = ""; document.removeEventListener("keydown", esc); };
    var esc = function (ev) { if (ev.key === "Escape") close(); };
    var steps = h("ol", { cls: "steps", style: "padding-left:18px;margin:0" }, [
      h("li", { text: "Baixe os arquivos acima." }),
      h("li", { text: "No GitHub, abra a pasta dados do repositório → Add file → Upload files → solte o historico.json → Commit changes." }),
      h("li", { text: "Abra a pasta dados/medicoes → Add file → Upload files → solte o(s) arquivo(s) s….json → Commit changes." }),
      h("li", { text: "Em 1 a 2 minutos o site publicado mostra a medição para todo mundo. Até lá ela aparece só neste navegador." })]);
    var panel = h("div", { cls: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Enviar ao GitHub" }, [
      h("div", { cls: "eyebrow", text: "Publicar medição" }),
      h("h2", { text: "Enviar ao GitHub" }),
      aviso ? h("ul", { cls: "warnlist" }, [h("li", { text: aviso })]) : null,
      h("p", { cls: "note", style: "font-size:13px", text: locais.length ? "A medição foi salva neste navegador. Para ela entrar no histórico do site, envie estes arquivos ao repositório:" : "Não há medições pendentes neste navegador. O historico.json abaixo é o mesmo que já está no repositório." }),
      lista, steps,
      h("div", { cls: "actions" }, [h("button", { cls: "btn", type: "button", text: "Fechar", onclick: close })])]);
    var bg = h("div", { cls: "drawer-bg", onclick: function (ev) { if (ev.target === bg) close(); } }, [panel]);
    host.appendChild(bg);
    document.addEventListener("keydown", esc);
  }
  function discardPreview() {
    ST.preview = null;
    if (ST.saved) { ST.cur = ST.saved; ST.page = 0; renderAll(); }
    else if (ST.snaps.length && ST.viewId) loadSnapshot(ST.viewId);
    else { mounted = false; showLoading("Nenhuma medição salva ainda. Clique em “Atualizar base” para carregar as planilhas."); $("meta").textContent = "Sem medições."; $("previewBanner").hidden = true; }
  }

  $("btnUpload").addEventListener("click", openDrawer);
  $("btnSave").addEventListener("click", savePreview);
  $("btnDiscard").addEventListener("click", discardPreview);
  boot();
})();
