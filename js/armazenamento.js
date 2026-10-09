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
