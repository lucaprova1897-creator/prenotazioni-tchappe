/**
 * modern.js — interattività della nuova grafica di Home e Lista
 * (novembre 2026). Va caricato per ULTIMO.
 *
 * Regola d'oro: non cambia nessuna funzione dell'app. Si aggancia DOPO
 * che l'app ha disegnato la pagina (renderDashboard / renderList /
 * showScreen) e aggiunge solo cose in più: striscia dei giorni, swipe per
 * cambiare giorno, anello di riempimento, numeri animati, andamento del
 * servizio, filtri rapidi nella lista, "adesso" e "prossimo arrivo".
 * Per cambiare giorno o servizio usa i pulsanti/campi che esistono già,
 * così passa sempre dalla logica originale. Se qualcosa qui dentro va
 * storto, l'errore resta qui e l'app continua a funzionare come prima.
 */
(function () {
  'use strict';
  if (typeof UI === 'undefined') return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function safe(fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { console.warn('[modern]', e); }
    };
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function nowHHMM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function toMin(t) { var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function today() { return Utils.todayISO(); }
  function shift(iso, n) { return UI.shiftDate(iso, n); }
  function pageY() { return window.scrollY || document.body.scrollTop || document.documentElement.scrollTop || 0; }
  function scrollPageTop() {
    try { window.scrollTo(0, 0); document.body.scrollTop = 0; document.documentElement.scrollTop = 0; } catch (e) { /* ignora */ }
  }
  function haptic() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* ignora */ } }

  var ICON = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/></svg>',
    preview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M3 9h18M9 21V9"/></svg>',
    sun: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-2px"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  };

  // ======================================================================
  // Numeri che "contano" fino al nuovo valore
  // ======================================================================
  var prevNums = {};
  function countUp(node, key) {
    if (!node) return;
    var to = parseInt(node.textContent, 10);
    if (isNaN(to)) return;
    var from = prevNums[key];
    prevNums[key] = to;
    if (from === undefined || from === to) return;
    if (REDUCED) return;
    if (node._mxRaf) cancelAnimationFrame(node._mxRaf);
    var start = performance.now(), dur = Math.min(900, 350 + Math.abs(to - from) * 25);
    var step = function (t) {
      var k = Math.min(1, (t - start) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      // se nel frattempo l'app ha scritto un altro valore, si ferma
      if (node._mxLast !== undefined && node.textContent !== String(node._mxLast)) { node._mxRaf = null; return; }
      var v = Math.round(from + (to - from) * e);
      node.textContent = v;
      node._mxLast = v;
      if (k < 1) node._mxRaf = requestAnimationFrame(step);
      else { node._mxRaf = null; node._mxLast = undefined; node.textContent = to; }
    };
    node._mxLast = from;
    node.textContent = from;
    node._mxRaf = requestAnimationFrame(step);
    node.classList.remove('mx-bump'); void node.offsetWidth; node.classList.add('mx-bump');
  }

  // ======================================================================
  // Impostazione iniziale (una volta sola)
  // ======================================================================
  var ui = { lastKey: { dashboard: null, list: null }, lastDate: null, barSel: null };

  var setup = safe(function () {
    // --- Titolo + sottotitolo nelle due barre in alto
    [['screen-dashboard', 'mxDashSub'], ['screen-list', 'mxListSub']].forEach(function (p) {
      var tb = $('#' + p[0] + ' .topbar');
      var h1 = tb && tb.querySelector('h1');
      if (!h1 || h1.parentNode.classList.contains('mx-title-wrap')) return;
      var w = el('div', 'mx-title-wrap');
      h1.parentNode.insertBefore(w, h1);
      w.appendChild(h1);
      var sub = el('div', 'mx-subtitle');
      sub.id = p[1];
      w.appendChild(sub);
    });

    // --- Icone moderne al posto delle emoji (stesso pulsante, stessa funzione)
    var rb = $('#refreshBtn');
    if (rb) {
      rb.innerHTML = ICON.refresh;
      rb.setAttribute('aria-label', 'Aggiorna');
      rb.addEventListener('click', function () {
        rb.classList.add('mx-spin');
        setTimeout(function () { rb.classList.remove('mx-spin'); }, 900);
      });
    }
    var pb = $('#openPreviewBtn');
    if (pb) { pb.innerHTML = ICON.preview; pb.setAttribute('aria-label', 'Anteprima sala'); }

    // --- Il calendario si apre toccando l'icona ovunque
    ['dashJumpDate', 'listJumpDate'].forEach(function (id) {
      var inp = document.getElementById(id);
      if (!inp) return;
      inp.setAttribute('aria-label', 'Vai a una data');
      inp.addEventListener('click', function () { try { if (inp.showPicker) inp.showPicker(); } catch (e) { /* ignora */ } });
    });

    // --- Pranzo / Cena: icona + indicatore che scivola
    [['btnServiceLunch', 'sun'], ['btnServiceDinner', 'moon'], ['listBtnLunch', 'sun'], ['listBtnDinner', 'moon']].forEach(function (p) {
      var b = document.getElementById(p[0]);
      if (b && !b.querySelector('.mx-svc-ico')) b.insertAdjacentHTML('afterbegin', '<span class="mx-svc-ico" aria-hidden="true">' + ICON[p[1]] + '</span>');
    });
    $$('#screen-dashboard .service-toggle, #screen-list .service-toggle, #screen-preview .service-toggle').forEach(function (t) { t.classList.add('mx-seg'); });
    [['previewBtnLunch', 'sun'], ['previewBtnDinner', 'moon']].forEach(function (p) {
      var b = document.getElementById(p[0]);
      if (b && !b.querySelector('.mx-svc-ico')) b.insertAdjacentHTML('afterbegin', '<span class="mx-svc-ico" aria-hidden="true">' + ICON[p[1]] + '</span>');
    });
    var pvCard = $('#screen-preview .date-service-card');
    if (pvCard) enableSwipe(pvCard, 'previewPrevDay', 'previewNextDay');

    setupSheets();

    // --- Striscia dei giorni + swipe sulle due schede data
    [['#screen-dashboard .date-service-card', 'dashJumpDate', 'dashPrevDay', 'dashNextDay'],
     ['#screen-list .date-service-card', 'listJumpDate', 'listPrevDay', 'listNextDay']].forEach(function (p) {
      var card = $(p[0]);
      if (!card) return;
      var strip = el('div', 'mx-days');
      strip.setAttribute('role', 'tablist');
      strip.setAttribute('aria-label', 'Scegli il giorno');
      card.appendChild(strip);
      strip.addEventListener('click', function (e) {
        var d = e.target.closest('.mx-day');
        if (!d) return;
        haptic();
        goToDate(p[1], d.dataset.date);
      });
      enableSwipe(card, p[2], p[3]);
    });

    // --- Home: anello di riempimento dentro la scheda stato servizio
    var ssc = $('#screen-dashboard .service-status-card');
    if (ssc && !$('.mx-ring', ssc)) {
      var C = 2 * Math.PI * 40;
      var ring = el('div', 'mx-ring',
        '<svg viewBox="0 0 92 92" aria-hidden="true">' +
          '<circle class="mx-ring-track" cx="46" cy="46" r="40" fill="none" stroke-width="9"/>' +
          '<circle class="mx-ring-val" cx="46" cy="46" r="40" fill="none" stroke-width="9" stroke="#2F8A5B" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"/>' +
        '</svg>' +
        '<div class="mx-ring-center"><span class="mx-ring-pct"><span id="mxRingPct">0</span><small>%</small></span><span class="mx-ring-cap">pieno</span></div>');
      ssc.insertBefore(ring, ssc.firstChild);
      ssc.classList.add('mx-has-ring');
      // tocco sull'anello = vai alla lista del servizio
      ring.style.cursor = 'pointer';
      ring.title = 'Apri la lista di questo servizio';
      ring.addEventListener('click', function () { openList(); });
    }

    // --- Home: andamento del servizio (barre per orario), sotto lo stato
    if (ssc && !$('#mxTimeline')) {
      var tl = el('div', 'mx-timeline');
      tl.id = 'mxTimeline';
      ssc.parentNode.insertBefore(tl, ssc.nextSibling);
      tl.addEventListener('click', function (e) {
        var go = e.target.closest('.mx-pop-go');
        if (go) { openList(); return; }
        var bar = e.target.closest('.mx-bar');
        if (!bar) return;
        haptic();
        ui.barSel = ui.barSel === bar.dataset.slot ? null : bar.dataset.slot;
        renderTimeline(true);
      });
    }

    // --- Home: riepilogo giornata → riquadri cliccabili con mini barra
    $$('#screen-dashboard .day-summary-row').forEach(function (row, i) {
      if (!row.querySelector('.mx-mini-bar')) row.appendChild(el('div', 'mx-mini-bar', '<i></i>'));
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      var svc = i === 0 ? 'lunch' : 'dinner';
      row.title = 'Mostra ' + (svc === 'lunch' ? 'il pranzo' : 'la cena');
      var go = function () {
        haptic();
        var b = document.getElementById(svc === 'lunch' ? 'btnServiceLunch' : 'btnServiceDinner');
        if (b) b.click();
      };
      row.addEventListener('click', go);
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });

    // --- Home: azioni rapide in griglia (stessi pulsanti, spostati)
    var ds = $('#dailySpecialsDrawerTrigger'), ods = $('#odsTrigger'), kf = $('#kitchenFreeBtn');
    if (ds && ods && kf && !$('.mx-quick')) {
      var q = el('div', 'mx-quick');
      ds.parentNode.insertBefore(q, ds);
      q.appendChild(ds); q.appendChild(ods); q.appendChild(kf);
      kf.innerHTML = '<span class="mx-kf-icon" aria-hidden="true">🍽️</span><span>Segnala cucina libera</span>';
      kf.addEventListener('click', function () {
        kf.classList.add('mx-sent');
        setTimeout(function () { kf.classList.remove('mx-sent'); }, 1500);
      });
    }

    // --- Lista: filtri rapidi nella testata che resta in alto
    var head = $('#screen-list > .dashboard-content');
    if (head && !$('#mxFilters')) {
      var f = el('div', 'mx-filters');
      f.id = 'mxFilters';
      f.setAttribute('role', 'toolbar');
      f.setAttribute('aria-label', 'Filtra le prenotazioni');
      head.appendChild(f);
      f.addEventListener('click', function (e) {
        var c = e.target.closest('.mx-chip');
        if (!c) return;
        haptic();
        setFilter(c.dataset.f === getFilter() && c.dataset.f !== 'all' ? 'all' : c.dataset.f);
      });
    }

    // --- Lista: leggera vibrazione sui pulsanti delle schede (telefono)
    var lc = $('#listContent');
    if (lc) lc.addEventListener('click', function (e) {
      if (e.target.closest('.arrived-check, .noshow-check, .completed-check, .table-assign-btn-sm, .table-badge-box')) haptic();
      var reset = e.target.closest('.mx-filter-reset');
      if (reset) setFilter('all');
    });

    // --- Indice per l'ingresso "a cascata" delle card della Home
    $$('#screen-dashboard .dashboard-content > *').forEach(function (n, i) { n.style.setProperty('--mx-i', i); });

    // --- Scorrimento: ombra barra in alto, testata compatta, pulsante "+" ridotto
    // NB: in questa app a scorrere è il <body>, non la finestra — si
    // ascolta in "cattura" e si ignorano gli scorrimenti interni (es. la
    // striscia dei giorni o i filtri, che scorrono in orizzontale).
    var lastY = 0, compact = false;
    document.addEventListener('scroll', function (e) {
      var t = e.target;
      if (t !== document && t !== document.body && t !== document.documentElement) return;
      var y = pageY(), body = document.body;
      body.classList.toggle('mx-scrolled', y > 4);
      if (!compact && y > 170) { compact = true; body.classList.add('mx-compact'); }
      else if (compact && y < 40) { compact = false; body.classList.remove('mx-compact'); }
      if (y > 220 && y > lastY + 4) body.classList.add('mx-fab-mini');
      else if (y < lastY - 4 || y < 120) body.classList.remove('mx-fab-mini');
      lastY = y;
    }, { passive: true, capture: true });

    // --- Tastiera (tablet/computer): frecce ← → per cambiare giorno
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.modal-overlay.active, .modal.active, .ds-drawer-panel.open')) return;
      var scr = UI.state.currentScreen;
      if (scr !== 'dashboard' && scr !== 'list') return;
      var prefix = scr === 'dashboard' ? 'dash' : 'list';
      var b = document.getElementById(prefix + (e.key === 'ArrowLeft' ? 'PrevDay' : 'NextDay'));
      if (b) { e.preventDefault(); b.click(); }
    });

    // --- Orologio nel sottotitolo
    setInterval(safe(function () {
      if (UI.state.currentScreen === 'dashboard') renderDashSubtitle();
    }), 20000);

    window.addEventListener('resize', safe(measureTopbar));
    // Altezza della testata fissa della Lista: su tablet la piantina
    // "incollata" a sinistra deve stare sotto di lei, non coperta
    var headEl = $('#screen-list > .dashboard-content');
    if (headEl && 'ResizeObserver' in window) {
      new ResizeObserver(safe(function () {
        if (headEl.offsetHeight) document.documentElement.style.setProperty('--mx-head', headEl.offsetHeight + 'px');
        measureTopbar();
      })).observe(headEl);
    }
  });

  // ======================================================================
  // Finestre e modulo: trascina giù per chiudere, contatori, vibrazione
  // ======================================================================
  function setupSheets() {
    // --- Trascinare la maniglia di una finestra verso il basso la chiude.
    // Chiude esattamente come un tocco sullo sfondo (stesso gestore
    // dell'app), quindi le finestre "bloccanti" non si chiudono mai così.
    var drag = null;
    document.addEventListener('pointerdown', function (e) {
      var sheet = e.target.closest && e.target.closest('.modal-overlay.active > .modal-sheet');
      if (!sheet) return;
      var ov = sheet.parentNode;
      if (ov.classList.contains('modal-blocking') || ov.classList.contains('modal-overlay-centered')) return;
      if (e.target.closest('input, textarea, select, button, a, [contenteditable]')) return;
      var r = sheet.getBoundingClientRect();
      // solo dalla parte alta (maniglia/titolo), e solo se non è scorsa
      if (e.clientY - r.top > 64 || sheet.scrollTop > 0) return;
      drag = { sheet: sheet, ov: ov, y0: e.clientY, dy: 0, t0: Date.now() };
      sheet.classList.add('mx-dragging');
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.dy = Math.max(0, e.clientY - drag.y0);
      drag.sheet.style.transform = 'translateY(' + drag.dy + 'px)';
    }, { passive: true });
    var endDrag = function () {
      if (!drag) return;
      var d = drag; drag = null;
      d.sheet.classList.remove('mx-dragging');
      var fast = d.dy > 40 && (Date.now() - d.t0) < 250;
      if (d.dy > 110 || fast) {
        haptic();
        d.sheet.classList.add('mx-snap');
        d.sheet.style.transform = 'translateY(100%)';
        setTimeout(function () {
          d.ov.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          d.sheet.classList.remove('mx-snap');
          d.sheet.style.transform = '';
        }, 200);
      } else {
        d.sheet.classList.add('mx-snap');
        d.sheet.style.transform = '';
        setTimeout(function () { d.sheet.classList.remove('mx-snap'); }, 320);
      }
    };
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    // --- Contatori − n +: il numero "rimbalza" quando cambia
    document.addEventListener('click', function (e) {
      var sb = e.target.closest && e.target.closest('.stepper-btn');
      if (sb) {
        haptic();
        var val = sb.parentNode && sb.parentNode.querySelector('.stepper-value');
        if (val && !REDUCED) {
          setTimeout(function () { val.classList.remove('mx-bump'); void val.offsetWidth; val.classList.add('mx-bump'); }, 0);
        }
        return;
      }
      if (e.target.closest && e.target.closest('.slot-pill, .form-table-pill, .table-pill, .zone-btn, .status-btn, .service-btn, .piantina-style-btn, .fdate-quick-btn, .booking-actions-menu button')) haptic();
    }, true);
  }

  // ======================================================================
  // Navigazione: passa SEMPRE dai controlli originali dell'app
  // ======================================================================
  function goToDate(inputId, iso) {
    var inp = document.getElementById(inputId);
    if (!inp || !iso || iso === UI.state.selectedDate) return;
    inp.value = iso;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function openList() {
    var nav = document.querySelector('.nav-item[data-screen="list"]');
    if (nav && nav.offsetParent !== null) nav.click();
    else UI.showScreen('list');
    scrollPageTop();
  }

  function enableSwipe(card, prevId, nextId) {
    var sx = 0, sy = 0, active = false, swallow = false;
    card.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.mx-days')) return; // la striscia scorre da sola
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      active = true; sx = e.clientX; sy = e.clientY;
    });
    card.addEventListener('pointerup', function (e) {
      if (!active) return;
      active = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        haptic();
        var b = document.getElementById(dx < 0 ? nextId : prevId);
        if (b) b.click();
        // il clic "vero" che il browser manda dopo il dito alzato non deve
        // premere anche il pulsante che c'era sotto (va attivato DOPO b.click)
        swallow = true;
        setTimeout(function () { swallow = false; }, 350);
      }
    });
    card.addEventListener('pointercancel', function () { active = false; });
    card.addEventListener('click', function (e) {
      if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; }
    }, true);
  }

  // ======================================================================
  // Striscia dei giorni
  // ======================================================================
  function dayCounts() {
    var map = {};
    (Bookings._cache || []).forEach(function (b) {
      if (b.status === 'cancelled' || b.status === 'archived' || b.status === 'noshow') return;
      map[b.date] = (map[b.date] || 0) + 1;
    });
    return map;
  }
  function renderDays(card) {
    var strip = card && $('.mx-days', card);
    if (!strip) return;
    var sel = UI.state.selectedDate, t = today(), counts = dayCounts();
    var html = '';
    for (var i = -3; i <= 10; i++) {
      var iso = shift(sel, i);
      var d = Utils.isoToDate(iso);
      if (d.getDate() === 1 || i === -3) {
        html += '<span class="mx-day-month" aria-hidden="true">' + d.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '') + '</span>';
      }
      var n = counts[iso] || 0;
      var dots = n === 0 ? '' : n <= 5 ? '<i></i>' : n <= 15 ? '<i></i><i></i>' : '<i></i><i></i><i></i>';
      var closed = false;
      try { closed = !!(SharedTables.getClosureFor(iso, 'lunch') && SharedTables.getClosureFor(iso, 'dinner')); } catch (e) { /* ignora */ }
      var cls = 'mx-day' + (iso === sel ? ' is-active' : '') + (iso === t ? ' is-today' : '') + (closed ? ' is-closed' : '');
      var label = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) +
        (n ? ' — ' + n + (n === 1 ? ' prenotazione' : ' prenotazioni') : '') + (closed ? ' — chiuso' : '');
      html += '<button type="button" role="tab" class="' + cls + '" data-date="' + iso + '" aria-selected="' + (iso === sel) + '" title="' + esc(label) + '">' +
        '<span class="mx-day-wd">' + (iso === t ? 'oggi' : d.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '')) + '</span>' +
        '<span class="mx-day-n">' + d.getDate() + '</span>' +
        '<span class="mx-day-dots">' + dots + '</span>' +
      '</button>';
    }
    strip.innerHTML = html;
    var act = $('.mx-day.is-active', strip);
    if (act) strip.scrollLeft = act.offsetLeft - strip.clientWidth / 2 + act.offsetWidth / 2;
  }

  // Direzione dell'animazione quando cambia il giorno
  function animateDateChange(card) {
    var sel = UI.state.selectedDate;
    if (ui.lastDate && ui.lastDate !== sel && card && !REDUCED) {
      var cls = sel > ui.lastDate ? 'mx-slide-left' : 'mx-slide-right';
      card.classList.remove('mx-slide-left', 'mx-slide-right'); void card.offsetWidth;
      card.classList.add(cls);
      setTimeout(function () { card.classList.remove(cls); }, 400);
    }
  }

  function syncToggle(screenEl, service) {
    var svc = service || UI.state.selectedService;
    $$('.service-toggle.mx-seg', screenEl).forEach(function (t) {
      t.classList.toggle('mx-dinner', svc === 'dinner');
    });
  }

  function bumpSwap(screenEl, key, which) {
    if (ui.lastKey[which] && ui.lastKey[which] !== key && !REDUCED) {
      screenEl.classList.remove('mx-swap'); void screenEl.offsetWidth;
      screenEl.classList.add('mx-swap');
      clearTimeout(screenEl._mxSwapT);
      screenEl._mxSwapT = setTimeout(function () { screenEl.classList.remove('mx-swap'); }, 900);
    }
    ui.lastKey[which] = key;
  }

  // ======================================================================
  // HOME
  // ======================================================================
  function renderDashSubtitle() {
    var sub = $('#mxDashSub');
    if (!sub) return;
    var h = new Date().getHours();
    var greet = h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
    var who = (typeof DB !== 'undefined' && DB.getOperator && DB.getOperator()) || '';
    sub.innerHTML = greet + (who ? ', <b>' + esc(who.split(' ')[0]) + '</b>' : '') + ' · <span class="mx-clock">' + nowHHMM() + '</span>';
  }

  function renderRing() {
    var bar = $('#dashFillBar'), val = $('.mx-ring .mx-ring-val'), pctEl = $('#mxRingPct');
    if (!bar || !val || !pctEl) return;
    var pct = Math.max(0, Math.min(100, parseFloat(bar.style.width) || 0));
    var C = 2 * Math.PI * 40;
    val.style.strokeDashoffset = (C * (1 - pct / 100)).toFixed(1);
    val.style.stroke = pct >= 90 ? '#C0392B' : pct >= 60 ? '#C98A1E' : '#2F8A5B';
    pctEl.textContent = Math.round(pct);
    countUp(pctEl, 'ring');
  }

  function renderDaySummaryExtras() {
    var svc = UI.state.selectedService;
    $$('#screen-dashboard .day-summary-row').forEach(function (row, i) {
      row.classList.toggle('mx-current', (i === 0 ? 'lunch' : 'dinner') === svc);
      var spans = row.querySelectorAll(':scope > span');
      var booked = parseInt(spans[1] && spans[1].textContent, 10) || 0;
      var served = parseInt(spans[2] && spans[2].textContent, 10) || 0;
      var bar = row.querySelector('.mx-mini-bar i');
      if (bar) bar.style.width = (booked ? Math.min(100, Math.round(served / booked * 100)) : 0) + '%';
    });
    countUp($('#daySummaryLunchBooked'), 'dlb');
    countUp($('#daySummaryLunchServed'), 'dls');
    countUp($('#daySummaryDinnerBooked'), 'ddb');
    countUp($('#daySummaryDinnerServed'), 'dds');
  }

  function renderTimeline(keepAnim) {
    var box = $('#mxTimeline');
    if (!box) return;
    var date = UI.state.selectedDate, svc = UI.state.selectedService;
    var cfg = Config.load();
    var step = cfg.slotDurationMinutes || 15;
    var bookings = Bookings.getByDateAndService(date, svc).filter(function (b) {
      return ['cancelled', 'archived', 'noshow', 'waitlist'].indexOf(b.status) === -1;
    });
    var slots = (Slots.generateSlotsForService(svc) || []).map(toMin);
    var buckets = {};
    slots.forEach(function (m) { buckets[m] = []; });
    bookings.forEach(function (b) {
      var m = Math.floor(toMin(b.time) / step) * step;
      (buckets[m] = buckets[m] || []).push(b);
    });
    var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
    var svcLabel = svc === 'lunch' ? 'pranzo' : 'cena';
    var title = '<div class="mx-timeline-head"><h3 class="mx-card-title">⏱️ Arrivi a ' + svcLabel + '</h3>';
    if (!keys.length) { box.innerHTML = title + '</div><div class="mx-timeline-empty">Orari del servizio non configurati.</div>'; return; }
    var covers = function (list) { return list.reduce(function (s, b) { return s + (b.people || 0); }, 0); };
    var max = 0, peakKey = null;
    keys.forEach(function (k) { var c = covers(buckets[k]); if (c > max) { max = c; peakKey = k; } });
    if (max === 0) {
      box.innerHTML = title + '</div><div class="mx-timeline-empty">Nessun arrivo previsto per questo servizio.</div>';
      return;
    }
    var hhmm = function (m) { return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); };
    var isToday = date === today(), nm = nowMin();
    var bars = '', axis = '';
    keys.forEach(function (k, i) {
      var list = buckets[k], c = covers(list);
      var h = c ? Math.max(8, Math.round(c / max * 100)) : 4;
      var past = isToday && k + step <= nm;
      bars += '<button type="button" class="mx-bar' + (c ? '' : ' is-empty') + (past ? ' is-past' : '') + (ui.barSel === String(k) ? ' is-sel' : '') + '" data-slot="' + k + '" style="--mx-i:' + i + '" aria-label="' + hhmm(k) + ': ' + c + ' coperti">' +
        '<span class="mx-bar-n">' + (c || '') + '</span><span class="mx-bar-fill" style="height:' + h + '%"></span></button>';
      var showLabel = keys.length <= 8 || k % 30 === 0;
      axis += '<span>' + (showLabel ? hhmm(k) : '') + '</span>';
    });
    var nowLine = '';
    var first = keys[0], last = keys[keys.length - 1] + step;
    if (isToday && nm >= first && nm <= last) {
      // posizione dentro la colonna dello slot corrente
      var idx = 0;
      for (var j = 0; j < keys.length; j++) if (keys[j] <= nm) idx = j;
      var within = Math.min(1, (nm - keys[idx]) / step);
      var leftPct = ((idx + within) / keys.length) * 100;
      nowLine = '<span class="mx-now-line" data-t="' + nowHHMM() + '" style="left:' + leftPct.toFixed(2) + '%"></span>';
    }
    var pop = '';
    if (ui.barSel !== null && buckets[ui.barSel]) {
      var sl = buckets[ui.barSel];
      pop = '<div class="mx-bar-pop"><b>' + hhmm(+ui.barSel) + '</b> · ' + (sl.length
        ? sl.map(function (b) { return esc(b.name || '—') + ' (' + (b.people || 0) + ')'; }).join(', ')
        : 'nessun arrivo') + ' <a href="#" class="mx-pop-go" onclick="return false">Apri lista ›</a></div>';
    }
    box.innerHTML = title + '<span class="mx-timeline-peak">picco <b>' + hhmm(peakKey) + '</b> · ' + max + ' cop.</span></div>' +
      '<div class="mx-bars">' + bars + nowLine + '</div><div class="mx-bars-axis">' + axis + '</div>' + pop;
    if (!keepAnim) box.classList.remove('mx-no-anim');
    else box.classList.add('mx-no-anim');
  }

  var afterDashboard = safe(function () {
    var scr = $('#screen-dashboard');
    var card = $('#screen-dashboard .date-service-card');
    var key = UI.state.selectedDate + '|' + UI.state.selectedService;
    if (ui.lastKey.dashboard !== key) ui.barSel = null;
    animateDateChange(card);
    bumpSwap(scr, key, 'dashboard');
    syncToggle(scr);
    ui.lastDate = UI.state.selectedDate;
    renderDashSubtitle();
    renderDays(card);
    countUp($('#statGuests'), 'guests');
    countUp($('#statTables'), 'tables');
    countUp($('#statLate'), 'free');
    renderRing();
    renderTimeline(false);
    renderDaySummaryExtras();
  });

  // ======================================================================
  // LISTA
  // ======================================================================
  var FILTERS = [
    { id: 'all', label: 'Tutte', dot: null, test: function () { return true; } },
    { id: 'todo', label: 'Da arrivare', dot: '#7A2038', test: function (r) {
      var s = r.dataset.status;
      return !r.classList.contains('arrived') && (s === 'confirmed' || s === 'modificato' || s === 'confermato');
    } },
    { id: 'late', label: 'In ritardo', dot: '#C0392B', test: function (r) { return r.classList.contains('late'); } },
    { id: 'arrived', label: 'Arrivati', dot: '#2F8A5B', test: function (r) {
      return r.classList.contains('arrived') || r.dataset.status === 'arrived' || r.dataset.status === 'seated';
    } },
    { id: 'notable', label: 'Senza tavolo', dot: '#C0392B', test: function (r) { return r.classList.contains('no-table'); } },
    { id: 'allergy', label: 'Allergie', dot: '#C98A1E', test: function (r) {
      return $$('.tag.tag-warning', r).some(function (t) { return t.textContent.trim().indexOf('⚠') === 0; });
    } },
    { id: 'wait', label: 'Attesa e asporto', dot: '#9A968A', test: function (r) { return r.classList.contains('waitlist-row'); } },
    { id: 'done', label: 'Chiuse', dot: '#A39A90', test: function (r) {
      var s = r.dataset.status; return s === 'completed' || s === 'noshow' || s === 'cancelled';
    } },
  ];
  function getFilter() { try { return sessionStorage.getItem('mx-filter') || 'all'; } catch (e) { return 'all'; } }
  function setFilter(id) {
    try { sessionStorage.setItem('mx-filter', id); } catch (e) { /* ignora */ }
    applyFilter(true);
  }

  function applyFilter(animate) {
    var bar = $('#mxFilters'), lc = $('#listContent');
    if (!bar || !lc) return;
    var rows = $$('.booking-row', lc);
    var cur = getFilter();
    var curDef = FILTERS.filter(function (f) { return f.id === cur; })[0] || FILTERS[0];
    // chip: "Tutte" sempre, le altre solo se servono (o se selezionate)
    var html = '';
    FILTERS.forEach(function (f) {
      var n = rows.filter(f.test).length;
      if (f.id !== 'all' && n === 0 && f.id !== cur) return;
      html += '<button type="button" class="mx-chip' + (f.id === cur ? ' is-on' : '') + '" data-f="' + f.id + '" aria-pressed="' + (f.id === cur) + '">' +
        (f.dot ? '<span class="mx-chip-dot" style="background:' + f.dot + '"></span>' : '') +
        esc(f.label) + '<span class="mx-chip-n">' + n + '</span></button>';
    });
    bar.innerHTML = html;
    bar.classList.toggle('mx-hidden', rows.length === 0);

    var visible = 0;
    rows.forEach(function (r) {
      var show = curDef.test(r);
      r.classList.toggle('mx-hidden', !show);
      if (show) visible++;
    });
    var oldEmpty = $('.mx-filter-empty', lc);
    if (oldEmpty) oldEmpty.remove();
    var nowLine = $('.mx-now', lc);
    if (nowLine) nowLine.classList.toggle('mx-hidden', cur !== 'all');
    if (rows.length && !visible) {
      lc.appendChild(el('div', 'mx-filter-empty',
        'Nessuna prenotazione «' + esc(curDef.label.toLowerCase()) + '» in questo servizio.<br><button type="button" class="mx-filter-reset">Mostra tutte</button>'));
    }
    if (animate && !REDUCED) {
      var i = 0;
      rows.forEach(function (r) {
        if (r.classList.contains('mx-hidden')) return;
        r.style.animation = 'none'; void r.offsetWidth;
        r.style.animation = 'mx-rise 0.35s var(--ease-out) both ' + (i++ * 30) + 'ms';
      });
    }
  }

  function markNowAndNext() {
    var lc = $('#listContent');
    if (!lc || UI.state.selectedDate !== today()) return;
    var rows = $$('.booking-row', lc);
    var nm = nowMin();
    // linea "adesso" prima della prima prenotazione futura
    var firstFuture = null;
    rows.some(function (r) {
      var t = $('.time-value', r);
      if (t && toMin(t.textContent) > nm) { firstFuture = r; return true; }
      return false;
    });
    if (rows.length && (firstFuture || toMin(($('.time-value', rows[rows.length - 1]) || {}).textContent || '0:0') <= nm)) {
      var line = el('div', 'mx-now', 'Adesso · ' + nowHHMM());
      if (firstFuture) lc.insertBefore(line, firstFuture);
      else lc.appendChild(line);
    }
    // prossimo arrivo: la prima ancora da arrivare, non in ritardo
    var next = rows.filter(function (r) {
      return r.dataset.status === 'confirmed' && !r.classList.contains('arrived') && !r.classList.contains('late') &&
        toMin(($('.time-value', r) || {}).textContent || '0:0') >= nm - 5;
    })[0];
    if (next) {
      next.classList.add('mx-next');
      var stLine = $('.booking-status-line', next);
      var badge = el('span', 'mx-next-badge', 'Prossimo');
      if (stLine) stLine.insertAdjacentElement('afterend', badge);
      else next.appendChild(badge);
    }
  }

  function renderListSubtitle() {
    var sub = $('#mxListSub');
    if (!sub) return;
    var list = Bookings.getByDateAndService(UI.state.selectedDate, UI.state.selectedService)
      .filter(function (b) { return ['cancelled', 'archived', 'noshow'].indexOf(b.status) === -1; });
    var cov = list.reduce(function (s, b) { return s + (b.people || 0); }, 0);
    sub.innerHTML = (UI.state.selectedService === 'lunch' ? 'Pranzo' : 'Cena') + ' · <b>' + list.length + '</b> ' +
      (list.length === 1 ? 'prenotazione' : 'prenotazioni') + ' · <b>' + cov + '</b> coperti';
  }

  function measureTopbar() {
    var tb = $('#screen-list .topbar');
    if (tb && tb.offsetHeight) document.documentElement.style.setProperty('--mx-top', tb.offsetHeight + 'px');
  }

  var afterList = safe(function () {
    var scr = $('#screen-list');
    var card = $('#screen-list .date-service-card');
    var key = UI.state.selectedDate + '|' + UI.state.selectedService;
    animateDateChange(card);
    bumpSwap(scr, key, 'list');
    syncToggle(scr);
    ui.lastDate = UI.state.selectedDate;
    renderListSubtitle();
    renderDays(card);
    measureTopbar();
    $$('#listContent > *').forEach(function (n, i) { n.style.setProperty('--mx-i', Math.min(i, 12)); });
    $$('#screen-list .list-summary-item strong').forEach(function (s, i) { countUp(s, 'ls' + i); });
    markNowAndNext();
    applyFilter(false);
  });

  // ======================================================================
  // Agganci alle funzioni originali (le chiamano sempre per prime)
  // ======================================================================
  function wrap(name, after) {
    var orig = UI[name];
    if (typeof orig !== 'function') return;
    UI[name] = function () {
      var r = orig.apply(this, arguments);
      after.apply(this, arguments);
      return r;
    };
  }
  // l'Anteprima ha un suo servizio, separato da Home/Lista
  wrap('renderPreview', safe(function () { syncToggle($('#screen-preview'), UI.state.previewService); }));
  wrap('renderDashboard', afterDashboard);
  wrap('renderList', afterList);
  wrap('showScreen', safe(function (name) {
    if (name !== 'dashboard' && name !== 'list') return;
    var scr = document.getElementById('screen-' + name);
    if (!scr || REDUCED) return;
    scr.classList.remove('mx-enter'); void scr.offsetWidth;
    scr.classList.add('mx-enter');
    clearTimeout(scr._mxEnterT);
    scr._mxEnterT = setTimeout(function () { scr.classList.remove('mx-enter'); }, 1100);
  }));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
  // Se la pagina era già disegnata prima che questo file venisse letto
  document.addEventListener('DOMContentLoaded', safe(function () {
    if (UI.state && UI.state.currentScreen === 'dashboard') afterDashboard();
    if (UI.state && UI.state.currentScreen === 'list') afterList();
  }));
})();
