// ===== Streaming XLSX / CSV reader (browser + Node 18+) =====
// Reads only what is needed, row by row, without loading the whole sheet in memory.
var XlsxStream = (function () {
  function decodeXml(s) {
    if (s.indexOf("&") < 0 && s.indexOf("_x") < 0) return s;
    return s
      .replace(/_x([0-9A-Fa-f]{4})_/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&(#x[0-9A-Fa-f]+|#\d+|lt|gt|amp|quot|apos);/g, function (_, e) {
        if (e === "lt") return "<";
        if (e === "gt") return ">";
        if (e === "amp") return "&";
        if (e === "quot") return '"';
        if (e === "apos") return "'";
        if (e[1] === "x") return String.fromCodePoint(parseInt(e.slice(2), 16));
        return String.fromCodePoint(parseInt(e.slice(1), 10));
      });
  }

  async function zipEntries(blob) {
    var size = blob.size;
    var tailLen = Math.min(size, 65557);
    var tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
    var eocd = -1;
    for (var i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("O arquivo não parece ser um .xlsx válido.");
    var dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    var count = dv.getUint16(eocd + 10, true);
    var cdSize = dv.getUint32(eocd + 12, true);
    var cdOff = dv.getUint32(eocd + 16, true);
    if (cdOff === 0xFFFFFFFF) throw new Error("Arquivo .xlsx muito grande (ZIP64) — exporte em CSV.");
    var cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    var cdv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    var td = new TextDecoder();
    var out = {}, p = 0;
    for (var k = 0; k < count; k++) {
      if (cdv.getUint32(p, true) !== 0x02014b50) break;
      var method = cdv.getUint16(p + 10, true);
      var csize = cdv.getUint32(p + 20, true);
      var usize = cdv.getUint32(p + 24, true);
      var nlen = cdv.getUint16(p + 28, true), xlen = cdv.getUint16(p + 30, true), clen = cdv.getUint16(p + 32, true);
      var lho = cdv.getUint32(p + 42, true);
      var name = td.decode(cd.subarray(p + 46, p + 46 + nlen));
      out[name] = { method: method, csize: csize, usize: usize, lho: lho };
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  async function entryStream(blob, e) {
    var lh = new DataView(await blob.slice(e.lho, e.lho + 30).arrayBuffer());
    var start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    var raw = blob.slice(start, start + e.csize).stream();
    if (e.method === 0) return raw;
    if (e.method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("Este navegador não descompacta .xlsx — use Chrome/Edge atualizado ou exporte em CSV.");
      return raw.pipeThrough(new DecompressionStream("deflate-raw"));
    }
    throw new Error("Compressão do .xlsx não suportada (método " + e.method + ").");
  }

  async function entryText(blob, e) {
    var r = (await entryStream(blob, e)).pipeThrough(new TextDecoderStream()).getReader();
    var parts = [];
    for (;;) { var x = await r.read(); if (x.done) break; parts.push(x.value); }
    return parts.join("");
  }

  function colIndex(ref) {
    var n = 0;
    for (var i = 0; i < ref.length; i++) {
      var c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  function parseSST(xml) {
    var out = [];
    xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    var re = /<si>([\s\S]*?)<\/si>|<si\/>/g, m;
    while ((m = re.exec(xml))) {
      var inner = m[1] || "", t = "", re2 = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m2;
      while ((m2 = re2.exec(inner))) t += m2[1];
      out.push(decodeXml(t));
    }
    return out;
  }

  // visitor: {onRow(cells:Array<string>)} ; cells indexed by column. returns rowCount
  async function readXlsx(blob, visitor, onProgress) {
    var ents = await zipEntries(blob);
    var sheetPath = "xl/worksheets/sheet1.xml";
    try {
      if (ents["xl/workbook.xml"] && ents["xl/_rels/workbook.xml.rels"]) {
        var wb = await entryText(blob, ents["xl/workbook.xml"]);
        var rid = (/<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb) || [])[1];
        var rels = await entryText(blob, ents["xl/_rels/workbook.xml.rels"]);
        if (rid) {
          var re = new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*>');
          var rel = re.exec(rels);
          var tgt = rel && /Target="([^"]+)"/.exec(rel[0]);
          if (tgt) {
            var t = tgt[1].replace(/^\//, "");
            sheetPath = t.indexOf("xl/") === 0 ? t : "xl/" + t;
          }
        }
      }
    } catch (err) { /* keep default */ }
    var sheet = ents[sheetPath];
    if (!sheet) { for (var k in ents) if (/^xl\/worksheets\/[^/]+\.xml$/.test(k)) { sheet = ents[k]; break; } }
    if (!sheet) throw new Error("Planilha não encontrada dentro do .xlsx.");
    var sst = ents["xl/sharedStrings.xml"] ? parseSST(await entryText(blob, ents["xl/sharedStrings.xml"])) : [];

    var total = sheet.usize || 1, seen = 0, lastP = 0;
    var reader = (await entryStream(blob, sheet)).pipeThrough(new TextDecoderStream()).getReader();
    var buf = "", rows = 0;
    var rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
    var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    function handleRow(inner) {
      var cells = [], m, seq = 0;
      cellRe.lastIndex = 0;
      while ((m = cellRe.exec(inner))) {
        var attrs = m[1], body = m[2];
        var rm = / r="([A-Z]+)\d*"/.exec(attrs);
        var ci = rm ? colIndex(rm[1]) : seq;
        seq = ci + 1;
        if (!body) continue;
        var tm = / t="([^"]+)"/.exec(attrs), type = tm ? tm[1] : "n", val = "";
        if (type === "inlineStr") {
          var it = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, x;
          while ((x = it.exec(body))) val += x[1];
          val = decodeXml(val);
        } else {
          var vm = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (!vm) continue;
          val = vm[1];
          if (type === "s") val = sst[+val] != null ? sst[+val] : "";
          else if (type === "str" || type === "e") val = decodeXml(val);
        }
        cells[ci] = val;
      }
      rows++;
      visitor.onRow(cells);
    }
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      buf += r.value;
      seen += r.value.length;
      var end = buf.lastIndexOf("</row>");
      if (end < 0) continue;
      var chunk = buf.slice(0, end + 6);
      buf = buf.slice(end + 6);
      rowRe.lastIndex = 0;
      var m;
      while ((m = rowRe.exec(chunk))) handleRow(m[1] || "");
      if (onProgress && seen - lastP > 2e6) { lastP = seen; onProgress(Math.min(0.99, seen / total)); }
    }
    rowRe.lastIndex = 0;
    var mm;
    while ((mm = rowRe.exec(buf))) handleRow(mm[1] || "");
    if (onProgress) onProgress(1);
    return rows;
  }

  async function readCsv(blob, visitor, onProgress) {
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (e) { text = new TextDecoder("windows-1252").decode(bytes); }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var firstLines = text.slice(0, 5000).split(/\r?\n/).slice(0, 5).join("\n");
    var sep = (firstLines.split(";").length >= firstLines.split(",").length) ? ";" : ",";
    if (firstLines.split("\t").length > firstLines.split(sep).length) sep = "\t";
    var rows = 0, i = 0, n = text.length, field = "", cells = [], inQ = false;
    while (i < n) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === sep) { cells.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cells.push(field); field = ""; visitor.onRow(cells); cells = []; rows++;
        if (onProgress && rows % 20000 === 0) onProgress(i / n);
      } else field += c;
      i++;
    }
    if (field || cells.length) { cells.push(field); visitor.onRow(cells); rows++; }
    if (onProgress) onProgress(1);
    return rows;
  }

  async function read(blob, name, visitor, onProgress) {
    if (/\.(csv|txt)$/i.test(name || "")) return readCsv(blob, visitor, onProgress);
    return readXlsx(blob, visitor, onProgress);
  }

  return { read: read };
})();
if (typeof module !== "undefined") module.exports = XlsxStream;
