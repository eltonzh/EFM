(function() {
  var RAILWAY_URL = 'efm.ai-taichi.com';
  var CHAT_WS = window.location.hostname === 'localhost'
    ? 'ws://localhost:8080'
    : 'wss://' + RAILWAY_URL;

  var CHAT_COLORS = [
    '#DC143C','#FF2400','#9B111E','#800020','#800000',
    '#FF007F','#FF6B6B','#FA8072','#FF00FF','#DD77FF',
    '#FFBF00','#F4C430','#F28500','#FFCBA4','#FBCEB1',
    '#FFD700','#FFDB58','#FFFF99','#FFF44F','#FFFDD0',
    '#50C878','#808000','#BCB88A','#98FF98','#00A86B',
    '#32CD32','#228B22','#008080','#7FFF00','#AACC00',
    '#0F52BA','#4B0082','#0047AB','#001F5B','#007BA7',
    '#40E0D0','#967BB6','#C8A2C8','#9966CC','#DDA0DD',
    '#483C32','#704214','#A0522D','#CC7722','#36454F',
    '#708090','#FFFFF0','#F5F5DC','#555D50','#F2F0E6'
  ];
  var nameColorMap = {}, colorIdx = 0;

  function getNameColor(name) {
    if (!nameColorMap[name]) {
      nameColorMap[name] = CHAT_COLORS[colorIdx++ % CHAT_COLORS.length];
    }
    return nameColorMap[name];
  }

  function luminance(hex) {
    if (!hex || hex[0] !== '#' || hex.length < 7) return 0.5;
    var r = parseInt(hex.slice(1,3),16)/255;
    var g = parseInt(hex.slice(3,5),16)/255;
    var b = parseInt(hex.slice(5,7),16)/255;
    return 0.299*r + 0.587*g + 0.114*b;
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? 'am' : 'pm');
  }

  // ── Build DOM ──────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#efm-chat-widget{position:fixed;bottom:0;right:20px;z-index:9999;font-family:system-ui,sans-serif;width:280px;}',
    '#efm-chat-bar{background:#2a7a2a;color:#fff;padding:10px 14px;border-radius:10px 10px 0 0;cursor:pointer;display:flex;align-items:center;gap:8px;user-select:none;}',
    '#efm-chat-bar:hover{background:#236b23;}',
    '#efm-chat-bar-label{flex:1;font-weight:700;font-size:0.88rem;letter-spacing:0.02em;}',
    '#efm-chat-badge{background:#fff;color:#2a7a2a;border-radius:99px;padding:1px 7px;font-size:0.72rem;font-weight:800;display:none;}',
    '#efm-chat-panel{display:none;flex-direction:column;background:#fff;border:1px solid rgba(0,0,0,0.12);border-bottom:none;border-radius:8px 8px 0 0;overflow:hidden;height:340px;}',
    '#efm-chat-msgs{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px;background:#fff;}',
    '#efm-chat-empty{flex:1;display:flex;align-items:center;justify-content:center;color:#888;font-size:0.8rem;text-align:center;padding:20px;}',
    '.ecw-row{display:flex;flex-direction:column;max-width:82%;}',
    '.ecw-row.own{align-self:flex-end;align-items:flex-end;}',
    '.ecw-row.other{align-self:flex-start;align-items:flex-start;}',
    '.ecw-name{font-size:0.67rem;margin-bottom:2px;padding:0 3px;}',
    '.ecw-bubble{padding:7px 11px;border-radius:14px;font-size:0.82rem;line-height:1.4;word-break:break-word;}',
    '.ecw-row.own .ecw-bubble{border-bottom-right-radius:3px;}',
    '.ecw-row.other .ecw-bubble{border-bottom-left-radius:3px;}',
    '.ecw-time{font-size:0.62rem;color:rgba(0,0,0,0.35);margin-top:2px;padding:0 3px;}',
    '#efm-chat-input-row{display:flex;gap:6px;padding:8px;border-top:1px solid rgba(0,0,0,0.08);background:#fff;flex-shrink:0;}',
    '#efm-chat-input{flex:1;border:1.5px solid rgba(0,0,0,0.12);border-radius:99px;padding:7px 12px;font-size:0.82rem;font-family:system-ui,sans-serif;outline:none;background:#f7f7f7;}',
    '#efm-chat-input:focus{border-color:#2a7a2a;background:#fff;}',
    '#efm-chat-send{background:#2a7a2a;color:#fff;border:none;border-radius:99px;padding:7px 14px;font-size:0.82rem;font-weight:600;font-family:system-ui,sans-serif;cursor:pointer;}',
    '#efm-chat-send:active{background:#1e5a1e;}',
  ].join('');
  document.head.appendChild(style);

  var widget = document.createElement('div');
  widget.id = 'efm-chat-widget';
  widget.innerHTML = [
    '<div id="efm-chat-panel">',
    '  <div id="efm-chat-msgs"><div id="efm-chat-empty">No messages yet.<br>Say something!</div></div>',
    '  <div id="efm-chat-input-row">',
    '    <input id="efm-chat-input" type="text" placeholder="Message..." maxlength="500" autocomplete="off">',
    '    <button id="efm-chat-send">Send</button>',
    '  </div>',
    '</div>',
    '<div id="efm-chat-bar">',
    '  <span>💬</span>',
    '  <span id="efm-chat-bar-label">EFM Chat</span>',
    '  <span id="efm-chat-badge"></span>',
    '  <span id="efm-chat-chevron">▲</span>',
    '</div>',
  ].join('');
  document.body.appendChild(widget);

  var panel  = document.getElementById('efm-chat-panel');
  var bar    = document.getElementById('efm-chat-bar');
  var msgs   = document.getElementById('efm-chat-msgs');
  var input  = document.getElementById('efm-chat-input');
  var badge  = document.getElementById('efm-chat-badge');
  var chev   = document.getElementById('efm-chat-chevron');
  var open   = false;
  var unread = 0;

  function setOpen(v) {
    open = v;
    panel.style.display = v ? 'flex' : 'none';
    chev.textContent = v ? '▼' : '▲';
    if (v) { unread = 0; badge.style.display = 'none'; badge.textContent = ''; msgs.scrollTop = msgs.scrollHeight; input.focus(); }
  }

  bar.addEventListener('click', function() { setOpen(!open); });

  // ── Render a message ───────────────────────────────────────────────────────
  function renderMsg(msg) {
    var empty = document.getElementById('efm-chat-empty');
    if (empty) empty.remove();

    var myName = localStorage.getItem('efm_cursor_name') || 'Guest';
    var isOwn = msg.name === myName;
    var bg = isOwn
      ? (localStorage.getItem('efm_cursor_color') || '#2a7a2a')
      : getNameColor(msg.name);

    var row = document.createElement('div');
    row.className = 'ecw-row ' + (isOwn ? 'own' : 'other');

    if (!isOwn) {
      var nameEl = document.createElement('div');
      nameEl.className = 'ecw-name';
      nameEl.style.color = bg;
      nameEl.textContent = msg.name;
      row.appendChild(nameEl);
    }

    var bubble = document.createElement('div');
    bubble.className = 'ecw-bubble';
    bubble.textContent = msg.text;
    bubble.style.background = bg;
    bubble.style.color = luminance(bg) > 0.55 ? '#111' : '#fff';
    row.appendChild(bubble);

    var time = document.createElement('div');
    time.className = 'ecw-time';
    time.textContent = fmtTime(msg.time);
    row.appendChild(time);

    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;

    if (!open && !isOwn) {
      unread++;
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.style.display = 'inline';
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
  var ws;
  function connect() {
    try { ws = new WebSocket(CHAT_WS); } catch(e) { return; }
    ws.onopen = function() {
      var myName = localStorage.getItem('efm_cursor_name') || 'Guest';
      ws.send(JSON.stringify({ type: 'chat_join', name: myName }));
    };
    ws.onmessage = function(e) {
      var data = JSON.parse(e.data);
      if (data.type === 'chat_history') {
        msgs.innerHTML = '<div id="efm-chat-empty">No messages yet.<br>Say something!</div>';
        nameColorMap = {}; colorIdx = 0;
        data.messages.slice(-50).forEach(renderMsg);
      } else if (data.type === 'chat') {
        renderMsg(data);
      }
    };
    ws.onclose = function() { setTimeout(connect, 3000); };
  }
  connect();

  // ── Send ───────────────────────────────────────────────────────────────────
  function send() {
    var text = input.value.trim();
    if (!text) return;
    var myName = localStorage.getItem('efm_cursor_name') || 'Guest';
    var msg = { name: myName, text: text, time: new Date().toISOString() };
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'chat', name: msg.name, text: msg.text, time: msg.time }));
    } else {
      renderMsg(msg);
    }
    input.value = '';
    input.focus();
  }

  document.getElementById('efm-chat-send').addEventListener('click', send);
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') send(); });
})();
