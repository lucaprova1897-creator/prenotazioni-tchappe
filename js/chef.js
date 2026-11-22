/**
 * chef.js — nuova grafica della vista CUCINA (chef e cuochi), novembre 2026.
 * Va caricato DOPO modern.js.
 *
 * Stessa regola di modern.js: non cambia nessuna funzione. Si aggancia
 * DOPO che l'app ha disegnato la vista chef (renderReadOnlyView,
 * renderRoEventiPage, openPiattiTab, renderRoMise) e aggiunge:
 *  - testata con saluto e orologio, icone moderne;
 *  - scheda bordeaux con striscia dei giorni, swipe, numeri del servizio;
 *  - riepilogo allergie del servizio (tocco → porta alla prenotazione);
 *  - arrivi ogni 15 minuti;
 *  - filtri rapidi, linea "adesso" e "prossimo" nella lista;
 *  - su tablet: due colonne (riepiloghi a sinistra, lista a destra);
 *  - "Calendario" = eventi + giorni chiusi in una sola scheda.
 * Per cambiare giorno o servizio usa gli stessi pulsanti/stato dell'app.
 * Se qualcosa qui dentro va storto, l'errore resta qui.
 */
(function () {
  'use strict';
  if (typeof UI === 'undefined') return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function safe(fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { console.warn('[chef]', e); }
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
  function toMin(t) { var p = String(t || '0:0').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function hhmm(m) { return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
  function today() { return Utils.todayISO(); }
  function haptic() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* ignora */ } }
  function isChefView() { return typeof DB !== 'undefined' && DB.getRole && DB.getRole() === 'read'; }
  function svc() { return UI.state.roService || 'lunch'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  var ICON = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    bellOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    ods: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3.5" width="14" height="18" rx="2"/><path d="M9 3.5h6v3H9z"/><path d="M8.5 11h7M8.5 15h5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-2px"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  };

  // ======================================================================
  // Icone: i pulsanti dell'app si riscrivono da soli (🔄 → ⏳ → 🔄,
  // 🔔 ↔ 🔕). Qui si osserva il testo e lo si trasforma in icona, senza
  // toccare la funzione del pulsante.
  // ======================================================================
  function iconize(btn, map) {
    if (!btn) return;
    var apply = function () {
      var t = btn.textContent.trim();
      if (!t || !(t in map)) return;
      var m = map[t];
      btn.innerHTML = m.svg;
      btn.classList.toggle('mx-spin', !!m.spin);
      if (m.label) btn.setAttribute('aria-label', m.label);
    };
    apply();
    new MutationObserver(apply).observe(btn, { childList: true, characterData: true, subtree: true });
  }

  // ======================================================================
  // Navigazione tra giorni / servizi — stesso stato dell'app
  // ======================================================================
  function goDay(iso) {
    if (!iso || iso === UI.state.selectedDate) return;
    UI.state.selectedDate = iso;
    UI.renderReadOnlyView();
  }
  function goMiseDay(iso) {
    if (!iso || iso === UI.state.selectedDate) return;
    UI.state.selectedDate = iso;
    if (typeof window.renderRoMise === 'function') window.renderRoMise();
  }

  function enableSwipe(card, prevId, nextId) {
    var sx = 0, sy = 0, active = false, swallow = false;
    card.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.mx-days')) return;
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
        swallow = true;
        setTimeout(function () { swallow = false; }, 350);
      }
    });
    card.addEventListener('pointercancel', function () { active = false; });
    card.addEventListener('click', function (e) {
      if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; }
    }, true);
  }

  function dayCounts() {
    var map = {};
    (Bookings._cache || []).forEach(function (b) {
      if (b.status === 'cancelled' || b.status === 'archived' || b.status === 'noshow') return;
      map[b.date] = (map[b.date] || 0) + 1;
    });
    return map;
  }
  function renderDays(strip, sel) {
    if (!strip) return;
    var t = today(), counts = dayCounts(), html = '';
    for (var i = -3; i <= 10; i++) {
      var iso = UI.shiftDate(sel, i);
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
        (n ? ' — ' + plural(n, 'prenotazione', 'prenotazioni') : '') + (closed ? ' — chiuso' : '');
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

  function addSvcIcons(lunchId, dinnerId) {
    [[lunchId, 'sun'], [dinnerId, 'moon']].forEach(function (p) {
      var b = document.getElementById(p[0]);
      if (b && !b.querySelector('.mx-svc-ico')) b.insertAdjacentHTML('afterbegin', '<span class="mx-svc-ico" aria-hidden="true">' + ICON[p[1]] + '</span>');
    });
  }

  // ======================================================================
  // Allergeni: "glutine, lattosio" → ['Glutine', 'Lattosio']
  // ======================================================================
  function splitAllergens(txt) {
    return String(txt || '')
      .split(/[,;\/+\n]|\s+e\s+|\s+-\s+/i)
      .map(function (s) { return s.trim().replace(/^[-–•·]+\s*/, '').replace(/\.$/, ''); })
      .filter(Boolean)
      .map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); });
  }

  // Prenotazioni "vere" del servizio per i conteggi (come la Mise en place:
  // niente cancellate, archiviate, no-show, lista d'attesa, asporti)
  function serviceBookings(date, service) {
    return Bookings.getByDateAndService(date, service).filter(function (b) {
      return ['cancelled', 'archived', 'noshow', 'waitlist', 'takeaway'].indexOf(b.status) === -1;
    });
  }

  // ======================================================================
  // Impostazione iniziale (una volta sola)
  // ======================================================================
  var st = { filter: 'all', barSel: null, lastKey: null, lastDate: null };

  var setup = safe(function () {
    var scr = $('#screen-readonly');
    if (!scr || scr._chefReady) return;
    scr._chefReady = true;
    document.body.classList.add('chef-ui');

    // --- Testata: "Cucina" + saluto e orologio
    var tb = $('.topbar', scr);
    var h1 = tb && tb.querySelector('h1');
    if (h1 && !h1.parentNode.classList.contains('mx-title-wrap')) {
      h1.textContent = 'Cucina';
      var w = el('div', 'mx-title-wrap');
      h1.parentNode.insertBefore(w, h1);
      w.appendChild(h1);
      var sub = el('div', 'mx-subtitle');
      sub.id = 'chefSub';
      w.appendChild(sub);
    }

    // --- Icone moderne (stessi pulsanti, stesse funzioni)
    iconize($('#roRefreshBtn'), { '🔄': { svg: ICON.refresh, label: 'Aggiorna' }, '⏳': { svg: ICON.refresh, spin: true } });
    iconize($('#roMiseRefreshBtn'), { '🔄': { svg: ICON.refresh, label: 'Aggiorna' } });
    iconize($('#roPushToggleBtn'), { '🔔': { svg: ICON.bell, label: 'Attiva le notifiche' }, '🔕': { svg: ICON.bellOff, label: 'Disattiva le notifiche' } });
    iconize($('#roManageAccessBtn'), { '🔐': { svg: ICON.lock, label: 'Gestisci accessi' } });
    iconize($('#roLogoutBtn'), { '🚪': { svg: ICON.logout, label: 'Esci' } });
    // Eventi / Asporti: icona e scritta separate (sul telefono resta l'icona)
    ['roEventsBadgeBtn', 'roTakeawayBadgeBtn'].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b || b.querySelector('.chef-b-txt')) return;
      var tn = b.firstChild;
      if (!tn || tn.nodeType !== 3) return;
      var m = tn.textContent.trim().match(/^(\S+)\s+(.+)$/);
      if (!m) return;
      var frag = el('span', 'chef-b-ico', esc(m[1]));
      frag.setAttribute('aria-hidden', 'true');
      b.insertBefore(frag, tn);
      b.insertBefore(el('span', 'chef-b-txt', esc(m[2])), tn);
      b.removeChild(tn);
    });
    var odsIco = $('#roOdsBtn .chef-ods-ico');
    if (odsIco) odsIco.innerHTML = ICON.ods;
    var rr = $('#roRefreshBtn');
    if (rr) rr.addEventListener('click', function () {
      rr.classList.add('mx-spin');
      setTimeout(function () { rr.classList.remove('mx-spin'); }, 900);
    });

    // --- Scheda bordeaux: striscia giorni + numeri del servizio
    var card = $('.date-service-card', scr);
    if (card) {
      card.classList.add('chef-hero');
      var strip = el('div', 'mx-days');
      strip.id = 'chefDays';
      strip.setAttribute('role', 'tablist');
      strip.setAttribute('aria-label', 'Scegli il giorno');
      card.appendChild(strip);
      strip.addEventListener('click', function (e) {
        var d = e.target.closest('.mx-day');
        if (!d) return;
        haptic();
        goDay(d.dataset.date);
      });
      var tog = $('.service-toggle', card);
      if (tog) tog.classList.add('mx-seg');
      addSvcIcons('roBtnLunch', 'roBtnDinner');
      // coperti della giornata dentro l'interruttore Pranzo / Cena
      ['roBtnLunch', 'roBtnDinner'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b && !b.querySelector('.chef-svc-n')) b.insertAdjacentHTML('beforeend', '<span class="chef-svc-n" aria-hidden="true"></span>');
      });
      var stats = el('div', 'chef-stats');
      stats.id = 'chefStats';
      card.appendChild(stats);
      stats.addEventListener('click', function (e) {
        var s = e.target.closest('[data-go]');
        if (!s) return;
        haptic();
        if (s.dataset.go === 'allergy') setFilter(st.filter === 'allergy' ? 'all' : 'allergy', true);
        else if (s.dataset.go === 'todo') setFilter(st.filter === 'todo' ? 'all' : 'todo', true);
      });
      enableSwipe(card, 'roPrevDay', 'roNextDay');
    }

    // --- Riepilogo allergie + arrivi ogni 15 minuti (dopo la scheda bordeaux)
    var content = $('.dashboard-content', scr);
    if (content && card) {
      var allergy = el('div', 'chef-card chef-allergy-card hidden');
      allergy.id = 'chefAllergy';
      var tl = el('div', 'mx-timeline chef-timeline');
      tl.id = 'chefTimeline';
      // ordine: data · chiusura · allergie · preparazioni · arrivi · resto
      var closure = $('#roClosureBox', content);
      var after = closure || card;
      after.parentNode.insertBefore(allergy, after.nextSibling);
      var prep = $('#roSpecialPrepBox', content);
      (prep || allergy).parentNode.insertBefore(tl, (prep || allergy).nextSibling);

      allergy.addEventListener('click', function (e) {
        var r = e.target.closest('[data-id]');
        if (r) { haptic(); focusBooking(r.dataset.id); return; }
        if (e.target.closest('.chef-allergy-all')) { haptic(); setFilter('allergy', true); }
      });
      tl.addEventListener('click', function (e) {
        var go = e.target.closest('[data-id]');
        if (go) { haptic(); focusBooking(go.dataset.id); return; }
        var bar = e.target.closest('.mx-bar');
        if (!bar) return;
        haptic();
        st.barSel = st.barSel === bar.dataset.slot ? null : bar.dataset.slot;
        renderTimeline(true);
      });
    }

    // --- Lista: filtri rapidi sopra le schede
    var list = $('#roBookingList');
    if (list && !$('#chefFilters')) {
      var head = el('div', 'chef-list-head');
      head.innerHTML = '<h2 class="chef-sec-title" id="chefListTitle">Prenotazioni</h2><div class="mx-filters chef-filters" id="chefFilters" role="toolbar" aria-label="Filtra le prenotazioni"></div>';
      list.parentNode.insertBefore(head, list);
      $('#chefFilters').addEventListener('click', function (e) {
        var c = e.target.closest('.mx-chip');
        if (!c) return;
        haptic();
        setFilter(c.dataset.f === st.filter && c.dataset.f !== 'all' ? 'all' : c.dataset.f, false);
      });
      list.addEventListener('click', function (e) {
        if (e.target.closest('.mx-filter-reset')) setFilter('all', false);
      });
    }

    // --- Tablet: due colonne (riepiloghi | lista). Si spostano gli stessi
    // elementi, con gli stessi ID.
    if (content && list && !$('.chef-layout', scr)) {
      var lay = el('div', 'chef-layout');
      var colL = el('div', 'chef-col chef-col-side');
      var colR = el('div', 'chef-col chef-col-main');
      content.parentNode.insertBefore(lay, content);
      lay.appendChild(colL); lay.appendChild(colR);
      colL.appendChild(content);
      colR.appendChild($('.chef-list-head', scr));
      colR.appendChild(list);
      var rem = $('.reminders-card', scr);
      if (rem) { rem.removeAttribute('style'); colR.appendChild(rem); }
    }

    // --- Eventi / asporti: i badge restano in alto, il pannello si apre
    // come finestra dal basso (CSS). Toccare fuori la chiude.
    document.addEventListener('pointerdown', function (e) {
      ['roEventsPopover', 'roTakeawayPopover'].forEach(function (id) {
        var p = document.getElementById(id);
        if (!p || p.classList.contains('hidden')) return;
        if (p.contains(e.target) || e.target.closest('#roEventsBadgeBtn, #roTakeawayBadgeBtn')) return;
        p.classList.add('hidden');
      });
    }, true);

    // --- Mise en place: stessa scheda bordeaux
    var mcard = $('#screen-ro-mise .date-service-card');
    if (mcard) {
      mcard.classList.add('chef-hero');
      var mstrip = el('div', 'mx-days');
      mstrip.id = 'chefMiseDays';
      mcard.appendChild(mstrip);
      mstrip.addEventListener('click', function (e) {
        var d = e.target.closest('.mx-day');
        if (!d) return;
        haptic();
        goMiseDay(d.dataset.date);
      });
      var mtog = $('.service-toggle', mcard);
      if (mtog) mtog.classList.add('mx-seg');
      addSvcIcons('roMiseBtnLunch', 'roMiseBtnDinner');
      enableSwipe(mcard, 'roMisePrevDay', 'roMiseNextDay');
    }

    // --- Piatti: la riga data diventa una scheda bordeaux con swipe
    var prow = $('#screen-ro-piatti .piatti-date-row');
    if (prow) {
      prow.classList.add('chef-hero', 'chef-hero-slim');
      enableSwipe(prow, 'piattiPrevDay', 'piattiNextDay');
    }

    // --- Tastiera (tablet/computer): frecce ← → cambiano giorno
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.modal-overlay.active, .ds-drawer-panel.open')) return;
      var map = { 'screen-readonly': 'ro', 'screen-ro-mise': 'roMise', 'screen-ro-piatti': 'piatti' };
      var act = $$('.screen.active').filter(function (s) { return map[s.id]; })[0];
      if (!act) return;
      var b = document.getElementById(map[act.id] + (e.key === 'ArrowLeft' ? 'PrevDay' : 'NextDay'));
      if (b) { e.preventDefault(); b.click(); }
    });

    // --- Orologio + linea "adesso" sempre aggiornati
    setInterval(safe(function () {
      if (!$('#screen-readonly.active')) return;
      renderSubtitle();
      if (UI.state.selectedDate === today()) { markNowAndNext(); renderTimeline(true); }
    }), 30000);
  });

  // ======================================================================
  // SERVIZIO (lista cucina)
  // ======================================================================
  function renderSubtitle() {
    var sub = $('#chefSub');
    if (!sub) return;
    var h = new Date().getHours();
    var greet = h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
    var who = (typeof DB !== 'undefined' && DB.getOperator && DB.getOperator()) || '';
    sub.innerHTML = '<span class="chef-greet">' + greet + (who ? ', ' : '') + '</span>' + (who ? '<b>' + esc(who.split(' ')[0]) + '</b> · ' : '<span class="chef-greet"> · </span>') + '<span class="mx-clock">' + nowHHMM() + '</span>';
  }

  function renderStats() {
    var box = $('#chefStats');
    if (!box) return;
    var date = UI.state.selectedDate, s = svc();
    var list = serviceBookings(date, s);
    var covers = 0, chairs = 0, allergies = 0, arrived = 0;
    list.forEach(function (b) {
      covers += b.people || 0;
      chairs += b.highchairs || 0;
      if (b.intolerances && String(b.intolerances).trim()) allergies++;
      if (b.arrivedAt || b.status === 'completed') arrived++;
    });
    var isToday = date === today();
    var cell = function (n, label, extra, go) {
      return '<div class="chef-stat' + (extra || '') + '"' + (go ? ' data-go="' + go + '" role="button" tabindex="0"' : '') + '>' +
        '<span class="chef-stat-n">' + n + '</span><span class="chef-stat-l">' + label + '</span></div>';
    };
    box.innerHTML =
      cell(covers, 'coperti') +
      cell(list.length, list.length === 1 ? 'tavolo' : 'tavoli') +
      (isToday
        ? cell(arrived + '<small>/' + list.length + '</small>', 'arrivati', st.filter === 'todo' ? ' is-on' : '', 'todo')
        : cell(chairs, chairs === 1 ? 'seggiolone' : 'seggioloni')) +
      cell(allergies, allergies === 1 ? 'allergia' : 'allergie', (allergies ? ' is-alert' : '') + (st.filter === 'allergy' ? ' is-on' : ''), allergies ? 'allergy' : null);

    // coperti della giornata dentro l'interruttore
    var l = $('#roCoversLunch'), d = $('#roCoversDinner');
    var nl = $('#roBtnLunch .chef-svc-n'), nd = $('#roBtnDinner .chef-svc-n');
    if (nl && l) nl.textContent = l.textContent;
    if (nd && d) nd.textContent = d.textContent;
  }

  function renderAllergy() {
    var box = $('#chefAllergy');
    if (!box) return;
    var date = UI.state.selectedDate, s = svc();
    var list = Bookings.getByDateAndService(date, s).filter(function (b) {
      return ['cancelled', 'archived', 'noshow'].indexOf(b.status) === -1 && b.intolerances && String(b.intolerances).trim();
    }).sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
    if (!list.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    var tally = {}, order = [];
    list.forEach(function (b) {
      splitAllergens(b.intolerances).forEach(function (a) {
        var k = a.toLowerCase();
        if (!tally[k]) { tally[k] = { label: a, n: 0 }; order.push(k); }
        tally[k].n++;
      });
    });
    order.sort(function (a, b) { return tally[b].n - tally[a].n || tally[a].label.localeCompare(tally[b].label); });
    var chips = order.map(function (k) {
      return '<span class="chef-allergen">' + esc(tally[k].label) + (tally[k].n > 1 ? ' <b>×' + tally[k].n + '</b>' : '') + '</span>';
    }).join('');
    var rows = list.map(function (b) {
      var where = b.tablesAssigned ? 'tav. ' + esc(b.tablesAssigned) : '';
      return '<button type="button" class="chef-allergy-row' + (b.arrivedAt ? ' is-arrived' : '') + '" data-id="' + esc(b.id) + '">' +
        '<span class="chef-allergy-time">' + esc(b.time) + '</span>' +
        '<span class="chef-allergy-what"><b>' + esc(b.intolerances) + '</b><small>' + esc(b.name || '—') + ' · ' + (b.people || 0) + ' cop.' + (where ? ' · ' + where : '') + '</small></span>' +
        '<span class="chef-allergy-go" aria-hidden="true">›</span>' +
      '</button>';
    }).join('');
    box.innerHTML =
      '<div class="chef-card-head"><h3 class="mx-card-title"><span class="chef-alert-ico" aria-hidden="true">⚠️</span> Allergie del servizio</h3>' +
        '<button type="button" class="chef-allergy-all">Solo queste ›</button></div>' +
      '<div class="chef-allergens">' + chips + '</div>' +
      '<div class="chef-allergy-list">' + rows + '</div>';
  }

  function renderTimeline(keepAnim) {
    var box = $('#chefTimeline');
    if (!box) return;
    var date = UI.state.selectedDate, s = svc();
    var cfg = (typeof Config !== 'undefined' && Config.load) ? Config.load() : {};
    var step = cfg.slotDurationMinutes || 15;
    var bookings = serviceBookings(date, s);
    var slots = [];
    try { slots = (Slots.generateSlotsForService(s) || []).map(toMin); } catch (e) { slots = []; }
    var buckets = {};
    slots.forEach(function (m) { buckets[Math.floor(m / step) * step] = []; });
    bookings.forEach(function (b) {
      var m = Math.floor(toMin(b.time) / step) * step;
      (buckets[m] = buckets[m] || []).push(b);
    });
    var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
    var title = '<div class="mx-timeline-head"><h3 class="mx-card-title">⏱️ Arrivi ogni ' + step + ' minuti</h3>';
    var covers = function (l) { return l.reduce(function (t, b) { return t + (b.people || 0); }, 0); };
    var max = 0, peakKey = null;
    keys.forEach(function (k) { var c = covers(buckets[k]); if (c > max) { max = c; peakKey = k; } });
    if (!keys.length || max === 0) {
      box.innerHTML = title + '</div><div class="mx-timeline-empty">Nessun arrivo previsto per questo servizio.</div>';
      return;
    }
    var isToday = date === today(), nm = nowMin();
    var bars = '', axis = '';
    keys.forEach(function (k, i) {
      var l = buckets[k], c = covers(l);
      var h = c ? Math.max(8, Math.round(c / max * 100)) : 4;
      var past = isToday && k + step <= nm;
      bars += '<button type="button" class="mx-bar' + (c ? '' : ' is-empty') + (past ? ' is-past' : '') + (st.barSel === String(k) ? ' is-sel' : '') + (k === peakKey ? ' is-peak' : '') +
        '" data-slot="' + k + '" style="--mx-i:' + i + '" aria-label="' + hhmm(k) + ': ' + c + ' coperti">' +
        '<span class="mx-bar-n">' + (c || '') + '</span><span class="mx-bar-fill" style="height:' + h + '%"></span></button>';
      axis += '<span>' + (keys.length <= 8 || k % 30 === 0 ? hhmm(k) : '') + '</span>';
    });
    var nowLine = '';
    var first = keys[0], last = keys[keys.length - 1] + step;
    if (isToday && nm >= first && nm <= last) {
      var idx = 0;
      for (var j = 0; j < keys.length; j++) if (keys[j] <= nm) idx = j;
      var within = Math.min(1, (nm - keys[idx]) / step);
      nowLine = '<span class="mx-now-line" data-t="' + nowHHMM() + '" style="left:' + (((idx + within) / keys.length) * 100).toFixed(2) + '%"></span>';
    }
    var pop = '';
    if (st.barSel !== null && buckets[st.barSel]) {
      var sl = buckets[st.barSel];
      pop = '<div class="mx-bar-pop"><b>' + hhmm(+st.barSel) + '</b> · ' + (sl.length
        ? sl.map(function (b) {
            return '<a href="#" class="chef-pop-b" data-id="' + esc(b.id) + '" onclick="return false">' + esc(b.name || '—') + ' (' + (b.people || 0) + ')' + (b.intolerances ? ' ⚠️' : '') + '</a>';
          }).join(', ')
        : 'nessun arrivo') + '</div>';
    }
    box.innerHTML = title + '<span class="mx-timeline-peak">picco <b>' + hhmm(peakKey) + '</b> · ' + max + ' cop.</span></div>' +
      '<div class="mx-bars">' + bars + nowLine + '</div><div class="mx-bars-axis">' + axis + '</div>' + pop;
    box.classList.toggle('mx-no-anim', !!keepAnim);
  }

  // --- Filtri della lista
  var FILTERS = [
    { id: 'all', label: 'Tutte', dot: null, test: function () { return true; } },
    { id: 'todo', label: 'Da arrivare', dot: '#7A2038', test: function (r) { return !r.classList.contains('arrived'); } },
    { id: 'arrived', label: 'Arrivati', dot: '#2F8A5B', test: function (r) { return r.classList.contains('arrived'); } },
    { id: 'allergy', label: 'Allergie', dot: '#C0392B', test: function (r) { return !!r.querySelector('.chef-row-allergy, .dietary-alert, .dietary-alert-tag'); } },
    { id: 'notes', label: 'Con note', dot: '#C98A1E', test: function (r) { return !!r.querySelector('.chef-row-note'); } },
    { id: 'hotel', label: 'Hotel', dot: '#2F6FB0', test: function (r) { return !!r.querySelector('.chef-row-hotel'); } },
  ];
  function setFilter(id, scroll) {
    st.filter = id;
    applyFilter(true);
    renderStats();
    if (scroll) {
      var head = $('.chef-list-head');
      if (head && window.innerWidth < 768) head.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    }
  }
  function applyFilter(animate) {
    var bar = $('#chefFilters'), list = $('#roBookingList');
    if (!bar || !list) return;
    var rows = $$('.chef-row', list);
    var cur = FILTERS.filter(function (f) { return f.id === st.filter; })[0] || FILTERS[0];
    var html = '';
    FILTERS.forEach(function (f) {
      var n = rows.filter(f.test).length;
      if (f.id !== 'all' && n === 0 && f.id !== cur.id) return;
      html += '<button type="button" class="mx-chip' + (f.id === cur.id ? ' is-on' : '') + '" data-f="' + f.id + '" aria-pressed="' + (f.id === cur.id) + '">' +
        (f.dot ? '<span class="mx-chip-dot" style="background:' + f.dot + '"></span>' : '') +
        esc(f.label) + '<span class="mx-chip-n">' + n + '</span></button>';
    });
    bar.innerHTML = html;
    bar.classList.toggle('mx-hidden', rows.length === 0);
    var visible = 0;
    rows.forEach(function (r) {
      var show = cur.test(r);
      r.classList.toggle('mx-hidden', !show);
      if (show) visible++;
    });
    var old = $('.mx-filter-empty', list);
    if (old) old.remove();
    var nowL = $('.mx-now', list);
    if (nowL) nowL.classList.toggle('mx-hidden', cur.id !== 'all');
    if (rows.length && !visible) {
      list.appendChild(el('div', 'mx-filter-empty',
        'Nessuna prenotazione «' + esc(cur.label.toLowerCase()) + '» in questo servizio.<br><button type="button" class="mx-filter-reset">Mostra tutte</button>'));
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
    var list = $('#roBookingList');
    if (!list) return;
    $$('.mx-now', list).forEach(function (n) { n.remove(); });
    $$('.chef-row.mx-next', list).forEach(function (n) { n.classList.remove('mx-next'); });
    $$('.chef-next-badge', list).forEach(function (n) { n.remove(); });
    if (UI.state.selectedDate !== today()) return;
    var rows = $$('.chef-row', list);
    if (!rows.length) return;
    var nm = nowMin();
    var tOf = function (r) { var t = $('.chef-row-time-badge', r); return toMin(t && t.textContent); };
    var firstFuture = rows.filter(function (r) { return tOf(r) > nm; })[0] || null;
    var firstT = tOf(rows[0]), lastT = tOf(rows[rows.length - 1]);
    if (nm >= firstT - 60 && nm <= lastT + 120) {
      var line = el('div', 'mx-now', 'Adesso · ' + nowHHMM());
      if (firstFuture) list.insertBefore(line, firstFuture); else list.appendChild(line);
      if (st.filter !== 'all') line.classList.add('mx-hidden');
    }
    var next = rows.filter(function (r) { return !r.classList.contains('arrived') && tOf(r) >= nm - 5; })[0];
    if (next) {
      next.classList.add('mx-next');
      var top = $('.chef-row-top', next);
      if (top) top.appendChild(el('span', 'chef-next-badge', 'Prossimo'));
    }
  }

  // Porta alla prenotazione nella lista e la fa lampeggiare
  function focusBooking(id) {
    var list = $('#roBookingList');
    var row = list && $$('.chef-row', list).filter(function (r) { return r.dataset.id === String(id); })[0];
    if (!row) return;
    if (row.classList.contains('mx-hidden')) setFilter('all', false);
    row.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
    row.classList.remove('chef-flash'); void row.offsetWidth;
    row.classList.add('chef-flash');
    setTimeout(function () { row.classList.remove('chef-flash'); }, 1800);
  }

  function animateDateChange(card) {
    var sel = UI.state.selectedDate;
    if (st.lastDate && st.lastDate !== sel && card && !REDUCED) {
      var cls = sel > st.lastDate ? 'mx-slide-left' : 'mx-slide-right';
      card.classList.remove('mx-slide-left', 'mx-slide-right'); void card.offsetWidth;
      card.classList.add(cls);
      setTimeout(function () { card.classList.remove(cls); }, 400);
    }
    st.lastDate = sel;
  }

  function renderCalDot() {
    var dot = $('#chefCalDot');
    if (!dot) return;
    var n = 0;
    try { n += UI.getAllUpcomingEvents().length; } catch (e) { /* ignora */ }
    try {
      var t = today();
      n += SharedTables.getClosures().filter(function (c) { return (c.endDate || c.startDate) >= t; }).length;
    } catch (e) { /* ignora */ }
    dot.textContent = n > 9 ? '9+' : String(n);
    dot.classList.toggle('hidden', n === 0);
  }

  var afterReadOnly = safe(function () {
    setup();
    var scr = $('#screen-readonly');
    var card = $('#screen-readonly .chef-hero');
    var key = UI.state.selectedDate + '|' + svc();
    if (st.lastKey !== key) st.barSel = null;
    animateDateChange(card);
    if (st.lastKey && st.lastKey !== key && !REDUCED && scr) {
      scr.classList.remove('mx-swap'); void scr.offsetWidth;
      scr.classList.add('mx-swap');
      clearTimeout(scr._mxSwapT);
      scr._mxSwapT = setTimeout(function () { scr.classList.remove('mx-swap'); }, 900);
    }
    st.lastKey = key;
    $$('.service-toggle.mx-seg', card || document.createElement('div')).forEach(function (t) { t.classList.toggle('mx-dinner', svc() === 'dinner'); });
    renderSubtitle();
    renderDays($('#chefDays'), UI.state.selectedDate);
    renderAllergy();
    renderTimeline(false);
    var title = $('#chefListTitle');
    if (title) title.textContent = (svc() === 'lunch' ? 'Pranzo' : 'Cena') + ' · prenotazioni';
    $$('#roBookingList > *').forEach(function (n, i) { n.style.setProperty('--mx-i', Math.min(i, 12)); });
    markNowAndNext();
    applyFilter(false);
    renderStats();
    renderCalDot();
  });

  // ======================================================================
  // MISE, PIATTI, CALENDARIO
  // ======================================================================
  var afterMise = safe(function () {
    setup();
    var card = $('#screen-ro-mise .chef-hero');
    var s = UI.state.miseService || UI.state.roService || 'lunch';
    $$('.service-toggle.mx-seg', card || document.createElement('div')).forEach(function (t) { t.classList.toggle('mx-dinner', s === 'dinner'); });
    renderDays($('#chefMiseDays'), UI.state.selectedDate);
    // tavoli con allergie ben evidenti
    $$('#roMiseContent .mise-card').forEach(function (c) {
      var a = $$('.mise-alert', c).some(function (x) { return x.textContent.indexOf('⚠') !== -1; });
      c.classList.toggle('chef-mise-allergy', a);
    });
  });

  var afterCalendar = safe(function () {
    setup();
    if (typeof UI.renderRoChiusurePage === 'function') UI.renderRoChiusurePage();
    renderCalDot();
  });

  // ======================================================================
  // Agganci alle funzioni originali (le chiamano sempre per prime)
  // ======================================================================
  function wrap(obj, name, after) {
    var orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function () {
      var r = orig.apply(this, arguments);
      if (r && typeof r.then === 'function') r.then(function () { after(); }, function () {});
      else after.apply(this, arguments);
      return r;
    };
  }
  wrap(UI, 'renderReadOnlyView', afterReadOnly);
  wrap(UI, 'renderRoEventiPage', afterCalendar);
  wrap(UI, 'openPiattiTab', safe(function () { setup(); }));
  // Pulsante "Cucina" per gli amministratori: visibile anche se i
  // permessi sono stati sbloccati col PIN dopo l'ingresso
  wrap(UI, 'renderDashboard', safe(function () { if (window.updateKitchenSwitch) window.updateKitchenSwitch(); }));
  wrap(UI, 'renderList', safe(function () { if (window.updateKitchenSwitch) window.updateKitchenSwitch(); }));
  wrap(window, 'renderRoMise', afterMise);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
