(function () {
  const TOKEN_KEY = "account_app_token";

  document.addEventListener("DOMContentLoaded", function () {
    if (window._lpAuthInitRan === true) return;
    window._lpAuthInitRan = true;
    const cardInner = document.querySelector(".lp-card-inner");
    if (cardInner && !document.getElementById("lp-auth-tabs")) {
      let oldHtml = cardInner.innerHTML;
      cardInner.innerHTML = `
        <div id="lp-auth-tabs" class="lp-tabs">
          <div class="lp-tab active" data-tab="login">登录</div>
          <div class="lp-tab" data-tab="register">注册</div>
        </div>
        <div id="lp-tab-login">
          ${oldHtml}
        </div>
        <div id="lp-tab-register" class="hidden">
          <div class="lp-title">记账系统管理平台</div>
          <div class="lp-subtitle">新用户注册</div>
          <div class="lp-input-group">
            <span class="lp-input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#8ea4c9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <input id="reg-account" class="lp-input" type="text" placeholder="请输入 6 位数字账号或 11 位手机号" maxlength="11" autocomplete="username"/>
          </div>
          <div class="lp-input-group">
            <span class="lp-input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#8ea4c9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </span>
            <input id="reg-password" class="lp-input lp-is-password" type="password" placeholder="请输入 6~12 位数字密码" maxlength="12" autocomplete="new-password"/>
          </div>
          <div class="lp-input-group">
            <span class="lp-input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#8ea4c9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </span>
            <input id="reg-password2" class="lp-input lp-is-password" type="password" placeholder="再次输入密码" maxlength="12" autocomplete="new-password"/>
          </div>
          <div class="lp-input-group">
            <span class="lp-input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#8ea4c9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/></svg>
            </span>
            <input id="reg-nickname" class="lp-input" type="text" placeholder="昵称（可选）" maxlength="20"/>
          </div>
          <button id="reg-btn" type="button" class="lp-login-btn">立即注册</button>
          <div id="reg-msg" class="lp-error"></div>
        </div>`;
      cardInner.querySelectorAll(".lp-tab").forEach((t) => {
        t.addEventListener("click", () => {
          cardInner.querySelectorAll(".lp-tab").forEach((x) => x.classList.remove("active"));
          t.classList.add("active");
          const tab = t.getAttribute("data-tab");
          var loginDiv = document.getElementById("lp-tab-login");
          loginDiv.classList.toggle("hidden", tab !== "login");
          loginDiv.style.display = (tab === "login") ? "" : "none";
          var registerDiv = document.getElementById("lp-tab-register");
          registerDiv.classList.toggle("hidden", tab !== "register");
          registerDiv.style.display = (tab === "register") ? "" : "none";
          const lm = document.getElementById("login-msg");
          if (lm) { lm.textContent = ""; lm.classList.remove("lp-error","lp-success"); lm.classList.add("lp-error"); }
          const rm = document.getElementById("reg-msg");
          if (rm) { rm.textContent = ""; rm.classList.remove("lp-error","lp-success"); rm.classList.add("lp-error"); }
          if (tab === "register") {
            ["reg-account","reg-password","reg-password2","reg-nickname"].forEach((id) => {
              const el = document.getElementById(id);
              if (el) {
                el.value = "";
                try { el.removeAttribute("value"); } catch (_) {}
                try { el.setAttribute("autocomplete","off"); } catch (_) {}
                try { el.dispatchEvent(new Event("input", { bubbles:true })); } catch (_) {}
              }
            });
          }
        });
      });
    }

    const eye = document.getElementById("show-password-eye");
    const pwd = document.getElementById("login-password");
    const btn = document.getElementById("login-btn");
    const form = document.getElementById("login-form");
    const msg = document.getElementById("login-msg");
    const userInput = document.getElementById("login-username");
    const regBtn = document.getElementById("reg-btn");
    const regMsg = document.getElementById("reg-msg");

    const _toastMsg = (el, text, type) => {
      if (!el) return;
      const raw = (text === undefined || text === null) ? "" : String(text);
      try { el.textContent = raw; } catch (_) {}
      try { el.innerText = raw; } catch (_) {}
      if (raw && !raw.includes("<")) { try { el.innerHTML = raw.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); } catch (_) {} }
      const t = (type === "success") ? "success" : "error";
      try { el.classList.remove("lp-error", "lp-success", "show"); } catch (_) {}
      try { el.classList.add((t === "success") ? "lp-success" : "lp-error"); } catch (_) {}
      try {
        el.style.setProperty("display", "block", "important");
        el.style.setProperty("visibility", "visible", "important");
        el.style.setProperty("opacity", "1", "important");
        el.style.setProperty("min-height", "18px", "important");
        el.style.setProperty("padding", "10px 12px", "important");
        el.style.setProperty("border-radius", "8px", "important");
        el.style.setProperty("font-size", "13px", "important");
        el.style.setProperty("font-weight", "700", "important");
        el.style.setProperty("line-height", "1.7", "important");
        el.style.setProperty("letter-spacing", "0.5px", "important");
        el.style.setProperty("word-break", "break-all", "important");
        el.style.setProperty("white-space", "pre-wrap", "important");
        if (t === "success") {
          el.style.setProperty("color", "#059669", "important");
          el.style.setProperty("background", "rgba(16, 185, 129, 0.10)", "important");
          el.style.setProperty("border", "1px solid rgba(16, 185, 129, 0.45)", "important");
          el.style.setProperty("box-shadow", "0 1px 6px rgba(16,185,129,.12)", "important");
          try { el.classList.add("show"); } catch (_) {}
        } else {
          el.style.setProperty("color", "#dc2626", "important");
          el.style.setProperty("background", "rgba(239, 68, 68, 0.08)", "important");
          el.style.setProperty("border", "1px solid rgba(239, 68, 68, 0.35)", "important");
          el.style.setProperty("box-shadow", "0 1px 6px rgba(239,68,68,.10)", "important");
        }
      } catch (_) {}
    };

    const _afterLogin = (res) => {
      if (!res || !res.data) return;
      const token = res.data.token;
      let user = res.data.user || res.data.userInfo || null;
      if (!user) {
        try { user = JSON.parse(localStorage.getItem("account_user_info")); } catch (_) {}
      }
      if (!token) {
        _toastMsg(msg, res.msg || "登录失败", "error");
        return;
      }
      try { localStorage.setItem(TOKEN_KEY, token); } catch (_) {}
      try { localStorage.setItem("account_user_info", JSON.stringify(user)); } catch (_) {}
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (_) {}
      _toastMsg(msg, "登录成功，正在跳转...", "success");
      setTimeout(() => {
        try { window.location.href = "/index.html"; } catch (_) {
          try { window.location.reload(); } catch (_) {}
        }
      }, 800);
    };

    const _getApiBase = () => {
      const loc = window.location;
      return loc.protocol + "//" + loc.host;
    };

    const _doLogin = () => {
      const username = userInput.value.trim();
      const password = pwd.value.trim();
      if (!username) {
        _toastMsg(msg, "请输入账号", "error");
        return;
      }
      if (!password) {
        _toastMsg(msg, "请输入密码", "error");
        return;
      }
      btn.disabled = true;
      try { btn.style.opacity = "0.6"; } catch (_) {}
      _toastMsg(msg, "", "error");
      fetch(_getApiBase() + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_no: username, password: password })
      }).then((r) => r.json()).then((res) => {
        btn.disabled = false;
        try { btn.style.opacity = "1"; } catch (_) {}
        if (res.code === 0) {
          _afterLogin(res);
        } else {
          _toastMsg(msg, res.msg || "登录失败", "error");
        }
      }).catch((err) => {
        btn.disabled = false;
        try { btn.style.opacity = "1"; } catch (_) {}
        _toastMsg(msg, "网络错误: " + (err.message || err), "error");
      });
    };

    const _doRegister = () => {
      const account = document.getElementById("reg-account").value.trim();
      const password = document.getElementById("reg-password").value.trim();
      const password2 = document.getElementById("reg-password2").value.trim();
      const nickname = document.getElementById("reg-nickname").value.trim();
      if (!account) {
        _toastMsg(regMsg, "请输入账号", "error");
        return;
      }
      if (!/^\d{6,11}$/.test(account)) {
        _toastMsg(regMsg, "账号必须为6-11位数字", "error");
        return;
      }
      if (!password) {
        _toastMsg(regMsg, "请输入密码", "error");
        return;
      }
      if (!/^\d{6,12}$/.test(password)) {
        _toastMsg(regMsg, "密码必须为6-12位数字", "error");
        return;
      }
      if (password !== password2) {
        _toastMsg(regMsg, "两次输入的密码不一致", "error");
        return;
      }
      regBtn.disabled = true;
      try { regBtn.style.opacity = "0.6"; } catch (_) {}
      _toastMsg(regMsg, "", "error");
      fetch(_getApiBase() + "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_no: account, password: password, nickname: nickname })
      }).then((r) => r.json()).then((res) => {
        regBtn.disabled = false;
        try { regBtn.style.opacity = "1"; } catch (_) {}
        if (res.code === 0) {
          _toastMsg(regMsg, "注册成功，请登录", "success");
          setTimeout(() => {
            document.querySelector(".lp-tab[data-tab='login']").click();
          }, 1000);
        } else {
          _toastMsg(regMsg, res.msg || "注册失败", "error");
        }
      }).catch((err) => {
        regBtn.disabled = false;
        try { regBtn.style.opacity = "1"; } catch (_) {}
        _toastMsg(regMsg, "网络错误: " + (err.message || err), "error");
      });
    };

    if (btn) {
      btn.addEventListener("click", _doLogin);
    }

    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        _doLogin();
      });
    }

    if (regBtn) {
      regBtn.addEventListener("click", _doRegister);
    }

    if (eye && pwd) {
      eye.addEventListener("click", () => {
        const type = pwd.getAttribute("type") === "password" ? "text" : "password";
        pwd.setAttribute("type", type);
        try { eye.classList.toggle("fa-eye"); } catch (_) {}
        try { eye.classList.toggle("fa-eye-slash"); } catch (_) {}
      });
    }

    if (pwd && userInput) {
      userInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { pwd.focus(); }
      });
      pwd.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { _doLogin(); }
      });
    }
  });
})();
