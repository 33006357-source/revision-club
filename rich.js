/* Revision Hub - shared tools for showing equations, tables and pictures */
(function () {
  var style = document.createElement("style");
  style.textContent = [
    ".rh-tablewrap{overflow-x:auto;max-width:100%;margin:10px 0}",
    ".rh-table{border-collapse:collapse}",
    ".rh-table th,.rh-table td{border:1px solid var(--line,#ccc);padding:6px 10px;vertical-align:top;text-align:left}",
    ".rh-table th{background:var(--accent-soft,#eee)}",
    ".rh-dmath{overflow-x:auto;max-width:100%}",
    ".rh-img{display:block;max-width:100%;height:auto;margin:8px 0;border-radius:6px;background:#fff}",
    ".rh-missing{color:#b42318}"
  ].join("\n");
  document.head.append(style);

  // pictures are only allowed from this project's own image storage
  var IMG_RE = /^https:\/\/ovescrsrikwonurarbbl\.supabase\.co\/storage\/v1\/object\/public\/question-images\/[A-Za-z0-9._-]+$/;

  // Splits text into plain text, $inline math$, $$display math$$, [[table:id]] and [[img:url]] pieces.
  function tokenize(src, allowTables) {
    var out = [], buf = "", bufStart = 0, i = 0;
    function add(c, idx) { if (!buf) bufStart = idx; buf += c; }
    function flush(end) { if (buf) out.push({ t: "text", v: buf, s: bufStart, e: end }); buf = ""; }
    while (i < src.length) {
      if (src.startsWith("\\$", i)) { add("$", i); i += 2; continue; }
      if (src.startsWith("$$", i)) {
        var end = src.indexOf("$$", i + 2);
        if (end > i + 2) {
          flush(i);
          out.push({ t: "dmath", v: src.slice(i + 2, end).trim(), s: i, e: end + 2 });
          i = end + 2; continue;
        }
      }
      if (src[i] === "$") {
        var j = i + 1;
        while (j < src.length && src[j] !== "$" && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
        if (j < src.length && src[j] === "$" && j > i + 1) {
          flush(i);
          out.push({ t: "math", v: src.slice(i + 1, j), s: i, e: j + 1 });
          i = j + 1; continue;
        }
      }
      if (allowTables && src.startsWith("[[table:", i)) {
        var tEnd = src.indexOf("]]", i);
        if (tEnd > 0) {
          var id = src.slice(i + 8, tEnd);
          if (/^[A-Za-z0-9_-]+$/.test(id)) {
            flush(i);
            out.push({ t: "table", v: id, s: i, e: tEnd + 2 });
            i = tEnd + 2; continue;
          }
        }
      }
      if (allowTables && src.startsWith("[[img:", i)) {
        var mEnd = src.indexOf("]]", i);
        if (mEnd > 0) {
          var url = src.slice(i + 6, mEnd).trim();
          if (IMG_RE.test(url)) {
            flush(i);
            out.push({ t: "img", v: url, s: i, e: mEnd + 2 });
            i = mEnd + 2; continue;
          }
        }
      }
      add(src[i], i); i++;
    }
    flush(src.length);
    // tidy the line breaks around blocks
    for (var k = 0; k < out.length; k++) {
      var tk = out[k];
      if (tk.t === "dmath" || tk.t === "table" || tk.t === "img") {
        var p = out[k - 1], n = out[k + 1];
        if (p && p.t === "text") p.v = p.v.replace(/\n$/, "");
        if (n && n.t === "text") n.v = n.v.replace(/^\n/, "");
      }
    }
    return out;
  }

  function renderMath(el, latex, display) {
    if (typeof katex === "undefined") { el.textContent = latex; return; }
    try {
      katex.render(latex, el, { displayMode: !!display, throwOnError: false, trust: false, strict: "ignore" });
    } catch (e) { el.textContent = latex; }
  }

  function checkMath(latex, display) {
    if (typeof katex === "undefined") return null;
    try {
      katex.renderToString(latex, { displayMode: !!display, throwOnError: true, trust: false, strict: "ignore" });
      return null;
    } catch (e) {
      return String(e.message || e).replace(/^KaTeX parse error:\s*/, "");
    }
  }

  function validate(text) {
    var toks = tokenize(text || "", true);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.t === "math" || t.t === "dmath") {
        var msg = checkMath(t.v, t.t === "dmath");
        if (msg) return "The equation \"" + t.v.slice(0, 40) + "\" has a problem: " + msg;
      }
    }
    return null;
  }

  function tableRefs(text) {
    return tokenize(text || "", true).filter(function (t) { return t.t === "table"; }).map(function (t) { return t.v; });
  }
  function imageRefs(text) {
    return tokenize(text || "", true).filter(function (t) { return t.t === "img"; }).map(function (t) { return t.v; });
  }

  function buildTable(t, id, opts) {
    var wrap = document.createElement("div");
    wrap.className = "rh-tablewrap";
    if (!t || !Array.isArray(t.rows)) {
      wrap.className += " rh-missing";
      wrap.textContent = "[This table is missing]";
      return wrap;
    }
    var table = document.createElement("table");
    table.className = "rh-table";
    var body = document.createElement("tbody");
    t.rows.forEach(function (row, r) {
      var tr = document.createElement("tr");
      row.forEach(function (cell) {
        var c = document.createElement(t.header && r === 0 ? "th" : "td");
        render(c, String(cell || ""), [], { allowTables: false });
        tr.append(c);
      });
      body.append(tr);
    });
    table.append(body);
    wrap.append(table);
    if (opts.onEditTable) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "btn tiny"; b.textContent = "Edit table";
      b.addEventListener("click", function () { opts.onEditTable(id); });
      wrap.append(b);
    }
    return wrap;
  }

  // Safely draws text (with equations, tables and pictures) into an element. Never uses innerHTML on user text.
  function render(el, text, tables, opts) {
    opts = opts || {};
    var map = {};
    (tables || []).forEach(function (t) { if (t && t.id) map[t.id] = t; });
    var frag = document.createDocumentFragment();
    tokenize(text || "", opts.allowTables !== false).forEach(function (tok) {
      if (tok.t === "text") frag.append(document.createTextNode(tok.v));
      else if (tok.t === "math") {
        var s = document.createElement("span"); s.className = "rh-math";
        renderMath(s, tok.v, false); frag.append(s);
      } else if (tok.t === "dmath") {
        var d = document.createElement("div"); d.className = "rh-dmath";
        renderMath(d, tok.v, true); frag.append(d);
      } else if (tok.t === "img") {
        var im = document.createElement("img"); im.className = "rh-img";
        im.src = tok.v; im.alt = "Picture"; im.loading = "lazy"; frag.append(im);
      } else if (tok.t === "table") frag.append(buildTable(map[tok.v], tok.v, opts));
    });
    el.replaceChildren(frag);
  }

  window.Rich = { render: render, renderMath: renderMath, checkMath: checkMath, validate: validate, tokenize: tokenize, tableRefs: tableRefs, imageRefs: imageRefs };
})();
