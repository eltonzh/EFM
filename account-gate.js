// account-gate.js — inline "you need an account" gate for the two chat surfaces.
//
// EFM is free to browse. Only group-chat.html and elton-chat.html ask for an account, and
// they ask in place rather than redirecting the visitor away from the page.
//
// Usage:
//   <head>  <script src="account-gate.js"></script>
//           <script>EFMGate.preHide('#chat-main');</script>
//   <body>  EFMGate.gate('#chat-main', 'EFM Group Chat', connectChat);
//
// The gate is optimistic: it renders immediately rather than waiting on the network, then
// un-gates if cursors.js later restores an identity from the server (that lookup can take
// up to 4s — see _identityWS in cursors.js).
//
// NOTE: this is a UX affordance, not a security boundary. The server accepts chat frames
// from any socket; see the notes in the PR that introduced this file.
(function (global) {
  var HIDE_ID = 'efm-gate-prehide';

  var base = document.createElement('style');
  base.textContent =
    '.efm-gated { display:block !important; overflow:auto !important; }' +
    '.efm-gated > *:not(.efm-gate-card) { display:none !important; }';
  (document.head || document.documentElement).appendChild(base);

  function state() {
    if (localStorage.getItem('efm_cursor_name')) return 'in';
    if (localStorage.getItem('efm_pending_approval_email')) return 'pending';
    return 'out';
  }

  // Call from <head>, before the host element is parsed: suppresses the flash of ungated
  // UI in the window before gate() decides.
  function preHide(selector) {
    if (state() === 'in') return;
    var s = document.createElement('style');
    s.id = HIDE_ID;
    s.textContent = selector + ' > * { visibility:hidden !important; }';
    (document.head || document.documentElement).appendChild(s);
    // Failsafe: if gate() never runs (e.g. a page script threw first), reveal the page
    // rather than leaving a child staring at a blank screen. Deliberately fails open.
    setTimeout(unHide, 5000);
  }

  function unHide() {
    var s = document.getElementById(HIDE_ID);
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  function cardHtml(feature, s) {
    var pending = (s === 'pending');
    return '' +
      '<div style="max-width:420px;margin:80px auto;padding:40px 32px;text-align:center;' +
      'font-family:system-ui,sans-serif;background:#fff;border:1.5px solid #eee;' +
      'border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">' +
        '<div style="font-size:2.5rem;margin-bottom:16px;">' +
          (pending ? '&#128337;' : '&#128274;') + '</div>' +
        '<p style="font-weight:700;font-size:1.2rem;color:#0f0f13;margin:0 0 10px;">' +
          (pending ? 'Account access pending.' : feature + ' needs an account') + '</p>' +
        '<p style="color:#555;font-size:1rem;margin:0 0 24px;line-height:1.5;">' +
          (pending
            ? 'Elton is reviewing your account. This may take a few days &mdash; everything ' +
              'else on EFM stays open.'
            : 'Create a free EFM account to use ' + feature + '. Everything else on EFM ' +
              'stays free and open.') + '</p>' +
        (pending
          ? '<a href="efm_version_k.html" style="display:block;padding:14px;font-weight:700;' +
            'background:#27ae60;color:#fff;border-radius:10px;text-decoration:none;' +
            'margin-bottom:12px;">Keep exploring</a>'
          : '<a href="signup.html" style="display:block;padding:14px;font-weight:700;' +
            'background:#0f0f13;color:#fff;border-radius:10px;text-decoration:none;' +
            'margin-bottom:12px;">Create a free account</a>') +
        '<a href="signup.html" style="color:#555;font-size:0.9rem;text-decoration:none;">' +
          (pending ? 'Already approved? Log in' : 'Already have one? Log in') + '</a>' +
      '</div>';
  }

  // Replaces the contents of `selector` with a sign-up card unless the visitor has an
  // account. `onOpen` runs when (and only when) the feature is allowed to start.
  //
  // Children are hidden with a CSS class rather than by replacing innerHTML, so the page's
  // own event listeners survive and the gate can be reversed if an identity turns up.
  function gate(selector, feature, onOpen) {
    var host = document.querySelector(selector);
    if (!host) return;

    function open() {
      unHide();
      var card = host.querySelector('.efm-gate-card');
      if (card) host.removeChild(card);
      host.classList.remove('efm-gated');
      if (onOpen) onOpen();
    }

    function shut() {
      if (!host.querySelector('.efm-gate-card')) {
        var card = document.createElement('div');
        card.className = 'efm-gate-card';
        card.innerHTML = cardHtml(feature, state());
        host.appendChild(card);
      }
      host.classList.add('efm-gated');
      unHide();
    }

    if (state() === 'in') { open(); return; }

    shut();

    // cursors.js may still restore an identity from the server. Pages without cursors.js
    // never fire this, which is correct — no restore happens there either.
    global.addEventListener('efm_color_ready', function () {
      if (state() === 'in') open();
    }, { once: true });
  }

  global.EFMGate = {
    state: state,
    isOpen: function () { return state() === 'in'; },
    preHide: preHide,
    gate: gate
  };
})(window);
