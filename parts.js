/* Revision Hub - shared tools for multi-part questions: (a), (b), (i), (ii) */
(function () {
  var style = document.createElement("style");
  style.textContent = [
    ".rh-part{margin-top:14px}",
    ".rh-part .rh-part{margin-left:26px}",
    ".rh-prow{display:flex;gap:10px;align-items:flex-start}",
    ".rh-plabel{font-weight:700;min-width:28px}",
    ".rh-ptext{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word}",
    ".rh-pmarks{color:var(--muted,#667085);font-size:13px;font-weight:600;white-space:nowrap}",
    ".rh-pimg{display:block;max-width:100%;height:auto;margin:8px 0 0 38px;border-radius:8px;border:1px solid var(--line,#ccc);background:#fff}",
    ".rh-ans{border-left:3px solid var(--accent,#4f46e5);background:var(--accent-soft,#eef2ff);padding:8px 12px;border-radius:6px;margin:8px 0 0 38px;white-space:pre-wrap;word-break:break-word}",
    ".rh-ans.top{margin-left:0;margin-top:14px}",
    ".rh-anstitle{font-size:12px;font-weight:700;text-transform:uppercase;color:var(--accent,#4f46e5);margin-bottom:2px}",
    ".rh-noans{color:var(--muted,#667085);font-size:14px;margin-top:12px}",
    ".rh-toggle{margin:8px 0 0 38px}",
    ".rh-toggle.top{margin-left:0;margin-top:14px}",
    ".rh-showbtn{background:var(--accent-soft,#eef2ff);color:var(--accent,#4f46e5);border:0;border-radius:999px;padding:5px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}"
  ].join("\n");
  document.head.append(style);

  var ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
  function partLabel(depth, idx) {
    return depth === 0 ? String.fromCharCode(97 + idx) : (ROMAN[idx] || String(idx + 1));
  }

  // total marks: sub-parts count, and a part with sub-parts counts only its sub-parts
  function sumMarks(parts) {
    var total = 0;
    (parts || []).forEach(function (p) {
      if (p.parts && p.parts.length) total += sumMarks(p.parts);
      else total += Number(p.marks) || 0;
    });
    return total;
  }

  function imagesOf(parts) {
    var out = [];
    (parts || []).forEach(function (p) {
      if (p.image_url) out.push(p.image_url);
      out = out.concat(imagesOf(p.parts));
    });
    return out;
  }

  function hasText(v) { return v && String(v).trim(); }
  function hasAnswers(q) {
    if (hasText(q.model_answer) || hasText(q.marking_scheme) || hasText(q.explanation)) return true;
    return (q.parts || []).some(function (p) {
      return hasText(p.model_answer) || hasText(p.marking_scheme) ||
        (p.parts || []).some(function (c) { return hasText(c.model_answer) || hasText(c.marking_scheme); });
    });
  }

  function answerBlock(items, tables, top) {
    var shown = items.filter(function (x) { return hasText(x[1]); });
    if (!shown.length) return null;
    var frag = document.createDocumentFragment();
    shown.forEach(function (x) {
      var box = document.createElement("div");
      box.className = "rh-ans" + (top ? " top" : "");
      var title = document.createElement("div");
      title.className = "rh-anstitle";
      title.textContent = x[0];
      var body = document.createElement("div");
      Rich.render(body, x[1], tables);
      box.append(title, body);
      frag.append(box);
    });
    return frag;
  }

  // A button plus a hidden answer area. The answers are only drawn the first time they are opened.
  function makeToggle(reg, build, showLabel, hideLabel, top) {
    var wrap = document.createElement("div");
    wrap.className = "rh-toggle" + (top ? " top" : "");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rh-showbtn";
    btn.textContent = showLabel;
    btn.setAttribute("aria-expanded", "false");
    var area = document.createElement("div");
    area.style.display = "none";
    var drawn = false;
    var item = { on: false };
    item.set = function (on) {
      item.on = !!on;
      if (item.on && !drawn) {
        var content = build();
        if (content) area.append(content);
        drawn = true;
      }
      area.style.display = item.on ? "" : "none";
      btn.textContent = item.on ? hideLabel : showLabel;
      btn.setAttribute("aria-expanded", String(item.on));
    };
    btn.addEventListener("click", function () {
      item.set(!item.on);
      if (reg.onChange) reg.onChange();
    });
    wrap.append(btn, area);
    reg.items.push(item);
    return wrap;
  }

  function drawPart(p, depth, idx, tables, opts, reg) {
    var wrap = document.createElement("div");
    wrap.className = "rh-part";
    var row = document.createElement("div");
    row.className = "rh-prow";
    var lab = document.createElement("div");
    lab.className = "rh-plabel";
    lab.textContent = "(" + partLabel(depth, idx) + ")";
    var txt = document.createElement("div");
    txt.className = "rh-ptext";
    Rich.render(txt, p.text || "", tables);
    row.append(lab, txt);
    var hasKids = p.parts && p.parts.length;
    if (!hasKids && p.marks !== null && p.marks !== undefined && p.marks !== "") {
      var m = document.createElement("div");
      m.className = "rh-pmarks";
      m.textContent = "[" + p.marks + "]";
      row.append(m);
    }
    wrap.append(row);
    if (opts.safeImage && opts.safeImage(p.image_url)) {
      var img = document.createElement("img");
      img.className = "rh-pimg";
      img.src = p.image_url;
      img.alt = "Diagram for part (" + partLabel(depth, idx) + ")";
      img.loading = "lazy";
      wrap.append(img);
    }
    if (hasText(p.model_answer) || hasText(p.marking_scheme)) {
      wrap.append(makeToggle(reg, function () {
        return answerBlock([["Model answer", p.model_answer], ["Marking scheme", p.marking_scheme]], tables, false);
      }, "Show markscheme", "Hide markscheme", false));
    }
    (p.parts || []).forEach(function (c, i) { wrap.append(drawPart(c, 1, i, tables, opts, reg)); });
    return wrap;
  }

  // Draws the parts of an open-ended question. Every part (and sub-part) gets its own
  // "Show markscheme" button. Returns controls so a page can add "show all" / "hide all".
  function renderOpen(container, q, opts) {
    opts = opts || {};
    var tables = q.tables || [];
    container.replaceChildren();
    var reg = { items: [], onChange: opts.onChange };
    (q.parts || []).forEach(function (p, i) { container.append(drawPart(p, 0, i, tables, opts, reg)); });
    var qItems = [["Model answer", q.model_answer], ["Marking scheme", q.marking_scheme], ["Explanation", q.explanation]];
    if (qItems.some(function (x) { return hasText(x[1]); })) {
      container.append(makeToggle(reg, function () { return answerBlock(qItems, tables, true); },
        (q.parts && q.parts.length) ? "Show overall notes" : "Show markscheme",
        (q.parts && q.parts.length) ? "Hide overall notes" : "Hide markscheme", true));
    }
    var api = {
      count: reg.items.length,
      anyOn: function () { return reg.items.some(function (i) { return i.on; }); },
      allOn: function () { return reg.items.length > 0 && reg.items.every(function (i) { return i.on; }); },
      setAll: function (on) {
        reg.items.forEach(function (i) { i.set(on); });
        if (reg.onChange) reg.onChange();
      }
    };
    if (!reg.items.length) {
      var none = document.createElement("div");
      none.className = "rh-noans";
      none.textContent = "No markscheme has been added for this question yet.";
      container.append(none);
    }
    return api;
  }

  Object.assign(window.Rich, { partLabel: partLabel, sumMarks: sumMarks, imagesOf: imagesOf, renderOpen: renderOpen, hasAnswers: hasAnswers });
})();
