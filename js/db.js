/* ===========================================================
   Brightloop DB layer
   A tiny offline "database" persisted in localStorage.
   No static JSON shipped — all data is generated at first run
   and from then on mutated live by the engine/UI (dynamic,
   not a static fixture file).
=========================================================== */
(function (global) {
  "use strict";

  const STORAGE_KEY = "brightloop_db_v1";
  const SESSION_KEY = "brightloop_session_v1";

  function uid(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function isoDate(d) {
    if (typeof d === "string") return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  function addMonths(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setMonth(d.getMonth() + n);
    return isoDate(d);
  }
  function today() { return isoDate(new Date()); }

  function nextPeriodEnd(dateStr, frequency) {
    switch (frequency) {
      case "daily": return addDays(dateStr, 1);
      case "weekly": return addDays(dateStr, 7);
      case "monthly": return addMonths(dateStr, 1);
      case "yearly": return addMonths(dateStr, 12);
      default: return addMonths(dateStr, 1);
    }
  }

  // ---- simple offline password hashing (SubtleCrypto, no network) ----
  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(salt + ":" + password);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  function genSalt() { return uid("salt"); }

  // ---------------------------------------------------------------
  // Seed data — generated programmatically on first launch
  // ---------------------------------------------------------------
  function buildSeed() {
    const db = {
      meta: { version: 1, createdAt: new Date().toISOString() },
      users: [],
      products: [],
      plans: [],
      taxRules: [],
      discounts: [],
      quotationTemplates: [],
      subscriptions: [],
      invoices: [],
      payments: [],
      resetTokens: [],
      auditLog: [],
      seq: { subscription: 1000, invoice: 5000, product: 1, plan: 1 }
    };

    db.taxRules = [
      { id: uid("tax"), name: "Standard GST", rate: 18, appliesTo: "all" },
      { id: uid("tax"), name: "Export / Zero-rated", rate: 0, appliesTo: "export" }
    ];

    const productDefs = [
      { name: "Odoo ERP Suite", type: "Software", salesPrice: 1200, costPrice: 400, notes: "Core ERP bundle, billed per seat tier.", variants: [{ name: "Standard", priceDelta: 0 }, { name: "Odoo Brand Edition", priceDelta: 560 }, { name: "Enterprise", priceDelta: 900 }] },
      { name: "Brightloop Analytics", type: "Software", salesPrice: 650, costPrice: 180, notes: "Reporting & BI add-on.", variants: [{ name: "Standard", priceDelta: 0 }, { name: "Pro", priceDelta: 300 }] },
      { name: "Priority Support", type: "Service", salesPrice: 199, costPrice: 60, notes: "4-hour SLA support add-on.", variants: [{ name: "Standard", priceDelta: 0 }] },
      { name: "Extra Storage 500GB", type: "Add-on", salesPrice: 49, costPrice: 12, notes: "Per-block storage add-on.", variants: [{ name: "Standard", priceDelta: 0 }] },
      { name: "Brightloop Mobile", type: "Software", salesPrice: 350, costPrice: 90, notes: "Mobile companion app licensing.", variants: [{ name: "Standard", priceDelta: 0 }, { name: "Field Edition", priceDelta: 120 }] }
    ];
    productDefs.forEach(p => {
      db.products.push({
        id: uid("prod"), code: "PRD" + String(db.seq.product++).padStart(4, "0"),
        name: p.name, type: p.type, salesPrice: p.salesPrice, costPrice: p.costPrice, notes: p.notes,
        variants: p.variants.map(v => ({ id: uid("var"), name: v.name, priceDelta: v.priceDelta })),
        active: true, createdAt: new Date().toISOString()
      });
    });

    const freqDefs = [
      { f: "monthly", label: "Monthly" }, { f: "yearly", label: "Yearly" }, { f: "weekly", label: "Weekly" }
    ];
    db.products.forEach((p, idx) => {
      const freq = freqDefs[idx % freqDefs.length].f;
      db.plans.push({
        id: uid("plan"), code: "PLN" + String(db.seq.plan++).padStart(4, "0"),
        productId: p.id, variantId: p.variants[0].id, name: p.name + " — " + freqDefs[idx % freqDefs.length].label,
        frequency: freq, minQty: 1, availFrom: addMonths(today(), -6), availTo: addMonths(today(), 18),
        autoClose: idx % 3 === 0, allowPause: idx % 2 === 0, allowRenew: true, status: "active",
        createdAt: new Date().toISOString()
      });
      if (p.variants[1]) {
        db.plans.push({
          id: uid("plan"), code: "PLN" + String(db.seq.plan++).padStart(4, "0"),
          productId: p.id, variantId: p.variants[1].id, name: p.name + " (" + p.variants[1].name + ") — Yearly",
          frequency: "yearly", minQty: 1, availFrom: addMonths(today(), -4), availTo: addMonths(today(), 20),
          autoClose: false, allowPause: true, allowRenew: true, status: "active",
          createdAt: new Date().toISOString()
        });
      }
    });

    // discounts
    db.discounts = [
      { id: uid("disc"), name: "Seat Expansion 10%", type: "percentage", value: 10, minQty: 10, minPurchase: 0, startDate: addMonths(today(), -2), endDate: addMonths(today(), 10), usageLimit: 50, usedCount: 3, scope: "subscription", targetId: null, active: true },
      { id: uid("disc"), name: "Flat $100 Loyalty", type: "fixed", value: 100, minQty: 1, minPurchase: 500, startDate: addMonths(today(), -1), endDate: addMonths(today(), 6), usageLimit: 25, usedCount: 1, scope: "product", targetId: db.products[0].id, active: true }
    ];

    // users
    const staticUsers = [
      { name: "Avery Admin", email: "admin@brightloop.com", role: "admin" },
      { name: "Sana Staff", email: "staff@brightloop.com", role: "staff" },
      { name: "Priya Sharma", email: "priya@acme.com", role: "customer" },
      { name: "Daniel Wu", email: "daniel@nimbus.io", role: "customer" },
      { name: "Fatima Noor", email: "fatima@koru.co", role: "customer" }
    ];
    staticUsers.forEach(u => {
      const salt = genSalt();
      db.users.push({
        id: uid("usr"), name: u.name, email: u.email.toLowerCase(), role: u.role,
        salt, passwordHash: null, createdAt: new Date().toISOString(), active: true
      });
    });

    db.quotationTemplates = [
      { id: uid("qt"), name: "Standard ERP Starter", planId: db.plans[0].id, validDays: 14, lines: [{ productId: db.products[0].id, variantId: db.products[0].variants[0].id, qty: 5, unitPrice: db.products[0].salesPrice }] },
      { id: uid("qt"), name: "Analytics + Support Bundle", planId: db.plans[2].id, validDays: 10, lines: [{ productId: db.products[1].id, variantId: db.products[1].variants[0].id, qty: 3, unitPrice: db.products[1].salesPrice }, { productId: db.products[2].id, variantId: db.products[2].variants[0].id, qty: 3, unitPrice: db.products[2].salesPrice }] }
    ];

    global.__BL_SEED_USERS__ = staticUsers; // for async password init
    global.__BL_DB_DRAFT__ = db;
    return db;
  }

  // Generate volume subscriptions + billing history so the cockpit has
  // enough data to look real and to performance-test the grid (~1000 rows).
  function expandSubscriptionVolume(db, count) {
    const customerNames = ["Acme Retail", "Nimbus Labs", "Koru Collective", "Vertex Foods", "Pelican Freight",
      "Solace Health", "Brightpath Edu", "Harbor Logistics", "Maple Finance", "Quartz Studio", "Lumen Energy",
      "Cobalt Media", "Driftwood Travel", "Northstar Legal", "Ember Hospitality"];
    const terms = ["Net 15", "Net 30", "Net 45", "Due on Receipt"];
    const statuses = ["draft", "quotation", "confirmed", "active", "active", "active", "active", "paused", "closed"];
    const tax = db.taxRules[0];

    for (let i = 0; i < count; i++) {
      const plan = db.plans[Math.floor(Math.random() * db.plans.length)];
      const product = db.products.find(p => p.id === plan.productId);
      const variant = product.variants.find(v => v.id === plan.variantId) || product.variants[0];
      const qty = Math.max(plan.minQty, 1 + Math.floor(Math.random() * 20));
      const unitPrice = product.salesPrice + variant.priceDelta;
      const start = addDays(today(), -Math.floor(Math.random() * 300));
      const expiry = addMonths(start, 12 + Math.floor(Math.random() * 12));
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const lineAmount = qty * unitPrice;
      const taxAmount = round2(lineAmount * tax.rate / 100);

      const sub = {
        id: uid("sub"),
        number: "SUB-" + (db.seq.subscription++),
        customerName: customerNames[i % customerNames.length] + (i >= customerNames.length ? " #" + (Math.floor(i / customerNames.length) + 1) : ""),
        customerEmail: null,
        planId: plan.id,
        startDate: start,
        expiryDate: expiry,
        paymentTerms: terms[Math.floor(Math.random() * terms.length)],
        lines: [{ productId: product.id, variantId: variant.id, productName: product.name + " (" + variant.name + ")", qty, unitPrice, taxRate: tax.rate, amount: round2(lineAmount + taxAmount) }],
        status,
        lastBilledPeriodEnd: null,
        createdAt: new Date(Date.now() - Math.random() * 1e10).toISOString()
      };
      db.subscriptions.push(sub);
    }
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.warn("DB load failed, reseeding", e); }
    return null;
  }

  function save(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
    catch (e) { return null; }
  }
  function setSession(s) {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  }

  const DB = {
    uid, isoDate, addDays, addMonths, today, nextPeriodEnd, round2,
    hashPassword, genSalt,
    STORAGE_KEY,
    get: function () { return this._cache; },
    _cache: null,

    init: async function () {
      let db = load();
      let freshSeed = false;
      if (!db) {
        db = buildSeed();
        expandSubscriptionVolume(db, 180); // demo volume, generated not static
        freshSeed = true;
      }
      this._cache = db;
      if (freshSeed) {
        // async password hashing for seed users (offline, local crypto only)
        const seedPw = { admin: "Admin#1234", staff: "Staff#1234", customer: "Customer#1234" };
        for (const u of db.users) {
          const pw = seedPw[u.role] || "Customer#1234";
          u.passwordHash = await hashPassword(pw, u.salt);
        }
        this.persist();
      }
      return db;
    },

    persist: function () { save(this._cache); },

    getSession, setSession,

    reset: function () {
      localStorage.removeItem(STORAGE_KEY);
      setSession(null);
    }
  };

  global.BL_DB = DB;
})(window);
