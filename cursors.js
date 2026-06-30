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
  // ← AFTER Railway deploy, replace RAILWAY_URL with your app's Railway domain
  var RAILWAY_URL = 'acceptable-adaptation-production-565f.up.railway.app'; // e.g. "efm-production.up.railway.app"
  var WS_URL = window.location.hostname === 'localhost'
    ? 'ws://localhost:8080'
    : 'wss://' + RAILWAY_URL;

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
        '#FFBF00','#F4C430','#F28500','#FFCBA4','#FBCEB1', // Amber Saffron Tangerine Peach Apricot
        '#FFD700','#FFDB58','#FFFF99','#FFF44F','#FFFDD0', // Gold Mustard Canary Lemon Cream
        '#50C878','#808000','#BCB88A','#98FF98','#00A86B', // Emerald Olive Sage Mint Jade
        '#32CD32','#228B22','#008080','#7FFF00','#AACC00', // Lime ForestGreen Teal Chartreuse Peridot
        '#0F52BA','#4B0082','#0047AB','#001F5B','#007BA7', // Sapphire Indigo Cobalt Navy Cerulean
        '#40E0D0','#967BB6','#C8A2C8','#9966CC','#DDA0DD', // Turquoise Lavender Lilac Amethyst Plum
        '#483C32','#704214','#A0522D','#CC7722','#36454F', // Taupe Sepia Sienna Ochre Charcoal
        '#708090','#FFFFF0','#F5F5DC','#555D50','#F2F0E6'  // Slate Ivory Beige Ebony Alabaster
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

    Promise.resolve(identity.name || showNamePrompt(identity.color))
      .then(function (name) {
        identity.name = name;
        var storedColor = localStorage.getItem('efm_cursor_color');
        return storedColor || showColorPrompt(name);
      })
      .then(function (color) {
        identity.color = color;
        localStorage.setItem('efm_cursor_color', color);
        window.dispatchEvent(new CustomEvent('efm_color_ready'));
        var storedColor2 = localStorage.getItem('efm_cursor_color2');
        return storedColor2 || showColorPrompt(identity.name, 'Pick another color');
      })
      .then(function (color2) {
        localStorage.setItem('efm_cursor_color2', color2);
        var page = window.location.pathname.split('/').pop() || 'index.html';
        if (page === 'index.html' || page === '') startCursors(identity);
      });
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
        if (data.type === 'init') {
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
      if (id === identity.id || name === identity.name) return;
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
