// ===== Onde as medições ficam guardadas =====
// 1) No repositório (pasta dados/): historico.json + medicoes/<id>.json — todo mundo que abre o site vê.
// 2) Neste navegador (IndexedDB): medições salvas aqui e ainda não enviadas ao GitHub.
var Armazem = (function () {
  var NOME = "duplicidade-cadastro", VERSAO = 1, conexao;
  var memoria = { medicoes: {}, detalhes: {} }; // reserva quando o navegador não deixa gravar

  function abrir() {
    if (conexao !== undefined) return Promise.resolve(conexao);
    return new Promise(function (ok) {
      if (!window.indexedDB) { conexao = null; return ok(null); }
      var rq;
      try { rq = indexedDB.open(NOME, VERSAO); } catch (e) { conexao = null; return ok(null); }
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains("medicoes")) db.createObjectStore("medicoes", { keyPath: "id" });
        if (!db.objectStoreNames.contains("detalhes")) db.createObjectStore("detalhes");
      };
      rq.onsuccess = function () { conexao = rq.result; ok(conexao); };
      rq.onerror = rq.onblocked = function () { conexao = null; ok(null); };
    });
  }
  function req(store, modo, fn) {
    return abrir().then(function (db) {
      if (!db) return null;
      return new Promise(function (ok, falha) {
        var tx = db.transaction(store, modo), r = fn(tx.objectStore(store));
        tx.oncomplete = function () { ok(r && "result" in r ? r.result : null); };
        tx.onerror = tx.onabort = function () { falha(tx.error || new Error("IndexedDB")); };
      });
    });
  }

  async function doRepositorio() {
    try {
      var r = await fetch("dados/historico.json", { cache: "no-store" });
      if (!r.ok) return [];
      var j = await r.json();
      var lista = Array.isArray(j) ? j : (j.medicoes || []);
      return lista.filter(function (m) { return m && m.id && m.at; });
    } catch (e) { return []; }
  }
  async function doNavegador() {
    var lista = [];
    try { lista = (await req("medicoes", "readonly", function (s) { return s.getAll(); })) || []; } catch (e) { lista = []; }
    Object.keys(memoria.medicoes).forEach(function (id) {
      if (!lista.some(function (m) { return m.id === id; })) lista.push(memoria.medicoes[id]);
    });
    return lista;
  }

  // Lista única, em ordem de data. Uma medição que já chegou ao repositório sai do navegador.
  async function listar() {
    var repo = await doRepositorio(), loc = await doNavegador(), mapa = {};
    repo.forEach(function (m) { m.origem = "repo"; mapa[m.id] = m; });
    for (var i = 0; i < loc.length; i++) {
      var m = loc[i];
      if (mapa[m.id]) { if (mapa[m.id].arquivo) excluirLocal(m.id); continue; }
      m.origem = "local"; mapa[m.id] = m;
    }
    return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  }

  async function detalhe(m) {
    if (m.origem === "repo") {
      if (!m.arquivo) throw new Error("medição sem arquivo de detalhe");
      var r = await fetch("dados/medicoes/" + encodeURIComponent(m.arquivo), { cache: "no-store" });
      if (!r.ok) throw new Error("arquivo dados/medicoes/" + m.arquivo + " não encontrado (" + r.status + ")");
      return r.json();
    }
    if (memoria.detalhes[m.id]) return memoria.detalhes[m.id];
    var d = await req("detalhes", "readonly", function (s) { return s.get(m.id); });
    if (!d) throw new Error("detalhe não encontrado neste navegador");
    return d;
  }

  async function salvarLocal(doc, D) {
    var limpo = Object.assign({}, doc); delete limpo.origem;
    memoria.medicoes[doc.id] = limpo; memoria.detalhes[doc.id] = D;
    try {
      await req("medicoes", "readwrite", function (s) { return s.put(limpo); });
      await req("detalhes", "readwrite", function (s) { return s.put(D, doc.id); });
      return true;
    } catch (e) { return false; }
  }
  async function excluirLocal(id) {
    delete memoria.medicoes[id]; delete memoria.detalhes[id];
    try {
      await req("medicoes", "readwrite", function (s) { return s.delete(id); });
      await req("detalhes", "readwrite", function (s) { return s.delete(id); });
    } catch (e) { /* nada a fazer */ }
  }

  // historico.json novo = o que já está no repositório + as medições só deste navegador
  async function historicoParaPublicar() {
    var repo = await doRepositorio(), loc = await doNavegador(), mapa = {};
    repo.concat(loc).forEach(function (m) { var c = Object.assign({}, m); delete c.origem; mapa[c.id] = c; });
    return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  }

  function baixar(nome, conteudo, tipo) {
    var blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo || "application/octet-stream" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  return { listar: listar, detalhe: detalhe, salvarLocal: salvarLocal, excluirLocal: excluirLocal,
    historicoParaPublicar: historicoParaPublicar, baixar: baixar };
})();

// ===== Marcações de bloqueio =====
// 1) No repositório: dados/bloqueios.json — todo mundo que abre o site vê.
// 2) Neste navegador (localStorage): marcações feitas aqui e ainda não enviadas ao GitHub.
// Cada marcação: { on, d: quando marcou, t: última alteração }. Na junção vale a de "t" mais recente.
var Marcas = (function () {
  var CHAVE = "dup:marcas:v1", repo = {}, local = {}, ouvinte = null;
  function lerLocal() { try { var j = JSON.parse(localStorage.getItem(CHAVE) || "{}"); return j && typeof j === "object" ? j : {}; } catch (e) { return {}; } }
  function gravarLocal() { try { localStorage.setItem(CHAVE, JSON.stringify(local)); return true; } catch (e) { return false; } }
  function valida(e) { return e && typeof e === "object" && typeof e.t === "string"; }
  function juntar() {
    var m = {}, k;
    for (k in repo) if (valida(repo[k])) m[k] = repo[k];
    for (k in local) if (valida(local[k]) && (!m[k] || local[k].t > m[k].t)) m[k] = local[k];
    return m;
  }
  async function iniciar(fn) {
    ouvinte = fn; local = lerLocal();
    try {
      var r = await fetch("dados/bloqueios.json", { cache: "no-store" });
      if (r.ok) { var j = await r.json(); repo = (j && j.m) || {}; }
    } catch (e) { repo = {}; }
    // o que já chegou ao repositório sai do navegador
    var mudou = false;
    Object.keys(local).forEach(function (k) { var a = repo[k]; if (!valida(local[k]) || (valida(a) && a.t >= local[k].t)) { delete local[k]; mudou = true; } });
    if (mudou) gravarLocal();
    fn(juntar());
  }
  function salvar(itens) {
    itens.forEach(function (it) { local[it.emp + "|" + it.cod] = it.e; });
    var ok = gravarLocal();
    if (ouvinte) ouvinte(juntar());
    return ok ? Promise.resolve() : Promise.reject({ code: "storage", message: "o navegador não deixou guardar; baixe o bloqueios.json antes de fechar a página" });
  }
  function pendentes() { return Object.keys(local).length; }
  function paraPublicar() { return { v: 1, at: new Date().toISOString(), m: juntar() }; }
  return { iniciar: iniciar, salvar: salvar, pendentes: pendentes, paraPublicar: paraPublicar };
})();

// ===== Tabela de NCM (descrição de cada código) =====
// No repositório: dados/ncm.json. Carregada pelo site e ainda não enviada: localStorage.
var TabelaNcm = (function () {
  var CHAVE = "dup:ncm:v1";
  function local() { try { return JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch (e) { return null; } }
  async function carregar() {
    var repo = null, loc = local();
    try { var r = await fetch("dados/ncm.json", { cache: "no-store" }); if (r.ok) repo = await r.json(); } catch (e) { repo = null; }
    if (loc && repo && repo.at >= loc.at) { try { localStorage.removeItem(CHAVE); } catch (e) { /* nada */ } loc = null; }
    return loc || repo;
  }
  function guardar(t) { try { localStorage.setItem(CHAVE, JSON.stringify(t)); return true; } catch (e) { return false; } }
  function pendente() { return local(); }
  return { carregar: carregar, guardar: guardar, pendente: pendente };
})();

// ===== Tabelas de grupos de produto (descrição de cada grupo, por empresa) =====
// No repositório: dados/grupos.json = { v, emp: { "02": {at, arquivo, linhas, m}, "10": {...} } }.
// Carregadas pelo site e ainda não enviadas: localStorage, por empresa (vale a mais nova).
var TabelaGrupos = (function () {
  var CHAVE = "dup:grupos:v1";
  function local() { try { return JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch (e) { return null; } }
  function gravarLocal(obj) {
    try { if (obj) localStorage.setItem(CHAVE, JSON.stringify(obj)); else localStorage.removeItem(CHAVE); return true; } catch (e) { return false; }
  }
  async function doRepositorio() {
    try { var r = await fetch("dados/grupos.json", { cache: "no-store" }); if (r.ok) { var j = await r.json(); if (j && j.emp) return j; } } catch (e) { /* sem tabela */ }
    return null;
  }
  async function carregar() {
    var repo = await doRepositorio(), loc = local(), emp = Object.assign({}, repo && repo.emp);
    if (loc && loc.emp) {
      var resto = {};
      Object.keys(loc.emp).forEach(function (e) {
        var l = loc.emp[e], r = emp[e];
        if (!l || (r && r.at >= l.at)) return; // essa empresa já chegou ao repositório
        emp[e] = l; resto[e] = l;
      });
      gravarLocal(Object.keys(resto).length ? { v: 1, emp: resto } : null);
    }
    return { v: 1, emp: emp };
  }
  function guardar(e, tab) { var loc = local() || { v: 1, emp: {} }; loc.emp = loc.emp || {}; loc.emp[e] = tab; return gravarLocal(loc); }
  function pendente() { var l = local(); return l && l.emp && Object.keys(l.emp).length ? l : null; }
  async function paraPublicar() {
    var repo = await doRepositorio(), l = local();
    return { v: 1, at: new Date().toISOString(), emp: Object.assign({}, repo && repo.emp, l && l.emp) };
  }
  return { carregar: carregar, guardar: guardar, pendente: pendente, paraPublicar: paraPublicar };
})();
