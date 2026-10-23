/* Revision Hub - reads exam-paper PDFs (text positions) and splits them into questions.
   Pure logic: it takes lists of positioned text pieces and returns structured questions.
   All coordinates are in PDF points measured from the TOP-LEFT of the page. */
(function (root) {
  "use strict";

  var ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
  var PUA = /[\uE000-\uF8FF\uFFFD]|\(cid:\d+\)/;

  /* ---------- small helpers ---------- */
  function median(a, dflt) {
    if (!a.length) return dflt;
    var b = a.slice().sort(function (x, y) { return x - y; });
    return b[Math.floor(b.length / 2)];
  }
  function bodySizeOf(items) {
    var w = {};
    items.forEach(function (it) {
      var k = (Math.round(it.size * 2) / 2).toFixed(1);
      w[k] = (w[k] || 0) + it.s.length;
    });
    var best = null, bv = -1;
    Object.keys(w).forEach(function (k) { if (w[k] > bv) { bv = w[k]; best = k; } });
    return best ? parseFloat(best) : 10;
  }
  function visLen(s) { return String(s).replace(/\s/g, "").length; }

  /* ---------- turn positioned text pieces into lines ---------- */
  function renderItem(it, s) {
    if (!it.scripts.length) return s;
    var m = /(\S+)(\s*)$/.exec(s);
    var word = m ? m[1] : s;
    var trailing = m ? m[2] : "";
    var head = s.slice(0, s.length - word.length - trailing.length);
    if (!/^[A-Za-z0-9()\[\]\u00b0\u00b5\u03bc\u03a9\u03c0\u03b8\u03bb\u03c9\u0394\u2206\u03b1-\u03c9.\-+\u00d7\u00b7,]*$/.test(word)) {
      return s + it.scripts.map(function (sc) { return (sc.kind === "sup" ? "^" : "_") + "(" + sc.s + ")"; }).join("");
    }
    var math = "$" + word + it.scripts.map(function (sc) {
      return (sc.kind === "sup" ? "^" : "_") + "{" + sc.s.replace(/[{}$\\]/g, "") + "}";
    }).join("") + "$";
    return head + math + trailing;
  }

  function makeLines(page) {
    var items = [];
    page.items.forEach(function (it) {
      if (!it.s || it.s.replace(/\s+/g, "") === "") return;
      items.push({ s: it.s, x: it.x, y: it.y, w: it.w, size: it.size || 10, scripts: [], endX: undefined });
    });
    var body = bodySizeOf(items);
    var bases = [], smalls = [];
    items.forEach(function (it) {
      if (it.size < 0.86 * body && it.s.trim().length <= 8) smalls.push(it); else bases.push(it);
    });
    smalls.sort(function (a, b) { return a.x - b.x; });
    smalls.forEach(function (sm) {
      var best = null, bestGap = 1e9;
      bases.forEach(function (b) {
        var end = b.endX !== undefined ? b.endX : b.x + b.w;
        var gap = sm.x - end, dy = sm.y - b.y;
        if (gap > -2.5 && gap < 3.5 && Math.abs(dy) < 0.8 * body && Math.abs(gap) < bestGap) { best = b; bestGap = Math.abs(gap); }
      });
      if (best) {
        var dy2 = sm.y - best.y;
        var kind = dy2 < -0.18 * body ? "sup" : (dy2 > 0.12 * body ? "sub" : null);
        if (kind) {
          var last = best.scripts[best.scripts.length - 1];
          if (last && last.kind === kind) last.s += sm.s.trim(); else best.scripts.push({ kind: kind, s: sm.s.trim() });
          best.endX = sm.x + sm.w;
          return;
        }
      }
      sm.stray = true;
      bases.push(sm);
    });

    bases.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var tol = Math.max(3.2, 0.32 * body);
    var groups = [];
    bases.forEach(function (it) {
      var G = groups.length ? groups[groups.length - 1] : null;
      if (G && Math.abs(it.y - G.y) <= tol) { G.items.push(it); G.sum += it.y; G.n++; G.y = G.sum / G.n; }
      else groups.push({ items: [it], sum: it.y, n: 1, y: it.y });
    });

    var lines = groups.map(function (G) {
      G.items.sort(function (a, b) { return a.x - b.x; });
      var text = "", prevEnd = null, prevHadScript = false, maxSize = 0;
      G.items.forEach(function (it) {
        var s = it.s.replace(/\s+/g, " ").replace(/\$/g, "\\$");
        var piece = renderItem(it, s);
        if (prevEnd !== null) {
          var gap = it.x - prevEnd;
          var thr = prevHadScript ? 0.08 * body : 0.18 * body;
          if (gap > thr && !/\s$/.test(text) && !/^\s/.test(piece)) text += " ";
        }
        text += piece;
        prevEnd = it.endX !== undefined ? it.endX : it.x + it.w;
        prevHadScript = it.scripts.length > 0;
        if (it.size > maxSize) maxSize = it.size;
      });
      var first = G.items[0], lastIt = G.items[G.items.length - 1];
      text = text.replace(/\s+/g, " ").trim();
      return {
        y: G.y, x0: first.x, xEnd: lastIt.endX !== undefined ? lastIt.endX : lastIt.x + lastIt.w,
        size: Math.min(maxSize || body, body * 1.2), text: text, vis: visLen(text), items: G.items,
        dots: /^(?:\.\s*){6,}$/.test(text), garbled: PUA.test(text) || G.items.some(function (i) { return i.stray; }), frag: null, hasFrag: false, deferTo: null
      };
    });
    return { lines: lines, body: body };
  }

  function markFragments(lines) {
    lines.forEach(function (F) {
      if (F.dots || F.vis > 6) return;
      var best = null, bd = 1e9;
      lines.forEach(function (M) {
        if (M === F || M.dots || M.vis <= 6) return;
        var dy = F.y - M.y;
        if (Math.abs(dy) > 3.6 && Math.abs(dy) <= 11.5 && F.x0 >= M.x0 - 2 && F.xEnd <= M.xEnd + 3 && Math.abs(dy) < bd) { best = M; bd = Math.abs(dy); }
      });
      if (best) { F.frag = best; best.hasFrag = true; best.garbled = true; F.garbled = true; if (best.y > F.y) F.deferTo = best; }
    });
  }

  function isFurniture(L, W, H) {
    var t = L.text;
    if (L.y < 0.11 * H && /^[\u2013\u2212\-\d\sM]+$/.test(t)) return true;
    if (/^\d{4}\s*[\u2013\u2212\-]\s*\d{4}M?$/.test(t)) return true;
    if (/^\(This question continues on the following page\)$/i.test(t)) return true;
    if (/^\(Question \d+ continued\)$/i.test(t)) return true;
    if (/^Turn over$/i.test(t)) return true;
    if (/^\d{2}EP\d{2}$/.test(t)) return true;
    if (/^Please do not write on this page\.?$/i.test(t)) return true;
    if (/^Answers written on this page( will not be marked\.?)?$/i.test(t)) return true;
    if (/^will not be marked\.?$/i.test(t)) return true;
    return false;
  }

  function loadPages(pages) {
    var all = [], meta = [];
    pages.forEach(function (pg, pi) {
      var r = makeLines(pg);
      var lines = r.lines;
      markFragments(lines);
      var footerTop = 0.94 * pg.height;
      lines.forEach(function (L) {
        L.page = pi; L.W = pg.width; L.H = pg.height;
        L.furniture = isFurniture(L, pg.width, pg.height);
        if (L.furniture && L.y > 0.6 * pg.height) footerTop = Math.min(footerTop, L.y - L.size - 6);
      });
      meta.push({ width: pg.width, height: pg.height, footerTop: footerTop, body: r.body });
      lines.forEach(function (L) { all.push(L); });
    });
    return { lines: all, meta: meta };
  }

  /* attach "stacked fragment" lines that sit just above their main line to that main line */
  function groupDeferred(lines) {
    var map = new Map();
    lines.forEach(function (L) { if (L.deferTo) { if (!map.has(L.deferTo)) map.set(L.deferTo, []); map.get(L.deferTo).push(L); } });
    return map;
  }

  /* ---------- analyse the lines of one element (question / part / sub-part) ---------- */
  function lineTop(L) { return L.y - 0.85 * L.size; }
  function lineBottom(L) { return L.y + 0.32 * L.size; }

  function analyse(entries, defTextX, W, limitFor, meta) {
    // entries: [{L, text, isLabel}] in document order (fragments included)
    var kinds = entries.map(function (e) {
      var L = e.L;
      if (L.garbled || L.frag) return "pic";
      if (!e.isLabel && L.x0 - defTextX > 0.09 * W) return "pic";
      return "text";
    });
    // a text line squeezed between two picture lines (e.g. the middle of a stacked fraction) joins the picture
    for (var si = 1; si < entries.length - 1; si++) {
      if (kinds[si] === "text" && kinds[si - 1] === "pic" && kinds[si + 1] === "pic" && !entries[si].isLabel &&
          entries[si].L.page === entries[si - 1].L.page && entries[si].L.page === entries[si + 1].L.page &&
          entries[si].L.y - entries[si - 1].L.y < 13 && entries[si + 1].L.y - entries[si].L.y < 13) kinds[si] = "pic";
    }
    // typical line spacing
    var gaps = [];
    for (var i = 1; i < entries.length; i++) {
      if (kinds[i] === "text" && kinds[i - 1] === "text" && entries[i].L.page === entries[i - 1].L.page) {
        var g = entries[i].L.y - entries[i - 1].L.y;
        if (g >= 9 && g <= 20) gaps.push(g);
      }
    }
    var leading = median(gaps, 13.2);

    // sequence with gap markers
    var seq = [];
    entries.forEach(function (e, idx) {
      if (idx > 0 && kinds[idx] === "text" && kinds[idx - 1] === "text" && e.L.page === entries[idx - 1].L.page) {
        var prev = entries[idx - 1].L;
        if (e.L.y - prev.y > 3.0 * leading) seq.push({ gap: true, page: e.L.page });
      }
      seq.push({ e: e, kind: kinds[idx], page: e.L.page });
    });

    var regions = [];
    var i2 = 0;
    while (i2 < seq.length) {
      if (seq[i2].kind === "text") { i2++; continue; }
      var j = i2, pg = seq[i2].page;
      while (j + 1 < seq.length && seq[j + 1].kind !== "text" && seq[j + 1].page === pg) j++;
      var prevT = null, nextT = null, k;
      for (k = i2 - 1; k >= 0 && seq[k].page === pg; k--) { if (seq[k].kind === "text") { prevT = seq[k].e.L; break; } }
      for (k = j + 1; k < seq.length && seq[k].page === pg; k++) { if (seq[k].kind === "text") { nextT = seq[k].e.L; break; } }
      var clusterLines = [];
      for (k = i2; k <= j; k++) if (seq[k].e) clusterLines.push(seq[k].e.L);
      var y0, y1;
      if (prevT) y0 = lineBottom(prevT) + 1;
      else if (clusterLines.length) y0 = Math.min.apply(null, clusterLines.map(lineTop)) - 4;
      else y0 = 0;
      if (nextT) y1 = lineTop(nextT) - 1;
      else {
        var lastBottom = clusterLines.length ? Math.max.apply(null, clusterLines.map(lineBottom)) : y0 + 30;
        var lim = limitFor(pg);
        y1 = lim !== null && lim !== undefined ? Math.min(lim, lastBottom + 30) : lastBottom + 30;
        if (y1 < lastBottom + 3) y1 = lastBottom + 3;
      }
      if (y1 - y0 > 6) regions.push({ page: pg, x0: Math.max(2, defTextX - 3), x1: 0.9 * W, y0: Math.max(0, y0), y1: y1 });
      i2 = j + 1;
    }

    // text from the plain lines
    var out = "", prevL = null;
    seq.forEach(function (s2) {
      if (!s2.e || s2.kind !== "text") { if (s2.gap || s2.kind === "pic") prevL = null; return; }
      var t = s2.e.text;
      if (!t) return;
      if (out) out += prevL ? ((s2.e.L.y - prevL.y) <= 1.65 * leading && s2.e.L.page === prevL.page ? " " : "\n") : "\n";
      out += t;
      prevL = s2.e.L;
    });
    // everything, for the "use text instead of the picture" fallback
    var raw = "", pr = null;
    entries.forEach(function (e) {
      if (!e.text) return;
      if (raw) raw += pr && (e.L.y - pr.y) <= 1.65 * leading && e.L.page === pr.page ? " " : "\n";
      raw += e.text;
      pr = e.L;
    });
    return { text: out, rawText: raw, regions: regions };
  }

  function nextRoman(cur) { return cur ? ROMAN[ROMAN.indexOf(cur) + 1] || null : "i"; }
  function nextLetter(cur) { return cur ? String.fromCharCode(cur.charCodeAt(0) + 1) : "a"; }

  /* ---------- paper with open-ended questions (Paper 1B / 2 style) ---------- */
  function parseOpen(pages) {
    var data = loadPages(pages), lines = data.lines, meta = data.meta;
    var deferred = groupDeferred(lines);
    var questions = [], q = null, cur = null, expectQ = 1;
    var flat = [], carry = [];

    function newElem(kind, label, L) {
      var el = { kind: kind, label: label, entries: [], marks: null, children: [], answerTop: null, startPage: L.page, startY: L.y, size: L.size };
      flat.push(el);
      return el;
    }
    function add(el, L, text, isLabel) {
      var mm = /\s*\[(\d{1,2})\]\s*$/.exec(text);
      if (mm && L.xEnd > 0.8 * L.W) { el.marks = Number(mm[1]); text = text.slice(0, mm.index); }
      el.entries.push({ L: L, text: text.trim(), isLabel: !!isLabel });
      (deferred.get(L) || []).forEach(function (F) { el.entries.unshift({ L: F, text: F.text, isLabel: false }); });
    }
    function flushCarry(el, atEnd) {
      if (!carry.length) return;
      if (atEnd) { carry.forEach(function (c) { el.entries.push(c); }); }
      else { el.entries = carry.concat(el.entries); }
      carry = [];
    }
    function startElem(el) { flushCarry(el, false); }

    lines.forEach(function (L) {
      if (L.furniture || L.deferTo) return;
      var W = L.W, t = L.text, m;
      if (L.dots) { if (cur && !cur.answerTop) cur.answerTop = { page: L.page, y: L.y - 22 }; return; }

      if (L.x0 < 0.12 * W && (m = /^(\d{1,2})\.\s*(.*)$/.exec(t)) && Number(m[1]) === expectQ) {
        if (cur) flushCarry(cur, true);
        q = { number: expectQ, intro: newElem("intro", null, L), parts: [], warnings: [] };
        questions.push(q);
        expectQ++;
        cur = q.intro;
        add(cur, L, m[2], true);
        cur.defX = 0.119 * W;
        return;
      }
      if (!q) return;

      if (L.x0 >= 0.09 * W && L.x0 <= 0.15 * W && (m = /^\(([a-z])\)\s*(.*)$/.exec(t))) {
        var lastPart = q.parts.length ? q.parts[q.parts.length - 1].label : null;
        if (m[1] === nextLetter(lastPart)) {
          var part = newElem("part", m[1], L);
          part.defX = 0.1667 * W;
          q.parts.push(part);
          cur = part;
          startElem(cur);
          var rest = m[2], m2 = /^\(([ivx]{1,5})\)\s*(.*)$/.exec(rest);
          if (m2 && m2[1] === "i") {
            var sub = newElem("sub", "i", L);
            sub.defX = 0.2155 * W;
            part.children.push(sub);
            cur = sub;
            startElem(cur);
            add(cur, L, m2[2], true);
          } else add(cur, L, rest, true);
          return;
        }
      }
      if (L.x0 > 0.14 * W && L.x0 <= 0.21 * W && (m = /^\(([ivx]{1,5})\)\s*(.*)$/.exec(t)) && q.parts.length) {
        var pp = q.parts[q.parts.length - 1];
        var lastSub = pp.children.length ? pp.children[pp.children.length - 1].label : null;
        if (m[1] === nextRoman(lastSub)) {
          var sub2 = newElem("sub", m[1], L);
          sub2.defX = 0.2155 * W;
          pp.children.push(sub2);
          cur = sub2;
          startElem(cur);
          add(cur, L, m[2], true);
          return;
        }
      }
      if (cur.answerTop) {
        carry.push({ L: L, text: t, isLabel: false });
        (deferred.get(L) || []).forEach(function (F) { carry.unshift({ L: F, text: F.text, isLabel: false }); });
      } else add(cur, L, t, false);
    });
    if (cur) flushCarry(cur, true);

    // finish every element
    flat.forEach(function (el, idx) {
      var next = flat[idx + 1] || null;
      var W = meta[el.startPage].width;
      var res = analyse(el.entries, el.defX || 0.119 * W, W, function (pg) {
        if (el.answerTop && el.answerTop.page === pg) return el.answerTop.y;
        if (next && next.startPage === pg) return next.startY - 0.9 * next.size - 2;
        return meta[pg].footerTop;
      }, meta);
      el.text = res.text; el.rawText = res.rawText; el.regions = res.regions;
      el.hasPicture = res.regions.length > 0;
    });
    questions.forEach(function (qq) {
      var all = [qq.intro];
      qq.parts.forEach(function (p) { all.push(p); p.children.forEach(function (c) { all.push(c); }); });
      qq.elements = all;
      if (!qq.parts.length && qq.intro.marks == null) qq.warnings.push("No marks found for this question.");
    });
    return { questions: questions, meta: meta };
  }

  /* ---------- paper with multiple-choice questions (Paper 1A style) ---------- */
  function optionSafe(text, nLines) {
    if (nLines !== 1) return false;
    if (PUA.test(text) || /[\^_]\{|\^\(|_\(/.test(text)) return false;
    var words = (text.match(/[A-Za-z]{3,}/g) || []).length;
    return words >= 2 || text.length >= 25;
  }

  function parseMcq(pages) {
    var data = loadPages(pages), lines = data.lines, meta = data.meta;
    var deferred = groupDeferred(lines);
    var raw = [], q = null, expect = 1;
    lines.forEach(function (L) {
      if (L.furniture || L.deferTo) return;
      var m;
      if (L.x0 < 0.12 * L.W && (m = /^(\d{1,2})\.\s*(.*)$/.exec(L.text)) && Number(m[1]) === expect) {
        q = { number: expect, lines: [], start: L };
        raw.push(q);
        expect++;
        q.lines.push({ L: L, text: m[2], isLabel: true });
        (deferred.get(L) || []).forEach(function (F) { q.lines.unshift({ L: F, text: F.text, isLabel: false }); });
        return;
      }
      if (!q || L.dots) return;
      q.lines.push({ L: L, text: L.text, isLabel: false });
      (deferred.get(L) || []).forEach(function (F) { q.lines.unshift({ L: F, text: F.text, isLabel: false }); });
    });

    var questions = raw.map(function (rq, qi) {
      var nextStart = raw[qi + 1] ? raw[qi + 1].start : null;
      var pg0 = rq.start.page, W = rq.start.W;
      var ents = rq.lines.slice().sort(function (a, b) { return a.L.page - b.L.page || a.L.y - b.L.y; });
      // find option labels A, B, C, D in order
      var labels = [], want = "A";
      ents.forEach(function (e) {
        if (!want) return;
        var m = /^([A-D])\.(?:\s|$)/.exec(e.L.text);
        if (m && m[1] === want && e.L.x0 >= 0.10 * W && e.L.x0 <= 0.145 * W && !e.isLabel) {
          labels.push(e); want = want === "D" ? null : String.fromCharCode(want.charCodeAt(0) + 1);
        }
      });
      var warnings = [];
      var stemEnts, options = [];
      var limitBottom = function (pg) {
        if (nextStart && nextStart.page === pg) return nextStart.y - 0.9 * nextStart.size - 2;
        return meta[pg].footerTop;
      };
      if (labels.length === 4) {
        var ys = labels.map(function (e) { return e.L.y; });
        var spacing = Math.max(18, Math.min(ys[1] - ys[0], 60));
        var t0 = ys[0] - Math.min(16, 0.4 * spacing);
        var bounds = [t0, (ys[0] + ys[1]) / 2, (ys[1] + ys[2]) / 2, (ys[2] + ys[3]) / 2];
        var lastPage = labels[3].L.page;
        var endY = limitBottom(lastPage);
        stemEnts = ents.filter(function (e) { return e.L.page < labels[0].L.page || (e.L.page === labels[0].L.page && e.L.y < t0); });
        for (var k = 0; k < 4; k++) {
          var lo = bounds[k], hi = k < 3 ? bounds[k + 1] : Infinity;
          var own = ents.filter(function (e) {
            return e.L.page === labels[k].L.page && e.L.y >= lo && e.L.y < hi && e.L.y >= t0 - 0.01 && stemEnts.indexOf(e) === -1;
          });
          var texts = own.map(function (e) {
            var t = e.text;
            if (e === labels[k]) t = t.replace(/^[A-D]\.\s*/, "");
            return t;
          }).filter(Boolean);
          var top = k === 0 ? t0 : bounds[k];
          var bot = k < 3 ? bounds[k + 1] : Math.min(endY, labels[3].L.y + Math.max(24, spacing * 0.5));
          options.push({
            label: String.fromCharCode(65 + k), text: texts.join(" "), nLines: own.length,
            garbled: own.some(function (e) { return e.L.garbled; }),
            region: { page: labels[k].L.page, x0: labels[k].L.x0 + 11, x1: 0.9 * W, y0: top, y1: bot }
          });
        }
      } else {
        stemEnts = ents;
        warnings.push(labels.length === 0 ? "The answer choices were not found as text (they may be in the picture)." : "Only " + labels.length + " of the 4 answer choices were found.");
      }
      var stem = analyse(stemEnts, 0.119 * W, W, function (pg) {
        if (labels.length === 4 && labels[0].L.page === pg) return labels[0].L.y - Math.min(16, 0.4 * Math.max(18, Math.min(labels[1].L.y - labels[0].L.y, 60))) - 2;
        return limitBottom(pg);
      }, meta);
      var allSafe = options.length === 4 && options.every(function (o) { return !o.garbled && optionSafe(o.text, o.nLines); });
      var mode = options.length === 4 ? (allSafe ? "text" : "picture") : "placeholder";
      return { number: rq.number, stem: stem, options: options, optionsMode: mode, warnings: warnings, startPage: pg0 };
    });
    return { questions: questions, meta: meta };
  }

  /* ---------- answer key for multiple-choice papers ---------- */
  function parseMcqKey(pages) {
    var best = null;
    pages.forEach(function (pg) {
      var items = pg.items.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
      var text = items.map(function (it) { return it.s; }).join(" ").replace(/\s+/g, " ");
      var re = /(?:^|[^\d])(\d{1,2})\.\s*([A-D])(?![A-Za-z])/g, m, found = {}, n = 0;
      while ((m = re.exec(text))) { var no = Number(m[1]); if (no >= 1 && no <= 100 && !found[no]) { found[no] = m[2]; n++; } }
      if (!best || n > best.n) best = { n: n, found: found };
    });
    return best && best.n >= 5 ? best.found : {};
  }

  /* ---------- markscheme for open-ended papers ---------- */
  function parseMarkschemeOpen(pages) {
    var rows = {}, order = [];
    pages.forEach(function (pg, pi) {
      var W = pg.width, H = pg.height;
      var items = pg.items.filter(function (it) { return it.s && it.s.trim() !== ""; });
      items = items.filter(function (it) { return !(it.y < 0.11 * H && /^[\u2013\u2212\-\d\sM]+$/.test(it.s.trim())); });
      var starts = [];
      items.forEach(function (it) {
        var s = it.s.trim();
        if (/^\d{1,2}$/.test(s) && it.x >= 0.04 * W && it.x <= 0.095 * W) starts.push(it);
      });
      starts.sort(function (a, b) { return a.y - b.y; });
      var rowsHere = starts.map(function (st) {
        var sameLine = items.filter(function (it) { return Math.abs(it.y - st.y) <= 3 && it.x < 0.16 * W; });
        var part = null, sub = null;
        sameLine.forEach(function (it) {
          var s = it.s.trim();
          if (/^[a-z]$/.test(s) && it.x >= 0.085 * W && it.x <= 0.118 * W) part = s;
          else if (/^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(s) && it.x > 0.118 * W && it.x < 0.16 * W) sub = s;
        });
        var key = String(Number(st.s.trim())) + (part ? "." + part : "") + (sub ? "." + sub : "");
        return { key: key, q: Number(st.s.trim()), part: part, sub: sub, page: pi, y: st.y };
      });
      rowsHere.forEach(function (r, idx) {
        var top = r.y - 9;
        var bottom = idx + 1 < rowsHere.length ? rowsHere[idx + 1].y - 9 : null;
        var inRow = items.filter(function (it) { return it.y >= top && (bottom === null || it.y < bottom); });
        var ansItems = inRow.filter(function (it) { return it.x >= 0.155 * W && it.x < 0.644 * W; });
        var noteItems = inRow.filter(function (it) { return it.x >= 0.644 * W && it.x < 0.89 * W; });
        var totItems = inRow.filter(function (it) { return it.x >= 0.89 * W; });
        var tot = null, totMax = false;
        var tt = totItems.map(function (it) { return it.s; }).join(" ");
        var mt = /\[(\d+)(\s*max)?\s*\]?/.exec(tt);
        if (mt) { tot = Number(mt[1]); totMax = !!mt[2]; }
        function toText(arr) {
          if (!arr.length) return { text: "", lines: [] };
          var pgLike = { items: arr, width: W, height: H };
          var ls = makeLines(pgLike).lines;
          markFragments(ls);
          return { text: ls.map(function (l) { return l.text; }).join("\n"), lines: ls };
        }
        var A = toText(ansItems), N = toText(noteItems);
        var tickOnly = A.lines.filter(function (l) { return /^[\u2713\u2714\s]+$/.test(l.text); }).length;
        var yTop = top, yBottom;
        if (bottom !== null) yBottom = bottom;
        else {
          var maxY = inRow.length ? Math.max.apply(null, inRow.map(function (it) { return it.y; })) : r.y;
          (pg.images || []).forEach(function (im) { if (im.y0 >= top - 4 && im.y1 > maxY) maxY = im.y1; });
          yBottom = Math.min(H - 20, maxY + 16);
        }
        var hasImage = (pg.images || []).some(function (im) {
          var cy = (im.y0 + im.y1) / 2, cx = (im.x0 + im.x1) / 2;
          return cy >= yTop && cy < yBottom && cx >= 0.155 * W && cx < 0.89 * W;
        });
        var cleaned = A.text.replace(/[\u2713\u2714]/g, "").replace(/\s+/g, " ").trim();
        r.answerText = A.text; r.notesText = N.text; r.total = tot; r.totalMax = totMax;
        r.tickOnlyLines = tickOnly; r.hasImage = hasImage;
        r.thin = cleaned.length < 8;
        var mathy = A.lines.some(function (l) { return l.garbled || /^=/.test(l.text); }) ||
          /[\u{1D400}-\u{1D7FF}]/u.test(A.text) || /[\^_]\(/.test(A.text);
        r.mathy = mathy;
        r.needsPicture = hasImage || tickOnly > 0 || r.thin || mathy;
        r.region = { page: pi, x0: 0.157 * W, x1: 0.89 * W, y0: yTop, y1: yBottom };
        if (!rows[r.key]) order.push(r.key);
        rows[r.key] = r;
      });
    });
    return { rows: rows, order: order };
  }

  /* ---------- pasted list: "1-3 A.1" style topic assignments ---------- */
  function findSubtopic(spec, subject, topics, subtopics) {
    var s = String(spec).trim().replace(/\s+/g, " ");
    var low = s.toLowerCase();
    var mine = topics.filter(function (t) { return t.subject_id === subject.id; });
    var subs = subtopics.filter(function (x) { return mine.some(function (t) { return t.id === x.topic_id; }); });
    var slash = /^(.+?)\s*[\/>]\s*(\S+)$/.exec(s);
    if (slash) {
      var tl = slash[1].toLowerCase();
      var tcands = mine.filter(function (t) { return t.name.toLowerCase() === tl || t.name.split(" - ")[0].toLowerCase() === tl; });
      if (tcands.length === 1) {
        var c2 = subs.filter(function (x) { return x.topic_id === tcands[0].id && (x.name.toLowerCase() === slash[2].toLowerCase() || x.name.split(" ")[0].toLowerCase() === slash[2].toLowerCase()); });
        if (c2.length === 1) return { sub: c2[0] };
      }
    }
    var exact = subs.filter(function (x) { return x.name.toLowerCase() === low; });
    if (exact.length === 1) return { sub: exact[0] };
    var byCode = subs.filter(function (x) { return x.name.split(" ")[0].toLowerCase() === low.split(" ")[0]; });
    if (byCode.length === 1) return { sub: byCode[0] };
    if (byCode.length > 1) return { error: "\"" + spec + "\" matches more than one subtopic. Write it as Topic/Code, for example Structure 1/1.4." };
    return { error: "\"" + spec + "\" was not found." };
  }

  function parseTopicList(text, subject, topics, subtopics) {
    var out = [], errors = [];
    String(text || "").split(/\r?\n/).forEach(function (line, i) {
      var ln = line.trim();
      if (!ln) return;
      var m = /^(?:Q(?:uestions?)?\.?\s*)?(\d{1,3})(?:\s*(?:-|\u2013|\u2014|to)\s*(\d{1,3}))?\s*[:,\t=]?\s+(.+)$/i.exec(ln);
      if (!m) { errors.push("Line " + (i + 1) + " was not understood: " + ln); return; }
      var from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
      if (to < from) { errors.push("Line " + (i + 1) + ": the range goes backwards."); return; }
      var f = findSubtopic(m[3], subject, topics, subtopics);
      if (f.error) { errors.push("Line " + (i + 1) + ": " + f.error); return; }
      out.push({ from: from, to: to, sub: f.sub });
    });
    return { assignments: out, errors: errors };
  }

  var api = {
    makeLines: makeLines, parseOpen: parseOpen, parseMcq: parseMcq, parseMcqKey: parseMcqKey,
    parseMarkschemeOpen: parseMarkschemeOpen, parseTopicList: parseTopicList, findSubtopic: findSubtopic
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PdfParse = api;
})(typeof window !== "undefined" ? window : this);
