/* ===========================================================
   Brightloop UI layer — DOM helpers, DataGrid, modals, toasts,
   and the view renderers for every screen in the app.
=========================================================== */
(function (global) {
  "use strict";
  const D = global.BL_DB, BL = global.BL, C = global.BL_CHARTS;

  // ---------------- small DOM helpers ----------------
  function h(tag, attrs, children) {
    const e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(k => {
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function") e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(c => { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function esc(s) { return String(s === undefined || s === null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function money(n) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(s) { if (!s) return "—"; const d = new Date(s + "T00:00:00"); return isNaN(d) ? s : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" }); }
  function badge(status) { return `<span class="badge ${esc(status)}">${esc(status)}</span>`; }

  function toast(msg, type) {
    const stack = document.getElementById("toastStack");
    const t = h("div", { class: "toast " + (type || "") }, [msg]);
    stack.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

  function openModal(title, bodyNode) {
    document.getElementById("modalTitle").textContent = title;
    const body = document.getElementById("modalBody");
    body.innerHTML = "";
    body.appendChild(bodyNode);
    document.getElementById("modalBackdrop").hidden = false;
  }
  function closeModal() { document.getElementById("modalBackdrop").hidden = true; }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("modalClose").addEventListener("click", closeModal);
    document.getElementById("modalBackdrop").addEventListener("click", e => { if (e.target.id === "modalBackdrop") closeModal(); });
  });

  // ---------------- field helpers ----------------
  function field(label, inputHtml, errId) {
    return `<div class="field"><label>${esc(label)}</label>${inputHtml}<div class="err" id="${errId}"></div></div>`;
  }
  function showErrors(errors) {
    Object.keys(errors || {}).forEach(k => {
      const n = document.getElementById("err_" + k);
      if (n) n.textContent = errors[k];
    });
  }
  function clearErrors(form) {
    form.querySelectorAll(".err").forEach(n => n.textContent = "");
  }

  // ---------------- DataGrid: sortable / searchable / paginated ----------------
  // Built for responsiveness at volume (tested to 1000+ rows): only the
  // current page is rendered to the DOM at any time.
  function DataGrid(opts) {
    // opts: {title, columns:[{key,label,render,sortable,align}], rows, pageSize, searchKeys, filters:[{key,label,options}], onRow}
    const state = { page: 1, pageSize: opts.pageSize || 12, sortKey: opts.defaultSort || null, sortDir: 1, search: "", filterVals: {} };
    const wrap = h("div", { class: "table-wrap" });

    const toolbar = h("div", { class: "table-toolbar" });
    toolbar.appendChild(h("div", { class: "ttl" }, [opts.title + " (" + opts.rows.length + ")"]));
    const controls = h("div", { class: "toolbar-controls" });
    if (opts.searchKeys) {
      const search = h("input", { type: "text", placeholder: "Search…", style: "width:160px;" });
      search.addEventListener("input", () => { state.search = search.value.toLowerCase(); state.page = 1; render(); });
      controls.appendChild(search);
    }
    (opts.filters || []).forEach(f => {
      const sel = h("select", {});
      sel.appendChild(h("option", { value: "" }, [f.label + ": All"]));
      f.options.forEach(o => sel.appendChild(h("option", { value: o }, [o])));
      sel.addEventListener("change", () => { state.filterVals[f.key] = sel.value; state.page = 1; render(); });
      controls.appendChild(sel);
    });
    if (opts.actions) opts.actions.forEach(a => controls.appendChild(a));
    toolbar.appendChild(controls);
    wrap.appendChild(toolbar);

    const scrollBox = h("div", { class: "grid-scroll" });
    const table = h("table", { class: "data-grid" });
    const thead = h("thead");
    const trh = h("tr");
    opts.columns.forEach(col => {
      const th = h("th", { style: col.align === "right" ? "text-align:right" : "" }, [col.label + (col.sortable ? "" : "")]);
      if (col.sortable !== false) {
        th.addEventListener("click", () => {
          if (state.sortKey === col.key) state.sortDir *= -1; else { state.sortKey = col.key; state.sortDir = 1; }
          render();
        });
      }
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = h("tbody");
    table.appendChild(tbody);
    scrollBox.appendChild(table);
    wrap.appendChild(scrollBox);

    const foot = h("div", { class: "table-foot" });
    wrap.appendChild(foot);

    function filteredRows() {
      let rows = opts.rows;
      if (state.search) {
        rows = rows.filter(r => opts.searchKeys.some(k => String(r[k] ?? "").toLowerCase().includes(state.search)));
      }
      (opts.filters || []).forEach(f => {
        const v = state.filterVals[f.key];
        if (v) rows = rows.filter(r => String(r[f.key]) === v);
      });
      if (state.sortKey) {
        rows = rows.slice().sort((a, b) => {
          const av = a[state.sortKey], bv = b[state.sortKey];
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * state.sortDir;
        });
      }
      return rows;
    }

    function render() {
      const rows = filteredRows();
      const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
      state.page = Math.min(state.page, totalPages);
      const start = (state.page - 1) * state.pageSize;
      const pageRows = rows.slice(start, start + state.pageSize);

      tbody.innerHTML = "";
      if (!pageRows.length) {
        const tr = h("tr");
        const td = h("td", { colspan: String(opts.columns.length), class: "empty-state" }, ["No records match."]);
        tr.appendChild(td); tbody.appendChild(tr);
      }
      pageRows.forEach(r => {
        const tr = h("tr");
        opts.columns.forEach(col => {
          const td = h("td", { style: col.align === "right" ? "text-align:right" : "" });
          td.innerHTML = col.render ? col.render(r) : esc(r[col.key]);
          tr.appendChild(td);
        });
        if (opts.onRow) tr.addEventListener("click", () => opts.onRow(r));
        tbody.appendChild(tr);
      });

      foot.innerHTML = "";
      foot.appendChild(h("div", {}, [`Showing ${pageRows.length ? start + 1 : 0}–${Math.min(start + state.pageSize, rows.length)} of ${rows.length}`]));
      const pager = h("div", { class: "pager" });
      const prev = h("button", { onclick: () => { state.page--; render(); } }, ["‹ Prev"]);
      prev.disabled = state.page <= 1;
      const next = h("button", { onclick: () => { state.page++; render(); } }, ["Next ›"]);
      next.disabled = state.page >= totalPages;
      pager.appendChild(prev);
      pager.appendChild(h("span", { style: "font-size:11.5px;" }, [`Page ${state.page} / ${totalPages}`]));
      pager.appendChild(next);
      foot.appendChild(pager);
    }
    render();
    wrap.refresh = function (newRows) { if (newRows) opts.rows = newRows; render(); };
    return wrap;
  }

  // ---------------- VIEW: Cockpit (finance dashboard) ----------------
  function renderCockpit(root, ctx) {
    const kpi = BL.Reports.kpis();
    const statusMap = BL.Reports.subsByStatus();
    const invMap = BL.Reports.invoicesByStatus();
    const revMonths = BL.Reports.revenueByMonth(8);
    const topProducts = BL.Reports.topProductsByRevenue(5);

    root.innerHTML = "";
    root.appendChild(h("div", { class: "page-head" }, [
      (() => { const d = h("div"); d.appendChild(h("div", { class: "page-title" }, ["Finance Cockpit"])); d.appendChild(h("div", { class: "page-crumb" }, ["Standard · Analyze Items"])); return d; })(),
      h("div", { class: "page-actions" }, [
        h("button", { class: "btn-secondary btn-sm", onclick: () => { const n = BL.Subscriptions.autoCloseExpired(); toast(n + " expired subscription(s) auto-closed.", "success"); ctx.navigate("cockpit"); } }, ["Auto-close expired"]),
        h("button", { class: "btn-primary btn-sm", onclick: () => { const r = BL.Billing.runBillingCycle(); toast(`Billing run complete — ${r.created.length} invoice(s) created, ${r.skipped} already covered.`, "success"); ctx.navigate("cockpit"); } }, ["Run billing now"])
      ])
    ]));

    const tiles = h("div", { class: "tile-row" });
    const tileDefs = [
      ["Active Subscriptions", kpi.activeSubs.toLocaleString(), kpi.totalSubs + " total", ""],
      ["Revenue Collected", C.fmtMoney(kpi.paidRevenue), kpi.paymentCount + " payments", "alt1"],
      ["Outstanding Balance", C.fmtMoney(kpi.outstanding), kpi.invoiceCount + " invoices", "alt2"],
      ["Overdue Invoices", kpi.overdueCount.toLocaleString(), C.fmtMoney(kpi.overdueAmt) + " at risk", ""]
    ];
    tileDefs.forEach(([label, val, sub, cls]) => {
      tiles.appendChild(h("div", { class: "tile " + (cls || "") }, [
        h("div", { class: "tile-label" }, [label]), h("div", { class: "tile-value" }, [val]), h("div", { class: "tile-sub" }, [sub])
      ]));
    });
    root.appendChild(tiles);

    const panelRow = h("div", { class: "panel-row" });

    const p1 = h("div", { class: "panel" });
    p1.appendChild(h("div", { class: "panel-title" }, ["Subscriptions by Status"]));
    p1.innerHTML += C.donut(Object.entries(statusMap).filter(([k, v]) => v > 0).map(([k, v]) => ({ label: k, value: v })));
    panelRow.appendChild(p1);

    const p2 = h("div", { class: "panel" });
    p2.appendChild(h("div", { class: "panel-title" }, ["Invoices by Status"]));
    p2.innerHTML += C.donut(Object.entries(invMap).filter(([k, v]) => v > 0).map(([k, v]) => ({
      label: k, value: v, color: { draft: "#c8cfd4", confirmed: "#0070f2", paid: "#2e7d32", cancelled: "#b52b27" }[k]
    })));
    panelRow.appendChild(p2);

    const p3 = h("div", { class: "panel" });
    p3.appendChild(h("div", { class: "panel-title" }, ["Top Products by Revenue"]));
    p3.innerHTML += topProducts.length ? C.hBarList(topProducts.map(p => ({ label: p.name, value: p.value }))) : '<div class="empty-state">No invoiced revenue yet.</div>';
    panelRow.appendChild(p3);
    root.appendChild(panelRow);

    const p4 = h("div", { class: "panel" });
    p4.appendChild(h("div", { class: "panel-title" }, ["Revenue Collected — Last 8 Months", h("span", { class: "small" }, ["from recorded payments"])]));
    const hasRevenue = revMonths.some(m => m.value > 0);
    p4.innerHTML += hasRevenue
      ? C.barChart(revMonths.map(m => m.label), revMonths.map(m => m.value), { color: "#0070f2", fmt: v => "$" + (v >= 1000 ? Math.round(v / 1000) + "k" : v) })
      : '<div class="empty-state">No payments recorded yet — record a payment to see revenue trend.</div>';
    root.appendChild(p4);

    // Item Files style grid (mirrors the SAP cockpit reference: a live subscriptions table)
    const d = BL.db();
    const subsRows = d.subscriptions.map(s => ({ ...s, planName: (d.plans.find(p => p.id === s.planId) || {}).name || "—" }));
    const grid = DataGrid({
      title: "Subscriptions (All Items)",
      rows: subsRows, pageSize: 10, searchKeys: ["number", "customerName", "planName"],
      filters: [{ key: "status", label: "Status", options: ["draft", "quotation", "confirmed", "active", "paused", "closed"] }],
      columns: [
        { key: "number", label: "Number" },
        { key: "customerName", label: "Customer" },
        { key: "planName", label: "Plan" },
        { key: "status", label: "Status", render: r => badge(r.status) },
        { key: "startDate", label: "Start", render: r => fmtDate(r.startDate) },
        { key: "expiryDate", label: "Expiry", render: r => fmtDate(r.expiryDate) }
      ],
      onRow: r => ctx.navigate("subscriptions", { focus: r.id })
    });
    root.appendChild(grid);
  }

  // ---------------- VIEW: Products & Plans ----------------
  function renderProducts(root, ctx) {
    const d = BL.db();
    root.innerHTML = "";
    root.appendChild(h("div", { class: "page-head" }, [
      (() => { const x = h("div"); x.appendChild(h("div", { class: "page-title" }, ["Products & Plans"])); x.appendChild(h("div", { class: "page-crumb" }, ["Master Data"])); return x; })(),
      h("div", { class: "page-actions" }, [
        h("button", { class: "btn-secondary btn-sm", onclick: () => openPlanForm(ctx) }, ["+ New Plan"]),
        h("button", { class: "btn-primary btn-sm", onclick: () => openProductForm(ctx) }, ["+ New Product"])
      ])
    ]));

    const grid1 = DataGrid({
      title: "Products", rows: d.products, pageSize: 8, searchKeys: ["name", "code", "type"],
      columns: [
        { key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "type", label: "Type" },
        { key: "salesPrice", label: "Sales Price", align: "right", render: r => money(r.salesPrice) },
        { key: "costPrice", label: "Cost Price", align: "right", render: r => money(r.costPrice) },
        { key: "variants", label: "Variants", sortable: false, render: r => r.variants.map(v => esc(v.name) + (v.priceDelta ? ` (+${v.priceDelta})` : "")).join(", ") }
      ]
    });
    root.appendChild(grid1);

    const plansRows = d.plans.map(p => ({ ...p, productName: (d.products.find(x => x.id === p.productId) || {}).name || "—" }));
    const grid2 = DataGrid({
      title: "Plans", rows: plansRows, pageSize: 8, searchKeys: ["name", "code", "productName"],
      filters: [{ key: "frequency", label: "Frequency", options: ["daily", "weekly", "monthly", "yearly"] }],
      columns: [
        { key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "productName", label: "Product" },
        { key: "frequency", label: "Bills" }, { key: "minQty", label: "Min Qty", align: "right" },
        { key: "availFrom", label: "Available From", render: r => fmtDate(r.availFrom) },
        { key: "availTo", label: "Available To", render: r => fmtDate(r.availTo) },
        { key: "flags", label: "Lifecycle", sortable: false, render: r => [r.autoClose ? "Auto-close" : null, r.allowPause ? "Pausable" : null, r.allowRenew ? "Renewable" : null].filter(Boolean).join(" · ") || "—" }
      ]
    });
    root.appendChild(grid2);
  }

  function openProductForm(ctx) {
    const box = h("div");
    box.innerHTML = `
      <div class="form-grid">
        ${field("Product name", `<input id="pf_name" placeholder="e.g. Brightloop Analytics">`, "err_name")}
        ${field("Type", `<select id="pf_type"><option>Software</option><option>Service</option><option>Add-on</option></select>`, "err_type")}
        ${field("Sales price", `<input id="pf_sales" type="number" step="0.01" min="0" placeholder="0.00">`, "err_salesPrice")}
        ${field("Cost price", `<input id="pf_cost" type="number" step="0.01" min="0" placeholder="0.00">`, "err_costPrice")}
      </div>
      <div class="field">${field("Notes", `<textarea id="pf_notes" placeholder="Optional description"></textarea>`, "err_notes")}</div>
      <div class="panel" style="margin-top:4px;">
        <div class="panel-title">Variants <span class="small">e.g. brand or tier — choosing one adds its price delta</span></div>
        <div id="pf_variants"></div>
        <button type="button" class="btn-secondary btn-sm" id="pf_addVariant">+ Add variant</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="pf_cancel">Cancel</button>
        <button type="button" class="btn-primary" id="pf_save">Create product</button>
      </div>`;
    openModal("New Product", box);
    const variantsBox = box.querySelector("#pf_variants");
    function addVariantRow(name, delta) {
      const row = h("div", { style: "display:grid;grid-template-columns:2fr 1fr auto;gap:6px;margin-bottom:6px;" });
      row.innerHTML = `<input placeholder="Variant name" value="${esc(name || "")}" class="vf_name"><input type="number" step="0.01" placeholder="Price delta" value="${delta || 0}" class="vf_delta"><button type="button" class="btn-secondary btn-sm">✕</button>`;
      row.querySelector("button").addEventListener("click", () => row.remove());
      variantsBox.appendChild(row);
    }
    addVariantRow("Standard", 0);
    box.querySelector("#pf_addVariant").addEventListener("click", () => addVariantRow("", 0));
    box.querySelector("#pf_cancel").addEventListener("click", closeModal);
    box.querySelector("#pf_save").addEventListener("click", () => {
      clearErrors(box);
      const variants = Array.from(variantsBox.children).map(row => ({ name: row.querySelector(".vf_name").value.trim(), priceDelta: row.querySelector(".vf_delta").value })).filter(v => v.name);
      const res = BL.Catalog.createProduct({
        name: box.querySelector("#pf_name").value, type: box.querySelector("#pf_type").value,
        salesPrice: box.querySelector("#pf_sales").value, costPrice: box.querySelector("#pf_cost").value,
        notes: box.querySelector("#pf_notes").value, variants
      });
      if (!res.ok) { showErrors(res.errors); return; }
      toast("Product created.", "success"); closeModal(); ctx.navigate("products");
    });
  }

  function openPlanForm(ctx) {
    const d = BL.db();
    const box = h("div");
    const productOpts = d.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    box.innerHTML = `
      <div class="form-grid">
        ${field("Product", `<select id="pl_product">${productOpts}</select>`, "err_productId")}
        ${field("Variant", `<select id="pl_variant"></select>`, "err_variantId")}
        ${field("Plan name", `<input id="pl_name" placeholder="e.g. Monthly Standard">`, "err_name")}
        ${field("Billing frequency", `<select id="pl_freq"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="yearly">Yearly</option></select>`, "err_frequency")}
        ${field("Minimum quantity", `<input id="pl_minqty" type="number" min="1" value="1">`, "err_minQty")}
        ${field("Available from", `<input id="pl_from" type="date" value="${D.today()}">`, "err_availFrom")}
        ${field("Available to", `<input id="pl_to" type="date">`, "err_availTo")}
      </div>
      <div class="checkline"><input type="checkbox" id="pl_autoclose"> Auto-close when expiry date passes</div>
      <div class="checkline"><input type="checkbox" id="pl_pause" checked> Can be paused</div>
      <div class="checkline"><input type="checkbox" id="pl_renew" checked> Can be renewed</div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="pl_cancel">Cancel</button>
        <button type="button" class="btn-primary" id="pl_save">Create plan</button>
      </div>`;
    openModal("New Plan", box);
    function refreshVariants() {
      const p = d.products.find(x => x.id === box.querySelector("#pl_product").value);
      const sel = box.querySelector("#pl_variant");
      sel.innerHTML = (p ? p.variants : []).map(v => `<option value="${v.id}">${esc(v.name)}${v.priceDelta ? " (+" + v.priceDelta + ")" : ""}</option>`).join("");
    }
    refreshVariants();
    box.querySelector("#pl_product").addEventListener("change", refreshVariants);
    box.querySelector("#pl_cancel").addEventListener("click", closeModal);
    box.querySelector("#pl_save").addEventListener("click", () => {
      clearErrors(box);
      const res = BL.Catalog.createPlan({
        productId: box.querySelector("#pl_product").value, variantId: box.querySelector("#pl_variant").value,
        name: box.querySelector("#pl_name").value, frequency: box.querySelector("#pl_freq").value,
        minQty: box.querySelector("#pl_minqty").value, availFrom: box.querySelector("#pl_from").value, availTo: box.querySelector("#pl_to").value,
        autoClose: box.querySelector("#pl_autoclose").checked, allowPause: box.querySelector("#pl_pause").checked, allowRenew: box.querySelector("#pl_renew").checked
      });
      if (!res.ok) { showErrors(res.errors); return; }
      toast("Plan created.", "success"); closeModal(); ctx.navigate("products");
    });
  }

  // ---------------- VIEW: Quotations ----------------
  function renderQuotations(root, ctx) {
    const d = BL.db();
    root.innerHTML = "";
    root.appendChild(h("div", { class: "page-head" }, [
      (() => { const x = h("div"); x.appendChild(h("div", { class: "page-title" }, ["Quotations"])); x.appendChild(h("div", { class: "page-crumb" }, ["Sell · Templates & Draft Offers"])); return x; })(),
      h("div", { class: "page-actions" }, [h("button", { class: "btn-primary btn-sm", onclick: () => openQuoteForm(ctx) }, ["+ New Quotation"])])
    ]));

    const tplRows = d.quotationTemplates.map(t => ({ ...t, planName: (d.plans.find(p => p.id === t.planId) || {}).name || "—", lineCount: t.lines.length }));
    const grid1 = DataGrid({
      title: "Quotation Templates", rows: tplRows, pageSize: 8, searchKeys: ["name"],
      columns: [
        { key: "name", label: "Template" }, { key: "planName", label: "Plan" },
        { key: "validDays", label: "Valid (days)", align: "right" }, { key: "lineCount", label: "Lines", align: "right" }
      ],
      onRow: r => openQuoteForm(ctx, r.id)
    });
    root.appendChild(grid1);

    const quoteSubs = d.subscriptions.filter(s => s.status === "draft" || s.status === "quotation").map(s => ({ ...s, planName: (d.plans.find(p => p.id === s.planId) || {}).name || "—" }));
    const grid2 = DataGrid({
      title: "Draft & Quotation Subscriptions", rows: quoteSubs, pageSize: 10, searchKeys: ["number", "customerName"],
      columns: [
        { key: "number", label: "Number" }, { key: "customerName", label: "Customer" }, { key: "planName", label: "Plan" },
        { key: "status", label: "Status", render: r => badge(r.status) },
        { key: "amount", label: "Amount", align: "right", render: r => money(r.lines.reduce((s, l) => s + l.amount, 0)) },
        { key: "actions", label: "", sortable: false, render: r => `<button class="row-detail-link" data-act="confirm" data-id="${r.id}">Confirm →</button>` }
      ]
    });
    grid2.querySelectorAll('[data-act="confirm"]').forEach(btn => btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const sub = d.subscriptions.find(s => s.id === id);
      const target = sub.status === "draft" ? "quotation" : "confirmed";
      const res = BL.Subscriptions.transition(id, target);
      if (!res.ok) { toast(res.error, "error"); return; }
      toast(`Subscription moved to "${target}".`, "success"); ctx.navigate("quotations");
    }));
    root.appendChild(grid2);
  }

  function openQuoteForm(ctx, templateId) {
    const d = BL.db();
    const tpl = templateId ? d.quotationTemplates.find(t => t.id === templateId) : null;
    const box = h("div");
    const planOpts = d.plans.map(p => `<option value="${p.id}" ${tpl && tpl.planId === p.id ? "selected" : ""}>${esc(p.code)} — ${esc(p.name)}</option>`).join("");
    box.innerHTML = `
      ${tpl ? `<div class="hint" style="margin-bottom:10px;">Starting from template <b>${esc(tpl.name)}</b> (valid ${tpl.validDays} days).</div>` : ""}
      <div class="form-grid">
        ${field("Customer name", `<input id="qf_cust" placeholder="Company or person">`, "err_customerName")}
        ${field("Customer email", `<input id="qf_email" type="email" placeholder="billing@company.com">`, "err_customerEmail")}
        ${field("Plan", `<select id="qf_plan">${planOpts}</select>`, "err_planId")}
        ${field("Payment terms", `<select id="qf_terms"><option>Net 15</option><option selected>Net 30</option><option>Net 45</option><option>Due on Receipt</option></select>`, "err_paymentTerms")}
        ${field("Start date", `<input id="qf_start" type="date" value="${D.today()}">`, "err_startDate")}
        ${field("Expiry date", `<input id="qf_expiry" type="date" value="${tpl ? D.addDays(D.today(), tpl.validDays) : D.addMonths(D.today(), 12)}">`, "err_expiryDate")}
      </div>
      <div class="panel" style="margin-top:6px;">
        <div class="panel-title">Line Items</div>
        <div id="qf_lines"></div>
        <button type="button" class="btn-secondary btn-sm" id="qf_addLine">+ Add line</button>
      </div>
      <div class="field"><div class="err" id="err_lines"></div></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="qf_cancel">Cancel</button>
        <button type="button" class="btn-primary" id="qf_save">Save as quotation</button>
      </div>`;
    openModal(tpl ? "New Quotation — from Template" : "New Quotation", box);

    const linesBox = box.querySelector("#qf_lines");
    const productOpts = d.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    function addLineRow(l) {
      const row = h("div", { class: "line-item-row" });
      row.innerHTML = `
        <select class="lf_product">${productOpts}</select>
        <select class="lf_variant"></select>
        <input class="lf_qty" type="number" min="1" placeholder="Qty" value="${l ? l.qty : 1}">
        <input class="lf_price" type="number" step="0.01" placeholder="Unit price" value="${l ? l.unitPrice : ""}">
        <span class="hint lf_amt">—</span>
        <button type="button" class="btn-secondary btn-sm">✕</button>`;
      linesBox.appendChild(row);
      const prodSel = row.querySelector(".lf_product"), varSel = row.querySelector(".lf_variant");
      function refreshVariant() {
        const p = d.products.find(x => x.id === prodSel.value);
        varSel.innerHTML = (p ? p.variants : []).map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
        if (l && l.variantId) varSel.value = l.variantId;
        const price = BL.Catalog.unitPrice(prodSel.value, varSel.value);
        row.querySelector(".lf_price").value = l ? l.unitPrice : price;
      }
      prodSel.addEventListener("change", refreshVariant);
      varSel.addEventListener("change", () => { row.querySelector(".lf_price").value = BL.Catalog.unitPrice(prodSel.value, varSel.value); });
      if (l) prodSel.value = l.productId;
      refreshVariant();
      row.querySelector("button").addEventListener("click", () => row.remove());
    }
    if (tpl) tpl.lines.forEach(addLineRow); else addLineRow();
    box.querySelector("#qf_addLine").addEventListener("click", () => addLineRow());
    box.querySelector("#qf_cancel").addEventListener("click", closeModal);
    box.querySelector("#qf_save").addEventListener("click", () => {
      clearErrors(box);
      const lines = Array.from(linesBox.children).map(row => ({
        productId: row.querySelector(".lf_product").value, variantId: row.querySelector(".lf_variant").value,
        qty: row.querySelector(".lf_qty").value, unitPrice: row.querySelector(".lf_price").value
      }));
      const res = BL.Subscriptions.create({
        customerName: box.querySelector("#qf_cust").value, customerEmail: box.querySelector("#qf_email").value,
        planId: box.querySelector("#qf_plan").value, paymentTerms: box.querySelector("#qf_terms").value,
        startDate: box.querySelector("#qf_start").value, expiryDate: box.querySelector("#qf_expiry").value, lines
      }, "quotation");
      if (!res.ok) { showErrors(res.errors); return; }
      toast(`Quotation ${res.subscription.number} created.`, "success"); closeModal(); ctx.navigate("quotations");
    });
  }

  // ---------------- VIEW: Subscriptions ----------------
  function renderSubscriptions(root, ctx, params) {
    const d = BL.db();
    root.innerHTML = "";
    root.appendChild(h("div", { class: "page-head" }, [
      (() => { const x = h("div"); x.appendChild(h("div", { class: "page-title" }, ["Subscriptions"])); x.appendChild(h("div", { class: "page-crumb" }, ["Sell · Lifecycle Management"])); return x; })(),
      h("div", { class: "page-actions" }, [h("button", { class: "btn-primary btn-sm", onclick: () => openQuoteForm(ctx) }, ["+ New Subscription"])])
    ]));

    const rows = d.subscriptions.map(s => ({ ...s, planName: (d.plans.find(p => p.id === s.planId) || {}).name || "—", amount: s.lines.reduce((a, l) => a + l.amount, 0) }));
    const grid = DataGrid({
      title: "All Subscriptions", rows, pageSize: 15, searchKeys: ["number", "customerName", "planName"],
      filters: [{ key: "status", label: "Status", options: ["draft", "quotation", "confirmed", "active", "paused", "closed"] }],
      columns: [
        { key: "number", label: "Number" }, { key: "customerName", label: "Customer" }, { key: "planName", label: "Plan" },
        { key: "status", label: "Status", render: r => badge(r.status) },
        { key: "startDate", label: "Start", render: r => fmtDate(r.startDate) },
        { key: "expiryDate", label: "Expiry", render: r => fmtDate(r.expiryDate) },
        { key: "amount", label: "Line Value", align: "right", render: r => money(r.amount) }
      ],
      onRow: r => openSubDetail(ctx, r.id)
    });
    root.appendChild(grid);
    if (params && params.focus) openSubDetail(ctx, params.focus);
  }

  function openSubDetail(ctx, subId) {
    const d = BL.db();
    const sub = d.subscriptions.find(s => s.id === subId);
    if (!sub) return;
    const plan = d.plans.find(p => p.id === sub.planId);
    const box = h("div");
    const linesHtml = sub.lines.map(l => `<tr><td>${esc(l.productName)}</td><td class="right">${l.qty}</td><td class="right">${money(l.unitPrice)}</td><td class="right">${money(l.amount)}</td></tr>`).join("");
    const nextActions = {
      draft: [["quotation", "Send as Quotation"], ["confirmed", "Confirm Directly"]],
      quotation: [["confirmed", "Confirm"], ["closed", "Reject / Close"]],
      confirmed: [["active", "Activate"], ["closed", "Close"]],
      active: [["paused", "Pause"], ["closed", "Close"]],
      paused: [["active", "Resume"], ["closed", "Close"]],
      closed: []
    }[sub.status] || [];

    box.innerHTML = `
      <div class="form-grid">
        <div><div class="hint">Customer</div><div><b>${esc(sub.customerName)}</b></div></div>
        <div><div class="hint">Plan</div><div><b>${esc(plan ? plan.name : "—")}</b> (${plan ? plan.frequency : ""})</div></div>
        <div><div class="hint">Status</div><div>${badge(sub.status)}</div></div>
        <div><div class="hint">Payment Terms</div><div>${esc(sub.paymentTerms)}</div></div>
        <div><div class="hint">Start Date</div><div>${fmtDate(sub.startDate)}</div></div>
        <div><div class="hint">Expiry Date</div><div>${fmtDate(sub.expiryDate)}</div></div>
      </div>
      <table class="data-grid" style="margin-top:12px;"><thead><tr><th>Product</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Amount</th></tr></thead><tbody>${linesHtml}</tbody></table>
      <div class="modal-actions" id="sd_actions"></div>`;
    openModal(sub.number + " — Subscription Detail", box);
    const actWrap = box.querySelector("#sd_actions");
    nextActions.forEach(([to, label]) => {
      const btn = h("button", { class: to === "closed" ? "btn-danger" : "btn-primary" }, [label]);
      btn.addEventListener("click", () => {
        const res = BL.Subscriptions.transition(subId, to);
        if (!res.ok) { toast(res.error, "error"); return; }
        toast(`${sub.number} is now ${to}.`, "success"); closeModal(); ctx.navigate("subscriptions");
      });
      actWrap.appendChild(btn);
    });
    const close = h("button", { class: "btn-secondary" }, ["Close"]);
    close.addEventListener("click", closeModal);
    actWrap.appendChild(close);
  }

  // ---------------- VIEW: Invoices ----------------
  function renderInvoices(root, ctx) {
    const d = BL.db();
    root.innerHTML = "";
    root.appendChild(h("div", { class: "page-head" }, [
      (() => { const x = h("div"); x.appendChild(h("div", { class: "page-title" }, ["Invoices"])); x.appendChild(h("div", { class: "page-crumb" }, ["Bill · Billing Day"])); return x; })(),
      h("div", { class: "page-actions" }, [
        h("button", { class: "btn-primary btn-sm", onclick: () => { const r = BL.Billing.runBillingCycle(); toast(`${r.created.length} invoice(s) created.`, "success"); ctx.navigate("invoices"); } }, ["Run Billing"])
      ])
    ]));

    const rows = d.invoices.map(inv => ({ ...inv, overdue: BL.Billing.isOverdue(inv), balance: BL.Billing.balanceDue(inv) }));
    const grid = DataGrid({
      title: "Invoices", rows, pageSize: 15, searchKeys: ["number", "customerName", "subscriptionNumber"],
      filters: [{ key: "status", label: "Status", options: ["draft", "confirmed", "paid", "cancelled"] }],
      columns: [
        { key: "number", label: "Invoice #" }, { key: "customerName", label: "Customer" },
        { key: "date", label: "Date", render: r => fmtDate(r.date) }, { key: "dueDate", label: "Due", render: r => fmtDate(r.dueDate) + (r.overdue ? " ⚠" : "") },
        { key: "total", label: "Total", align: "right", render: r => money(r.total) },
        { key: "balance", label: "Balance Due", align: "right", render: r => money(r.balance) },
        { key: "status", label: "Status", render: r => r.overdue ? badge("overdue") : badge(r.status) },
        { key: "actions", label: "", sortable: false, render: r => `
            ${r.status === "draft" ? `<button class="row-detail-link" data-act="confirm" data-id="${r.id}">Confirm</button> · ` : ""}
            ${r.status !== "paid" && r.status !== "cancelled" ? `<button class="row-detail-link" data-act="pay" data-id="${r.id}">Pay</button> · <button class="row-detail-link" data-act="cancel" data-id="${r.id}">Cancel</button>` : ""}
            <button class="row-detail-link" data-act="print" data-id="${r.id}">Print</button>` }
      ]
    });
    grid.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.dataset.id, act = btn.dataset.act;
      if (act === "confirm") { const r = BL.Billing.confirm(id); r.ok ? (toast("Invoice confirmed.", "success"), ctx.navigate("invoices")) : toast(r.error, "error"); }
      if (act === "cancel") { const r = BL.Billing.cancel(id); r.ok ? (toast("Invoice cancelled.", "success"), ctx.navigate("invoices")) : toast(r.error, "error"); }
      if (act === "pay") openPaymentForm(ctx, id);
      if (act === "print") openInvoicePrint(id);
    }));
    root.appendChild(grid);
  }

  function openInvoicePrint(invId) {
    const d = BL.db();
    const inv = d.invoices.find(i => i.id === invId);
    const box = h("div");
    const lines = inv.lines.map(l => `<tr><td>${esc(l.productName)}</td><td class="right">${l.qty}</td><td class="right">${money(l.unitPrice)}</td><td class="right">${l.discount ? "-" + money(l.discount) : "—"}</td><td class="right">${money(l.taxAmount)}</td><td class="right">${money(l.amount)}</td></tr>`).join("");
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;">
        <div><b>Brightloop Software</b><br><span class="hint">Subscription Billing</span></div>
        <div style="text-align:right;"><b>${esc(inv.number)}</b><br><span class="hint">${badge(inv.status)}</span></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
      <div class="form-grid">
        <div><div class="hint">Bill To</div><div>${esc(inv.customerName)}</div></div>
        <div><div class="hint">Related Subscription</div><div>${esc(inv.subscriptionNumber)}</div></div>
        <div><div class="hint">Invoice Date</div><div>${fmtDate(inv.date)}</div></div>
        <div><div class="hint">Due Date</div><div>${fmtDate(inv.dueDate)}</div></div>
      </div>
      <table class="data-grid" style="margin-top:12px;"><thead><tr><th>Product</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Discount</th><th class="right">Tax</th><th class="right">Amount</th></tr></thead><tbody>${lines}</tbody></table>
      <div style="margin-top:10px;text-align:right;font-size:13px;">
        <div>Subtotal: ${money(inv.subTotal)}</div>
        <div>Discount: -${money(inv.discountTotal)}</div>
        <div>Tax: ${money(inv.taxTotal)}</div>
        <div style="font-weight:700;font-size:15px;margin-top:4px;">Total: ${money(inv.total)}</div>
        <div class="hint">Paid: ${money(BL.Billing.paidTotal(inv.id))} · Balance: ${money(BL.Billing.balanceDue(inv))}</div>
      </div>
      <div class="modal-actions"><button class="btn-secondary" id="pr_close">Close</button><button class="btn-primary" id="pr_print">Print</button></div>`;
    openModal("Invoice " + inv.number, box);
    box.querySelector("#pr_close").addEventListener("click", closeModal);
    box.querySelector("#pr_print").addEventListener("click", () => window.print());
  }

  // ---------------- VIEW: Payments ----------------
  function renderPayments(root, ctx) {
    const d = BL.db();
    root.innerHTML = "";
    root.appendChild(h("div", { class: "page-head" }, [
      (() => { const x = h("div"); x.appendChild(h("div", { class: "page-title" }, ["Payments"])); x.appendChild(h("div", { class: "page-crumb" }, ["Bill · The Money Comes In"])); return x; })(),
      h("div", { class: "page-actions" }, [h("button", { class: "btn-primary btn-sm", onclick: () => openPaymentForm(ctx) }, ["+ Record Payment"])])
    ]));

    const grid = DataGrid({
      title: "Payments", rows: d.payments.slice().reverse(), pageSize: 15, searchKeys: ["invoiceNumber", "customerName", "method"],
      filters: [{ key: "method", label: "Method", options: ["Card", "Bank Transfer", "Cash", "Cheque", "Wallet"] }],
      columns: [
        { key: "date", label: "Date", render: r => fmtDate(r.date) }, { key: "invoiceNumber", label: "Invoice" },
        { key: "customerName", label: "Customer" }, { key: "method", label: "Method" },
        { key: "amount", label: "Amount", align: "right", render: r => money(r.amount) },
        { key: "note", label: "Note" }
      ]
    });
    root.appendChild(grid);

    const outstanding = d.invoices.filter(i => i.status !== "paid" && i.status !== "cancelled").map(i => ({ ...i, balance: BL.Billing.balanceDue(i), overdue: BL.Billing.isOverdue(i) }));
    const grid2 = DataGrid({
      title: "Outstanding Invoices", rows: outstanding, pageSize: 10, searchKeys: ["number", "customerName"],
      columns: [
        { key: "number", label: "Invoice #" }, { key: "customerName", label: "Customer" },
        { key: "dueDate", label: "Due", render: r => fmtDate(r.dueDate) },
        { key: "balance", label: "Balance", align: "right", render: r => money(r.balance) },
        { key: "status", label: "Status", render: r => r.overdue ? badge("overdue") : badge(r.status) },
        { key: "act", label: "", sortable: false, render: r => `<button class="row-detail-link" data-pay="${r.id}">Record payment →</button>` }
      ]
    });
    grid2.querySelectorAll("[data-pay]").forEach(btn => btn.addEventListener("click", e => { e.stopPropagation(); openPaymentForm(ctx, btn.dataset.pay); }));
    root.appendChild(grid2);
  }

  function openPaymentForm(ctx, invoiceId) {
    const d = BL.db();
    const outstanding = d.invoices.filter(i => i.status !== "paid" && i.status !== "cancelled");
    const box = h("div");
    const invOpts = outstanding.map(i => `<option value="${i.id}" ${i.id === invoiceId ? "selected" : ""}>${esc(i.number)} — ${esc(i.customerName)} — Due ${money(BL.Billing.balanceDue(i))}</option>`).join("");
    box.innerHTML = `
      <div class="form-grid">
        ${field("Invoice", `<select id="pf_inv">${invOpts || "<option>No outstanding invoices</option>"}</select>`, "err_invoiceId")}
        ${field("Payment method", `<select id="pf_method"><option>Card</option><option>Bank Transfer</option><option>Cash</option><option>Cheque</option><option>Wallet</option></select>`, "err_method")}
        ${field("Amount", `<input id="pf_amount" type="number" step="0.01" min="0.01">`, "err_amount")}
        ${field("Date", `<input id="pf_date" type="date" value="${D.today()}">`, "err_date")}
      </div>
      <div class="field">${field("Note", `<input id="pf_note" placeholder="Optional reference / note">`, "err_note")}</div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="pf_cancel">Cancel</button>
        <button type="button" class="btn-primary" id="pf_save">Record payment</button>
      </div>`;
    openModal("Record Payment", box);
    box.querySelector("#pf_cancel").addEventListener("click", closeModal);
    box.querySelector("#pf_save").addEventListener("click", () => {
      clearErrors(box);
      const res = BL.Payments.record({
        invoiceId: box.querySelector("#pf_inv").value, method: box.querySelector("#pf_method").value,
        amount: box.querySelector("#pf_amount").value, date: box.querySelector("#pf_date").value, note: box.querySelector("#pf_note").value
      });
      if (!res.ok) { showErrors(res.errors); return; }
      toast("Payment recorded.", "success"); closeModal(); ctx.navigate("payments");
    });
  }

  // ---------------- VIEW: Discounts ----------------
  function renderDiscounts(root, ctx) {
    const d = BL.db();
    root.innerHTML = "";
    root.appendChild(h("div", { class: "page-head" }, [
      (() => { const x = h("div"); x.appendChild(h("div", { class: "page-title" }, ["Discount Rules"])); x.appendChild(h("div", { class: "page-crumb" }, ["Master Data · Admin Only"])); return x; })(),
      h("div", { class: "page-actions" }, [h("button", { class: "btn-primary btn-sm", onclick: () => openDiscountForm(ctx) }, ["+ New Discount"])])
    ]));
    const grid = DataGrid({
      title: "Discount Rules", rows: d.discounts, pageSize: 10, searchKeys: ["name"],
      columns: [
        { key: "name", label: "Name" }, { key: "type", label: "Type" },
        { key: "value", label: "Value", align: "right", render: r => r.type === "percentage" ? r.value + "%" : money(r.value) },
        { key: "startDate", label: "Start", render: r => fmtDate(r.startDate) }, { key: "endDate", label: "End", render: r => fmtDate(r.endDate) },
        { key: "usage", label: "Usage", align: "right", render: r => `${r.usedCount} / ${r.usageLimit}` },
        { key: "scope", label: "Scope" }
      ]
    });
    root.appendChild(grid);
  }
  function openDiscountForm(ctx) {
    const d = BL.db();
    const box = h("div");
    box.innerHTML = `
      <div class="form-grid">
        ${field("Name", `<input id="df_name" placeholder="e.g. Seat Expansion 10%">`, "err_name")}
        ${field("Type", `<select id="df_type"><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select>`, "err_type")}
        ${field("Value", `<input id="df_value" type="number" step="0.01" min="0">`, "err_value")}
        ${field("Scope", `<select id="df_scope"><option value="subscription">Whole subscription</option><option value="product">Specific product</option></select>`, "err_scope")}
        ${field("Target product (if scope = product)", `<select id="df_target"><option value="">—</option>${d.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>`, "err_targetId")}
        ${field("Minimum purchase ($)", `<input id="df_minpurchase" type="number" step="0.01" min="0" value="0">`, "err_minPurchase")}
        ${field("Minimum quantity", `<input id="df_minqty" type="number" min="0" value="0">`, "err_minQty")}
        ${field("Start date", `<input id="df_start" type="date" value="${D.today()}">`, "err_startDate")}
        ${field("End date", `<input id="df_end" type="date">`, "err_endDate")}
        ${field("Usage limit", `<input id="df_limit" type="number" min="1" value="100">`, "err_usageLimit")}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="df_cancel">Cancel</button>
        <button type="button" class="btn-primary" id="df_save">Create discount</button>
      </div>`;
    openModal("New Discount Rule", box);
    box.querySelector("#df_cancel").addEventListener("click", closeModal);
    box.querySelector("#df_save").addEventListener("click", () => {
      clearErrors(box);
      const res = BL.Discounts.create({
        name: box.querySelector("#df_name").value, type: box.querySelector("#df_type").value, value: box.querySelector("#df_value").value,
        scope: box.querySelector("#df_scope").value, targetId: box.querySelector("#df_target").value || null,
        minPurchase: box.querySelector("#df_minpurchase").value, minQty: box.querySelector("#df_minqty").value,
        startDate: box.querySelector("#df_start").value, endDate: box.querySelector("#df_end").value, usageLimit: box.querySelector("#df_limit").value
      });
      if (!res.ok) { showErrors(res.errors); return; }
      toast("Discount rule created.", "success"); closeModal(); ctx.navigate("discounts");
    });
  }

  // ---------------- VIEW: Users & Roles ----------------
  function renderUsers(root, ctx) {
    const d = BL.db();
    root.innerHTML = "";
    root.appendChild(h("div", { class: "page-head" }, [
      (() => { const x = h("div"); x.appendChild(h("div", { class: "page-title" }, ["Users & Roles"])); x.appendChild(h("div", { class: "page-crumb" }, ["Admin Only · Access Control"])); return x; })(),
      h("div", { class: "page-actions" }, [h("button", { class: "btn-primary btn-sm", onclick: () => openStaffForm(ctx) }, ["+ Add Staff Member"])])
    ]));
    const grid = DataGrid({
      title: "Users", rows: d.users, pageSize: 12, searchKeys: ["name", "email"],
      filters: [{ key: "role", label: "Role", options: ["admin", "staff", "customer"] }],
      columns: [
        { key: "name", label: "Name" }, { key: "email", label: "Email" },
        { key: "role", label: "Role", render: r => badge(r.role) },
        { key: "createdAt", label: "Joined", render: r => fmtDate(r.createdAt.slice(0, 10)) }
      ]
    });
    root.appendChild(grid);
  }
  function openStaffForm(ctx) {
    const box = h("div");
    box.innerHTML = `
      <div class="form-grid">
        ${field("Full name", `<input id="sf_name">`, "err_name")}
        ${field("Email", `<input id="sf_email" type="email">`, "err_email")}
        ${field("Role", `<select id="sf_role"><option value="staff">Staff (limited access)</option><option value="admin">Admin (full access)</option></select>`, "err_role")}
        ${field("Temporary password", `<input id="sf_pw" type="password" placeholder="8+ chars, Aa1!">`, "err_password")}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="sf_cancel">Cancel</button>
        <button type="button" class="btn-primary" id="sf_save">Add user</button>
      </div>`;
    openModal("Add Staff Member", box);
    box.querySelector("#sf_cancel").addEventListener("click", closeModal);
    box.querySelector("#sf_save").addEventListener("click", async () => {
      clearErrors(box);
      const res = await BL.Auth.addStaff({
        name: box.querySelector("#sf_name").value, email: box.querySelector("#sf_email").value,
        password: box.querySelector("#sf_pw").value, role: box.querySelector("#sf_role").value
      }, ctx.currentUser());
      if (!res.ok) { if (res.errors) showErrors(res.errors); else toast(res.error, "error"); return; }
      toast("User added.", "success"); closeModal(); ctx.navigate("users");
    });
  }

  // ---------------- VIEW: Customer portal ----------------
  function renderPortal(root, ctx) {
    const d = BL.db();
    const user = ctx.currentUser();
    root.innerHTML = "";
    root.appendChild(h("div", { class: "page-head" }, [
      (() => { const x = h("div"); x.appendChild(h("div", { class: "page-title" }, ["My Subscriptions"])); x.appendChild(h("div", { class: "page-crumb" }, ["Welcome back, " + esc(user.name)])); return x; })()
    ]));
    const mySubs = d.subscriptions.filter(s => s.customerEmail && s.customerEmail.toLowerCase() === user.email);
    const myInvIds = new Set();
    const myInvoices = d.invoices.filter(i => mySubs.some(s => s.id === i.subscriptionId));

    if (!mySubs.length) {
      root.appendChild(h("div", { class: "panel" }, [h("div", { class: "empty-state" }, ["No subscriptions are linked to your account yet. Ask the Brightloop team to attach your email to a subscription, or browse plans to get started."])]));
      return;
    }
    const grid = DataGrid({
      title: "My Subscriptions", rows: mySubs.map(s => ({ ...s, planName: (d.plans.find(p => p.id === s.planId) || {}).name || "—" })),
      pageSize: 10, searchKeys: ["number", "planName"],
      columns: [
        { key: "number", label: "Number" }, { key: "planName", label: "Plan" }, { key: "status", label: "Status", render: r => badge(r.status) },
        { key: "startDate", label: "Start", render: r => fmtDate(r.startDate) }, { key: "expiryDate", label: "Expiry", render: r => fmtDate(r.expiryDate) }
      ]
    });
    root.appendChild(grid);
    const grid2 = DataGrid({
      title: "My Invoices", rows: myInvoices.map(i => ({ ...i, balance: BL.Billing.balanceDue(i) })), pageSize: 10, searchKeys: ["number"],
      columns: [
        { key: "number", label: "Invoice #" }, { key: "date", label: "Date", render: r => fmtDate(r.date) },
        { key: "total", label: "Total", align: "right", render: r => money(r.total) },
        { key: "balance", label: "Balance", align: "right", render: r => money(r.balance) },
        { key: "status", label: "Status", render: r => badge(r.status) },
        { key: "act", label: "", sortable: false, render: r => `<button class="row-detail-link" data-pr="${r.id}">View →</button>` }
      ]
    });
    grid2.querySelectorAll("[data-pr]").forEach(btn => btn.addEventListener("click", e => { e.stopPropagation(); openInvoicePrint(btn.dataset.pr); }));
    root.appendChild(grid2);
  }

  global.BL_VIEWS = {
    h, esc, money, fmtDate, badge, toast, openModal, closeModal, DataGrid, field, showErrors, clearErrors,
    renderCockpit, renderProducts, renderQuotations, renderSubscriptions, renderInvoices, renderPayments, renderDiscounts, renderUsers, renderPortal
  };
})(window);
