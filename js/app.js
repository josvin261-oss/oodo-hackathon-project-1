/* ===========================================================
   Brightloop app shell — auth screens, router, nav wiring.
=========================================================== */
(function () {
  "use strict";
  const D = window.BL_DB, BL = window.BL, V = window.BL_VIEWS;

  const VIEW_RENDERERS = {
    cockpit: V.renderCockpit,
    products: V.renderProducts,
    quotations: V.renderQuotations,
    subscriptions: V.renderSubscriptions,
    invoices: V.renderInvoices,
    payments: V.renderPayments,
    discounts: V.renderDiscounts,
    users: V.renderUsers,
    portal: V.renderPortal
  };
  const VIEW_TITLES = {
    cockpit: "Finance Cockpit", products: "Products & Plans", quotations: "Quotations",
    subscriptions: "Subscriptions", invoices: "Invoices", payments: "Payments",
    discounts: "Discount Rules", users: "Users & Roles", portal: "My Subscriptions"
  };

  let currentView = "cockpit";

  const ctx = {
    currentUser: () => BL.Auth.currentUser(),
    navigate
  };

  function defaultViewForRole(role) {
    return role === "customer" ? "portal" : "cockpit";
  }

  function navigate(view, params) {
    const user = BL.Auth.currentUser();
    if (!user) return showAuth();
    if (!VIEW_RENDERERS[view]) view = defaultViewForRole(user.role);

    // role gating
    const navBtn = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navBtn && navBtn.dataset.role && !navBtn.dataset.role.split(",").includes(user.role)) {
      view = defaultViewForRole(user.role);
    }

    currentView = view;
    document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    document.getElementById("appTitle").textContent = VIEW_TITLES[view] || "Cockpit";
    const root = document.getElementById("viewRoot");
    VIEW_RENDERERS[view](root, ctx, params || {});
    document.getElementById("navRecordCount").textContent =
      (BL.db().subscriptions.length + BL.db().invoices.length + BL.db().payments.length).toLocaleString();
    if (window.innerWidth <= 860) document.getElementById("sideNav").classList.remove("open");
  }

  function applyRoleVisibility(role) {
    document.querySelectorAll(".nav-item").forEach(btn => {
      const allowed = btn.dataset.role;
      btn.style.display = (!allowed || allowed.split(",").includes(role)) ? "" : "none";
    });
  }

  function showApp(user) {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("viewRoot").hidden = false;
    document.getElementById("shellBar").hidden = false;
    document.getElementById("sideNav").hidden = false;
    document.getElementById("userNameLbl").textContent = user.name;
    document.getElementById("userRoleLbl").textContent = user.role;
    document.getElementById("avatarInit").textContent = user.name.trim()[0].toUpperCase();
    applyRoleVisibility(user.role);
    navigate(defaultViewForRole(user.role));
  }

  function showAuth() {
    document.getElementById("authScreen").hidden = false;
    document.getElementById("viewRoot").hidden = true;
    document.getElementById("shellBar").hidden = true;
    document.getElementById("sideNav").hidden = true;
  }

  // ---------------- Auth screen wiring ----------------
  function wireAuthTabs() {
    document.querySelectorAll(".auth-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        ["login", "signup", "reset"].forEach(name => {
          document.getElementById(name + "Form").hidden = tab.dataset.tab !== name;
        });
      });
    });
  }

  function wirePasswordRules() {
    const pw = document.getElementById("suPassword");
    pw.addEventListener("input", () => {
      const r = BL.Validate.password(pw.value);
      document.querySelectorAll("#pwRules span").forEach(s => s.classList.toggle("ok", !!r[s.dataset.rule]));
    });
  }

  function wireLogin() {
    const form = document.getElementById("loginForm");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const msg = document.getElementById("loginMsg");
      msg.textContent = ""; msg.className = "form-msg";
      const email = document.getElementById("loginEmail").value;
      const password = document.getElementById("loginPassword").value;
      const res = await BL.Auth.login({ email, password });
      if (!res.ok) { msg.textContent = res.error; msg.className = "form-msg error"; return; }
      V.toast("Welcome back, " + res.user.name + ".", "success");
      showApp(res.user);
    });
  }

  function wireSignup() {
    const form = document.getElementById("signupForm");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const msg = document.getElementById("signupMsg");
      msg.textContent = ""; msg.className = "form-msg";
      const res = await BL.Auth.signup({
        name: document.getElementById("suName").value,
        email: document.getElementById("suEmail").value,
        password: document.getElementById("suPassword").value,
        confirm: document.getElementById("suPassword2").value
      });
      if (!res.ok) {
        const firstErr = Object.values(res.errors)[0];
        msg.textContent = firstErr; msg.className = "form-msg error";
        return;
      }
      msg.textContent = "Account created — you can sign in now."; msg.className = "form-msg success";
      form.reset();
      document.querySelector('.auth-tab[data-tab="login"]').click();
      document.getElementById("loginEmail").value = res.user.email;
      V.toast("Account created. Please sign in.", "success");
    });
  }

  function wireReset() {
    const form = document.getElementById("resetForm");
    form.addEventListener("submit", e => {
      e.preventDefault();
      const msg = document.getElementById("resetMsg");
      const box = document.getElementById("resetLinkBox");
      msg.textContent = ""; msg.className = "form-msg"; box.hidden = true;
      const email = document.getElementById("rsEmail").value;
      const res = BL.Auth.requestReset(email);
      if (!res.ok) { msg.textContent = res.error; msg.className = "form-msg error"; return; }
      msg.textContent = "Reset link generated (offline demo — no mail server)."; msg.className = "form-msg success";
      box.hidden = false;
      box.innerHTML = `Reset link: <b>${res.link}</b><br><button type="button" class="btn-secondary btn-sm" id="doResetBtn" style="margin-top:8px;">Set new password now</button>`;
      document.getElementById("doResetBtn").addEventListener("click", () => openResetPasswordPrompt(res.token));
    });
  }

  function openResetPasswordPrompt(token) {
    const box = document.createElement("div");
    box.innerHTML = `
      <div class="field">${V.field("New password", `<input id="rp_pw" type="password" placeholder="8+ chars, Aa1!">`, "err_rp")}</div>
      <div class="modal-actions"><button type="button" class="btn-secondary" id="rp_cancel">Cancel</button><button type="button" class="btn-primary" id="rp_save">Update password</button></div>`;
    V.openModal("Set New Password", box);
    box.querySelector("#rp_cancel").addEventListener("click", V.closeModal);
    box.querySelector("#rp_save").addEventListener("click", async () => {
      const res = await BL.Auth.completeReset(token, box.querySelector("#rp_pw").value);
      if (!res.ok) { document.getElementById("err_rp").textContent = res.error; return; }
      V.toast("Password updated — sign in with your new password.", "success");
      V.closeModal();
      document.querySelector('.auth-tab[data-tab="login"]').click();
    });
  }

  // ---------------- Shell / nav wiring ----------------
  function wireShell() {
    document.getElementById("logoutBtn").addEventListener("click", () => {
      BL.Auth.logout();
      showAuth();
    });
    document.getElementById("navToggle").addEventListener("click", () => {
      document.getElementById("sideNav").classList.toggle("open");
      document.getElementById("sideNav").classList.toggle("collapsed");
    });
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => navigate(btn.dataset.view));
    });
  }

  // ---------------- Boot ----------------
  async function boot() {
    await D.init();
    wireAuthTabs();
    wirePasswordRules();
    wireLogin();
    wireSignup();
    wireReset();
    wireShell();

    const session = D.getSession();
    const user = session ? BL.Auth.currentUser() : null;
    if (user) showApp(user); else showAuth();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
