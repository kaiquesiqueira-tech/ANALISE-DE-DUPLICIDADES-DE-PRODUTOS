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
// No repositório: dados/bloqueios.json — todo mundo que abre o site vê.
// Quem marca conecta uma chave do GitHub (uma vez, neste navegador): cada marcação é gravada sozinha
// no repositório pela API do GitHub. Quem está conectado vê as marcações dos outros em até 20 s (pela API);
// sem chave, o site busca a cada 30 s no GitHub Pages, que leva 1 a 2 minutos para publicar.
// Sem chave, a marcação fica só neste navegador (localStorage) até ser enviada pelo PUBLICAR.
// Cada marcação: { on, d: quando marcou, t: última alteração }. Na junção vale a de "t" mais recente.
var Marcas = (function () {
  var CHAVE = "dup:marcas:v1", CHAVE_GH = "dup:github:v1", ARQ = "dados/bloqueios.json", API = "https://api.github.com";
  var repo = {}, local = {}, ouvinte = null, aoEstado = null, assinatura = "";
  var est = { fase: "", erro: "", enviadoEm: null, lidoEm: null };
  var tEnvio = 0, primeiroPend = 0, enviando = false, deNovo = false, tRetry = 0;

  function lerLocal() { try { var j = JSON.parse(localStorage.getItem(CHAVE) || "{}"); return j && typeof j === "object" ? j : {}; } catch (e) { return {}; } }
  function gravarLocal() { try { localStorage.setItem(CHAVE, JSON.stringify(local)); return true; } catch (e) { return false; } }
  function valida(e) { return e && typeof e === "object" && typeof e.t === "string"; }
  function juntar() {
    var m = {}, k;
    for (k in repo) if (valida(repo[k])) m[k] = repo[k];
    for (k in local) if (valida(local[k]) && (!m[k] || local[k].t > m[k].t)) m[k] = local[k];
    return m;
  }
  function avisar() { if (ouvinte) ouvinte(juntar()); }
  function mudouEstado() { if (aoEstado) aoEstado(); }
  // o que já chegou ao repositório sai do navegador
  function podar() {
    var mudou = false;
    Object.keys(local).forEach(function (k) { var a = repo[k]; if (!valida(local[k]) || (valida(a) && a.t >= local[k].t)) { delete local[k]; mudou = true; } });
    if (mudou) gravarLocal();
  }

  // ---- conexão com o GitHub ----
  function conexao() { try { var c = JSON.parse(localStorage.getItem(CHAVE_GH) || "null"); return c && c.token ? c : null; } catch (e) { return null; } }
  function repoDoSite() {
    var m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
    if (!m) return null;
    var seg = location.pathname.split("/").filter(Boolean)[0];
    return { owner: m[1], repo: seg && !/\.html?$/i.test(seg) ? seg : m[1] + ".github.io" };
  }
  function cab(c, raw) {
    return { "Authorization": "Bearer " + c.token, "Accept": raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  }
  function urlArq(c) { return API + "/repos/" + encodeURIComponent(c.owner) + "/" + encodeURIComponent(c.repo) + "/contents/" + ARQ; }
  function b64DeTexto(s) {
    var b = new TextEncoder().encode(s), out = "", N = 0x8000;
    for (var i = 0; i < b.length; i += N) out += String.fromCharCode.apply(null, b.subarray(i, i + N));
    return btoa(out);
  }
  function textoDeB64(c) {
    var bin = atob(String(c).replace(/\s/g, "")), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(b);
  }
  // pedido com tempo limite: se a rede travar, desiste em 20 s e tenta de novo depois
  function buscar(url, op) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : 0;
    return fetch(url, Object.assign({ cache: "no-store" }, op || {}, ctl ? { signal: ctl.signal } : {})).finally(function () { clearTimeout(t); });
  }
  // 403/429 por excesso de pedidos é temporário (o GitHub pede para esperar); 401 e o resto de 403 são da chave
  async function erroHttp(r, txt) {
    var e = new Error(txt || ("GitHub respondeu " + r.status)); e.status = r.status;
    if (r.status === 429 || (r.status === 403 && r.headers && r.headers.get("x-ratelimit-remaining") === "0")) e.espera = true;
    else if (r.status === 403) { try { var j = await r.clone().json(); if (/rate limit|abuse/i.test(j.message || "")) e.espera = true; } catch (x) { /* sem corpo */ } }
    return e;
  }
  // Lê dados/bloqueios.json pela API (sempre a versão mais nova, com o "sha" para gravar por cima)
  async function lerApi(c) {
    var r = await buscar(urlArq(c) + "?ref=" + encodeURIComponent(c.branch) + "&t=" + Date.now(), { headers: cab(c) });
    if (r.status === 404) return { sha: null, m: {} };
    if (!r.ok) throw await erroHttp(r);
    var j = await r.json(), texto = j.content && j.encoding === "base64" ? textoDeB64(j.content) : null;
    if (texto == null) { // arquivo maior que 1 MB: a API manda o conteúdo à parte
      var r2 = await buscar(urlArq(c) + "?ref=" + encodeURIComponent(c.branch) + "&t=" + Date.now(), { headers: cab(c, true) });
      if (!r2.ok) throw await erroHttp(r2);
      texto = await r2.text();
    }
    var obj = {}; try { obj = JSON.parse(texto.replace(/^﻿/, "")); } catch (e) { obj = {}; }
    return { sha: j.sha, m: (obj && obj.m) || {} };
  }
  async function lerSite() {
    var r = await buscar(ARQ + "?t=" + Date.now());
    if (!r.ok) return r.status === 404 ? {} : null;
    var j = await r.json();
    return (j && j.m) || {};
  }
  // Busca as marcações de todos (a cada minuto e quando a página volta a ficar visível)
  var aoNovos = null, atualizando = false;
  async function atualizar() {
    if (atualizando) return;
    atualizando = true;
    var c = conexao(), m = null;
    try { m = c ? (await lerApi(c)).m : await lerSite(); }
    catch (e) { if (c && !e.espera && (e.status === 401 || e.status === 403)) { est.fase = "chave"; est.erro = "a chave do GitHub não vale mais"; mudouEstado(); } }
    finally { atualizando = false; }
    if (!m) return;
    var sig = JSON.stringify(m);
    est.lidoEm = new Date();
    if (sig !== assinatura) {
      var novos = 0, k;
      for (k in m) { var a = m[k], b = repo[k]; if (a && a.on && (!b || !b.on) && !(local[k] && local[k].t >= a.t)) novos++; }
      var primeira = !assinatura;
      assinatura = sig; repo = m; podar(); avisar();
      // o envio que parecia ter falhado chegou ao GitHub (ex.: a rede caiu depois de gravar)
      if (est.fase === "erro" && !Object.keys(local).length) { est.fase = "ok"; est.erro = ""; est.enviadoEm = new Date(); clearTimeout(tRetry); }
      if (novos && !primeira && aoNovos) aoNovos(novos);
    }
    mudouEstado();
  }

  // ---- envio (em lote: 2 s depois da última marcação, no máximo 15 s depois da primeira) ----
  function agendar() {
    if (!conexao() || !Object.keys(local).length) return;
    var agora = Date.now();
    if (!primeiroPend) primeiroPend = agora;
    clearTimeout(tEnvio);
    tEnvio = setTimeout(enviar, Math.max(0, Math.min(2000, primeiroPend + 15000 - agora)));
  }
  async function enviar() {
    var c = conexao();
    if (!c || !Object.keys(local).length) {
      if (c && est.fase === "erro") { est.fase = "ok"; est.erro = ""; est.enviadoEm = new Date(); mudouEstado(); }
      return;
    }
    if (enviando) { deNovo = true; return; }
    enviando = true; deNovo = false; primeiroPend = 0; clearTimeout(tRetry);
    est.fase = "enviando"; est.erro = ""; mudouEstado();
    try {
      for (var tent = 0; ; tent++) {
        var lido = await lerApi(c), base = lido.m, junto = {}, k, novos = 0, mandados = {};
        for (k in base) if (valida(base[k])) junto[k] = base[k];
        for (k in local) if (valida(local[k]) && (!junto[k] || local[k].t > junto[k].t)) { junto[k] = local[k]; mandados[k] = local[k]; novos++; }
        if (!novos) { repo = base; break; }
        var corpo = { message: "Marcações de bloqueio: " + novos + (novos === 1 ? " produto" : " produtos") + (c.nome ? " (" + c.nome + ")" : ""),
          content: b64DeTexto(JSON.stringify({ v: 1, at: new Date().toISOString(), m: junto })), branch: c.branch };
        if (lido.sha) corpo.sha = lido.sha;
        var r = await buscar(urlArq(c), { method: "PUT", headers: Object.assign(cab(c), { "Content-Type": "application/json" }), body: JSON.stringify(corpo) });
        if (r.ok) {
          repo = junto;
          for (k in mandados) if (local[k] === mandados[k]) delete local[k];
          gravarLocal();
          break;
        }
        if ((r.status === 409 || r.status === 422) && tent < 4) { await new Promise(function (ok) { setTimeout(ok, 600 + Math.random() * 900); }); continue; } // outra pessoa gravou ao mesmo tempo
        throw await erroHttp(r);
      }
      assinatura = JSON.stringify(repo);
      est.fase = "ok"; est.enviadoEm = new Date();
      avisar();
    } catch (e) {
      if (!e.espera && (e.status === 401 || e.status === 403 || e.status === 404)) { est.fase = "chave"; est.erro = e.status === 404 ? "o repositório não foi encontrado com esta chave" : "a chave do GitHub não vale mais ou não pode gravar"; }
      else { est.fase = "erro"; est.erro = e.espera ? "o GitHub pediu para esperar um pouco" : "sem conexão com o GitHub"; tRetry = setTimeout(enviar, e.espera ? 60000 : 20000); }
    } finally {
      enviando = false; mudouEstado();
      if (deNovo || (est.fase === "ok" && Object.keys(local).length)) agendar();
    }
  }

  async function iniciar(fn, fnEstado, fnNovos) {
    ouvinte = fn; aoEstado = fnEstado || null; aoNovos = fnNovos || null; local = lerLocal();
    var c = conexao(), m = null;
    try { m = c ? (await lerApi(c)).m : await lerSite(); } catch (e) { m = null; }
    if (!m) { try { m = await lerSite(); } catch (e) { m = null; } }
    repo = m || {}; assinatura = JSON.stringify(repo); est.lidoEm = new Date();
    podar();
    fn(juntar());
    mudouEstado();
    (function ciclo() { setTimeout(function () { (document.visibilityState === "hidden" ? Promise.resolve() : atualizar()).then(ciclo, ciclo); }, conexao() ? 20000 : 30000); })();
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") atualizar();
      else if (Object.keys(local).length && conexao()) enviar(); // fechando a aba: tenta mandar o que falta
    });
    if (c && Object.keys(local).length) enviar();
  }
  function salvar(itens) {
    itens.forEach(function (it) { local[it.emp + "|" + it.cod] = it.e; });
    var ok = gravarLocal();
    avisar();
    agendar();
    return ok ? Promise.resolve() : Promise.reject({ code: "storage", message: "o navegador não deixou guardar" });
  }
  // Conecta com uma chave (token) do GitHub: confere se ela pode gravar no repositório do site
  async function conectar(token, owner, repoNome, nome) {
    token = String(token || "").trim();
    var alvo = repoDoSite() || { owner: owner, repo: repoNome };
    if (!token) throw new Error("cole a chave do GitHub");
    if (!alvo.owner || !alvo.repo) throw new Error("informe o dono e o nome do repositório");
    var c = { token: token, owner: alvo.owner, repo: alvo.repo, nome: String(nome || "").trim().slice(0, 60) };
    var r = await buscar(API + "/repos/" + encodeURIComponent(c.owner) + "/" + encodeURIComponent(c.repo), { headers: cab(c) });
    if (r.status === 401) throw new Error("a chave não foi aceita pelo GitHub (confira se copiou inteira ou se não venceu)");
    if (r.status === 404 || r.status === 403) throw new Error("esta chave não tem acesso ao repositório " + c.owner + "/" + c.repo);
    if (!r.ok) throw new Error("o GitHub respondeu " + r.status + "; tente de novo");
    var j = await r.json();
    if (j.permissions && !j.permissions.push) throw new Error("esta chave só pode ler o repositório; ela precisa de Contents: Read and write");
    c.branch = j.default_branch || "main";
    try { var u = await buscar(API + "/user", { headers: cab(c) }); if (u.ok) c.login = (await u.json()).login || ""; } catch (e) { /* só para mostrar */ }
    try { localStorage.setItem(CHAVE_GH, JSON.stringify(c)); } catch (e) { throw new Error("o navegador não deixou guardar a chave"); }
    est.fase = ""; est.erro = "";
    await atualizar();
    if (Object.keys(local).length) await enviar();
    mudouEstado();
    return c;
  }
  // botão "Salvar para todos": manda o que falta agora e busca o que os outros marcaram
  async function sincronizar() {
    clearTimeout(tEnvio);
    if (conexao() && Object.keys(local).length) await enviar();
    await atualizar();
    return estado();
  }
  function desconectar() { try { localStorage.removeItem(CHAVE_GH); } catch (e) { /* nada */ } est.fase = ""; est.erro = ""; mudouEstado(); }
  function estado() {
    var c = conexao();
    return { conectado: !!c, login: c && c.login, nome: c && c.nome, repo: c ? c.owner + "/" + c.repo : (repoDoSite() ? repoDoSite().owner + "/" + repoDoSite().repo : ""),
      noSite: !!repoDoSite(), fase: est.fase, erro: est.erro, enviadoEm: est.enviadoEm, lidoEm: est.lidoEm, pendentes: Object.keys(local).length };
  }
  function pendentes() { return Object.keys(local).length; }
  function paraPublicar() { return { v: 1, at: new Date().toISOString(), m: juntar() }; }
  return { iniciar: iniciar, salvar: salvar, pendentes: pendentes, paraPublicar: paraPublicar, conectar: conectar, desconectar: desconectar,
    estado: estado, atualizar: atualizar, enviar: enviar, sincronizar: sincronizar };
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
