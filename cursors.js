// Track previous page so back buttons work regardless of browser history state
(function () {
  var cur = window.location.pathname.split('/').pop() || 'index.html';
  var prev = sessionStorage.getItem('efm_cur_page');
  if (prev && prev !== cur) sessionStorage.setItem('efm_prev_page', prev);
  sessionStorage.setItem('efm_cur_page', cur);
})();

function efmGoBack() {
  window.location.href = sessionStorage.getItem('efm_prev_page') || 'index.html';
}

(function () {
  var RAILWAY_URL = 'efm.ai-taichi.com';
  var WS_URL = window.location.hostname === 'localhost'
    ? 'ws://localhost:8080'
    : 'wss://' + RAILWAY_URL;

  // ── Device identity (cookie + localStorage + server) ──────────────
  function getOrCreateDeviceId() {
    var id = localStorage.getItem('efm_device_id');
    if (!id) {
      var match = document.cookie.match(/(?:^|;\s*)efm_device_id=([^;]+)/);
      id = match ? decodeURIComponent(match[1]) : null;
    }
    if (!id) {
      id = 'efm_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }
    localStorage.setItem('efm_device_id', id);
    var exp = new Date(); exp.setFullYear(exp.getFullYear() + 1);
    document.cookie = 'efm_device_id=' + encodeURIComponent(id) + ';expires=' + exp.toUTCString() + ';path=/;SameSite=Lax';
    return id;
  }

  function _identityWS(buildMsg, onReply, timeoutMs) {
    return new Promise(function (resolve) {
      try {
        var ws = new WebSocket(WS_URL);
        var done = false;
        var timer = setTimeout(function () {
          if (!done) { done = true; try { ws.close(); } catch (e) {} resolve(null); }
        }, timeoutMs || 4000);
        ws.onopen = function () { ws.send(JSON.stringify(buildMsg())); };
        ws.onmessage = function (e) {
          try {
            var d = JSON.parse(e.data);
            var result = onReply(d);
            if (result !== undefined && !done) {
              done = true; clearTimeout(timer); try { ws.close(); } catch (er) {} resolve(result);
            }
          } catch (err) {}
        };
        ws.onerror = function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } };
        ws.onclose = function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } };
      } catch (e) { resolve(null); }
    });
  }

  function fetchIdentityFromServer(deviceId) {
    return _identityWS(
      function () { return {type: 'get_identity', device_id: deviceId}; },
      function (d) { if (d.type === 'identity_data') return d.identity || null; }
    );
  }

  function fetchIdentityByCode(code) {
    return _identityWS(
      function () { return {type: 'get_identity_by_code', code: code}; },
      function (d) { if (d.type === 'identity_data' && d.from_code) return d.identity || null; },
      6000
    );
  }

  function saveIdentityToServer(deviceId, name, fv, sfv) {
    return _identityWS(
      function () { return {type: 'save_identity', device_id: deviceId, name: name, fv: fv, sfv: sfv}; },
      function (d) { if (d.type === 'identity_saved') return d.code || null; },
      6000
    );
  }

  function registerAccount(email, password, name) {
    return _identityWS(
      function () { return {type: 'register', email: email, password: password, name: name}; },
      function (d) {
        if (d.type === 'register_ok')    return {ok: true,  code: d.code};
        if (d.type === 'register_error') return {ok: false, message: d.message};
      },
      8000
    );
  }

  function loginAccount(email, password) {
    return _identityWS(
      function () { return {type: 'login', email: email, password: password}; },
      function (d) {
        if (d.type === 'login_ok')    return {ok: true,  name: d.name, fv: d.fv, sfv: d.sfv, code: d.code};
        if (d.type === 'login_error') return {ok: false, message: d.message};
      },
      6000
    );
  }

  function deleteAccount(code, deviceId) {
    return _identityWS(
      function () { return {type: 'delete_account', code: code || '', device_id: deviceId || ''}; },
      function (d) { if (d.type === 'delete_account_ok') return true; },
      5000
    );
  }
  window.efmDeleteAccount = deleteAccount;

  function showCodeNotification(code) {
    if (!code) return;
    var bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);',
      'background:#0f0f13;color:#fff;padding:12px 20px;border-radius:12px;',
      'font-family:system-ui,sans-serif;font-size:0.88rem;z-index:9999999;',
      'box-shadow:0 4px 24px rgba(0,0,0,0.45);display:flex;align-items:center;gap:14px;',
      'max-width:92vw;white-space:nowrap;'
    ].join('');
    bar.innerHTML = [
      '<span>Your EFM code: <strong style="letter-spacing:0.1em;font-size:1rem;">' + code + '</strong>',
      ' &mdash; save this to log in from any browser</span>',
      '<button style="background:none;border:none;color:rgba(255,255,255,0.45);',
      'cursor:pointer;font-size:1.2rem;padding:0;line-height:1;flex-shrink:0;" title="Dismiss">&times;</button>'
    ].join('');
    bar.querySelector('button').addEventListener('click', function () { bar.remove(); });
    document.body.appendChild(bar);
    setTimeout(function () { if (bar.parentNode) bar.remove(); }, 14000);
  }

  function getIdentity() {
    var id    = localStorage.getItem('efm_cursor_id');
    var name  = localStorage.getItem('efm_cursor_name');
    var color = localStorage.getItem('efm_cursor_color');
    if (!id) {
      id = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
      localStorage.setItem('efm_cursor_id', id);
    }
    return { id: id, name: name, color: color || '#888' };
  }

  function showWelcomeScreen(deviceId) {
    return new Promise(function (resolve) {
      // Full white page, Gimkit-style
      var overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed;inset:0;background:#fff;overflow:hidden;',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;',
        'z-index:999999;font-family:system-ui,sans-serif;'
      ].join('');

      // ── Floating math symbols background ──
      var mathSymbols = [
        '∑','∫','π','±','√','×','÷','≠','∞','θ',
        'Δ','α','β','φ','λ','≈','≤','≥','∂','∇',
        '²','³','½','%','+','−','=','(',')','{','}',
        'γ','ε','μ','σ','ω','ρ','ζ','η','κ','ξ',
        '∏','∈','∉','∅','⊂','⊃','∪','∩','→','↔',
        '∀','∃','∧','∨','¬','⊕','⊗','⟨','⟩','|',
        '∑','π','√','∞','×','Δ','≈','∫','α','β',
        '≠','θ','φ','λ','≤','≥','±','÷','∂','∇',
        '!','?','#','8','3','7','2','9','4','6'
      ];

      var styleEl = document.createElement('style');
      styleEl.textContent = [
        '@keyframes efmFloat {',
        '  0%   { transform: translateY(0)   rotate(0deg);   }',
        '  30%  { transform: translateY(-22px) rotate(6deg); }',
        '  60%  { transform: translateY(10px)  rotate(-4deg);}',
        '  100% { transform: translateY(0)   rotate(0deg);   }',
        '}'
      ].join('');
      document.head.appendChild(styleEl);

      var bg = document.createElement('div');
      bg.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

      mathSymbols.forEach(function (sym, i) {
        var el = document.createElement('span');
        var size   = 22 + Math.random() * 52;          // 22–74 px
        var left   = Math.random() * 96;               // 0–96 vw
        var top    = Math.random() * 92;               // 0–92 vh
        var dur    = 7  + Math.random() * 14;          // 7–21 s
        var delay  = -(Math.random() * dur);           // stagger start
        var op     = 0.06 + Math.random() * 0.10;     // 0.06–0.16
        el.textContent = sym;
        el.style.cssText = [
          'position:absolute;',
          'left:' + left + 'vw;',
          'top:'  + top  + 'vh;',
          'font-size:' + size + 'px;',
          'color:#0f0f13;',
          'opacity:' + op.toFixed(2) + ';',
          'animation:efmFloat ' + dur.toFixed(1) + 's ' + delay.toFixed(1) + 's ease-in-out infinite;',
          'user-select:none;font-weight:600;',
          'font-family:Georgia,serif;'
        ].join('');
        bg.appendChild(el);
      });
      overlay.appendChild(bg);

      var wrap = document.createElement('div');
      wrap.style.cssText = 'width:100%;max-width:480px;padding:0 28px;box-sizing:border-box;position:relative;';

      // ── Big EFM title ──
      var logo = document.createElement('div');
      logo.style.cssText = [
        'font-size:4rem;font-weight:900;color:#0f0f13;',
        'text-align:center;letter-spacing:0.04em;margin-bottom:6px;',
        'line-height:1;'
      ].join('');
      logo.textContent = 'EFM';

      var sub = document.createElement('div');
      sub.style.cssText = 'font-size:0.95rem;color:#999;text-align:center;margin-bottom:28px;font-weight:500;';
      sub.textContent = "Elton's Fun Math";

      var hr1 = document.createElement('hr');
      hr1.style.cssText = 'border:none;border-top:1.5px solid #ebebeb;margin:0 0 22px;';

      // ── Sign up section ──
      var signupLabel = document.createElement('div');
      signupLabel.style.cssText = 'font-size:1rem;font-weight:700;color:#0f0f13;margin-bottom:10px;';
      signupLabel.textContent = 'Create an account...';

      function makeInput(type, placeholder, extraCss) {
        var inp = document.createElement('input');
        inp.type = type;
        inp.placeholder = placeholder;
        inp.autocomplete = type === 'password' ? 'new-password' : type === 'email' ? 'email' : 'off';
        inp.style.cssText = [
          'display:block;width:100%;padding:14px 16px;',
          'border:1.5px solid #e0e0e0;border-radius:12px;',
          'font-size:1rem;box-sizing:border-box;outline:none;',
          'font-family:system-ui,sans-serif;color:#0f0f13;',
          'transition:border-color 0.15s;margin-bottom:10px;',
          extraCss || ''
        ].join('');
        inp.addEventListener('focus', function () { inp.style.borderColor = '#0f0f13'; });
        inp.addEventListener('blur',  function () { inp.style.borderColor = '#e0e0e0'; });
        return inp;
      }

      var emailInput = makeInput('email', 'Email address');

      // Password field with show/hide eye
      var passWrap = document.createElement('div');
      passWrap.style.cssText = 'position:relative;margin-bottom:10px;';

      var passInput = document.createElement('input');
      passInput.type = 'password';
      passInput.placeholder = 'Password';
      passInput.autocomplete = 'new-password';
      passInput.style.cssText = [
        'display:block;width:100%;padding:14px 48px 14px 16px;',
        'border:1.5px solid #e0e0e0;border-radius:12px;',
        'font-size:1rem;box-sizing:border-box;outline:none;',
        'font-family:system-ui,sans-serif;color:#0f0f13;transition:border-color 0.15s;'
      ].join('');
      passInput.addEventListener('focus', function () { passInput.style.borderColor = '#0f0f13'; });
      passInput.addEventListener('blur',  function () { passInput.style.borderColor = '#e0e0e0'; });

      var eyeBtn = document.createElement('button');
      eyeBtn.type = 'button';
      eyeBtn.style.cssText = [
        'position:absolute;right:14px;top:50%;transform:translateY(-50%);',
        'background:none;border:none;padding:4px;cursor:pointer;',
        'color:#aaa;display:flex;align-items:center;transition:color 0.15s;'
      ].join('');

      var eyeOpen = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      var eyeClosed = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

      eyeBtn.innerHTML = eyeOpen;
      eyeBtn.addEventListener('mouseenter', function () { eyeBtn.style.color = '#0f0f13'; });
      eyeBtn.addEventListener('mouseleave', function () { eyeBtn.style.color = passInput.type === 'text' ? '#0f0f13' : '#aaa'; });
      eyeBtn.addEventListener('click', function () {
        var show = passInput.type === 'password';
        passInput.type = show ? 'text' : 'password';
        eyeBtn.innerHTML = show ? eyeClosed : eyeOpen;
        eyeBtn.style.color = show ? '#0f0f13' : '#aaa';
        passInput.focus();
      });

      passWrap.appendChild(passInput);
      passWrap.appendChild(eyeBtn);

      var nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';

      var firstInput = document.createElement('input');
      firstInput.type = 'text';
      firstInput.maxLength = 20;
      firstInput.placeholder = 'First name';
      firstInput.style.cssText = [
        'flex:1;padding:14px 16px;border:1.5px solid #e0e0e0;border-radius:12px;',
        'font-size:1rem;box-sizing:border-box;outline:none;',
        'font-family:system-ui,sans-serif;color:#0f0f13;transition:border-color 0.15s;'
      ].join('');

      var lastInput = document.createElement('input');
      lastInput.type = 'text';
      lastInput.maxLength = 1;
      lastInput.placeholder = 'A';
      lastInput.style.cssText = [
        'width:52px;padding:14px 10px;border:1.5px solid #e0e0e0;border-radius:12px;',
        'font-size:1rem;text-align:center;text-transform:uppercase;',
        'box-sizing:border-box;outline:none;',
        'font-family:system-ui,sans-serif;color:#0f0f13;transition:border-color 0.15s;'
      ].join('');

      [firstInput, lastInput].forEach(function (inp) {
        inp.addEventListener('focus', function () { inp.style.borderColor = '#0f0f13'; });
        inp.addEventListener('blur',  function () { inp.style.borderColor = '#e0e0e0'; });
      });
      lastInput.addEventListener('input', function () {
        lastInput.value = lastInput.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 1);
      });

      [emailInput, passInput, firstInput].forEach(function (inp) {
        inp.addEventListener('input', updateSignupBtn);
      });
      emailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') passInput.focus(); });
      passInput.addEventListener('keydown',  function (e) { if (e.key === 'Enter') firstInput.focus(); });
      firstInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') lastInput.focus(); });
      lastInput.addEventListener('keydown',  function (e) { if (e.key === 'Enter') submitSignup(); });

      nameRow.appendChild(firstInput);
      nameRow.appendChild(lastInput);

      var signupErr = document.createElement('div');
      signupErr.style.cssText = 'font-size:0.78rem;color:#c0392b;min-height:18px;margin-bottom:8px;';

      var signupBtn = document.createElement('button');
      signupBtn.style.cssText = [
        'display:block;width:100%;padding:14px 20px;',
        'background:#ccc;color:#fff;border:none;border-radius:12px;',
        'font-size:1rem;font-weight:700;cursor:default;',
        'font-family:system-ui,sans-serif;transition:background 0.15s;margin-bottom:24px;'
      ].join('');
      signupBtn.textContent = 'Create Account';

      function updateSignupBtn() {
        var active = emailInput.value.trim().length > 0 &&
                     passInput.value.length > 0 &&
                     firstInput.value.trim().length > 0;
        signupBtn.style.background = active ? '#0f0f13' : '#ccc';
        signupBtn.style.cursor     = active ? 'pointer' : 'default';
      }

      function submitSignup() {
        var email = emailInput.value.trim();
        var pass  = passInput.value;
        var first = firstInput.value.trim();
        if (!email || !pass || !first) { signupErr.textContent = 'Please fill in all fields.'; return; }
        if (!email.includes('@')) { signupErr.textContent = 'Enter a valid email address.'; emailInput.focus(); return; }
        if (pass.length < 6) { signupErr.textContent = 'Password must be at least 6 characters.'; passInput.focus(); return; }
        var last = lastInput.value.trim().toUpperCase();
        var name = first + (last ? ' ' + last + '.' : '');
        signupBtn.disabled = true;
        signupBtn.textContent = 'Creating account…';
        signupErr.textContent = '';
        registerAccount(email, pass, name).then(function (result) {
          if (!result) {
            signupErr.textContent = 'Could not connect — check your connection and try again.';
            signupBtn.disabled = false; signupBtn.textContent = 'Create Account'; return;
          }
          if (!result.ok) {
            signupErr.textContent = result.message || 'Something went wrong.';
            signupBtn.disabled = false; signupBtn.textContent = 'Create Account'; return;
          }
          localStorage.setItem('efm_cursor_name', name);
          localStorage.setItem('efm_cursor_email', email);
          localStorage.setItem('efm_password', pass);
          if (result.code) localStorage.setItem('efm_account_code', result.code);
          if (deviceId) saveIdentityToServer(deviceId, name, '', '');
          overlay.remove();
          resolve(null);
        });
      }

      signupBtn.addEventListener('click', submitSignup);

      // ── "or" divider ──
      var orRow = document.createElement('div');
      orRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:22px;';
      orRow.innerHTML = [
        '<div style="flex:1;height:1.5px;background:#0f0f13;"></div>',
        '<span style="font-size:0.85rem;color:#0f0f13;font-weight:600;">or</span>',
        '<div style="flex:1;height:1.5px;background:#0f0f13;"></div>'
      ].join('');

      // ── Email + password login section ──
      var codeLabel = document.createElement('div');
      codeLabel.style.cssText = 'font-size:1rem;font-weight:700;color:#0f0f13;margin-bottom:10px;';
      codeLabel.textContent = 'Log in...';

      var loginEmailInput = makeInput('email', 'Email');
      var loginPassWrap   = document.createElement('div');
      loginPassWrap.style.cssText = 'position:relative;margin-bottom:10px;';
      var loginPassInput  = makeInput('password', 'Password');
      loginPassInput.style.marginBottom = '0';
      loginPassInput.autocomplete = 'current-password';
      var loginEyeBtn = document.createElement('button');
      loginEyeBtn.type = 'button';
      loginEyeBtn.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:4px;color:#aaa;';
      loginEyeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      loginEyeBtn.addEventListener('click', function () {
        var show = loginPassInput.type === 'password';
        loginPassInput.type = show ? 'text' : 'password';
      });
      loginPassWrap.appendChild(loginPassInput);
      loginPassWrap.appendChild(loginEyeBtn);

      var codeErr = document.createElement('div');
      codeErr.style.cssText = 'font-size:0.78rem;color:#c0392b;min-height:18px;margin-bottom:8px;';

      var codeBtn = document.createElement('button');
      codeBtn.style.cssText = [
        'display:block;width:100%;padding:14px 20px;',
        'background:#0f0f13;color:#fff;border:none;border-radius:12px;',
        'font-size:1rem;font-weight:700;cursor:pointer;',
        'font-family:system-ui,sans-serif;transition:background 0.15s;'
      ].join('');
      codeBtn.textContent = 'Log In';

      function submitCode() {
        var email = loginEmailInput.value.trim();
        var pass  = loginPassInput.value;
        if (!email || !pass) { codeErr.textContent = 'Please fill in both fields.'; return; }
        codeBtn.disabled = true;
        codeBtn.textContent = 'Logging in…';
        codeErr.textContent = '';
        loginAccount(email, pass).then(function (result) {
          if (!result || !result.ok) {
            codeErr.textContent = (result && result.message) || 'Login failed — try again.';
            codeBtn.disabled = false;
            codeBtn.textContent = 'Log In';
          } else {
            localStorage.setItem('efm_cursor_name', result.name);
            localStorage.setItem('efm_cursor_email', email);
            localStorage.setItem('efm_password', pass);
            if (result.fv)   localStorage.setItem('efm_cursor_color',  result.fv);
            if (result.sfv)  localStorage.setItem('efm_cursor_color2', result.sfv);
            if (result.code) localStorage.setItem('efm_account_code',  result.code);
            if (deviceId) saveIdentityToServer(deviceId, result.name, result.fv || '', result.sfv || '');
            overlay.remove();
            resolve({restored: true, name: result.name, fv: result.fv, sfv: result.sfv});
          }
        });
      }

      codeBtn.addEventListener('click', submitCode);
      loginPassInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitCode(); });
      loginEmailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') loginPassInput.focus(); });

      wrap.appendChild(logo);
      wrap.appendChild(sub);
      wrap.appendChild(hr1);
      wrap.appendChild(signupLabel);
      wrap.appendChild(emailInput);
      wrap.appendChild(passWrap);
      wrap.appendChild(nameRow);
      wrap.appendChild(signupErr);
      wrap.appendChild(signupBtn);
      wrap.appendChild(orRow);
      wrap.appendChild(codeLabel);
      wrap.appendChild(loginEmailInput);
      wrap.appendChild(loginPassWrap);
      wrap.appendChild(codeErr);
      wrap.appendChild(codeBtn);
      overlay.appendChild(wrap);
      document.body.appendChild(overlay);
    });
  }

  function showNamePrompt(color) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed;inset:0;background:rgba(0,0,0,0.45);',
        'display:flex;align-items:center;justify-content:center;',
        'z-index:999999;font-family:system-ui,sans-serif;'
      ].join('');

      overlay.innerHTML = [
        '<div style="background:#fff;border-radius:14px;padding:32px 28px;',
        'box-shadow:0 8px 40px rgba(0,0,0,0.25);width:300px;text-align:center;">',
          '<div style="width:36px;height:36px;border-radius:50%;background:' + color + ';',
          'margin:0 auto 14px;box-shadow:0 2px 8px rgba(0,0,0,0.2);"></div>',
          '<div style="font-size:1.05rem;font-weight:700;color:#111;margin-bottom:6px;">',
            'What\'s your name?</div>',
          '<div style="font-size:0.82rem;color:#888;margin-bottom:18px;">',
            'Enter the first name and last initial you want to use for this website</div>',
          '<div style="display:flex;gap:8px;margin-bottom:0;">',
            '<input id="_cn_first" type="text" maxlength="20" placeholder="First name"',
            ' style="flex:1;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;',
            'font-size:0.95rem;outline:none;box-sizing:border-box;text-align:center;">',
            '<input id="_cn_last" type="text" maxlength="1" placeholder="A"',
            ' style="width:52px;padding:10px 8px;border:1.5px solid #ddd;border-radius:8px;',
            'font-size:0.95rem;outline:none;box-sizing:border-box;text-align:center;">',
          '</div>',
          '<button id="_cn_btn" style="margin-top:12px;width:100%;padding:11px;',
          'background:#0f0f13;color:#fff;border:none;border-radius:8px;',
          'font-size:0.95rem;font-weight:600;cursor:pointer;letter-spacing:0.02em;',
          'font-family:system-ui,sans-serif;">',
            'Next →</button>',
        '</div>'
      ].join('');

      document.body.appendChild(overlay);
      var firstInput = document.getElementById('_cn_first');
      var lastInput  = document.getElementById('_cn_last');
      var btn        = document.getElementById('_cn_btn');
      firstInput.focus();

      lastInput.addEventListener('input', function () {
        lastInput.value = lastInput.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 1);
      });

      function submit() {
        var first = firstInput.value.trim();
        var last  = lastInput.value.trim().toUpperCase();
        var name  = (first || 'Guest') + (last ? ' ' + last + '.' : '');
        localStorage.setItem('efm_cursor_name', name);
        overlay.remove();
        resolve(name);
      }
      btn.addEventListener('click', submit);
      firstInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') lastInput.focus(); });
      lastInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    });
  }

  function showColorPrompt(name, subtitle) {
    return new Promise(function (resolve) {
      var swatchColors = [
        // originals
        '#c0392b','#d35400','#c2185b','#8e44ad',
        '#2980b9','#16a085','#27ae60','#2c3e50',
        '#795548','#607d8b','#e67e22','#0f0f13',
        // named colors
        '#DC143C','#FF2400','#9B111E','#800020','#800000', // Crimson Scarlet Ruby Burgundy Maroon
        '#FF007F','#FF6B6B','#FA8072','#FF00FF','#DD77FF', // Rose Coral Salmon Magenta Fuchsia
        '#DA70D6','#DE5D83', // Orchid Blush
        '#FFBF00','#F4C430','#F28500','#FFCBA4','#FBCEB1', // Amber Saffron Tangerine Peach Apricot
        '#FFD700','#FFDB58','#FFFF99','#FFF44F', // Gold Mustard Canary Lemon
        '#50C878','#808000','#BCB88A','#98FF98','#00A86B', // Emerald Olive Sage Mint Jade
        '#32CD32','#228B22','#008080','#7FFF00','#AACC00', // Lime ForestGreen Teal Chartreuse Peridot
        '#0F52BA','#4B0082','#0047AB','#001F5B','#007BA7', // Sapphire Indigo Cobalt Navy Cerulean
        '#40E0D0','#967BB6','#C8A2C8','#9966CC','#DDA0DD', // Turquoise Lavender Lilac Amethyst Plum
        '#483C32','#704214','#A0522D','#CC7722','#36454F', // Taupe Sepia Sienna Ochre Charcoal
        '#708090','#F5F5DC','#555D50','#F2F0E6', // Slate Beige Ebony Alabaster
        // Icy & Pale
        '#3EB489','#9FE2BF','#ACE1AF','#B0E0E6','#87CEEB', // Mint Seafoam Celadon PowderBlue SkyBlue
        // Earthy Greens
        '#8A9A86','#8A9A5B','#93C572',                     // Sage Moss Pistachio
        // Vibrant & Jewel
        '#4CBB17','#4169E1','#7DF9FF',                     // KellyGreen RoyalBlue ElectricBlue
        // Deep & Moody
        '#000080','#191970','#355E3B','#01796F',            // Navy Midnight HunterGreen PineGreen
        // Blue-Green Blends
        '#00FFFF','#7FFFD4','#00CCCC'                      // Cyan Aquamarine RobinsEgg
      ];
      var selected = swatchColors[4]; // default blue

      var overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed;inset:0;background:rgba(0,0,0,0.45);',
        'display:flex;align-items:center;justify-content:center;',
        'z-index:999999;font-family:system-ui,sans-serif;'
      ].join('');

      var card = document.createElement('div');
      card.style.cssText = [
        'background:#fff;border-radius:14px;padding:28px 24px;',
        'box-shadow:0 8px 40px rgba(0,0,0,0.25);width:360px;text-align:center;',
        'max-height:90vh;overflow-y:auto;'
      ].join('');

      var preview = document.createElement('div');
      preview.style.cssText = [
        'width:40px;height:40px;border-radius:50%;background:' + selected + ';',
        'margin:0 auto 14px;box-shadow:0 2px 8px rgba(0,0,0,0.2);',
        'transition:background 0.15s;'
      ].join('');

      var heading = document.createElement('div');
      heading.style.cssText = 'font-size:1.05rem;font-weight:700;color:#111;margin-bottom:4px;';
      heading.textContent = 'Hi ' + name.split(' ')[0] + '!';

      var sub = document.createElement('div');
      sub.style.cssText = 'font-size:0.82rem;color:#888;margin-bottom:18px;';
      sub.textContent = subtitle || 'Pick your favorite color';

      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(10,1fr);gap:6px;margin-bottom:20px;justify-items:center;';

      swatchColors.forEach(function (c) {
        var sw = document.createElement('button');
        sw.style.cssText = [
          'width:26px;height:26px;border-radius:50%;background:' + c + ';',
          'border:3px solid ' + (c === selected ? '#fff' : 'transparent') + ';',
          'box-shadow:' + (c === selected ? '0 0 0 2px ' + c : 'none') + ';',
          'cursor:pointer;outline:none;padding:0;'
        ].join('');
        sw.addEventListener('mouseenter', function () { sw.style.transform = 'scale(1.15)'; });
        sw.addEventListener('mouseleave', function () { sw.style.transform = ''; });
        sw.addEventListener('click', function () {
          selected = c;
          preview.style.background = c;
          grid.querySelectorAll('button').forEach(function (b) {
            b.style.border = '3px solid transparent';
            b.style.boxShadow = 'none';
          });
          sw.style.border = '3px solid #fff';
          sw.style.boxShadow = '0 0 0 2px ' + c;
        });
        grid.appendChild(sw);
      });

      var btn = document.createElement('button');
      btn.style.cssText = [
        'width:100%;padding:11px;background:#0f0f13;color:#fff;',
        'border:none;border-radius:8px;font-size:0.95rem;',
        'font-weight:600;cursor:pointer;letter-spacing:0.02em;',
        'font-family:system-ui,sans-serif;'
      ].join('');
      btn.textContent = "Select";
      btn.addEventListener('click', function () {
        overlay.remove();
        resolve(selected);
      });

      card.appendChild(preview);
      card.appendChild(heading);
      card.appendChild(sub);
      card.appendChild(grid);
      card.appendChild(btn);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  }

  function makeCursorEl(name, color) {
    var wrap = document.createElement('div');
    wrap.style.cssText = [
      'position:fixed;pointer-events:none;z-index:99998;',
      'left:-999px;top:-999px;',
      'transition:left 0.06s linear,top 0.06s linear;'
    ].join('');
    wrap.innerHTML = [
      '<svg width="16" height="20" viewBox="0 0 16 20" style="display:block;',
      'filter:drop-shadow(0 1px 3px rgba(0,0,0,0.35))">',
        '<path d="M0 0 L0 14 L4 10.5 L7 18 L9 17 L6 9.5 L11 9.5 Z"',
        ' fill="' + color + '" stroke="#fff" stroke-width="1"/>',
      '</svg>',
      '<div style="position:absolute;top:18px;left:10px;background:' + color + ';',
      'color:#fff;padding:2px 9px;border-radius:4px;font-size:11px;',
      'font-family:system-ui,sans-serif;font-weight:600;white-space:nowrap;',
      'box-shadow:0 1px 5px rgba(0,0,0,0.28);letter-spacing:0.02em;">' + name + '</div>'
    ].join('');
    document.body.appendChild(wrap);
    return wrap;
  }

  function init() {
    var identity = getIdentity();
    var deviceId = getOrCreateDeviceId();
    var page     = window.location.pathname.split('/').pop() || 'index.html';
    var onIndex  = (page === 'index.html' || page === '');

    function afterSetup(name, color, color2) {
      identity.name  = name;
      identity.color = color;
      // Save to server, show code notification
      saveIdentityToServer(deviceId, name, color, color2);
    }

    function runFullSetup() {
      showWelcomeScreen(deviceId).then(function (restored) {
        if (restored) {
          identity.name = restored.name;
          if (restored.fv) {
            // Colors already on file — restore silently
            identity.color = restored.fv;
            window.dispatchEvent(new CustomEvent('efm_color_ready'));
            window.dispatchEvent(new CustomEvent('efm_setup_complete'));
            if (onIndex) startCursors(identity);
            return;
          }
          // Logged in but no colors saved yet — fall through to color prompts
        }
        // Name already saved by welcome screen; go straight to colors
        identity.name = localStorage.getItem('efm_cursor_name') || identity.name;
        Promise.resolve(localStorage.getItem('efm_cursor_color') || showColorPrompt(identity.name))
          .then(function (color) {
            identity.color = color;
            localStorage.setItem('efm_cursor_color', color);
            window.dispatchEvent(new CustomEvent('efm_color_ready'));
            return localStorage.getItem('efm_cursor_color2') || showColorPrompt(identity.name, 'Pick another color');
          })
          .then(function (color2) {
            localStorage.setItem('efm_cursor_color2', color2);
            afterSetup(identity.name, identity.color, color2);
            window.dispatchEvent(new CustomEvent('efm_setup_complete'));
            if (onIndex) startCursors(identity);
          });
      });
    }

    function continueWithIdentity() {
      // Identity is already in localStorage; start normally
      window.dispatchEvent(new CustomEvent('efm_color_ready'));
      if (onIndex) {
        window.dispatchEvent(new CustomEvent('efm_setup_complete'));
        startCursors(identity);
      } else {
        // Non-index pages may still need color prompts if not set
        Promise.resolve(localStorage.getItem('efm_cursor_color') || showColorPrompt(identity.name))
          .then(function (color) {
            identity.color = color;
            localStorage.setItem('efm_cursor_color', color);
            return localStorage.getItem('efm_cursor_color2') || showColorPrompt(identity.name, 'Pick another color');
          })
          .then(function (color2) {
            localStorage.setItem('efm_cursor_color2', color2);
          });
      }
    }

    if (identity.name) {
      // Already set up locally
      continueWithIdentity();
    } else if (onIndex) {
      if (localStorage.getItem('efm_reset')) {
        localStorage.removeItem('efm_reset');
        // Skip the account form — just re-collect name + colors
        window.efmBeginSetup = function () {
          var tempColor = '#888';
          showNamePrompt(tempColor).then(function (name) {
            identity.name = name;
            return showColorPrompt(name);
          }).then(function (color) {
            identity.color = color;
            localStorage.setItem('efm_cursor_color', color);
            window.dispatchEvent(new CustomEvent('efm_color_ready'));
            return showColorPrompt(identity.name, 'Pick another color');
          }).then(function (color2) {
            localStorage.setItem('efm_cursor_color2', color2);
            afterSetup(identity.name, identity.color, color2);
            window.dispatchEvent(new CustomEvent('efm_setup_complete'));
            startCursors(identity);
          });
        };
      } else {
        // Try server lookup first; if found, unlock silently; if not, wait for Go!
        fetchIdentityFromServer(deviceId).then(function (rec) {
          if (rec && rec.name) {
            localStorage.setItem('efm_cursor_name', rec.name);
            if (rec.fv)  localStorage.setItem('efm_cursor_color',  rec.fv);
            if (rec.sfv) localStorage.setItem('efm_cursor_color2', rec.sfv);
            identity.name  = rec.name;
            identity.color = rec.fv || identity.color;
            window.dispatchEvent(new CustomEvent('efm_setup_complete'));
            startCursors(identity);
          } else {
            window.efmBeginSetup = runFullSetup;
          }
        });
      }
    } else {
      // Non-index page, no local identity — try server, then setup if needed
      fetchIdentityFromServer(deviceId).then(function (rec) {
        if (rec && rec.name) {
          localStorage.setItem('efm_cursor_name', rec.name);
          if (rec.fv)  localStorage.setItem('efm_cursor_color',  rec.fv);
          if (rec.sfv) localStorage.setItem('efm_cursor_color2', rec.sfv);
          identity.name  = rec.name;
          identity.color = rec.fv || identity.color;
          continueWithIdentity();
        } else {
          runFullSetup();
        }
      });
    }
  }

  function startCursors(identity) {
    var remote = {};
    var ws;

    // Show own cursor with favorite color and hide the native cursor
    var ownCursor = makeCursorEl('You', identity.color);
    ownCursor.style.transition = 'none'; // no lag on own cursor
    var noNative = document.createElement('style');
    noNative.textContent = '* { cursor: none !important; }';
    document.head.appendChild(noNative);

    function connect() {
      try { ws = new WebSocket(WS_URL); } catch (e) { return; }

      ws.onopen = function () {
        ws.send(JSON.stringify({
          type:  'join',
          id:    identity.id,
          name:  identity.name,
          color: identity.color
        }));
      };

      ws.onmessage = function (e) {
        var data = JSON.parse(e.data);
        if (data.type === 'color_assign') {
          if (data.name && data.name !== identity.name) {
            sessionStorage.setItem('efm_display_name', data.name);
          } else {
            sessionStorage.removeItem('efm_display_name');
          }
        } else if (data.type === 'init') {
          data.cursors.forEach(function (c) { addCursor(c.id, c.name, c.color); });
        } else if (data.type === 'join') {
          addCursor(data.id, data.name, data.color);
        } else if (data.type === 'move') {
          moveCursor(data.id, data.x, data.y);
        } else if (data.type === 'leave') {
          removeCursor(data.id);
        }
      };

      ws.onclose = function () {
        Object.keys(remote).forEach(removeCursor);
        setTimeout(connect, 3000);
      };
    }

    function addCursor(id, name, color) {
      if (id === identity.id) return;
      if (!remote[id]) remote[id] = makeCursorEl(name, color);
    }
    function moveCursor(id, x, y) {
      if (!remote[id]) return;
      remote[id].style.left = x + 'vw';
      remote[id].style.top  = y + 'vh';
    }
    function removeCursor(id) {
      if (remote[id]) { remote[id].remove(); delete remote[id]; }
    }

    var rafPending = false, px = 0, py = 0;
    document.addEventListener('mousemove', function (e) {
      var overButton = !!e.target.closest('button, a, input, [role="button"]');
      var overEFM = !!e.target.closest('#efm-title');
      if (overButton) {
        ownCursor.style.display = 'none';
        noNative.textContent = '';
        return;
      }
      noNative.textContent = '* { cursor: none !important; }';
      ownCursor.style.display = '';
      ownCursor.style.left = e.clientX + 'px';
      ownCursor.style.top  = e.clientY + 'px';
      if (overEFM) return;
      px = (e.clientX / window.innerWidth)  * 100;
      py = (e.clientY / window.innerHeight) * 100;
      if (!rafPending && ws && ws.readyState === 1) {
        rafPending = true;
        requestAnimationFrame(function () {
          ws.send(JSON.stringify({ type: 'move', id: identity.id, x: px, y: py }));
          rafPending = false;
        });
      }
    });

    window.addEventListener('beforeunload', function () {
      if (ws && ws.readyState === 1)
        ws.send(JSON.stringify({ type: 'leave', id: identity.id }));
    });

    connect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
