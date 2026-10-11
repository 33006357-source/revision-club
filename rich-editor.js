/* Revision Hub - admin tools for editing equations, formulas and tables */
(function () {
  var style = document.createElement("style");
  style.textContent = [
    ".rhm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow:auto}",
    ".rhm-panel{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:14px;padding:18px;width:100%;max-width:700px;margin:auto}",
    ".rhm-panel h2{margin:0 0 10px;font-size:18px}",
    ".rhm-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}",
    ".rhm-preview{border:1px dashed var(--line);border-radius:8px;padding:10px;margin-top:10px;min-height:44px;overflow-x:auto}",
    ".rhm-grid{border-collapse:collapse}",
    ".rhm-grid td{padding:3px}",
    ".rhm-grid input[type=text]{min-width:120px}",
    "math-field{display:block;font-size:22px;width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--bg);color:var(--text);margin-bottom:10px}",
    ".rf-bar{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}",
    ".rf-preview{border:1px dashed var(--line);border-radius:8px;padding:8px 10px;margin-top:6px;min-height:36px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}",
    ".rf-preview.empty{color:var(--muted);font-size:13px}"
  ].join("\n");
  document.head.append(style);

  function el(tag, props) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "class") e.className = props[k]; else e.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(function (kid) {
        if (kid === null || kid === undefined || kid === false) return;
        e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
      });
    }
    return e;
  }
  function btn(label, cls) { return el("button", { type: "button", class: cls || "btn tiny" }, label); }

  var zLevel = 0;
  function openModal(title, bodyEl, buttons) {
    zLevel++;
    var overlay = el("div", { class: "rhm-overlay", style: "z-index:" + (50 + zLevel * 5) });
    var panel = el("div", { class: "rhm-panel" }, el("h2", {}, title), bodyEl, el("div", { class: "rhm-actions" }, buttons));
    overlay.append(panel);
    document.body.append(overlay);
    return { close: function () { overlay.remove(); zLevel--; } };
  }

  /* ---------- equation / chemical formula dialog ---------- */
  function openMathDialog(o) {
    var initial = (o.latex || "").trim();
    var chemMatch = initial.match(/^\\ce\{([\s\S]*)\}$/);
    var mode = chemMatch ? "chem" : ((!initial && o.mode) ? o.mode : "math");

    var modeSel = el("select", {}, el("option", { value: "math" }, "Equation (visual editor)"), el("option", { value: "chem" }, "Chemical formula or reaction"));
    modeSel.value = mode;
    var dispChk = el("input", { type: "checkbox" });
    dispChk.checked = !!o.display;
    var preview = el("div", { class: "rhm-preview" });
    var err = el("div", { class: "error", style: "display:none" });

    // equation part
    var latexIn = el("input", { type: "text", spellcheck: "false", placeholder: "The LaTeX code appears here. You can also type or paste it." });
    latexIn.value = chemMatch ? "" : initial;
    var mf = null;
    var mathPart = el("div", {});
    if (window.customElements && customElements.get("math-field")) {
      mf = document.createElement("math-field");
      mathPart.append(mf);
    } else {
      mathPart.append(el("p", { class: "muted small" }, "The visual equation box didn't load, so type the LaTeX code in the box below instead."));
    }
    mathPart.append(el("label", { class: "field" }, el("span", { class: "lbl" }, "LaTeX code (advanced)"), latexIn));

    // chemistry part
    var chemIn = el("input", { type: "text", spellcheck: "false", placeholder: "e.g.  H2SO4   or   SO4^2-   or   2H2 + O2 -> 2H2O" });
    chemIn.value = chemMatch ? chemMatch[1] : "";
    var chemPart = el("div", {}, el("label", { class: "field" },
      el("span", { class: "lbl" }, "Formula or reaction"), chemIn,
      el("span", { class: "hint" }, "Type formulas normally. Numbers become subscripts automatically (H2O). Use ^ for charges (Fe^3+ or SO4^2-), -> for arrows and <=> for equilibrium.")));

    function current() { return mode === "chem" ? "\\ce{" + chemIn.value.trim() + "}" : latexIn.value.trim(); }
    function isEmpty() { return mode === "chem" ? !chemIn.value.trim() : !latexIn.value.trim(); }
    function update() {
      err.style.display = "none";
      if (isEmpty()) { preview.textContent = "Preview appears here."; return; }
      Rich.renderMath(preview, current(), dispChk.checked);
    }
    function showMode() {
      mathPart.style.display = mode === "math" ? "" : "none";
      chemPart.style.display = mode === "chem" ? "" : "none";
      update();
    }

    var syncing = false;
    if (mf) {
      mf.addEventListener("input", function () {
        if (syncing) return;
        syncing = true; latexIn.value = mf.value; syncing = false; update();
      });
    }
    latexIn.addEventListener("input", function () {
      if (mf) { syncing = true; try { mf.value = latexIn.value; } catch (e) {} syncing = false; }
      update();
    });
    chemIn.addEventListener("input", update);
    dispChk.addEventListener("change", update);
    modeSel.addEventListener("change", function () { mode = modeSel.value; showMode(); });

    var dispLabel = el("label", { class: "small", style: "display:flex;gap:6px;align-items:center;margin-top:8px" }, dispChk, "Show on its own line, centred (display style)");
    if (o.allowDisplay === false) dispLabel.style.display = "none";

    var body = el("div", {},
      el("label", { class: "field" }, el("span", { class: "lbl" }, "Type"), modeSel),
      mathPart, chemPart, dispLabel,
      el("span", { class: "lbl", style: "margin-top:10px" }, "Preview (this is how students will see it)"), preview, err);

    var okBtn = btn(o.latex ? "Update" : "Insert", "btn primary");
    var cancelBtn = btn("Cancel", "btn");
    var m = openModal(o.latex ? "Edit equation" : "Insert equation or formula", body, [okBtn, cancelBtn]);

    okBtn.addEventListener("click", function () {
      var latex = current();
      var problem = null;
      if (isEmpty()) problem = "Please enter something first.";
      else if (latex.indexOf("$") !== -1) problem = "Please remove any $ signs. They are added for you.";
      else problem = Rich.checkMath(latex, dispChk.checked);
      if (problem) { err.textContent = problem; err.style.display = ""; return; }
      o.onDone(latex, o.allowDisplay === false ? false : dispChk.checked);
      m.close();
    });
    cancelBtn.addEventListener("click", function () { m.close(); });

    setTimeout(function () {
      if (mf) { syncing = true; try { mf.value = latexIn.value; } catch (e) {} syncing = false; mf.focus(); }
    }, 0);
    showMode();
  }

  // finds the equation the cursor is inside (if any)
  function mathAt(box) {
    var pos = box.selectionStart;
    var toks = Rich.tokenize(box.value, true);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if ((t.t === "math" || t.t === "dmath") && pos > t.s && pos < t.e) return t;
    }
    return null;
  }

  function editMath(box, mode, allowDisplay) {
    var tok = mathAt(box);
    openMathDialog({
      latex: tok ? tok.v : "", display: tok ? tok.t === "dmath" : false, mode: mode, allowDisplay: allowDisplay,
      onDone: function (latex, display) {
        var wrapped = display ? "$$" + latex + "$$" : "$" + latex + "$";
        if (tok) box.setRangeText(wrapped, tok.s, tok.e, "end");
        else box.setRangeText(wrapped, box.selectionStart, box.selectionEnd, "end");
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.focus();
      }
    });
  }

  /* ---------- table dialog ---------- */
  function openTableDialog(t, onSave, onDelete) {
    var rows = t.rows.map(function (r) { return r.slice(); });
    var header = !!t.header;
    var lastInput = null;
    var wrap = el("div", { style: "overflow-x:auto" });
    var err = el("div", { class: "error", style: "display:none" });

    var headChk = el("input", { type: "checkbox" });
    headChk.checked = header;
    headChk.addEventListener("change", function () { header = headChk.checked; });

    function draw() {
      lastInput = null;
      var table = el("table", { class: "rhm-grid" });
      var nCols = rows[0].length;
      rows.forEach(function (row, r) {
        var tr = el("tr", {});
        row.forEach(function (cell, c) {
          var inp = el("input", { type: "text" });
          inp.value = cell;
          inp.addEventListener("input", function () { rows[r][c] = inp.value; });
          inp.addEventListener("focus", function () { lastInput = inp; });
          tr.append(el("td", {}, inp));
        });
        var rm = btn("✕", "btn tiny danger");
        rm.title = "Remove this row";
        rm.addEventListener("click", function () { if (rows.length > 1) { rows.splice(r, 1); draw(); } });
        tr.append(el("td", {}, rm));
        table.append(tr);
      });
      var last = el("tr", {});
      for (var c = 0; c < nCols; c++) {
        (function (col) {
          var rm = btn("✕", "btn tiny danger");
          rm.title = "Remove this column";
          rm.addEventListener("click", function () {
            if (rows[0].length > 1) { rows.forEach(function (rw) { rw.splice(col, 1); }); draw(); }
          });
          last.append(el("td", { style: "text-align:center" }, rm));
        })(c);
      }
      table.append(last);
      wrap.replaceChildren(table);
    }

    var addRow = btn("+ Row"), addCol = btn("+ Column"), eqBtn = btn("∑ Equation in cell"), chemBtn = btn("⚗ Formula in cell");
    addRow.addEventListener("click", function () { if (rows.length < 40) { rows.push(new Array(rows[0].length).fill("")); draw(); } });
    addCol.addEventListener("click", function () { if (rows[0].length < 10) { rows.forEach(function (r) { r.push(""); }); draw(); } });
    function cellMath(mode) {
      if (!lastInput) { err.textContent = "Click inside a cell first, then press the button."; err.style.display = ""; return; }
      err.style.display = "none";
      editMath(lastInput, mode, false);
    }
    eqBtn.addEventListener("click", function () { cellMath("math"); });
    chemBtn.addEventListener("click", function () { cellMath("chem"); });

    var body = el("div", {},
      el("div", { class: "rf-bar" }, addRow, addCol, eqBtn, chemBtn),
      el("label", { class: "small", style: "display:flex;gap:6px;align-items:center;margin:6px 0 10px" }, headChk, "First row is a heading row"),
      wrap,
      el("p", { class: "hint muted small" }, "The ✕ buttons remove a row or column. Equations in cells appear between $ signs, and they render in the preview after you save the table."),
      err);

    var saveBtn = btn("Save table", "btn primary"), cancelBtn = btn("Cancel", "btn");
    var buttons = [saveBtn, cancelBtn];
    var delBtn = null;
    if (onDelete) { delBtn = btn("Delete table", "btn danger"); buttons.push(delBtn); }
    var m = openModal(onDelete ? "Edit table" : "Insert table", body, buttons);

    saveBtn.addEventListener("click", function () {
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].length; c++) {
          var msg = Rich.validate(rows[r][c]);
          if (msg) { err.textContent = "Row " + (r + 1) + ", column " + (c + 1) + ": " + msg; err.style.display = ""; return; }
        }
      }
      onSave({ id: t.id, header: header, rows: rows });
      m.close();
    });
    cancelBtn.addEventListener("click", function () { m.close(); });
    if (delBtn) delBtn.addEventListener("click", function () {
      if (confirm("Remove this table from the question?")) { onDelete(); m.close(); }
    });
    draw();
  }

  /* ---------- the text box with buttons and live preview ---------- */
  function richField(cfg) {
    var tables = cfg.tables || {};
    var allowTables = cfg.allowTables !== false;
    var ta = el("textarea", { rows: String(cfg.rows || 4) });
    ta.value = cfg.value || "";
    var preview = el("div", { class: "rf-preview" });

    function newId() {
      var id;
      do { id = "t" + Math.random().toString(36).slice(2, 8); } while (tables[id]);
      return id;
    }
    function editExisting(id) {
      var t = tables[id];
      if (!t) return;
      openTableDialog(t,
        function (nt) { tables[id] = nt; draw(); },
        function () { delete tables[id]; ta.value = ta.value.replace("[[table:" + id + "]]", ""); draw(); });
    }
    function draw() {
      if (!ta.value.trim()) { preview.className = "rf-preview empty"; preview.textContent = "Preview appears here as you type."; return; }
      preview.className = "rf-preview";
      Rich.render(preview, ta.value, Object.keys(tables).map(function (k) { return tables[k]; }),
        { allowTables: allowTables, onEditTable: allowTables ? editExisting : null });
    }
    ta.addEventListener("input", draw);

    var eqBtn = btn("∑ Equation"), chemBtn = btn("⚗ Chemical formula");
    eqBtn.addEventListener("click", function () { editMath(ta, "math", true); });
    chemBtn.addEventListener("click", function () { editMath(ta, "chem", true); });
    var bar = el("div", { class: "rf-bar" }, eqBtn, chemBtn);
    if (allowTables) {
      var tBtn = btn("▦ Table");
      tBtn.addEventListener("click", function () {
        var t = { id: newId(), header: true, rows: [["", "", ""], ["", "", ""], ["", "", ""]] };
        openTableDialog(t, function (nt) {
          tables[nt.id] = nt;
          ta.setRangeText("\n[[table:" + nt.id + "]]\n", ta.selectionStart, ta.selectionEnd, "end");
          draw();
        }, null);
      });
      bar.append(tBtn);
    }

    var root = el("div", { class: "field" },
      cfg.label ? el("span", { class: "lbl" }, cfg.label) : null,
      ta, bar, preview,
      cfg.hint ? el("span", { class: "hint" }, cfg.hint) : null);
    draw();
    return { el: root, box: ta, getValue: function () { return ta.value.trim(); } };
  }

  window.RichEditor = { richField: richField };
})();
