/**
 * piatti.js — "Piatti del giorno" (novembre 2026)
 *
 * Sostituisce la vecchia pagina admin.html del sito pubblico e la piccola
 * tendina "Proposte del giorno": una schermata grande, pensata per tablet,
 * dove si scrivono i piatti in italiano, si traducono (DeepL, con
 * revisione) e lo chef li conferma. Solo i piatti CONFERMATI compaiono sul
 * menu pubblico del QR code, che li legge da Supabase (funzione
 * "menu-pubblico") — nessuna chiave nel sito pubblico.
 *
 * I dati sono gli stessi di sempre (zone_tavoli._dailySpecials e
 * _dishLibrary, vedi config.js): cambia solo l'interfaccia.
 */
(function () {
  const CATS = [
    ['antipasti', 'Antipasti'], ['primi', 'Primi'], ['secondi', 'Secondi'],
    ['contorni', 'Contorni'], ['dolci', 'Dolci'], ['altro', 'Speciali'],
  ];
  const CAT_LABEL = Object.fromEntries(CATS);
  const STATUS = {
    pending: { label: 'Da confermare', cls: 'pending' },
    confermato: { label: 'Disponibile', cls: 'ok' },
    non_disponibile: { label: 'Finito / non disponibile', cls: 'ko' },
    modificato: { label: 'Modificato', cls: 'mod' },
  };
  const PUBLIC_MENU_URL = 'https://lucaprova1897-creator.github.io/carta-vini/';

  const esc = (s) => UI.escapeHTML(s == null ? '' : String(s));
  const statusOf = (s) => {
    if (STATUS[s.status]) return s.status;
    if (s.approval === 'rejected' || s.status === 'esaurito') return 'non_disponibile';
    if (s.approval === 'approved') return 'confermato';
    return 'pending';
  };
  const price = (p) => (p == null || isNaN(p)) ? '' : '€ ' + Number(p).toFixed(Number(p) % 1 ? 2 : 0).replace('.', ',');
  const shift = (iso, n) => { const d = Utils.isoToDate(iso); d.setDate(d.getDate() + n); return Utils.dateToISO(d); };

  // Chi conferma o cambia lo stato: chef principale, admin e sala (come
  // prima). Sul tablet condiviso serve il PIN di un responsabile.
  function withConfirmation(label, fn) {
    if (DB.getRole() === 'admin' || DB.isHeadChef()) { fn(); return; }
    UI.promptAdminPin(label, fn);
  }

  /* ------------------------------------------------------------------ */
  /* Schermata                                                           */
  /* ------------------------------------------------------------------ */
  UI.openSpecialsScreen = function (date) {
    UI.state.specialsDate = date || UI.state.specialsDate || UI.state.selectedDate || Utils.todayISO();
    UI.closeDailySpecialsDrawer && UI.closeDailySpecialsDrawer();
    UI.showScreen('piatti');
  };

  UI.renderSpecialsScreen = function () {
    const box = document.getElementById('piattiStudio');
    if (!box) return;
    const date = UI.state.specialsDate || Utils.todayISO();
    UI.renderSpecialsStudio(box, date, { withDateNav: true });
  };

  /**
   * Disegna lo "studio" piatti dentro box. Usato nella schermata dedicata
   * (sala/admin) e nella scheda Piatti della vista cucina.
   */
  UI.renderSpecialsStudio = function (box, date, opts) {
    opts = opts || {};
    SharedTables.ensureDailySpecialsForDate(date).then(() => draw());

    function draw() {
      const specials = SharedTables.getDailySpecials(date);
      const canManage = DB.canManageDailySpecials();
      const canApprove = DB.isHeadChef() || DB.canEdit();
      const nConf = specials.filter(s => statusOf(s) === 'confermato').length;
      const nPend = specials.filter(s => statusOf(s) === 'pending').length;
      const missingTr = specials.filter(s => !s.nameEn || !s.nameFr).length;
      const isToday = date === Utils.todayISO();

      let html = '';
      if (opts.withDateNav) {
        html += '<div class="ps-datebar">' +
          '<button type="button" class="ps-daybtn" data-shift="-1" aria-label="Giorno prima">‹</button>' +
          '<div class="ps-date"><span class="ps-date-main">' + esc(UI.dateLabel(date)) + '</span>' +
            (isToday ? '' : '<button type="button" class="ps-today" data-today="1">Torna a oggi</button>') + '</div>' +
          '<button type="button" class="ps-daybtn" data-shift="1" aria-label="Giorno dopo">›</button>' +
        '</div>';
      }

      html += '<div class="ps-summary">' +
        '<div class="ps-stat"><strong>' + specials.length + '</strong><span>piatti</span></div>' +
        '<div class="ps-stat ok"><strong>' + nConf + '</strong><span>sul menu QR</span></div>' +
        '<div class="ps-stat' + (nPend ? ' warn' : '') + '"><strong>' + nPend + '</strong><span>da confermare</span></div>' +
        (missingTr ? '<div class="ps-stat warn"><strong>' + missingTr + '</strong><span>senza traduzione</span></div>' : '') +
      '</div>';

      if (nPend && canApprove) {
        html += '<p class="ps-hint">I piatti "da confermare" <b>non compaiono</b> sul menu del QR code finché non vengono segnati come disponibili.</p>';
      }

      const isLockedTablet = DB.getRole() === 'staff' && DB._loginMethod === 'shared' && !DB.isTabletEditUnlocked();
      if (canManage) {
        html += '<button type="button" class="ps-add">＋ Aggiungi piatto</button>';
      } else if (isLockedTablet) {
        html += '<div class="ps-lock-banner"><span>🔒 Per aggiungere o modificare i piatti serve il codice di sblocco.</span>' +
          '<button type="button" class="ps-unlock">Sblocca</button></div>';
      }

      if (!specials.length) {
        html += '<div class="ps-empty"><strong>Nessun piatto per ' + esc(UI.dateLabel(date).toLowerCase()) + '</strong>' +
          '<span>' + (canManage ? 'Tocca "Aggiungi piatto" per iniziare.' : 'Quando la sala o lo chef ne aggiungono uno, compare qui.') + '</span></div>';
      } else {
        CATS.forEach(([cat, label]) => {
          const items = specials.filter(s => (s.category || 'altro') === cat);
          if (!items.length) return;
          html += '<section class="ps-group"><h3 class="ps-group-title">' + label + '</h3>' +
            items.map(s => card(s, canManage, canApprove)).join('') + '</section>';
        });
      }

      html += '<a class="ps-public" href="' + PUBLIC_MENU_URL + '" target="_blank" rel="noopener">Vedi il menu pubblico (QR code) ↗</a>';
      box.innerHTML = html;
      bind(specials, canManage);
    }

    function card(s, canManage, canApprove) {
      const st = statusOf(s);
      const tr = (code, has) => '<span class="ps-lang ' + (has ? 'has' : 'missing') + '">' + code + (has ? ' ✓' : ' manca') + '</span>';
      const canSeePrice = DB.canEdit() || DB.isHeadChef();
      return '<article class="ps-card ps-' + STATUS[st].cls + '" data-id="' + s.id + '">' +
        '<div class="ps-card-head">' +
          '<div class="ps-card-title"><h4>' + esc(s.name) + '</h4>' +
            (s.description ? '<p>' + esc(s.description) + '</p>' : '') + '</div>' +
          (canSeePrice && s.price != null ? '<div class="ps-price">' + price(s.price) + '</div>' : '') +
        '</div>' +
        '<div class="ps-meta">' +
          '<span class="ps-badge ps-badge-' + STATUS[st].cls + '">' + STATUS[st].label + '</span>' +
          tr('EN', !!s.nameEn) + tr('FR', !!s.nameFr) +
          (s.portionsLeft != null ? '<span class="ps-portions-badge">' + s.portionsLeft + ' porzioni</span>' : '') +
        '</div>' +
        (st === 'modificato' && s.chefNote ? '<p class="ps-chefnote">✏️ ' + esc(s.chefNote) + '</p>' : '') +
        (canApprove
          ? '<div class="ps-status" role="group" aria-label="Stato del piatto">' +
              ['confermato', 'non_disponibile', 'modificato'].map(k =>
                '<button type="button" class="ps-status-btn ps-' + STATUS[k].cls + (st === k ? ' active' : '') + '" data-status="' + k + '" data-id="' + s.id + '">' +
                  (k === 'confermato' ? 'Disponibile' : k === 'non_disponibile' ? 'Finito' : 'Modificato') + '</button>'
              ).join('') +
            '</div>' +
            (st === 'modificato' ? '<textarea class="text-input ps-note" data-id="' + s.id + '" rows="2" placeholder="Cosa è cambiato? (es. senza panna, contorno di patate)">' + esc(s.chefNote || '') + '</textarea>' : '')
          : '') +
        (canManage
          ? '<div class="ps-actions">' +
              '<div class="ps-portions"><span>Porzioni</span>' +
                '<button type="button" class="ps-step" data-step="-1" data-id="' + s.id + '" aria-label="Meno">−</button>' +
                '<b>' + (s.portionsLeft != null ? s.portionsLeft : '—') + '</b>' +
                '<button type="button" class="ps-step" data-step="1" data-id="' + s.id + '" aria-label="Più">+</button></div>' +
              '<div class="ps-links">' +
                '<button type="button" class="ps-link" data-act="edit" data-id="' + s.id + '">Modifica</button>' +
                '<button type="button" class="ps-link" data-act="tomorrow" data-id="' + s.id + '">Anche domani</button>' +
                '<button type="button" class="ps-link danger" data-act="remove" data-id="' + s.id + '">Elimina</button>' +
              '</div>' +
            '</div>'
          : '') +
      '</article>';
    }

    function rerender() { UI.renderSpecialsStudio(box, date, opts); if (UI.renderDailySpecials) UI.renderDailySpecials(date, ['dash']); }

    function bind(specials, canManage) {
      box.querySelectorAll('.ps-daybtn').forEach(b => b.addEventListener('click', () => {
        UI.state.specialsDate = shift(date, Number(b.dataset.shift));
        UI.renderSpecialsScreen();
      }));
      const todayBtn = box.querySelector('[data-today]');
      if (todayBtn) todayBtn.addEventListener('click', () => { UI.state.specialsDate = Utils.todayISO(); UI.renderSpecialsScreen(); });

      const unlock = box.querySelector('.ps-unlock');
      if (unlock) unlock.addEventListener('click', () => {
        const code = prompt('Codice di sblocco modifiche:');
        if (code === null) return;
        if (DB.unlockTabletEdit(code.trim())) { UI.toast('Sbloccato ✓'); rerender(); }
        else UI.toast('Codice sbagliato', 'warning');
      });
      const add = box.querySelector('.ps-add');
      if (add) add.addEventListener('click', () => UI.openSpecialEditor(date, null, rerender));

      box.querySelectorAll('.ps-status-btn').forEach(b => b.addEventListener('click', () => {
        const label = b.textContent.trim();
        withConfirmation('Segnare "' + label + '"?', () => {
          SharedTables.updateDailySpecial(date, b.dataset.id, { status: b.dataset.status });
          rerender();
        });
      }));
      box.querySelectorAll('.ps-note').forEach(t => t.addEventListener('change', () => {
        SharedTables.updateDailySpecial(date, t.dataset.id, { chefNote: t.value.trim() });
      }));
      if (!canManage) return;
      box.querySelectorAll('.ps-step').forEach(b => b.addEventListener('click', () => {
        const s = specials.find(x => x.id === b.dataset.id); if (!s) return;
        const cur = s.portionsLeft != null ? s.portionsLeft : 0;
        SharedTables.updateDailySpecial(date, s.id, { portionsLeft: Math.max(0, cur + Number(b.dataset.step)) });
        rerender();
      }));
      box.querySelectorAll('.ps-link').forEach(b => b.addEventListener('click', () => {
        const s = specials.find(x => x.id === b.dataset.id); if (!s) return;
        if (b.dataset.act === 'edit') UI.openSpecialEditor(date, s, rerender);
        if (b.dataset.act === 'tomorrow') {
          const to = shift(date, 1);
          SharedTables.duplicateDailySpecialToDate(date, s.id, to);
          UI.toast('"' + s.name + '" proposto anche ' + UI.dateLabel(to).toLowerCase() + ' ✓');
        }
        if (b.dataset.act === 'remove') {
          if (!confirm('Eliminare "' + s.name + '"? Sparisce anche dai giorni successivi che l\'avevano già.')) return;
          SharedTables.removeDailySpecial(date, s.id);
          rerender();
        }
      }));
    }
  };

  /* ------------------------------------------------------------------ */
  /* Scheda piatto: nuovo o modifica                                     */
  /* ------------------------------------------------------------------ */
  UI.openSpecialEditor = function (date, existing, onDone) {
    let sheet = document.getElementById('psEditor');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'psEditor';
      sheet.className = 'ps-editor-overlay';
      document.getElementById('app').appendChild(sheet);
    }
    const e = existing || {};
    let cat = e.category || 'primi';
    const canPrice = DB.canEdit() || DB.isHeadChef();

    sheet.innerHTML =
      '<div class="ps-editor" role="dialog" aria-modal="true" aria-labelledby="psEdTitle">' +
        '<header class="ps-ed-head">' +
          '<button type="button" class="ps-ed-close" id="psEdCancel" aria-label="Chiudi">✕</button>' +
          '<h2 id="psEdTitle">' + (existing ? 'Modifica piatto' : 'Nuovo piatto') + '</h2>' +
          '<span class="ps-ed-date">' + esc(UI.dateLabel(date)) + '</span>' +
        '</header>' +
        '<div class="ps-ed-body">' +
          '<div class="ps-field"><span class="ps-label">Portata</span>' +
            '<div class="ps-cats">' + CATS.map(([k, l]) => '<button type="button" class="ps-cat' + (k === cat ? ' active' : '') + '" data-cat="' + k + '">' + l + '</button>').join('') + '</div></div>' +
          '<div class="ps-field"><label class="ps-label" for="psName">Nome del piatto</label>' +
            '<input id="psName" class="ps-input ps-input-xl" autocomplete="off" placeholder="Es. Polenta concia con fontina" value="' + esc(e.name) + '">' +
            '<div id="psSuggest" class="ps-suggest hidden"></div></div>' +
          '<div class="ps-row">' +
            '<div class="ps-field ps-grow"><label class="ps-label" for="psDesc">Descrizione <em>(facoltativa)</em></label>' +
              '<textarea id="psDesc" class="ps-input" rows="2" placeholder="Es. Con burro d\'alpeggio e fontina DOP">' + esc(e.description) + '</textarea></div>' +
            (canPrice ? '<div class="ps-field ps-price-field"><label class="ps-label" for="psPrice">Prezzo €</label>' +
              '<input id="psPrice" class="ps-input" type="number" inputmode="decimal" step="0.5" min="0" placeholder="18" value="' + (e.price != null ? e.price : '') + '"></div>' : '') +
          '</div>' +
          '<div class="ps-tr">' +
            '<div class="ps-tr-head"><div><h3>Traduzioni per il menu QR</h3>' +
              '<p>Scrivi in italiano e premi Traduci: controlla sempre il risultato, soprattutto i nomi tipici.</p></div>' +
              '<button type="button" class="ps-translate" id="psTranslate">Traduci in inglese e francese</button></div>' +
            '<div class="ps-tr-grid">' +
              lang('en', 'English', e.nameEn, e.descriptionEn) +
              lang('fr', 'Français', e.nameFr, e.descriptionFr) +
            '</div>' +
          '</div>' +
          (!existing ? '<label class="ps-check"><input type="checkbox" id="psCascade" checked> Proponilo anche nei giorni successivi già programmati</label>' : '') +
        '</div>' +
        '<footer class="ps-ed-foot">' +
          '<button type="button" class="ps-btn-secondary" id="psEdCancel2">Annulla</button>' +
          '<button type="button" class="ps-btn-primary" id="psEdSave">' + (existing ? 'Salva modifiche' : 'Aggiungi piatto') + '</button>' +
        '</footer>' +
      '</div>';

    function lang(code, label, n, d) {
      return '<div class="ps-tr-col"><span class="ps-tr-lang">' + label + '</span>' +
        '<input class="ps-input" id="psName_' + code + '" placeholder="Nome in ' + label + '" value="' + esc(n) + '">' +
        '<textarea class="ps-input" id="psDesc_' + code + '" rows="2" placeholder="Descrizione">' + esc(d) + '</textarea></div>';
    }

    const $ = (sel) => sheet.querySelector(sel);
    const close = () => { sheet.classList.remove('active'); document.body.classList.remove('ps-lock'); };
    sheet.classList.add('active');
    document.body.classList.add('ps-lock');
    setTimeout(() => $('#psName').focus(), 50);

    sheet.querySelectorAll('.ps-cat').forEach(b => b.addEventListener('click', () => {
      cat = b.dataset.cat;
      sheet.querySelectorAll('.ps-cat').forEach(x => x.classList.toggle('active', x === b));
    }));

    // Suggerimenti dalla libreria: un piatto già fatto riporta anche le traduzioni
    const nameInput = $('#psName');
    const sug = $('#psSuggest');
    nameInput.addEventListener('input', () => {
      const matches = SharedTables.searchDishLibrary(nameInput.value).filter(d => d.name.toLowerCase() !== nameInput.value.trim().toLowerCase());
      if (!matches.length) { sug.classList.add('hidden'); sug.innerHTML = ''; return; }
      sug.classList.remove('hidden');
      sug.innerHTML = '<span class="ps-suggest-title">Già fatti in passato</span>' + matches.map(d =>
        '<button type="button" class="ps-suggest-item" data-id="' + d.id + '"><strong>' + esc(d.name) + '</strong>' +
        (d.description ? '<span>' + esc(d.description) + '</span>' : '') +
        ((d.nameEn || d.nameFr) ? '<em>con traduzioni</em>' : '') + '</button>').join('');
      sug.querySelectorAll('.ps-suggest-item').forEach(b => b.addEventListener('click', () => {
        const d = matches.find(x => x.id === b.dataset.id); if (!d) return;
        nameInput.value = d.name;
        $('#psDesc').value = d.description || '';
        $('#psName_en').value = d.nameEn || ''; $('#psDesc_en').value = d.descriptionEn || '';
        $('#psName_fr').value = d.nameFr || ''; $('#psDesc_fr').value = d.descriptionFr || '';
        cat = d.category || cat;
        sheet.querySelectorAll('.ps-cat').forEach(x => x.classList.toggle('active', x.dataset.cat === cat));
        sug.classList.add('hidden'); sug.innerHTML = '';
      }));
    });

    $('#psTranslate').addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const desc = $('#psDesc').value.trim();
      if (!name) { UI.toast('Scrivi prima il nome in italiano', 'warning'); nameInput.focus(); return; }
      const btn = $('#psTranslate');
      btn.disabled = true; btn.textContent = 'Traduco…';
      const r = await DB.accesso('traduci', { testi: [name, desc] });
      btn.disabled = false; btn.textContent = 'Traduci in inglese e francese';
      if (!r || r.errore || !r.traduzioni) { UI.toast((r && r.errore) || 'Traduzione non riuscita', 'warning'); return; }
      ['en', 'fr'].forEach(code => {
        const t = r.traduzioni[code] || [];
        if (t[0]) $('#psName_' + code).value = t[0];
        $('#psDesc_' + code).value = t[1] || '';
        $('#psName_' + code).classList.add('ps-fresh'); $('#psDesc_' + code).classList.add('ps-fresh');
      });
      UI.toast('Traduzioni pronte: controllale prima di salvare');
    });

    [$('#psEdCancel'), $('#psEdCancel2')].forEach(b => b.addEventListener('click', close));
    sheet.addEventListener('pointerdown', (ev) => { if (ev.target === sheet) close(); });

    $('#psEdSave').addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { UI.toast('Serve almeno il nome del piatto', 'warning'); nameInput.focus(); return; }
      const priceEl = $('#psPrice');
      const data = {
        name,
        description: $('#psDesc').value.trim(),
        category: cat,
        price: priceEl ? (priceEl.value !== '' ? Number(priceEl.value) : null) : (existing ? existing.price : null),
        nameEn: $('#psName_en').value.trim(), descriptionEn: $('#psDesc_en').value.trim(),
        nameFr: $('#psName_fr').value.trim(), descriptionFr: $('#psDesc_fr').value.trim(),
      };
      const save = () => {
        close();
        if (existing) {
          SharedTables.updateDailySpecial(date, existing.id, data, true);
          SharedTables.addToDishLibrary(data.name, data.description, data.category, data.nameEn, data.nameFr, data.descriptionEn, data.descriptionFr);
          UI.toast('Piatto aggiornato ✓');
        } else {
          const cascade = $('#psCascade') ? $('#psCascade').checked : true;
          SharedTables.addDailySpecial(date, { ...data, createdBy: DB.getOperator() }, cascade);
          UI.toast('Piatto aggiunto ✓ — lo chef lo deve confermare per mostrarlo sul menu QR');
        }
        if (onDone) onDone();
      };
      if (!data.nameEn || !data.nameFr) {
        if (!confirm('Mancano alcune traduzioni: sul menu QR i clienti stranieri vedranno il nome in italiano. Salvare lo stesso?')) return;
      }
      if (existing && !(DB.getRole() === 'admin' || DB.isHeadChef())) {
        UI.promptAdminPin('Salvare le modifiche a "' + name + '"?', save);
      } else {
        save();
      }
    });
  };
})();
