// ===== Similarity core (shared by browser worker and Node tests) =====
function SimCoreFactory() {
  var ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ./+-";
  var A = ALPHA.length;
  var CODE = new Int16Array(128).fill(-1);
  for (var k = 0; k < A; k++) CODE[ALPHA.charCodeAt(k)] = k;

  function normalize(s) {
    if (s == null) return "";
    s = String(s).replace(/[\u00ba\u00b0\u00aa]/g, "");
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    s = s.replace(/[^\x00-\x7F]/g, "").toUpperCase();
    s = s.replace(/(\d),(?=\d)/g, "$1.");
    // inch marks are noise: 5/8'' = 5/8" = 5/8
    s = s.replace(/''|"/g, " ");
    // glue reference codes written with hyphens: 9W-9058 -> 9W9058, CA-42374 -> CA42374
    s = s.replace(/([A-Z0-9])-(?=[0-9])|([0-9])-(?=[A-Z0-9])/g, "$1$2");
    // a sign right before a number is part of the measure (granulometry -2 x +2): keep it
    s = s.replace(/[^A-Z0-9./+-]+/g, " ");
    s = s.replace(/[+-](?![0-9])|(?<=[A-Z0-9./])[+-]/g, " ");
    s = s.replace(/(?<![0-9])[./]|[./](?![0-9])/g, " ");
    var t = s.split(" ").filter(Boolean).map(function (w) {
      if (!/[0-9]/.test(w)) return w;
      return w.replace(/\.0+$/, "").replace(/^([+-]?)0+(?=[0-9])/, "$1");
    });
    t.sort();
    return t.join(" ");
  }

  // Factor applied when descriptions carry measures / part numbers (tokens with digits).
  // Different references => different items, so the similarity drops.
  // Sizes and colors also tell variants apart (TAM G x TAM M, cabo AZUL x PRETO)
  var VARIANT = {
    PP: "PP", G: "G", M: "M", GG: "GG", XG: "XG", EG: "XG", EXG: "XGG", XGG: "XGG", EGG: "XGG", XXG: "XGG",
    AZ: "AZUL", VM: "VERMELHO", VERM: "VERMELHO", VD: "VERDE", AM: "AMARELO", AMAR: "AMARELO", PT: "PRETO",
    BR: "BRANCO", BCO: "BRANCO", CZ: "CINZA", LJ: "LARANJA", MARROM: "MARROM", ROXO: "ROXO", ROXA: "ROXO",
    ROSA: "ROSA", BEGE: "BEGE", INCOLOR: "INCOLOR", DOURADO: "DOURADO", PRATA: "PRATA", GRAFITE: "GRAFITE"
  };
  var VPREFIX = [["VERMELH", "VERMELHO"], ["AMAREL", "AMARELO"], ["PRET", "PRETO"], ["BRANC", "BRANCO"],
    ["VERDE", "VERDE"], ["AZUL", "AZUL"], ["CINZ", "CINZA"], ["LARANJ", "LARANJA"]];
  function variantOf(w) {
    if (VARIANT.hasOwnProperty(w)) return VARIANT[w];
    for (var i = 0; i < VPREFIX.length; i++) if (w.indexOf(VPREFIX[i][0]) === 0) return VPREFIX[i][1];
    return null;
  }
  function refTokens(norm) {
    var out = [];
    norm.split(" ").forEach(function (w) {
      if (/[0-9]/.test(w)) { out.push(w); return; }
      var v = variantOf(w);
      if (v) out.push("~" + v);
    });
    return out;
  }
  function refFactor(ra, rb) {
    if (!ra.length && !rb.length) return 1;
    if (!ra.length || !rb.length) return 0.9;
    var inter = 0, setB = {};
    for (var i = 0; i < rb.length; i++) setB[rb[i]] = (setB[rb[i]] || 0) + 1;
    for (i = 0; i < ra.length; i++) if (setB[ra[i]] > 0) { inter++; setB[ra[i]]--; }
    var uni = ra.length + rb.length - inter;
    return 0.5 + 0.5 * inter / uni;
  }

  function popcnt(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  // strings: array of normalized unique strings. T: min score (e.g. 70).
  // returns {a:Int32Array, b:Int32Array, s:Uint8Array, n} pairs of indexes into strings with score>=T
  function join(strings, T, onProgress, stride, offset) {
    stride = stride || 1; offset = offset || 0;
    var n = strings.length;
    var order = new Int32Array(n);
    for (var i = 0; i < n; i++) order[i] = i;
    var lens = strings.map(function (s) { return Math.min(s.length, 255); });
    order.sort(function (x, y) { return lens[x] - lens[y]; });
    // encode
    var off = new Int32Array(n + 1);
    for (i = 0; i < n; i++) off[i + 1] = off[i] + lens[order[i]];
    var buf = new Uint8Array(off[n]);
    var hist = new Uint8Array(n * A);
    var L = new Int32Array(n);
    for (i = 0; i < n; i++) {
      var s = strings[order[i]], o = off[i], len = lens[order[i]];
      L[i] = len;
      for (var p = 0; p < len; p++) {
        var c = CODE[s.charCodeAt(p)];
        if (c < 0) c = 36; // treat unknown as space
        buf[o + p] = c;
        hist[i * A + c]++;
      }
    }
    var q;
    var cap = 1 << 16, pa = new Int32Array(cap), pb = new Int32Array(cap), ps = new Uint8Array(cap), np = 0;
    function push(x, y, sc) {
      if (np === cap) {
        cap *= 2;
        var na = new Int32Array(cap); na.set(pa); pa = na;
        var nb = new Int32Array(cap); nb.set(pb); pb = nb;
        var ns = new Uint8Array(cap); ns.set(ps); ps = ns;
      }
      pa[np] = x; pb[np] = y; ps[np] = sc; np++;
    }
    var PM = new Uint32Array(A * 8);
    // global char frequency -> rank (rarest first)
    var freq = new Float64Array(A);
    for (i = 0; i < buf.length; i++) freq[buf[i]]++;
    var rank = []; for (q = 0; q < A; q++) rank.push(q);
    rank.sort(function (x, y) { return freq[x] - freq[y]; });
    var sc_chr = new Int32Array(A), sc_cnt = new Int32Array(A);
    var V = new Float64Array(8);
    var lastReport = 0;
    for (i = offset; i < n; i += stride) {
      var li = L[i];
      if (li === 0) continue;
      var W = (li + 31) >>> 5;
      PM.fill(0, 0, A * W);
      var oi = off[i];
      for (p = 0; p < li; p++) {
        var cc = buf[oi + p];
        PM[cc * W + (p >>> 5)] |= (1 << (p & 31)) >>> 0;
      }
      var maxL = Math.floor(li * (200 - T) / T);
      var hi = i * A, ni = 0;
      for (q = 0; q < A; q++) {
        var cq = rank[q];
        if (hist[hi + cq] > 0) { sc_chr[ni] = cq; sc_cnt[ni] = hist[hi + cq]; ni++; }
      }
      for (var j = i + 1; j < n; j++) {
        var lj = L[j];
        if (lj > maxL) break;
        var need = Math.ceil(T * (li + lj) / 200 - 1e-9);
        // bag bound (sparse, rarest chars first, early exit)
        var hj = j * A, deficit = 0, allow = li - need;
        for (var q = 0; q < ni; q++) {
          var d = sc_cnt[q] - hist[hj + sc_chr[q]];
          if (d > 0) { deficit += d; if (deficit > allow) break; }
        }
        if (deficit > allow) continue;
        var oj = off[j], lcs;
        if (W === 1) {
          var v = 0xFFFFFFFF;
          for (p = 0; p < lj; p++) {
            var u = v & PM[buf[oj + p]];
            v = ((v + u) | (v - u)) >>> 0;
          }
          var mask = li === 32 ? 0xFFFFFFFF : ((1 << li) - 1) >>> 0;
          lcs = li - popcnt((v & mask) >>> 0);
        } else {
          for (q = 0; q < W; q++) V[q] = 0xFFFFFFFF;
          for (p = 0; p < lj; p++) {
            var base = buf[oj + p] * W, carry = 0;
            for (q = 0; q < W; q++) {
              var vq = V[q];
              var uq = (vq & PM[base + q]) >>> 0;
              var sum = vq + uq + carry;
              carry = sum > 0xFFFFFFFF ? 1 : 0;
              V[q] = ((sum >>> 0) | (vq - uq)) >>> 0;
            }
          }
          var zeros = 0;
          for (q = 0; q < W; q++) {
            var bits = (q === W - 1) ? (li - 32 * q) : 32;
            var m2 = bits === 32 ? 0xFFFFFFFF : ((1 << bits) - 1) >>> 0;
            zeros += bits - popcnt((V[q] & m2) >>> 0);
          }
          lcs = zeros;
        }
        if (lcs >= need) {
          var sc = Math.floor(200 * lcs / (li + lj) + 1e-9);
          if (sc >= T) push(order[i], order[j], sc);
        }
      }
      if (onProgress && i - lastReport > 500 * stride) { lastReport = i; onProgress(i / n); }
    }
    return { a: pa.subarray(0, np), b: pb.subarray(0, np), s: ps.subarray(0, np), n: np };
  }
  return { normalize: normalize, join: join, refTokens: refTokens, refFactor: refFactor };
}
var SimCore = SimCoreFactory();
if (typeof module !== "undefined") module.exports = SimCore;
