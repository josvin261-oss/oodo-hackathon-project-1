/* ===========================================================
   Brightloop business engine
   Auth, validation, subscription lifecycle, billing run,
   discount application, payments, dashboard aggregates.
=========================================================== */
(function (global) {
  "use strict";
  const D = global.BL_DB;

  function db() { return D.get(); }

  // ----------------------- validation -----------------------
  const Validate = {
    email(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim()); },
    password(v) {
      v = String(v || "");
      return {
        len: v.length >= 8,
        upper: /[A-Z]/.test(v),
        lower: /[a-z]/.test(v),
        special: /[^A-Za-z0-9]/.test(v)
      };
    },
    passwordOk(v) {
      const r = this.password(v);
      return r.len && r.upper && r.lower && r.special;
    },
    required(v) { return v !== undefined && v !== null && String(v).trim() !== ""; },
    positiveNum(v) { return !isNaN(parseFloat(v)) && parseFloat(v) > 0; },
    nonNegNum(v) { return !isNaN(parseFloat(v)) && parseFloat(v) >= 0; },
    dateOrder(a, b) { return !a || !b || a <= b; }
  };

  // ----------------------- audit -----------------------
  function audit(action, detail) {
    const d = db();
    d.auditLog.push({ id: D.uid("log"), ts: new Date().toISOString(), action, detail });
    if (d.auditLog.length > 500) d.auditLog.shift();
  }

  // ----------------------- AUTH -----------------------
  const Auth = {
    async signup({ name, email, password, confirm }) {
      email = String(email || "").trim().toLowerCase();
      const errors = {};
      if (!Validate.required(name)) errors.name = "Name is required.";
      if (!Validate.email(email)) errors.email = "Enter a valid email address.";
      else if (db().users.some(u => u.email === email)) errors.email = "An account with this email already exists.";
      if (!Validate.passwordOk(password)) errors.password = "Password does not meet all requirements.";
      if (password !== confirm) errors.confirm = "Passwords do not match.";
      if (Object.keys(errors).length) return { ok: false, errors };

      const salt = D.genSalt();
      const passwordHash = await D.hashPassword(password, salt);
      const user = { id: D.uid("usr"), name: name.trim(), email, role: "customer", salt, passwordHash, createdAt: new Date().toISOString(), active: true };
      db().users.push(user);
      D.persist();
      audit("user.signup", { email });
      return { ok: true, user };
    },

    async login({ email, password }) {
      email = String(email || "").trim().toLowerCase();
      // Generic error on both "no such user" and "wrong password" so the
      // login form can't be used to enumerate which emails have accounts.
      const GENERIC_ERR = "Incorrect email or password.";
      const user = db().users.find(u => u.email === email && u.active);
      if (!user) return { ok: false, error: GENERIC_ERR };
      const hash = await D.hashPassword(password, user.salt);
      if (hash !== user.passwordHash) {
        // Accounts saved by older builds used plain salted SHA-256. Accept that
        // once, then upgrade the stored hash to PBKDF2 so it never recurs.
        const legacy = await D.legacyHashPassword(password, user.salt);
        if (legacy !== user.passwordHash) return { ok: false, error: GENERIC_ERR };
        user.passwordHash = hash;
        D.persist();
      }
      D.setSession({ userId: user.id, role: user.role, at: Date.now() });
      audit("user.login", { email });
      return { ok: true, user };
    },

    logout() { audit("user.logout", {}); D.setSession(null); },

    currentUser() {
      const s = D.getSession();
      if (!s) return null;
      return db().users.find(u => u.id === s.userId) || null;
    },

    requestReset(email) {
      email = String(email || "").trim().toLowerCase();
      const user = db().users.find(u => u.email === email);
      if (!user) return { ok: false, error: "No account found for this email." };
      const token = D.uid("rst");
      db().resetTokens.push({ token, userId: user.id, createdAt: Date.now(), used: false });
      D.persist();
      // Offline app: no mail server, so we surface the "sent" link directly.
      return { ok: true, token, link: `#reset=${token}` };
    },

    async completeReset(token, newPassword) {
      const rec = db().resetTokens.find(t => t.token === token && !t.used);
      if (!rec) return { ok: false, error: "Reset link is invalid or expired." };
      if (!Validate.passwordOk(newPassword)) return { ok: false, error: "Password does not meet requirements." };
      const user = db().users.find(u => u.id === rec.userId);
      user.passwordHash = await D.hashPassword(newPassword, user.salt);
      rec.used = true;
      D.persist();
      return { ok: true };
    },

    async addStaff({ name, email, password, role }, actingUser) {
      if (!actingUser || actingUser.role !== "admin") return { ok: false, error: "Only an admin can add staff members." };
      email = String(email || "").trim().toLowerCase();
      const errors = {};
      if (!Validate.required(name)) errors.name = "Name is required.";
      if (!Validate.email(email)) errors.email = "Enter a valid email.";
      else if (db().users.some(u => u.email === email)) errors.email = "Email already in use.";
      if (!Validate.passwordOk(password)) errors.password = "Password does not meet requirements.";
      if (!["admin", "staff"].includes(role)) errors.role = "Invalid role.";
      if (Object.keys(errors).length) return { ok: false, errors };
      const salt = D.genSalt();
      const passwordHash = await D.hashPassword(password, salt);
      const user = { id: D.uid("usr"), name, email, role, salt, passwordHash, createdAt: new Date().toISOString(), active: true };
      db().users.push(user);
      D.persist();
      audit("user.addStaff", { email, role, by: actingUser.email });
      return { ok: true, user };
    }
  };

  // ----------------------- PRODUCTS / PLANS -----------------------
  const Catalog = {
    createProduct(data) {
      const errors = {};
      if (!Validate.required(data.name)) errors.name = "Name is required.";
      if (!Validate.required(data.type)) errors.type = "Type is required.";
      if (!Validate.nonNegNum(data.salesPrice)) errors.salesPrice = "Enter a valid sales price.";
      if (!Validate.nonNegNum(data.costPrice)) errors.costPrice = "Enter a valid cost price.";
      if (Object.keys(errors).length) return { ok: false, errors };
      const d = db();
      const product = {
        id: D.uid("prod"), code: "PRD" + String(d.seq.product++).padStart(4, "0"),
        name: data.name.trim(), type: data.type, salesPrice: parseFloat(data.salesPrice), costPrice: parseFloat(data.costPrice),
        notes: data.notes || "", variants: (data.variants || []).map(v => ({ id: D.uid("var"), name: v.name, priceDelta: parseFloat(v.priceDelta || 0) })),
        active: true, createdAt: new Date().toISOString()
      };
      if (!product.variants.length) product.variants.push({ id: D.uid("var"), name: "Standard", priceDelta: 0 });
      d.products.push(product);
      D.persist();
      audit("product.create", { id: product.id, name: product.name });
      return { ok: true, product };
    },

    createPlan(data) {
      const errors = {};
      if (!Validate.required(data.productId)) errors.productId = "Select a product.";
      if (!Validate.required(data.name)) errors.name = "Plan name is required.";
      if (!["daily", "weekly", "monthly", "yearly"].includes(data.frequency)) errors.frequency = "Select a billing frequency.";
      if (!Validate.positiveNum(data.minQty)) errors.minQty = "Minimum quantity must be greater than 0.";
      if (!Validate.dateOrder(data.availFrom, data.availTo)) errors.availTo = "End date must be after start date.";
      if (Object.keys(errors).length) return { ok: false, errors };
      const d = db();
      const plan = {
        id: D.uid("plan"), code: "PLN" + String(d.seq.plan++).padStart(4, "0"),
        productId: data.productId, variantId: data.variantId || null, name: data.name.trim(),
        frequency: data.frequency, minQty: parseFloat(data.minQty),
        availFrom: data.availFrom || D.today(), availTo: data.availTo || null,
        autoClose: !!data.autoClose, allowPause: !!data.allowPause, allowRenew: !!data.allowRenew,
        status: "active", createdAt: new Date().toISOString()
      };
      d.plans.push(plan);
      D.persist();
      audit("plan.create", { id: plan.id, name: plan.name });
      return { ok: true, plan };
    },

    productLabel(productId, variantId) {
      const d = db();
      const p = d.products.find(x => x.id === productId);
      if (!p) return "—";
      const v = p.variants.find(x => x.id === variantId);
      return p.name + (v && v.name !== "Standard" ? " (" + v.name + ")" : "");
    },
    unitPrice(productId, variantId) {
      const d = db();
      const p = d.products.find(x => x.id === productId);
      if (!p) return 0;
      const v = p.variants.find(x => x.id === variantId);
      return p.salesPrice + (v ? v.priceDelta : 0);
    }
  };

  // ----------------------- DISCOUNTS -----------------------
  const Discounts = {
    create(data) {
      const errors = {};
      if (!Validate.required(data.name)) errors.name = "Name is required.";
      if (!["fixed", "percentage"].includes(data.type)) errors.type = "Select a discount type.";
      if (!Validate.positiveNum(data.value)) errors.value = "Enter a valid value.";
      if (data.type === "percentage" && parseFloat(data.value) > 100) errors.value = "Percentage cannot exceed 100.";
      if (!Validate.dateOrder(data.startDate, data.endDate)) errors.endDate = "End date must be after start date.";
      if (!Validate.positiveNum(data.usageLimit)) errors.usageLimit = "Enter a usage limit greater than 0.";
      if (Object.keys(errors).length) return { ok: false, errors };
      const d = db();
      const disc = {
        id: D.uid("disc"), name: data.name.trim(), type: data.type, value: parseFloat(data.value),
        minPurchase: parseFloat(data.minPurchase || 0), minQty: parseFloat(data.minQty || 0),
        startDate: data.startDate || D.today(), endDate: data.endDate || null,
        usageLimit: parseFloat(data.usageLimit), usedCount: 0,
        scope: data.scope, targetId: data.targetId || null, active: true
      };
      d.discounts.push(disc);
      D.persist();
      audit("discount.create", { id: disc.id, name: disc.name });
      return { ok: true, discount: disc };
    },

    // Find the best applicable, still-valid discount for a subscription line
    applicableFor(sub, line, onDate) {
      const d = db();
      const candidates = d.discounts.filter(disc => {
        if (!disc.active) return false;
        if (disc.startDate && onDate < disc.startDate) return false;
        if (disc.endDate && onDate > disc.endDate) return false;
        if (disc.usedCount >= disc.usageLimit) return false;
        if (disc.scope === "product" && disc.targetId !== line.productId) return false;
        if (disc.scope === "subscription" && disc.targetId && disc.targetId !== sub.id) return false;
        const lineTotal = line.qty * line.unitPrice;
        if (disc.minPurchase && lineTotal < disc.minPurchase) return false;
        if (disc.minQty && line.qty < disc.minQty) return false;
        return true;
      });
      if (!candidates.length) return null;
      // pick the discount giving the largest reduction
      let best = null, bestAmt = -1;
      candidates.forEach(disc => {
        const lineTotal = line.qty * line.unitPrice;
        const amt = disc.type === "fixed" ? disc.value : lineTotal * disc.value / 100;
        if (amt > bestAmt) { bestAmt = amt; best = disc; }
      });
      return { discount: best, amount: D.round2(bestAmt) };
    },

    applyUsage(discountId) {
      const disc = db().discounts.find(x => x.id === discountId);
      if (disc) disc.usedCount++;
    }
  };

  // ----------------------- QUOTATIONS / SUBSCRIPTIONS -----------------------
  const Subscriptions = {
    STATUS_FLOW: ["draft", "quotation", "confirmed", "active", "closed"],

    createFromTemplate(templateId, { customerName, customerEmail, startDate, paymentTerms }) {
      const d = db();
      const tpl = d.quotationTemplates.find(t => t.id === templateId);
      if (!tpl) return { ok: false, error: "Quotation template not found." };
      const plan = d.plans.find(p => p.id === tpl.planId);
      const expiry = D.addDays(D.today(), tpl.validDays);
      return this.create({
        customerName, customerEmail, planId: tpl.planId,
        startDate: startDate || D.today(), expiryDate: expiry, paymentTerms: paymentTerms || "Net 30",
        lines: tpl.lines.map(l => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, unitPrice: l.unitPrice }))
      }, "quotation");
    },

    create(data, initialStatus) {
      const errors = {};
      if (!Validate.required(data.customerName)) errors.customerName = "Customer name is required.";
      if (!Validate.required(data.planId)) errors.planId = "Select a plan.";
      if (!Validate.required(data.startDate)) errors.startDate = "Start date is required.";
      if (!Validate.dateOrder(data.startDate, data.expiryDate)) errors.expiryDate = "Expiry must be after start date.";
      if (!data.lines || !data.lines.length) errors.lines = "Add at least one line item.";
      else data.lines.forEach((l, i) => {
        if (!Validate.positiveNum(l.qty)) errors["line" + i] = "Line " + (i + 1) + ": quantity must be > 0.";
      });
      if (Object.keys(errors).length) return { ok: false, errors };

      const d = db();
      const plan = d.plans.find(p => p.id === data.planId);
      if (plan && data.lines.some(l => l.qty < plan.minQty)) {
        return { ok: false, errors: { lines: `Quantity must be at least ${plan.minQty} per plan minimum.` } };
      }
      const tax = d.taxRules[0];
      const lines = data.lines.map(l => {
        const amount = D.round2(l.qty * l.unitPrice * (1 + tax.rate / 100));
        return { productId: l.productId, variantId: l.variantId, productName: Catalog.productLabel(l.productId, l.variantId), qty: parseFloat(l.qty), unitPrice: parseFloat(l.unitPrice), taxRate: tax.rate, amount };
      });

      const sub = {
        id: D.uid("sub"), number: "SUB-" + (d.seq.subscription++),
        customerName: data.customerName.trim(), customerEmail: data.customerEmail || null, customerId: data.customerId || null,
        planId: data.planId, startDate: data.startDate, expiryDate: data.expiryDate || null,
        paymentTerms: data.paymentTerms || "Net 30", lines,
        status: initialStatus || "draft", lastBilledPeriodEnd: null,
        createdAt: new Date().toISOString()
      };
      d.subscriptions.push(sub);
      D.persist();
      audit("subscription.create", { id: sub.id, number: sub.number });
      return { ok: true, subscription: sub };
    },

    transition(subId, toStatus) {
      const d = db();
      const sub = d.subscriptions.find(s => s.id === subId);
      if (!sub) return { ok: false, error: "Subscription not found." };
      const flow = this.STATUS_FLOW;
      const allowedNext = {
        draft: ["quotation", "confirmed"],
        quotation: ["confirmed", "closed"],
        confirmed: ["active", "closed"],
        active: ["paused", "closed"],
        paused: ["active", "closed"],
        closed: []
      };
      if (!allowedNext[sub.status] || !allowedNext[sub.status].includes(toStatus)) {
        return { ok: false, error: `Cannot move subscription from "${sub.status}" to "${toStatus}".` };
      }
      if (toStatus === "paused") {
        const plan = d.plans.find(p => p.id === sub.planId);
        if (plan && !plan.allowPause) return { ok: false, error: "This plan does not allow pausing." };
      }
      sub.status = toStatus;
      D.persist();
      audit("subscription.transition", { id: sub.id, to: toStatus });
      return { ok: true, subscription: sub };
    },

    autoCloseExpired() {
      const d = db();
      const t = D.today();
      let closed = 0;
      d.subscriptions.forEach(sub => {
        const plan = d.plans.find(p => p.id === sub.planId);
        if (plan && plan.autoClose && sub.expiryDate && sub.expiryDate < t && !["closed"].includes(sub.status)) {
          sub.status = "closed";
          closed++;
        }
      });
      if (closed) D.persist();
      return closed;
    }
  };

  // ----------------------- BILLING ENGINE -----------------------
  const Billing = {
    // Idempotent: a subscription is only invoiced once per billing period.
    // Re-running the engine never creates a duplicate invoice for a period
    // already covered (checked via sub.lastBilledPeriodEnd AND a guard
    // against an existing invoice for the same subscription+period).
    runBillingCycle(onDate) {
      onDate = onDate || D.today();
      const d = db();
      const results = { created: [], skipped: 0, totalBilled: 0 };

      d.subscriptions.forEach(sub => {
        if (sub.status !== "active") return;
        const plan = d.plans.find(p => p.id === sub.planId);
        if (!plan) return;

        let periodStart = sub.lastBilledPeriodEnd || sub.startDate;
        // bill every elapsed period up to onDate, but cap iterations for safety
        let iterations = 0;
        while (periodStart <= onDate && iterations < 36) {
          iterations++;
          const periodEnd = D.nextPeriodEnd(periodStart, plan.frequency);
          if (periodStart > onDate) break;

          const already = d.invoices.find(inv => inv.subscriptionId === sub.id && inv.period && inv.period.start === periodStart);
          if (already) { results.skipped++; periodStart = periodEnd; continue; }

          const invoice = this._buildInvoice(sub, plan, periodStart, periodEnd, onDate);
          d.invoices.push(invoice);
          results.created.push(invoice);
          results.totalBilled += invoice.total;
          sub.lastBilledPeriodEnd = periodEnd;
          periodStart = periodEnd;

          if (periodEnd > onDate) break;
        }
      });

      if (results.created.length) D.persist();
      audit("billing.run", { date: onDate, created: results.created.length, skipped: results.skipped });
      return results;
    },

    _buildInvoice(sub, plan, periodStart, periodEnd, onDate) {
      const d = db();
      const tax = d.taxRules[0];
      let subTotal = 0, taxTotal = 0, discountTotal = 0;
      const lines = sub.lines.map(l => {
        const lineBase = D.round2(l.qty * l.unitPrice);
        const discApplied = Discounts.applicableFor(sub, l, onDate);
        let discAmt = 0;
        if (discApplied) { discAmt = Math.min(discApplied.amount, lineBase); Discounts.applyUsage(discApplied.discount.id); }
        const taxable = lineBase - discAmt;
        const lineTax = D.round2(taxable * tax.rate / 100);
        subTotal += lineBase; discountTotal += discAmt; taxTotal += lineTax;
        return {
          productId: l.productId, variantId: l.variantId, productName: l.productName || Catalog.productLabel(l.productId, l.variantId),
          qty: l.qty, unitPrice: l.unitPrice, lineBase, discount: discAmt, discountName: discApplied ? discApplied.discount.name : null,
          taxRate: tax.rate, taxAmount: lineTax, amount: D.round2(taxable + lineTax)
        };
      });
      const total = D.round2(subTotal - discountTotal + taxTotal);
      const termsDays = { "Net 15": 15, "Net 30": 30, "Net 45": 45, "Due on Receipt": 0 }[sub.paymentTerms] ?? 30;

      return {
        id: D.uid("inv"), number: "INV-" + (d.seq.invoice++),
        subscriptionId: sub.id, subscriptionNumber: sub.number,
        customerName: sub.customerName, customerEmail: sub.customerEmail,
        date: periodStart, dueDate: D.addDays(periodStart, termsDays),
        period: { start: periodStart, end: periodEnd },
        lines, subTotal: D.round2(subTotal), discountTotal: D.round2(discountTotal), taxTotal: D.round2(taxTotal), total,
        status: "draft", createdAt: new Date().toISOString()
      };
    },

    confirm(invoiceId) {
      const inv = db().invoices.find(i => i.id === invoiceId);
      if (!inv) return { ok: false, error: "Invoice not found." };
      if (inv.status !== "draft") return { ok: false, error: "Only draft invoices can be confirmed." };
      inv.status = "confirmed";
      D.persist();
      audit("invoice.confirm", { id: inv.id });
      return { ok: true };
    },
    cancel(invoiceId) {
      const inv = db().invoices.find(i => i.id === invoiceId);
      if (!inv) return { ok: false, error: "Invoice not found." };
      if (inv.status === "paid") return { ok: false, error: "A paid invoice cannot be cancelled." };
      inv.status = "cancelled";
      D.persist();
      audit("invoice.cancel", { id: inv.id });
      return { ok: true };
    },

    paidTotal(invoiceId) {
      return D.round2(db().payments.filter(p => p.invoiceId === invoiceId).reduce((s, p) => s + p.amount, 0));
    },
    balanceDue(inv) { return D.round2(inv.total - this.paidTotal(inv.id)); },
    isOverdue(inv) { return inv.status !== "paid" && inv.status !== "cancelled" && inv.dueDate < D.today(); }
  };

  // ----------------------- PAYMENTS -----------------------
  const Payments = {
    record(data) {
      const errors = {};
      if (!Validate.required(data.invoiceId)) errors.invoiceId = "Select an invoice.";
      if (!Validate.positiveNum(data.amount)) errors.amount = "Enter a valid payment amount.";
      if (!["Card", "Bank Transfer", "Cash", "Cheque", "Wallet"].includes(data.method)) errors.method = "Select a payment method.";
      if (!Validate.required(data.date)) errors.date = "Payment date is required.";
      if (Object.keys(errors).length) return { ok: false, errors };

      const d = db();
      const inv = d.invoices.find(i => i.id === data.invoiceId);
      if (!inv) return { ok: false, errors: { invoiceId: "Invoice not found." } };
      const amount = parseFloat(data.amount);
      const already = Billing.paidTotal(inv.id);
      if (D.round2(already + amount) > inv.total + 0.01) {
        return { ok: false, errors: { amount: `Amount exceeds balance due ($${D.round2(inv.total - already)}).` } };
      }
      if (inv.status === "draft") inv.status = "confirmed";

      const payment = { id: D.uid("pay"), invoiceId: inv.id, invoiceNumber: inv.number, customerName: inv.customerName, method: data.method, amount, date: data.date, note: data.note || "", createdAt: new Date().toISOString() };
      d.payments.push(payment);

      if (D.round2(already + amount) >= inv.total - 0.01) inv.status = "paid";
      D.persist();
      audit("payment.record", { id: payment.id, invoice: inv.number, amount });
      return { ok: true, payment };
    }
  };

  // ----------------------- DASHBOARD AGGREGATES -----------------------
  const Reports = {
    kpis() {
      const d = db();
      const active = d.subscriptions.filter(s => s.status === "active").length;
      const paidRevenue = D.round2(d.payments.reduce((s, p) => s + p.amount, 0));
      const outstanding = D.round2(d.invoices.filter(i => i.status !== "cancelled").reduce((s, i) => s + Billing.balanceDue(i), 0));
      const overdue = d.invoices.filter(i => Billing.isOverdue(i));
      const overdueAmt = D.round2(overdue.reduce((s, i) => s + Billing.balanceDue(i), 0));
      return {
        activeSubs: active, totalSubs: d.subscriptions.length,
        paidRevenue, outstanding, overdueCount: overdue.length, overdueAmt,
        invoiceCount: d.invoices.length, paymentCount: d.payments.length
      };
    },
    subsByStatus() {
      const d = db();
      const map = {};
      Subscriptions.STATUS_FLOW.concat(["paused"]).forEach(s => map[s] = 0);
      d.subscriptions.forEach(s => map[s.status] = (map[s.status] || 0) + 1);
      return map;
    },
    revenueByMonth(months) {
      const d = db();
      const out = [];
      const now = new Date();
      for (let i = months - 1; i >= 0; i--) {
        const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = dt.toISOString().slice(0, 7);
        const label = dt.toLocaleString("en", { month: "short" });
        const amt = D.round2(d.payments.filter(p => p.date.slice(0, 7) === key).reduce((s, p) => s + p.amount, 0));
        out.push({ key, label, value: amt });
      }
      return out;
    },
    invoicesByStatus() {
      const d = db();
      const map = { draft: 0, confirmed: 0, paid: 0, cancelled: 0 };
      d.invoices.forEach(i => map[i.status] = (map[i.status] || 0) + 1);
      return map;
    },
    topProductsByRevenue(limit) {
      const d = db();
      const map = {};
      d.invoices.forEach(inv => inv.lines.forEach(l => {
        map[l.productName] = (map[l.productName] || 0) + l.amount;
      }));
      return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, value]) => ({ name, value: D.round2(value) }));
    }
  };

  global.BL = { Validate, Auth, Catalog, Discounts, Subscriptions, Billing, Payments, Reports, audit, db };
})(window);
