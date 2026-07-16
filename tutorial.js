(function () {
  'use strict';

  var overlayEls = [];

  function clearOverlay() {
    overlayEls.forEach(function (el) { try { el.parentNode.removeChild(el); } catch (e) {} });
    overlayEls = [];
  }

  function addEl(css, parent) {
    var el = document.createElement('div');
    el.style.cssText = css;
    (parent || document.body).appendChild(el);
    overlayEls.push(el);
    return el;
  }

  function fullDim() {
    addEl('position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);pointer-events:all;');
  }

  function spotlightRect(r) {
    var pad = 10;
    var x1 = Math.max(0, r.left - pad);
    var y1 = Math.max(0, r.top - pad);
    var x2 = Math.min(window.innerWidth, r.right + pad);
    var y2 = Math.min(window.innerHeight, r.bottom + pad);
    var base = 'position:fixed;z-index:9999;background:rgba(0,0,0,0.75);pointer-events:all;';
    addEl(base + 'left:0;top:0;right:0;height:' + y1 + 'px');
    addEl(base + 'left:0;top:' + y2 + 'px;right:0;bottom:0');
    addEl(base + 'left:0;top:' + y1 + 'px;width:' + x1 + 'px;height:' + (y2 - y1) + 'px');
    addEl(base + 'left:' + x2 + 'px;top:' + y1 + 'px;right:0;height:' + (y2 - y1) + 'px');
  }

  function showBubble(r, text) {
    var bw = 260;
    var cx = (r.left + r.right) / 2;
    var left = Math.min(window.innerWidth - bw - 10, Math.max(10, cx - bw / 2));
    var top = r.bottom + 14;
    var bub = addEl(
      'position:fixed;z-index:10000;background:#fff;color:#0f0f13;' +
      'font-family:system-ui,sans-serif;font-size:0.9rem;font-weight:500;line-height:1.5;' +
      'padding:14px 16px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.3);' +
      'width:' + bw + 'px;pointer-events:none;' +
      'left:' + left + 'px;top:' + top + 'px;'
    );
    bub.textContent = text;
    var arrowX = Math.min(bw - 16, Math.max(12, cx - left));
    var arrow = document.createElement('div');
    arrow.style.cssText =
      'position:absolute;bottom:100%;left:' + arrowX + 'px;transform:translateX(-50%);' +
      'width:0;height:0;border:8px solid transparent;border-bottom-color:#fff;';
    bub.appendChild(arrow);
  }

  function spotlightEl(id, text, nextStep) {
    var el = document.getElementById(id);
    if (!el) return;
    setTimeout(function () {
      var r = el.getBoundingClientRect();
      spotlightRect(r);
      showBubble(r, text);
      el.addEventListener('click', function () {
        localStorage.setItem('efm_tutorial_step', String(nextStep));
      }, { once: true });
    }, 60);
  }

  function init() {
    clearOverlay();
    var step = localStorage.getItem('efm_tutorial_step');
    if (!step || step === 'done') return;

    var page = window.location.pathname.split('/').pop() || 'index.html';
    var isIndex = page === 'index.html' || page === '';

    if (step === '1' && isIndex) {
      fullDim();
      var card = addEl(
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;' +
        'background:#fff;border-radius:16px;padding:32px 36px;' +
        'box-shadow:0 8px 40px rgba(0,0,0,0.3);text-align:center;' +
        'font-family:system-ui,sans-serif;pointer-events:all;max-width:360px;width:90vw;'
      );
      card.innerHTML =
        '<p style="font-size:1.25rem;font-weight:700;color:#0f0f13;margin:0 0 20px;">Welcome to Tutorial!</p>' +
        '<button id="_tut_go" style="padding:12px 28px;font-size:1rem;font-weight:700;' +
        'font-family:system-ui,sans-serif;background:#0f0f13;color:#fff;border:none;' +
        'border-radius:10px;cursor:pointer;">Let\'s Go ›</button>';
      document.getElementById('_tut_go').onclick = function () {
        localStorage.setItem('efm_tutorial_step', '2');
        init();
      };

    } else if (step === '2' && isIndex) {
      spotlightEl('nav-about',
        'Click on the About button to view info about this website and its creator!', '3');

    } else if (step === '3' && page === 'about.html') {
      spotlightEl('back-btn',
        'Click on "Back" buttons to go back to the page you were at before!', '4');

    } else if (step === '4' && isIndex) {
      spotlightEl('nav-notebook',
        'Use the Notebook for taking notes and jotting down your ideas.', '5');

    } else if (step === '5' && page === 'notebook.html') {
      spotlightEl('back-btn',
        'Now try clicking the "Back" button on this page yourself!', 'done');
    }
  }

  init();
})();
