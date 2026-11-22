// Tavoli esterni con nomi personalizzati
// I tavoli sono ora gestiti da SharedTables (config.js) — caricati da Supabase

const NOTIFICATION_TYPES = {
  new_booking_today: 'Nuova prenotazione oggi',
  new_booking_any: 'Nuova prenotazione (qualsiasi giorno)',
  new_walkin: 'Nuovo walk-in',
  new_reminder: 'Nuovo promemoria',
  booking_cancelled: 'Prenotazione cancellata o archiviata',
  booking_modified_today: 'Modifica prenotazione oggi',
  booking_modified_any: 'Modifica prenotazione (qualsiasi giorno)',
  new_event: 'Nuovo evento',
  special_needs: 'Preparazione speciale richiesta',
  closure_upcoming: 'Chiusura imminente',
  dish_sold_out: 'Piatto del giorno esaurito',
  new_daily_special: 'Nuova proposta del giorno aggiunta',
  kitchen_free: 'Cucina libera (segnalato da sala)',
  service_summary: 'Resoconto fine servizio',
  ods_updated: 'ODS: ordine di servizio aggiornato',
  ods_assigned: 'ODS: nuovo compito per te',
  ods_done: 'ODS: cosa fatta da un collega (per gli organizzatori)',
};

const PROJECT_STATUS_LABELS = {
  idea: 'Idea',
  preventivo: 'Preventivo',
  inviato: 'Inviato',
  in_attesa: 'In attesa',
  confermato: 'Confermato',
  in_produzione: 'In produzione',
  completato: 'Completato',
  annullato: 'Annullato',
};
// Da qui in poi (Confermato → In produzione → Completato) l'evento è
// "operativo" — mostra la scheda operativa nel form, prima no (non ha
// senso preparare la cucina per un'idea non ancora nemmeno preventivata).
const PROJECT_OPERATIONAL_STATUSES = ['confermato', 'in_produzione', 'completato'];

const PROJECT_EVENT_TYPE_LABELS = {
  cena_abbinamento: 'Cena con abbinamento',
  degustazione: 'Degustazione guidata',
  aperitivo: 'Aperitivo-Welcome',
  privato: 'Evento privato',
  altro: 'Altro',
};

const UI = {
  state: {
    currentScreen: 'dashboard',
    selectedDate: Utils.todayISO(),
    selectedService: null,
    editingBookingId: null,
    formZone: 'any',
    formStatus: STATUS.CONFIRMED,
    previewDate: Utils.todayISO(),
    previewService: null,
  },

  showScreen(screenName) {
    // Schermate riservate all'admin pieno: chi non ne ha diritto torna in Home
    if ((screenName === 'stats' || screenName === 'projects') && !DB.isFullAdmin()) {
      screenName = 'dashboard';
    }
    // Uno spostamento tavolo lasciato a metà non deve restare "appeso"
    // se si cambia schermata
    if (screenName !== 'list') this.state.piantinaMoveSource = null;
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    const target = document.getElementById('screen-' + screenName);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.screen === screenName);
    });
    this.state.currentScreen = screenName;
    if (screenName === 'dashboard') { this.renderDashboard(); if (typeof ODS !== 'undefined') ODS.updateTrigger(); }
    if (screenName === 'list') this.renderList();
    if (screenName === 'config') this.renderConfig();
    if (screenName === 'search') document.getElementById('searchInput').focus();
    if (screenName === 'preview') this.renderPreview();
    if (screenName === 'readonly') this.renderReadOnlyView();
    if (screenName === 'buoni') { UI.renderBuoni(document.getElementById('buoniSearchInput')?.value || ''); }
    if (screenName === 'mise') this.renderMise();
    if (screenName === 'ordini') this.renderOrdini();
    if (screenName === 'buono-form') {}
    if (screenName === 'stats') this.renderStats();
    if (screenName === 'piatti' && this.renderSpecialsScreen) this.renderSpecialsScreen();
    if (screenName === 'projects') this.renderProjects();
    if (screenName === 'ods' && typeof ODS !== 'undefined') ODS.render();
  },

  /**
   * Pagina dettaglio evento in sola lettura — vista, non modificabile da
   * qui. Mostra tutto quello che serve per un briefing: quando, quanti,
   * allergie, menu, richieste speciali, note libere.
   */
  /**
   * Righe del dettaglio evento — condivise tra la pagina sola lettura (per
   * lo chef) e quella dello staff in Home, così i due posti mostrano
   * sempre esattamente le stesse informazioni senza doverle allineare a mano.
   */
  buildEventoDetailRows(b) {
    const { userNotes, eventoDetails } = Bookings.splitNotes(b.notes);
    const rows = [];
    rows.push({ label: 'Quando', value: Utils.relativeDayLabel(b.date) + ' — ' + Utils.formatDateShort(b.date) + ' · ' + b.time + ' (' + (b.service === 'lunch' ? 'Pranzo' : 'Cena') + ')' });
    rows.push({ label: 'Coperti', value: b.people + (b.highchairs > 0 ? ' (+' + b.highchairs + ' seggiolini)' : '') });
    if (Bookings.dietaryAlert(b)) rows.push({ label: '⚠️ Avviso', value: Bookings.dietaryAlert(b), warn: true });
    if (b.intolerances) rows.push({ label: 'Allergie / Intolleranze', value: b.intolerances, warn: true });
    if (eventoDetails && eventoDetails.menu) rows.push({ label: 'Menu', value: eventoDetails.menu });
    if (eventoDetails && eventoDetails.vino) rows.push({ label: 'Vino', value: eventoDetails.vino });
    if (eventoDetails && eventoDetails.richieste) rows.push({ label: 'Richieste speciali', value: eventoDetails.richieste });
    if (eventoDetails && eventoDetails.costo) rows.push({ label: 'Costo al cliente', value: eventoDetails.costo });
    if (eventoDetails && eventoDetails.statoPagamento) rows.push({ label: 'Pagamento', value: EVENTO_PAYMENT_LABELS[eventoDetails.statoPagamento] || eventoDetails.statoPagamento });
    if (userNotes) rows.push({ label: 'Note', value: userNotes });
    return rows;
  },

  _buildEventoDetailCardHTML(b) {
    const rows = this.buildEventoDetailRows(b);
    return '<div class="evento-detail-card">' +
      '<h2>' + this.escapeHTML(b.name || '(senza nome)') + '</h2>' +
      rows.map(r =>
        '<div class="evento-detail-row' + (r.warn ? ' evento-detail-row-warn' : '') + '">' +
          '<span class="evento-detail-label">' + r.label + '</span>' +
          '<span class="evento-detail-value">' + this.escapeHTML(r.value) + '</span>' +
        '</div>'
      ).join('') +
    '</div>';
  },

  openEventoDetailView(bookingId) {
    const b = Bookings.getById(bookingId);
    const content = document.getElementById('roEventoDetailContent');
    if (!b || !content) return;
    content.innerHTML = this._buildEventoDetailCardHTML(b);
    const editBtn = document.getElementById('roEventoDetailEditBtn');
    // Solo il chef principale può modificare — per gli altri cuochi resta
    // di sola lettura come sempre.
    editBtn.classList.toggle('hidden', !DB.isHeadChef());
    editBtn.textContent = '✏️ Modifica prenotazione';
    editBtn.onclick = () => this.openEditForm(bookingId);
    this.showScreen('ro-evento-detail');
  },

  openDayEventoDetailView(id) {
    const e = SharedTables.getDayEvents().find(x => x.id === id);
    const content = document.getElementById('roEventoDetailContent');
    if (!e || !content) return;
    content.innerHTML = this._buildDayEventoDetailCardHTML(e);
    const editBtn = document.getElementById('roEventoDetailEditBtn');
    editBtn.classList.toggle('hidden', !DB.isHeadChef());
    editBtn.textContent = '✏️ Modifica evento';
    editBtn.onclick = () => this.openDayEventForm(e);
    this.showScreen('ro-evento-detail');
  },

  /**
   * Stessa pagina di dettaglio, ma per lo staff in Home — con un pulsante
   * per passare alla modifica vera, invece di finire dritti nel form
   * appena tocchi l'evento (come succedeva prima).
   */
  openEventoDetailViewMain(bookingId) {
    const b = Bookings.getById(bookingId);
    const content = document.getElementById('eventoDetailContent');
    if (!b || !content) return;
    content.innerHTML = this._buildEventoDetailCardHTML(b);
    const editBtn = document.getElementById('eventoDetailEditBtn');
    editBtn.textContent = '✏️ Modifica prenotazione';
    editBtn.onclick = () => this.openEditForm(bookingId);
    this.showScreen('evento-detail');
  },

  _buildDayEventoDetailCardHTML(e) {
    const rows = [];
    rows.push({ label: 'Quando', value: Utils.relativeDayLabel(e.date) + ' — ' + Utils.formatDateShort(e.date) });
    if (e.menu) rows.push({ label: 'Menu', value: e.menu });
    if (e.vino) rows.push({ label: 'Vino', value: e.vino });
    if (e.richieste) rows.push({ label: 'Richieste speciali', value: e.richieste });
    if (e.costo) rows.push({ label: 'Costo', value: e.costo });
    return '<div class="evento-detail-card">' +
      '<h2>📅 ' + this.escapeHTML(e.title || 'Evento del giorno') + '</h2>' +
      rows.map(r =>
        '<div class="evento-detail-row">' +
          '<span class="evento-detail-label">' + r.label + '</span>' +
          '<span class="evento-detail-value">' + this.escapeHTML(r.value) + '</span>' +
        '</div>'
      ).join('') +
    '</div>';
  },

  /**
   * Dettaglio di un evento "del giorno" (senza prenotazione) — stessa
   * pagina usata per gli eventi legati a una prenotazione, ma il pulsante
   * in fondo apre il piccolo form dedicato invece del form prenotazione.
   */
  openDayEventoDetailViewMain(id) {
    const e = SharedTables.getDayEvents().find(x => x.id === id);
    const content = document.getElementById('eventoDetailContent');
    if (!e || !content) return;
    content.innerHTML = this._buildDayEventoDetailCardHTML(e);
    const editBtn = document.getElementById('eventoDetailEditBtn');
    editBtn.textContent = '✏️ Modifica evento';
    editBtn.onclick = () => this.openDayEventForm(e);
    this.showScreen('evento-detail');
  },

  /**
   * Crea o modifica un evento "del giorno" — senza cliente/tavolo, solo un
   * piano per una data (es. menu fisso di Ferragosto). Se `existing` è
   * dato, modifica quello; altrimenti ne crea uno nuovo.
   */
  openDayEventForm(existing) {
    let modal = document.getElementById('dayEventModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dayEventModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const e = existing || {};
    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>' + (existing ? 'Modifica evento' : 'Nuovo evento del giorno') + '</h3>' +
        '<p style="font-size:13px;color:var(--color-ink-soft);margin-bottom:14px">Legato a una data intera, non a una prenotazione — es. un menu fisso per una ricorrenza.</p>' +
        '<div class="field-group"><label class="field-label">Data</label>' +
          '<input type="date" class="text-input" id="dayEventDate" value="' + (e.date || Utils.todayISO()) + '"></div>' +
        '<div class="field-group"><label class="field-label">Titolo</label>' +
          '<input type="text" class="text-input" id="dayEventTitle" placeholder="Es. Ferragosto, Capodanno, Menu di Natale…" value="' + this.escapeHTML(e.title || '') + '"></div>' +
        '<div class="field-group"><label class="field-label">Menu</label>' +
          '<textarea class="text-input" id="dayEventMenu" placeholder="Es. Menu fisso 5 portate, tipico valdostano…">' + this.escapeHTML(e.menu || '') + '</textarea></div>' +
        '<div class="field-group"><label class="field-label">Vino</label>' +
          '<textarea class="text-input" id="dayEventVino" placeholder="Es. Petite Arvine, Torrette…">' + this.escapeHTML(e.vino || '') + '</textarea></div>' +
        '<div class="field-group"><label class="field-label">Richieste speciali</label>' +
          '<textarea class="text-input" id="dayEventRichieste" placeholder="Es. decorazioni, musica, orario diverso dal solito…">' + this.escapeHTML(e.richieste || '') + '</textarea></div>' +
        '<div class="field-group"><label class="field-label">Costo</label>' +
          '<input type="text" class="text-input" id="dayEventCosto" placeholder="Es. 45€ a persona" value="' + this.escapeHTML(e.costo || '') + '"></div>' +
        (existing ? '<a href="#" class="delete-link" id="dayEventDelete">Elimina evento</a>' : '') +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="dayEventCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="dayEventSave" style="background:var(--color-primary)">Salva</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');
    modal.querySelector('#dayEventCancel').addEventListener('click', () => modal.classList.remove('active'));

    if (existing) {
      modal.querySelector('#dayEventDelete').addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!confirm('Eliminare questo evento del giorno?')) return;
        modal.classList.remove('active');
        this.showSyncIndicator(true);
        await SharedTables.removeDayEvent(existing.id);
        this.showSyncIndicator(false);
        this.toast('Evento eliminato ✓');
        this.showScreen('dashboard');
      });
    }

    modal.querySelector('#dayEventSave').addEventListener('click', async () => {
      const date = modal.querySelector('#dayEventDate').value;
      const title = modal.querySelector('#dayEventTitle').value.trim();
      if (!date || !title) { this.toast('Data e titolo sono obbligatori', 'warning'); return; }
      const data = {
        date, title,
        menu: modal.querySelector('#dayEventMenu').value.trim(),
        vino: modal.querySelector('#dayEventVino').value.trim(),
        richieste: modal.querySelector('#dayEventRichieste').value.trim(),
        costo: modal.querySelector('#dayEventCosto').value.trim(),
      };
      modal.classList.remove('active');
      this.showSyncIndicator(true);
      let saved;
      if (existing) { await SharedTables.updateDayEvent(existing.id, data); saved = { ...existing, ...data }; }
      else { saved = await SharedTables.addDayEvent(data); }
      this.showSyncIndicator(false);
      this.toast('Evento salvato ✓');
      if (saved) this.openDayEventoDetailViewMain(saved.id);
      else this.showScreen('dashboard');
    });
  },

  toast(message, type) {
    type = type || 'default';
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast visible ' + type;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
  },

  showSyncIndicator(show) {
    const el = document.getElementById('syncIndicator');
    if (el) el.classList.toggle('visible', show);
  },

  // DASHBOARD
  renderDashboard() {
    const date = this.state.selectedDate;
    const service = this.state.selectedService;
    document.getElementById('dashDateLabel').textContent = this.dateLabel(date);
    document.getElementById('dashTodayBtn').classList.toggle('hidden', date === Utils.todayISO());
    document.getElementById('btnServiceLunch').classList.toggle('active', service === 'lunch');
    document.getElementById('btnServiceDinner').classList.toggle('active', service === 'dinner');

    const stats = Bookings.getStatsForDateAndService(date, service);
    document.getElementById('statGuests').textContent = stats.totalGuests;
    document.getElementById('statTables').textContent = stats.totalTablesBooked;

    this.renderDailySpecials(date);

    // Conta prenotazioni in ritardo
    const now = new Date();
    const todayISO = Utils.todayISO();
    const bookings = Bookings.getByDateAndService(date, service)
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW);
    const lateBookings = date === todayISO ? bookings.filter(b => {
      if (b.arrivedAt) return false;
      const nowMin = now.getHours() * 60 + now.getMinutes();
      return nowMin > Slots.toMinutes(b.time) + 5;
    }) : [];

    // Barra di riempimento: tavoli assegnati / tavoli disponibili non bloccati
    const zt = SharedTables.getZoneTavoli();
    const totalAvailableTables = SharedTables.getZones()
      .flatMap(z => zt[z] || [])
      .filter(t => !SharedTables.isBlocked(t, date, service)).length;
    const assignedTablesCount = bookings.reduce((sum, b) => {
      if (!b.tablesAssigned) return sum;
      return sum + b.tablesAssigned.split(',').filter(t => t.trim()).length;
    }, 0);
    const maxBookings = totalAvailableTables > 0 ? totalAvailableTables : 1;
    const pct = Math.min(100, Math.round((assignedTablesCount / maxBookings) * 100));

    const freeTables = Math.max(0, totalAvailableTables - assignedTablesCount);
    const statLateEl = document.getElementById('statLate');
    statLateEl.textContent = freeTables;
    statLateEl.style.color = freeTables === 0 ? 'var(--color-danger)' : 'var(--color-success)';

    const fillBar = document.getElementById('dashFillBar');
    const fillLabel = document.getElementById('dashFillLabel');
    if (fillBar) {
      const color = pct >= 90 ? '#c0392b' : pct >= 60 ? '#e67e22' : '#27ae60';
      fillBar.style.width = pct + '%';
      fillBar.style.background = color;
    }
    if (fillLabel) {
      if (stats.totalBookings === 0) fillLabel.textContent = 'Nessuna prenotazione';
      else fillLabel.textContent = pct + '% di riempimento — ' + assignedTablesCount + '/' + totalAvailableTables + ' tavoli assegnati';
    }

    // Alert ritardi
    const lateAlert = document.getElementById('dashLateAlert');
    if (lateAlert) {
      if (lateBookings.length > 0) {
        lateAlert.classList.remove('hidden');
        lateAlert.innerHTML = '⚠️ ' + lateBookings.length + ' ' +
          (lateBookings.length === 1 ? 'tavolo in ritardo' : 'tavoli in ritardo') + ': ' +
          lateBookings.map(b => '<strong>' + this.escapeHTML(b.name) + '</strong> (' + b.time + ')').join(', ');
      } else {
        lateAlert.classList.add('hidden');
      }
    }

    this.renderConflictAlert('dashConflictAlert', date, service);
    this.renderDaySummary(date);
    this.renderEventsCard();
    this.renderSecondTurnsCard(bookings, date, service);
    this.renderReminders();

    // Riquadro tavoli disponibili
    const tablesBox = document.getElementById('availableTablesBox');
    if (tablesBox) renderTableGrid(tablesBox, date, service, DB.canEdit());
  },

  renderAvailableTables(dateISO, serviceKey) {
    const container = document.getElementById('availableTablesBox');
    if (!container) return;
    renderTableGrid(container, dateISO, serviceKey, DB.canEdit());
  },

  /**
   * "domani 19 agosto" / "oggi 19 agosto" / "giovedì 21 agosto" — usato
   * nella frase di conferma dopo il salvataggio, più naturale da leggere
   * e da verificare al volo di "19/08/2026".
   */
  bookingSummaryDateLabel(iso) {
    const today = Utils.todayISO();
    const tm = Utils.isoToDate(today); tm.setDate(tm.getDate() + 1);
    const tomorrow = Utils.dateToISO(tm);
    const d = Utils.isoToDate(iso);
    const dayMonth = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    if (iso === today) return 'oggi ' + dayMonth;
    if (iso === tomorrow) return 'domani ' + dayMonth;
    const weekday = d.toLocaleDateString('it-IT', { weekday: 'long' });
    return weekday + ' ' + dayMonth;
  },

  /**
   * Resoconto servizio — stessa pagina raggiungibile toccando la
   * notifica di fine servizio automatica, o navigandoci a mano.
   */
  openServiceReport(dateISO, serviceKey) {
    // Anche il resoconto servizio è "dati" — stesso controllo severo
    // riservato al tablet condiviso, non solo Statistiche.
    if (DB.getRole() === 'staff' && DB._loginMethod === 'shared' && !DB.isFullAdmin()) {
      this.promptStrictAdminPin('Apri resoconto servizio', () => this.openServiceReport(dateISO, serviceKey));
      return;
    }
    const report = Bookings.getServiceReport(dateISO, serviceKey);
    const serviceLabel = serviceKey === 'lunch' ? 'Pranzo' : 'Cena';
    document.getElementById('serviceReportTitle').textContent = serviceLabel + ' — ' + this.dateLabel(dateISO);
    document.getElementById('serviceReportPeople').textContent = report.totalPeople;
    document.getElementById('serviceReportTables').textContent = report.totalTables;
    document.getElementById('serviceReportWalkins').textContent = report.walkInsCount;

    const list = document.getElementById('serviceReportList');
    if (report.bookings.length === 0) {
      list.innerHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessuna prenotazione per questo servizio.</p>';
    } else {
      list.innerHTML = report.bookings
        .slice()
        .sort((a, b) => a.time.localeCompare(b.time))
        .map(b => {
          const isWalkIn = (b.notes || '').trim().startsWith('🚶');
          return '<div class="reminder-row"><div class="reminder-row-text">' +
            b.time + ' — ' + this.escapeHTML(b.name || '(senza nome)') + ' · ' + b.people + ' persone' +
            (isWalkIn ? ' <span class="reminder-recipient-tag">walk-in</span>' : '') +
            (b.tablesAssigned ? ' · tav. ' + this.escapeHTML(b.tablesAssigned) : '') +
            '</div></div>';
        }).join('');
    }
    this.showScreen('service-report');
  },

  // Prefissi riconosciuti dal selettore nel form — usati anche per
  // capire se un numero già salvato ne aveva già uno, quando si riapre
  // una prenotazione in modifica.
  _PHONE_PREFIXES: ['+41', '+33', '+49', '+43', '+44', '+1', '+34', '+32', '+31', '+39'],

  /**
   * Da un numero salvato (es. "+41 79 123 4567" o, per la stragrande
   * maggioranza dei casi, un numero italiano scritto senza prefisso),
   * ricava cosa mettere nei due campi del form. Se non riconosce nessun
   * prefisso davanti, assume Italia e mette tutto il resto nel campo
   * numero — esattamente il comportamento di sempre, per non cambiare
   * nulla sui numeri già salvati.
   */
  splitPhoneForForm(phone) {
    const p = (phone || '').trim();
    for (const prefix of this._PHONE_PREFIXES) {
      if (p === prefix) return { prefix, number: '' };
      if (p.startsWith(prefix) && /[\s0-9]/.test(p[prefix.length] || '')) {
        return { prefix, number: p.slice(prefix.length).trim() };
      }
    }
    return { prefix: '+39', number: p };
  },

  /**
   * L'opposto — legge i due campi del form e ricava il valore unico da
   * salvare. Per l'Italia (il prefisso di default) non aggiunge nulla
   * davanti al numero: i numeri italiani restano identici a come sono
   * sempre stati salvati finora, cambia solo il modo in cui li scrivi.
   */
  combinePhoneFromForm() {
    const prefixEl = document.getElementById('fPhonePrefix');
    const numberEl = document.getElementById('fPhone');
    const prefix = prefixEl ? prefixEl.value : '';
    const number = numberEl ? numberEl.value.trim() : '';
    if (!number) return '';
    if (!prefix || prefix === '+39') return number;
    return prefix + ' ' + number;
  },

  dateLabel(iso) {
    const today = Utils.todayISO();
    const todayDate = Utils.isoToDate(today);
    const tm = new Date(todayDate); tm.setDate(todayDate.getDate() + 1);
    const yd = new Date(todayDate); yd.setDate(todayDate.getDate() - 1);
    const tomorrow = Utils.dateToISO(tm);
    const yesterday = Utils.dateToISO(yd);
    if (iso === today) return 'Oggi · ' + Utils.formatDateShort(iso);
    if (iso === tomorrow) return 'Domani · ' + Utils.formatDateShort(iso);
    if (iso === yesterday) return 'Ieri · ' + Utils.formatDateShort(iso);
    return Utils.formatDateLong(iso);
  },

  /**
   * Aggiorna la scritta "Sabato 16 Agosto" accanto al campo data del form —
   * così un errore di giorno si becca mentre si compila, non dopo aver già
   * salvato. Gestisce anche Oggi/Domani/Ieri come dateLabel().
   */
  /**
   * Controlla se il giorno/servizio scelto nel form è chiuso — mostra
   * l'avviso (o lo nasconde). Il blocco vero e proprio del pulsante Salva
   * vive dentro updateSaveButtonState(), che va chiamata subito dopo:
   * tenerli separati avrebbe fatto sì che l'una sovrascrivesse l'altra,
   * dato che updateSaveButtonState ricalcola sempre da zero.
   */
  checkFormClosureBlock() {
    const dateVal = document.getElementById('fDate').value;
    const service = this._formService;
    const alertBox = document.getElementById('formClosureAlert');
    if (!dateVal || !service || !alertBox) return false;
    const closure = SharedTables.getClosureFor(dateVal, service);
    if (closure) {
      const serviceLabel = service === 'lunch' ? 'il pranzo' : 'la cena';
      alertBox.classList.remove('hidden');
      alertBox.innerHTML = '🚫 Chiuso — ' + serviceLabel + ' di ' + this.dateLabel(dateVal).toLowerCase() +
        ' non è prenotabile' + (closure.reason ? ' (' + this.escapeHTML(closure.reason) + ')' : '') + '.';
      return true;
    }
    alertBox.classList.add('hidden');
    alertBox.innerHTML = '';
    return false;
  },

  /**
   * Apre (o aggiorna) la scheda Piatti dello chef sulla data indicata —
   * una data tutta sua, separata da quella usata nel resto della vista
   * chef (Lista, Eventi...), così sfogliare avanti per scrivere il menu
   * di domani non cambia cosa vede sala aprendo il proprio pannello.
   */
  openPiattiTab(date) {
    if (date) this.state.piattiSelectedDate = date;
    if (!this.state.piattiSelectedDate) this.state.piattiSelectedDate = this.state.selectedDate;
    const label = document.getElementById('piattiDateLabel');
    if (label) label.textContent = this.dateLabel(this.state.piattiSelectedDate);
    this.renderDailySpecials(this.state.piattiSelectedDate, ['ro']);
  },

  updateDateWeekdayLabel() {
    const input = document.getElementById('fDate');
    const label = document.getElementById('fDateWeekday');
    if (!input || !label) return;
    const text = input.value ? this.dateLabel(input.value) : '';
    label.textContent = text;
    // "Oggi" risalta con un colore forte — l'errore più comune è mettere
    // per sbaglio domani una prenotazione di oggi (o viceversa): un
    // colpo d'occhio sul colore, non solo sul testo piccolo, aiuta a
    // beccarlo mentre si compila, non dopo aver già salvato.
    label.classList.toggle('fdate-weekday-today', text.startsWith('Oggi'));
    label.classList.toggle('fdate-weekday-tomorrow', text.startsWith('Domani'));
  },

  shiftDate(iso, deltaDays) {
    const d = Utils.isoToDate(iso);
    d.setDate(d.getDate() + deltaDays);
    return Utils.dateToISO(d);
  },

  renderTimeline(containerId, dateISO, serviceKey, clickable) {
    const container = document.getElementById(containerId);
    const cfg = Config.load();
    const counts = Slots.countBookingsPerSlot(serviceKey, dateISO, Bookings.getCached());
    container.innerHTML = '';
    for (const slot of Slots.generateSlotsForService(serviceKey)) {
      const count = counts[slot] || 0;
      const level = this.slotLevel(count, cfg.maxBookingsPerSlot);
      const div = document.createElement('div');
      div.className = 'timeline-slot';
      div.dataset.level = level;
      div.innerHTML = '<span class="slot-time">' + slot + '</span><span class="slot-count">' + count + '/' + cfg.maxBookingsPerSlot + '</span>';
      if (clickable) {
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => {
          this.state.selectedDate = dateISO;
          this.state.selectedService = serviceKey;
          this.showScreen('list');
        });
      }
      container.appendChild(div);
    }
  },

  slotLevel(count, max) {
    if (count <= 0) return 'empty';
    if (count >= max) return 'full';
    if (count === 1) return 'partial2';   // giallo
    return 'partial';                      // arancione (2+)
  },

  serviceLabel(key) {
    return Config.load().services[key]?.label || key;
  },

  // LISTA
  renderList() {
    const date = this.state.selectedDate;
    const service = this.state.selectedService;
    document.getElementById('listDateLabel').textContent = this.dateLabel(date);
    document.getElementById('listTodayBtn').classList.toggle('hidden', date === Utils.todayISO());
    document.getElementById('listBtnLunch').classList.toggle('active', service === 'lunch');
    document.getElementById('listBtnDinner').classList.toggle('active', service === 'dinner');
    const bookings = Bookings.getByDateAndService(date, service);
    this.renderBookingRows('listContent', bookings, {
      emptyIcon: '🍽️', emptyTitle: 'Nessuna prenotazione', emptyText: 'Nessuna prenotazione per questo servizio.',
    });
    this.renderListSummary(bookings);
    this.renderConflictAlert('listConflictAlert', date, service);
    this.renderListAvailableTables(date);
    this.renderPiantina('listPiantinaBox', date, service, false);
  },

  /**
   * Resoconto sopra la lista (colonna destra): quante prenotazioni devono
   * ancora arrivare, quanti coperti e quanti tavoli coinvolge — solo chi
   * non è ancora segnato arrivato/seduto, per il servizio in corso. Un
   * colpo d'occhio su "quanto manca ancora" senza scorrere tutta la lista
   * a contare a mano.
   */
  renderListSummary(bookings) {
    const container = document.getElementById('listContent');
    if (!container || bookings.length === 0) return; // niente sopra una lista vuota

    const notArrived = bookings.filter(b =>
      b.status !== STATUS.CANCELLED && b.status !== STATUS.NOSHOW &&
      b.status !== STATUS.COMPLETED && b.status !== STATUS.WAITLIST &&
      b.status !== STATUS.SEATED && !b.arrivedAt
    );
    const totalCovers = notArrived.reduce((s, b) => s + (b.people || 0) + (b.highchairs || 0), 0);
    const tablesInvolved = new Set();
    notArrived.forEach(b => {
      if (b.tablesAssigned) b.tablesAssigned.split(',').forEach(t => tablesInvolved.add(t.trim()));
    });

    const summary = document.createElement('div');
    summary.className = 'list-summary-card';
    summary.innerHTML =
      '<div class="list-summary-item"><strong>' + notArrived.length + '</strong><span>ancora da arrivare</span></div>' +
      '<div class="list-summary-item"><strong>' + totalCovers + '</strong><span>coperti</span></div>' +
      '<div class="list-summary-item"><strong>' + tablesInvolved.size + '</strong><span>tavoli</span></div>';
    container.prepend(summary);
  },

  /**
   * Avviso ben visibile se due prenotazioni diverse risultano sullo stesso
   * tavolo senza un doppio turno che le separi — tipico di due operatori
   * che assegnano lo stesso tavolo nello stesso momento senza saperlo.
   */
  renderConflictAlert(containerId, dateISO, serviceKey) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const conflicts = Piantina.findConflicts(dateISO, serviceKey);
    if (conflicts.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }

    box.classList.remove('hidden');
    box.innerHTML = '⚠️ ' + conflicts.length + (conflicts.length === 1 ? ' tavolo doppio: ' : ' tavoli doppi: ') +
      conflicts.map(c =>
        'Tavolo ' + this.escapeHTML(c.table) + ' — <strong>' + this.escapeHTML(c.a.name) + '</strong> (' + c.a.time + ') e <strong>' +
        this.escapeHTML(c.b.name) + '</strong> (' + c.b.time + ')'
      ).join('; ');
  },

  /**
   * Riepilogo giornata: prenotati vs fatti per pranzo e cena insieme,
   * indipendente dal servizio selezionato nel toggle sopra — così si vede
   * sempre tutta la giornata senza dover cambiare tab.
   */
  renderDaySummary(dateISO) {
    const lunch = Bookings.getServedStats(dateISO, 'lunch');
    const dinner = Bookings.getServedStats(dateISO, 'dinner');
    document.getElementById('daySummaryLunchBooked').textContent = lunch.prenotati;
    document.getElementById('daySummaryLunchServed').textContent = lunch.fatti;
    document.getElementById('daySummaryDinnerBooked').textContent = dinner.prenotati;
    document.getElementById('daySummaryDinnerServed').textContent = dinner.fatti;
  },

  /**
   * Prenotazioni segnate come "Evento" (dal menu ⋯ → 🎉 Segna come evento)
   * — promemoria di qualcosa da organizzare in anticipo, non legato al
   * giorno/servizio selezionato: mostra sempre i prossimi in assoluto.
   */
  /**
   * HTML di una riga evento, riusato in Home e in sola lettura — così
   * un cambiamento (es. aggiungere le allergie) si applica ovunque insieme,
   * invece di doverlo ricordare in due posti diversi.
   */
  /**
   * Elenco unico dei prossimi eventi, uniti da due fonti diverse: quelli
   * legati a una prenotazione vera (checkbox nel form) e quelli "del
   * giorno" senza un cliente specifico (es. menu di Ferragosto). Ogni voce
   * porta con sé `kind` per sapere quale delle due è, e `id` per riaprirla.
   */
  getAllUpcomingEvents() {
    const bookingEvents = Bookings.getUpcomingEventi().map(b => ({ kind: 'booking', id: b.id, date: b.date, raw: b }));
    const dayEvents = SharedTables.getUpcomingDayEvents().map(e => ({ kind: 'day', id: e.id, date: e.date, raw: e }));
    return [...bookingEvents, ...dayEvents].sort((a, b) => a.date.localeCompare(b.date) || (a.raw.time || '').localeCompare(b.raw.time || ''));
  },

  /**
   * HTML di una riga evento, riusato in Home e in sola lettura — gestisce
   * entrambe le fonti (prenotazione o evento del giorno) con lo stesso
   * aspetto, così un cambiamento si applica ovunque insieme.
   */
  buildEventoRowHTML(item, clickable) {
    const clickCls = clickable ? ' event-row-clickable' : '';
    if (item.kind === 'day') {
      const e = item.raw;
      return '<div class="event-row' + clickCls + ' event-row-day" data-id="' + e.id + '" data-kind="day">' +
        '<div class="event-row-when">' +
          '<span class="event-row-relative">' + Utils.relativeDayLabel(e.date) + '</span>' +
          '<span class="event-row-date">' + Utils.formatDateShort(e.date) + '</span>' +
        '</div>' +
        '<div class="event-row-info">' +
          '<strong>📅 ' + this.escapeHTML(e.title || 'Evento del giorno') + '</strong>' +
          (e.costo ? '<div class="event-row-note">💶 ' + this.escapeHTML(e.costo) + '</div>' : '') +
          (e.menu ? '<div class="event-row-note">🍽️ ' + this.escapeHTML(e.menu) + '</div>' : '') +
        '</div>' +
      '</div>';
    }
    const b = item.raw;
    const { userNotes } = Bookings.splitNotes(b.notes);
    return '<div class="event-row' + clickCls + '" data-id="' + b.id + '" data-kind="booking">' +
      '<div class="event-row-when">' +
        '<span class="event-row-relative">' + Utils.relativeDayLabel(b.date) + '</span>' +
        '<span class="event-row-date">' + Utils.formatDateShort(b.date) + ' · ' + b.time + '</span>' +
      '</div>' +
      '<div class="event-row-info">' +
        '<strong>' + this.escapeHTML(b.name || '(senza nome)') + '</strong> · ' + b.people + ' pers.' +
        this.dietaryAlertHTML(b, true) +
        (b.intolerances ? '<div class="event-row-allergy">⚠️ ' + this.escapeHTML(b.intolerances) + '</div>' : '') +
        (userNotes ? '<div class="event-row-note">📝 ' + this.escapeHTML(userNotes) + '</div>' : '') +
      '</div>' +
    '</div>';
  },

  renderEventsCard() {
    const card = document.getElementById('dashEventsCard');
    const list = document.getElementById('dashEventsList');
    if (!card || !list) return;
    const eventi = this.getAllUpcomingEvents().slice(0, 8);
    if (eventi.length === 0) {
      list.innerHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessun evento in arrivo.</p>';
      return;
    }

    list.innerHTML = eventi.map(item => this.buildEventoRowHTML(item, true)).join('');

    list.querySelectorAll('.event-row').forEach(row => {
      row.addEventListener('click', () => {
        if (row.dataset.kind === 'day') this.openDayEventoDetailViewMain(row.dataset.id);
        else this.openEventoDetailViewMain(row.dataset.id);
      });
    });
  },

  /**
   * Card "Secondi turni" in Home — tavoli condivisi da più prenotazioni
   * nel servizio attualmente selezionato (non su più giorni come Eventi,
   * qui interessa solo il servizio che si sta guardando adesso). Compare
   * solo se ce n'è almeno uno, per non occupare spazio a vuoto.
   */
  renderSecondTurnsCard(bookings, date, service) {
    const card = document.getElementById('dashSecondTurnsCard');
    const list = document.getElementById('dashSecondTurnsList');
    const serviceLabel = document.getElementById('dashSecondTurnsService');
    if (!card || !list) return;

    const secondTurns = this.findSecondTurns(bookings).later;
    if (secondTurns.size === 0) {
      card.classList.add('hidden');
      list.innerHTML = '';
      return;
    }

    card.classList.remove('hidden');
    if (serviceLabel) serviceLabel.textContent = (service === 'lunch' ? 'Pranzo' : 'Cena') + ' ' + Utils.formatDateShort(date);

    // Ordina per orario, così si vede prima chi arriva prima
    const rows = Array.from(secondTurns.entries())
      .map(([id, info]) => ({ booking: bookings.find(b => b.id === id), info }))
      .filter(r => r.booking)
      .sort((a, b) => a.booking.time.localeCompare(b.booking.time));

    list.innerHTML = rows.map(({ booking: b, info }) =>
      '<div class="event-row event-row-clickable" data-id="' + b.id + '">' +
        '<div class="event-row-when">' +
          '<span class="event-row-relative" style="color:#C08A2E">Tav. ' + this.escapeHTML(b.tablesAssigned) + '</span>' +
          '<span class="event-row-date">' + b.time + '</span>' +
        '</div>' +
        '<div class="event-row-info">' +
          '<strong>' + this.escapeHTML(b.name || '(senza nome)') + '</strong> · ' + b.people + ' pers.' +
          '<div class="event-row-note">dopo ' + this.escapeHTML(info.earlier.name || '(senza nome)') + ' (' + info.earlier.time + ')' +
            (info.isProvisional ? ' · provvisorio' : '') +
          '</div>' +
        '</div>' +
      '</div>'
    ).join('');

    list.querySelectorAll('.event-row').forEach(row => {
      row.addEventListener('click', () => this.openEditForm(row.dataset.id));
    });
  },

  /**
   * Promemoria squadra: note libere condivise tra tutti, con chi le ha
   * scritte e quando — per lasciare messaggi ai colleghi o ricordarsi di
   * fare qualcosa, senza passare dal telefono o da un foglio in cucina.
   */
  renderReminders() {
    const list = document.getElementById('remindersList');
    if (!list) return;
    const addRow = document.querySelector('.reminder-add-row');
    if (addRow) addRow.classList.toggle('hidden', !DB.canEdit());

    // Selettore destinatario — stesso elenco nomi usato per "chi sei",
    // ripopolato ad ogni ridisegno così include anche chi è stato appena
    // aggiunto da Impostazioni senza dover ricaricare la pagina.
    const recipientSelect = document.getElementById('reminderRecipient');
    if (recipientSelect) {
      const names = SharedTables.getStaffNames();
      const currentVal = recipientSelect.value;
      recipientSelect.innerHTML = '<option value="">Per tutti</option>' +
        names.map(n => '<option value="' + this.escapeHTML(n) + '">Solo ' + this.escapeHTML(n) + '</option>').join('');
      if (names.includes(currentVal)) recipientSelect.value = currentVal;
    }

    const reminders = SharedTables.getReminders();
    if (reminders.length === 0) {
      list.innerHTML = '<p style="font-size:13px;color:var(--color-ink-soft);margin-top:10px">Nessun promemoria al momento.</p>';
      return;
    }
    list.innerHTML = reminders.map(r => {
      const when = new Date(r.createdAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return '<div class="reminder-row">' +
        '<div class="reminder-row-text">' + this.escapeHTML(r.text) + (r.recipient ? ' <span class="reminder-recipient-tag">per ' + this.escapeHTML(r.recipient) + '</span>' : '') + '</div>' +
        '<div class="reminder-row-meta">' +
          '<span>' + this.escapeHTML(r.author) + ' · ' + when + '</span>' +
          (DB.canEdit() ? '<span class="reminder-row-actions">' +
            '<button class="reminder-edit-btn" data-id="' + r.id + '">✏️</button>' +
            '<button class="reminder-remove-btn" data-id="' + r.id + '">Fatto ✓</button>' +
          '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.reminder-edit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const current = SharedTables.getReminders().find(r => r.id === btn.dataset.id);
        if (!current) return;
        const newText = prompt('Modifica promemoria:', current.text);
        if (newText === null) return; // annullato
        if (!newText.trim()) { this.toast('Il promemoria non può essere vuoto', 'warning'); return; }
        this.showSyncIndicator(true);
        await SharedTables.updateReminder(current.id, newText);
        this.showSyncIndicator(false);
        this.renderReminders();
      });
    });
    list.querySelectorAll('.reminder-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.showSyncIndicator(true);
        await SharedTables.removeReminder(btn.dataset.id);
        this.showSyncIndicator(false);
        this.renderReminders();
      });
    });
  },

  addReminder() {
    if (!DB.canEdit()) return;
    const input = document.getElementById('reminderInput');
    const text = input.value.trim();
    if (!text) return;
    const recipient = document.getElementById('reminderRecipient')?.value || null;

    const submit = async () => {
      this.showSyncIndicator(true);
      await SharedTables.addReminder(text, DB.getOperatorWithDevice(), recipient);
      this.showSyncIndicator(false);
      input.value = '';
      this.renderReminders();
    };

    // Su dispositivo etichettato (tablet condiviso) chiede prima "chi sei",
    // così il promemoria risulta firmato da chi l'ha scritto davvero.
    if (DB.getDeviceLabel()) {
      this.openOperatorPicker(false, {
        title: 'Chi lascia questo promemoria?',
        subtitle: 'Da ' + DB.getDeviceLabel() + '.',
        onConfirm: submit,
      });
      return;
    }
    submit();
  },


  // PIANTINA SALA
  // editable=true solo nelle Impostazioni, solo per admin da desktop (pointer:fine)
  // Mostra una zona alla volta (selettore in alto) invece di impilare tutte le piantine.
  renderPiantina(containerId, dateISO, serviceKey, editable) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const data = Piantina.buildLayoutData(dateISO, serviceKey);
    const zonesWithTables = data.filter(z => z.tables.length > 0);

    if (zonesWithTables.length === 0) {
      container.innerHTML = '<div class="piantina-empty">Nessun tavolo configurato. Aggiungi zone e tavoli qui sopra.</div>';
      return;
    }

    // Mantieni la zona selezionata se ancora valida, altrimenti la prima disponibile
    if (!this.state.piantinaZone || !zonesWithTables.some(z => z.zone === this.state.piantinaZone)) {
      this.state.piantinaZone = zonesWithTables[0].zone;
    }
    const selectedZone = this.state.piantinaZone;

    container.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';

    // Elenco chiaro dei turni in arrivo, sopra la piantina — con o senza
    // orario confermato, così anche un doppio turno preso al volo senza
    // orario preciso (provvisorio) resta ben visibile, non solo quello
    // con un orario esatto impostato.
    if (!editable) {
      const upcoming = [];
      // Raggruppo per chi ARRIVA DOPO (non per la coppia esatta) — così
      // copre anche il caso in cui due prenotazioni diverse (es. due
      // tavoli da 2 separati) liberano insieme i tavoli per un'unica
      // prenotazione del secondo turno che li unisce (es. un tavolo da 4):
      // "dopo Mario e Anna, poi Davide" invece di due righe separate.
      const seenByNext = new Map(); // id di chi arriva dopo -> voce
      data.forEach(zoneData => {
        zoneData.tables.forEach(t => {
          if (t.booking && t.secondTurn) {
            const key = t.secondTurn.id;
            if (seenByNext.has(key)) {
              const entry = seenByNext.get(key);
              entry.tables.push(t.table);
              if (!entry.currents.some(c => c.id === t.booking.id)) entry.currents.push(t.booking);
            } else {
              const entry = { tables: [t.table], currents: [t.booking], next: t.secondTurn };
              seenByNext.set(key, entry);
              upcoming.push(entry);
            }
          }
        });
      });
      if (upcoming.length > 0) {
        upcoming.sort((a, b) => a.next.time.localeCompare(b.next.time));
        const upcomingBox = document.createElement('div');
        upcomingBox.className = 'piantina-upcoming-turns';
        const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
        const isToday = dateISO === Utils.todayISO();
        upcomingBox.innerHTML = '<h4>⏱️ Turni in arrivo</h4>' + upcoming.map(u => {
          const currentNames = u.currents.map(c => this.escapeHTML(c.name || 'senza nome')).join(' e ');
          // Colore e riempimento in base a quanto tempo resta davvero —
          // solo se confermato: uso il rilascio più tardivo tra chi deve
          // ancora liberare il tavolo (il vero momento in cui sarà pronto).
          const releaseTimes = u.currents.map(c => c.doubleShiftRelease).filter(Boolean).sort();
          const effectiveRelease = releaseTimes.length ? releaseTimes[releaseTimes.length - 1] : null;
          const urgency = (isToday && u.next.confirmed && effectiveRelease) ? this._urgencyStyle(effectiveRelease) : null;
          const style = urgency ? ' style="background:' + urgency.bg + ';border-left-color:' + urgency.border + '"' : '';
          const fill = urgency ? '<span class="piantina-upcoming-fill" style="width:' + Math.round(urgency.t * 100) + '%;background:' + urgency.border + '"></span>' : '';

          // Da quanto sono seduti — utile per giudicare quanto è realistico
          // l'orario dichiarato, non solo fidarsi del numero sulla carta.
          // Ha senso solo guardando la piantina di OGGI, non di un altro
          // giorno (passato o futuro), altrimenti sarebbe un conto senza senso.
          const seatedSince = isToday ? u.currents.map(c => {
            const minutesSeated = nowMinutes - Slots.toMinutes(c.time);
            if (minutesSeated < 0) return null; // deve ancora arrivare, non ha senso "da quanto"
            return this.escapeHTML(c.name || 'senza nome') + ' da ' + minutesSeated + ' min';
          }).filter(Boolean).join(', ') : '';

          // Come vanno ripreparati i tavoli: se oggi sono separati (più
          // prenotazioni diverse) ma il turno dopo li vuole uniti, o
          // viceversa — il numero che cambia è proprio quello che genera
          // errori se nessuno lo segnala chiaramente.
          let reconfigNote = '';
          if (u.tables.length > 1 && u.currents.length > 1) {
            reconfigNote = '🔧 Da unire: tavoli ' + this.escapeHTML(u.tables.join('+')) + ' insieme (oggi separati)';
          } else if (u.currents.length === 1) {
            const currentOwnTables = u.currents[0].tablesAssigned ? u.currents[0].tablesAssigned.split(',').map(t => t.trim()) : [];
            const extraTables = currentOwnTables.filter(t => !u.tables.includes(t));
            if (extraTables.length > 0) {
              reconfigNote = '🔧 Da separare: solo ' + this.escapeHTML(u.tables.join('+')) + ' per questo turno (ora unito anche a ' + this.escapeHTML(extraTables.join('+')) + ')';
            }
          }

          return '<div class="piantina-upcoming-row' + (!u.next.confirmed ? ' provisional' : '') + '" data-id="' + u.next.id + '"' + style + '>' +
            fill +
            '<span class="piantina-upcoming-content">' +
              '<strong>Tav. ' + this.escapeHTML(u.tables.join('+')) + '</strong>' +
              ' — dopo ' + currentNames + ', poi <strong>' + this.escapeHTML(u.next.name || 'senza nome') + '</strong>, ' + (u.next.people || 0) + ' cop. (' + u.next.time + ')' +
              (u.next.confirmed ? '' : ' <span class="piantina-upcoming-tag">provvisorio</span>') +
              (seatedSince ? '<div class="piantina-upcoming-detail">' + seatedSince + '</div>' : '') +
              (reconfigNote ? '<div class="piantina-upcoming-detail piantina-upcoming-reconfig">' + reconfigNote + '</div>' : '') +
            '</span>' +
          '</div>';
        }).join('');
        container.appendChild(upcomingBox);
        upcomingBox.querySelectorAll('.piantina-upcoming-row').forEach(row => {
          row.addEventListener('click', () => { if (DB.canEdit()) this.openEditForm(row.dataset.id); });
        });
      }
    }

    // Banner "modalità sposta" attiva: resta visibile anche cambiando zona,
    // così si può spostare una prenotazione anche su un tavolo di un'altra sala.
    const move = this.state.piantinaMoveSource;
    if (!editable && move) {
      const isMultiMove = move.sourceTables.length > 1;
      const banner = document.createElement('div');
      banner.className = 'piantina-move-banner';
      if (isMultiMove) {
        banner.innerHTML =
          '<span>🔄 Sposto <strong>' + this.escapeHTML(move.name) + '</strong> (tavoli ' + move.sourceTables.join('+') +
          ') — tocca ' + move.sourceTables.length + ' o più tavoli liberi di destinazione (' + move.destination.length + ' scelti)</span>' +
          '<button type="button" id="piantinaMoveConfirmBtn" ' + (move.destination.length === 0 ? 'disabled' : '') + '>Conferma</button>' +
          '<button type="button" id="piantinaMoveCancelBtn">Annulla</button>';
      } else {
        banner.innerHTML =
          '<span>🔄 Sposto <strong>' + this.escapeHTML(move.name) + '</strong> dal tavolo ' + this.escapeHTML(move.sourceTables[0]) + ' — tocca la destinazione</span>' +
          '<button type="button" id="piantinaMoveCancelBtn">Annulla</button>';
      }
      container.appendChild(banner);
      banner.querySelector('#piantinaMoveCancelBtn').addEventListener('click', () => {
        this.cancelTableMove(containerId, dateISO, serviceKey);
      });
      const confirmBtn = banner.querySelector('#piantinaMoveConfirmBtn');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => this.completeMultiTableMove(containerId, dateISO, serviceKey));
      }
    }

    // Selettore zona (solo se più di una zona ha tavoli)
    if (zonesWithTables.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'piantina-zone-tabs';
      zonesWithTables.forEach(({ zone }) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'piantina-zone-tab' + (zone === selectedZone ? ' active' : '');
        tab.textContent = zone;
        tab.addEventListener('click', () => {
          this.state.piantinaZone = zone;
          this.renderPiantina(containerId, dateISO, serviceKey, editable);
        });
        tabs.appendChild(tab);
      });
      container.appendChild(tabs);
    }

    const { zone, tables } = zonesWithTables.find(z => z.zone === selectedZone);

    const wrap = document.createElement('div');
    wrap.className = 'piantina-svg-wrap';
    if (editable) wrap.classList.add('piantina-svg-wrap-editable');

    // Calcola dimensioni canvas in base alle posizioni reali dei tavoli,
    // non partendo sempre da (0,0) — se i tavoli iniziano più in basso o
    // più a destra, il contenitore li segue invece di lasciare un margine
    // vuoto enorme prima di loro (era il problema principale).
    const cols = Math.min(Piantina.COLS, tables.length) || 1;
    const rows = Math.ceil(tables.length / Piantina.COLS);
    const padding = editable ? 100 : 16;
    const halfW = Piantina.TABLE_SIZE * 0.8; // margine generoso: copre anche i tavoli rettangolari, più larghi
    const halfH = Piantina.TABLE_SIZE / 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    tables.forEach(t => {
      minX = Math.min(minX, t.pos.x - halfW);
      minY = Math.min(minY, t.pos.y - halfH);
      maxX = Math.max(maxX, t.pos.x + halfW);
      maxY = Math.max(maxY, t.pos.y + halfH);
    });
    if (!isFinite(minX)) {
      // Nessun tavolo ancora posizionato: usa la griglia di default
      minX = 0; minY = 0;
      maxX = cols * Piantina.DEFAULT_SPACING;
      maxY = rows * Piantina.DEFAULT_SPACING;
    }
    const viewMinX = Math.max(0, minX - padding);
    const viewMinY = Math.max(0, minY - padding);
    const viewW = (maxX - viewMinX) + padding;
    const viewH = (maxY - viewMinY) + padding;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${viewMinX} ${viewMinY} ${viewW} ${viewH}`);
    svg.setAttribute('width', '100%');
    // Niente altezza fissa in pixel: con larghezza al 100% su un contenitore
    // largo, un'altezza fissa quasi mai ha le stesse proporzioni del
    // contenuto vero — il browser lo ridimensiona per stare dentro e
    // riempie lo spazio avanzato con un margine vuoto (di solito sopra e
    // sotto, centrato). Con aspect-ratio il browser calcola da solo
    // l'altezza giusta in base alla larghezza reale, senza mai dover
    // aggiungere margine.
    svg.style.aspectRatio = viewW + ' / ' + viewH;
    svg.style.height = 'auto';
    svg.style.minHeight = '160px';
    if (editable) svg.classList.add('piantina-svg-editable');

    // Sfondo a quadretti nell'editor: solo riferimento visivo per allineare
    // a occhio, il trascinamento è libero e NON scatta su questa griglia.
    if (editable) {
      const defs = document.createElementNS(NS, 'defs');
      const pattern = document.createElementNS(NS, 'pattern');
      const patternId = 'piantinaGrid';
      pattern.setAttribute('id', patternId);
      pattern.setAttribute('width', Piantina.VISUAL_GRID);
      pattern.setAttribute('height', Piantina.VISUAL_GRID);
      pattern.setAttribute('patternUnits', 'userSpaceOnUse');
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', 1);
      dot.setAttribute('cy', 1);
      dot.setAttribute('r', 1.2);
      dot.setAttribute('fill', 'var(--color-border)');
      pattern.appendChild(dot);
      defs.appendChild(pattern);
      svg.appendChild(defs);

      const bg = document.createElementNS(NS, 'rect');
      bg.setAttribute('x', 0);
      bg.setAttribute('y', 0);
      bg.setAttribute('width', maxX);
      bg.setAttribute('height', maxY);
      bg.setAttribute('fill', `url(#${patternId})`);
      svg.appendChild(bg);
    }

    // Linea di collegamento tra tavoli uniti per la stessa prenotazione
    // (disegnata per prima, così resta sotto ai tavoli)
    this._drawJoinedTableLinks(NS, svg, tables);
    // Linea per i tavoli fisicamente accostati (senza prenotazione sopra)
    // — solo in piantina dal vivo, non nell'editor: lì non ha senso, non
    // esiste un giorno/servizio specifico da guardare.
    if (!editable) this._drawFreeTableJoinLinks(NS, svg, tables, dateISO, serviceKey);

    tables.forEach(t => {
      const g = this._buildTableShape(NS, zone, t, editable, dateISO, serviceKey);
      // Tap/click sul tavolo (senza trascinamento):
      // in modalità editable apre l'editor forma/rotazione, altrimenti il dettaglio
      // (o, se il tavolo è occupato, permette di trascinarlo su un altro libero).
      this._bindPiantinaTap(g, svg, zone, t.table, t.status, t.booking, t.pos, editable, containerId, dateISO, serviceKey);
      svg.appendChild(g);
    });

    wrap.appendChild(svg);
    container.appendChild(wrap);

    // Legenda
    const legend = document.createElement('div');
    legend.className = 'piantina-legend';
    Object.entries(Piantina.STATUS_LABELS).forEach(([key, label]) => {
      const item = document.createElement('div');
      item.className = 'piantina-legend-item';
      const dot = document.createElement('span');
      dot.className = 'piantina-legend-dot';
      dot.style.background = `var(${Piantina.STATUS_COLOR_VAR[key]})`;
      item.appendChild(dot);
      const span = document.createElement('span');
      span.textContent = label;
      item.appendChild(span);
      legend.appendChild(item);
    });
    if (!editable) {
      const arrivedItem = document.createElement('div');
      arrivedItem.className = 'piantina-legend-item';
      const ring = document.createElement('span');
      ring.className = 'piantina-legend-dot';
      ring.style.background = 'transparent';
      ring.style.border = '2px solid #2ECC71';
      arrivedItem.appendChild(ring);
      const arrivedLabel = document.createElement('span');
      arrivedLabel.textContent = 'Cliente arrivato';
      arrivedItem.appendChild(arrivedLabel);
      legend.appendChild(arrivedItem);

      const secondTurnItem = document.createElement('div');
      secondTurnItem.className = 'piantina-legend-item';
      const stRing = document.createElement('span');
      stRing.className = 'piantina-legend-dot';
      stRing.style.background = 'transparent';
      stRing.style.border = '2px dashed #C08A2E';
      secondTurnItem.appendChild(stRing);
      const stLabel = document.createElement('span');
      stLabel.textContent = 'Secondo turno in arrivo';
      secondTurnItem.appendChild(stLabel);
      legend.appendChild(secondTurnItem);
    }
    container.appendChild(legend);
    if (editable) {
      const hint = document.createElement('div');
      hint.className = 'piantina-edit-toggle-hint';
      hint.textContent = 'Trascina un tavolo per spostarlo. Tocca un tavolo fermo per cambiare forma e orientamento.';
      container.appendChild(hint);
    } else if (DB.canEdit() && tables.some(t => t.booking)) {
      const hint = document.createElement('div');
      hint.className = 'piantina-edit-toggle-hint';
      hint.textContent = 'Tocca un tavolo occupato e poi "Sposta tavolo" per spostare la prenotazione su uno libero.';
      container.appendChild(hint);
    }
  },

  /**
   * Disegna una linea tra tutti i tavoli uniti per la stessa prenotazione
   * (b.tablesAssigned con più di un tavolo), così si vede a colpo d'occhio
   * quali tavoli formano un unico tavolo virtuale più grande.
   */
  /**
   * Linea tra tavoli liberi ma segnati come fisicamente accostati adesso
   * (SharedTables._tableJoins) — diversa da _drawJoinedTableLinks, che
   * collega i tavoli di UNA prenotazione: qui non c'è nessuna prenotazione
   * sopra, è la configurazione fisica della sala in questo momento.
   */
  _drawFreeTableJoinLinks(NS, svg, tables, dateISO, serviceKey) {
    if (!dateISO || !serviceKey) return;
    const seenGroups = new Set();
    tables.forEach(t => {
      if (t.booking) return; // occupato: se conta, ci pensa già l'altra funzione
      const group = SharedTables.getTableJoinGroupFor(dateISO, serviceKey, t.table);
      if (!group) return;
      const key = group.slice().sort().join(',');
      if (seenGroups.has(key)) return;
      seenGroups.add(key);
      const points = group.map(gt => {
        const found = tables.find(x => x.table === gt);
        return found ? found.pos : null;
      }).filter(Boolean);
      if (points.length < 2) return; // gli altri tavoli del gruppo non sono in questa zona
      for (let i = 0; i < points.length - 1; i++) {
        const line = document.createElementNS(NS, 'line');
        line.classList.add('piantina-join-line', 'piantina-join-line-free');
        line.setAttribute('x1', points[i].x);
        line.setAttribute('y1', points[i].y);
        line.setAttribute('x2', points[i + 1].x);
        line.setAttribute('y2', points[i + 1].y);
        svg.appendChild(line);
      }
    });
  },

  _drawJoinedTableLinks(NS, svg, tables) {
    const byBooking = new Map();
    tables.forEach(t => {
      if (!t.booking) return;
      const count = t.booking.tablesAssigned ? t.booking.tablesAssigned.split(',').filter(x => x.trim()).length : 1;
      if (count < 2) return; // un solo tavolo, niente da collegare
      if (!byBooking.has(t.booking.id)) byBooking.set(t.booking.id, { status: t.status, points: [] });
      byBooking.get(t.booking.id).points.push(t.pos);
    });

    byBooking.forEach(({ status, points }) => {
      if (points.length < 2) return; // gli altri tavoli del gruppo non sono in questa zona
      const colorVar = Piantina.STATUS_COLOR_VAR[status];
      // Collega ogni tavolo al successivo (nell'ordine in cui compaiono in
      // tablesAssigned) — per 2-3 tavoli dà una catena visivamente chiara.
      for (let i = 0; i < points.length - 1; i++) {
        const line = document.createElementNS(NS, 'line');
        line.classList.add('piantina-join-line');
        line.setAttribute('x1', points[i].x);
        line.setAttribute('y1', points[i].y);
        line.setAttribute('x2', points[i + 1].x);
        line.setAttribute('y2', points[i + 1].y);
        line.setAttribute('stroke', `var(${colorVar})`);
        svg.appendChild(line);
      }
    });
  },

  /**
   * Costruisce il gruppo SVG di un singolo tavolo, con forma (quadrato,
   * rettangolare, rotondo) e rotazione (orizzontale/obliquo/verticale).
   */
  /**
   * Un anello attorno al tavolo, stessa forma del tavolo stesso (quadrato/
   * rettangolo/rotondo) — riusato per "arrivato" e "secondo turno in
   * arrivo", con un margine diverso così più anelli possono convivere
   * senza sovrapporsi sullo stesso tavolo.
   */
  _buildStatusRing(NS, t, shape, rotation, size, ringPad, className) {
    let ring;
    if (shape === Piantina.SHAPES.ROUND) {
      ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('cx', t.pos.x);
      ring.setAttribute('cy', t.pos.y);
      ring.setAttribute('r', size / 2 + ringPad);
    } else {
      const w = shape === Piantina.SHAPES.RECT ? size * 1.6 : size;
      ring = document.createElementNS(NS, 'rect');
      ring.setAttribute('x', t.pos.x - w / 2 - ringPad);
      ring.setAttribute('y', t.pos.y - size / 2 - ringPad);
      ring.setAttribute('width', w + ringPad * 2);
      ring.setAttribute('height', size + ringPad * 2);
      ring.setAttribute('rx', (shape === Piantina.SHAPES.RECT ? 6 : 8) + ringPad);
      if (rotation) ring.setAttribute('transform', `rotate(${rotation} ${t.pos.x} ${t.pos.y})`);
    }
    className.split(' ').forEach(c => ring.classList.add(c));
    return ring;
  },

  _buildTableShape(NS, zone, t, editable, dateISO, serviceKey) {
    const size = Piantina.TABLE_SIZE - 16;
    const g = document.createElementNS(NS, 'g');
    g.classList.add('piantina-table-group');
    if (editable) g.classList.add('editable');
    g.dataset.zone = zone;
    g.dataset.table = t.table;

    // Modalità sposta attiva: evidenzia i tavoli di origine, le destinazioni
    // già scelte (spostamento multi-tavolo) e i tavoli liberi disponibili
    // come destinazione — per farsi capire senza istruzioni.
    const move = !editable && this.state.piantinaMoveSource;
    if (move) {
      if (move.sourceTables.includes(t.table) && move.zone === zone) {
        g.classList.add('move-source');
      } else if (move.destination && move.destination.some(d => d.table === t.table && d.zone === zone)) {
        g.classList.add('move-destination-picked');
      } else if (!t.booking && t.status !== Piantina.STATUS.BLOCKED) {
        g.classList.add('move-target');
      }
    }

    const colorVar = Piantina.STATUS_COLOR_VAR[t.status];
    const shape = t.pos.shape || Piantina.DEFAULT_SHAPE;
    const rotation = t.pos.rotation || 0;

    let shapeEl;
    if (shape === Piantina.SHAPES.ROUND) {
      shapeEl = document.createElementNS(NS, 'circle');
      shapeEl.setAttribute('cx', t.pos.x);
      shapeEl.setAttribute('cy', t.pos.y);
      shapeEl.setAttribute('r', size / 2);
    } else {
      shapeEl = document.createElementNS(NS, 'rect');
      const w = shape === Piantina.SHAPES.RECT ? size * 1.6 : size;
      const h = size;
      shapeEl.setAttribute('x', t.pos.x - w / 2);
      shapeEl.setAttribute('y', t.pos.y - h / 2);
      shapeEl.setAttribute('width', w);
      shapeEl.setAttribute('height', h);
      shapeEl.setAttribute('rx', shape === Piantina.SHAPES.RECT ? 6 : 8);
      if (rotation) shapeEl.setAttribute('transform', `rotate(${rotation} ${t.pos.x} ${t.pos.y})`);
    }
    // Anello "arrivato": si vede subito con la coda dell'occhio, senza
    // toccare il colore di riempimento che indica lo stato occupato/walk-in.
    if (t.booking && t.booking.arrivedAt) {
      g.appendChild(this._buildStatusRing(NS, t, shape, rotation, size, 5, 'piantina-arrived-ring'));
    }
    // Anello "secondo turno in arrivo": tratteggiato se provvisorio (stima,
    // nessun orario certo), pieno se confermato (orario di rilascio
    // impostato) — promemoria per preparare il tavolo al cambio, sommato
    // all'anello arrivato invece di sostituirlo (un tavolo può avere entrambi).
    if (t.secondTurn) {
      const ringPad = (t.booking && t.booking.arrivedAt) ? 11 : 5;
      const ring = this._buildStatusRing(NS, t, shape, rotation, size, ringPad,
        t.secondTurn.confirmed ? 'piantina-secondturn-ring' : 'piantina-secondturn-ring provisional');
      ring.setAttribute('title', '🔄 Secondo turno' + (t.secondTurn.confirmed ? '' : ' (provvisorio)') + ': ' + this.escapeHTML(t.secondTurn.name) + ' alle ' + t.secondTurn.time);
      g.appendChild(ring);
    }

    shapeEl.classList.add('piantina-table-shape');
    shapeEl.setAttribute('fill', `var(${colorVar})`);
    shapeEl.setAttribute('stroke', `var(${colorVar})`);
    g.appendChild(shapeEl);

    // Vignetta cane: piccolo badge nell'angolo, solo se serve — non entra
    // nel testo per non affollare il tavolo (deve restare leggibile)
    if (t.booking && t.booking.dogs > 0) {
      const halfW = shape === Piantina.SHAPES.RECT ? size * 0.8 : size / 2;
      const halfH = size / 2;
      const badge = document.createElementNS(NS, 'text');
      badge.classList.add('piantina-dog-badge');
      badge.setAttribute('x', t.pos.x + halfW - 4);
      badge.setAttribute('y', t.pos.y - halfH + 4);
      badge.textContent = '🐾';
      g.appendChild(badge);
    }

    // Lucchetto: tavolo da non cambiare al cliente — angolo opposto al
    // cane, così possono convivere sullo stesso tavolo senza sovrapporsi.
    if (t.booking && Bookings.isFixedTable(t.booking)) {
      const halfW2 = shape === Piantina.SHAPES.RECT ? size * 0.8 : size / 2;
      const halfH2 = size / 2;
      const lockBadge = document.createElementNS(NS, 'text');
      lockBadge.classList.add('piantina-lock-badge');
      lockBadge.setAttribute('x', t.pos.x - halfW2 + 4);
      lockBadge.setAttribute('y', t.pos.y - halfH2 + 4);
      lockBadge.textContent = '🔒';
      const titleEl = document.createElementNS(NS, 'title');
      titleEl.textContent = 'Non spostare questo tavolo al cliente';
      lockBadge.appendChild(titleEl);
      g.appendChild(lockBadge);
    }

    // Hotel/mezza pensione e menu operai: stesso principio dei due badge
    // sopra, negli altri due angoli liberi (in basso) — così i quattro
    // possono convivere sullo stesso tavolo senza mai sovrapporsi.
    if (t.booking) {
      const hotelInfo = Bookings.getHotelInfo(t.booking);
      if (hotelInfo) {
        // Mezza pensione ha il cerchio grande e blu di sempre — è
        // un'informazione che conta per la cucina (piatti da non
        // ripetere). Alla carta mangia come qualunque altro cliente, non
        // ha senso lo stesso peso visivo: cerchio più piccolo, grigio
        // neutro, non blu — a colpo d'occhio si riconosce la differenza
        // senza dover leggere la scritta.
        const isMezzaPensione = hotelInfo.mealPlan === 'mezza_pensione';
        const halfW3 = shape === Piantina.SHAPES.RECT ? size * 0.8 : size / 2;
        const halfH3 = size / 2;
        const hotelRadius = isMezzaPensione ? 38 : 24;
        const bx = t.pos.x - halfW3 + hotelRadius;
        const by = t.pos.y + halfH3 - hotelRadius;
        const hotelBadge = document.createElementNS(NS, 'g');
        hotelBadge.classList.add('piantina-hotel-badge');
        if (!isMezzaPensione) hotelBadge.classList.add('piantina-hotel-badge-carta');
        const hotelCircle = document.createElementNS(NS, 'circle');
        hotelCircle.setAttribute('cx', bx);
        hotelCircle.setAttribute('cy', by);
        hotelCircle.setAttribute('r', hotelRadius);
        hotelBadge.appendChild(hotelCircle);
        const hotelLetter = document.createElementNS(NS, 'text');
        hotelLetter.classList.add('piantina-hotel-badge-letter');
        if (!isMezzaPensione) hotelLetter.classList.add('piantina-hotel-badge-letter-carta');
        hotelLetter.setAttribute('x', bx);
        hotelLetter.setAttribute('y', by);
        hotelLetter.textContent = 'H';
        hotelBadge.appendChild(hotelLetter);
        const hotelTitle = document.createElementNS(NS, 'title');
        hotelTitle.textContent = 'Camera ' + (hotelInfo.roomNumber || '?') + ' — ' +
          (isMezzaPensione ? 'Mezza pensione' : 'Alla carta');
        hotelBadge.appendChild(hotelTitle);
        g.appendChild(hotelBadge);
      }
      if (Bookings.isWorkerMenu(t.booking)) {
        const halfW4 = shape === Piantina.SHAPES.RECT ? size * 0.8 : size / 2;
        const halfH4 = size / 2;
        const workerBadge = document.createElementNS(NS, 'text');
        workerBadge.classList.add('piantina-worker-menu-badge');
        workerBadge.setAttribute('x', t.pos.x + halfW4 - 4);
        workerBadge.setAttribute('y', t.pos.y + halfH4 - 4);
        workerBadge.textContent = '👷';
        const workerTitle = document.createElementNS(NS, 'title');
        workerTitle.textContent = 'Menu operaio';
        workerBadge.appendChild(workerTitle);
        g.appendChild(workerBadge);
      }
    }

    const text = this._buildTableLabel(NS, t, editable, dateISO, serviceKey);
    g.appendChild(text);

    return g;
  },

  /**
   * Etichetta del tavolo: solo il nome/numero se libero o bloccato;
   * nome/numero + nome prenotazione + orario se occupato (prenotazione o
   * walk-in). Il testo è troncato in base alla forma per non uscire dal
   * tavolo (l'SVG non va a capo da solo).
   */
  _buildTableLabel(NS, t, editable, dateISO, serviceKey) {
    const shape = t.pos.shape || Piantina.DEFAULT_SHAPE;
    const text = document.createElementNS(NS, 'text');
    text.classList.add('piantina-table-label');
    text.setAttribute('x', t.pos.x);

    const tableLabel = Piantina.truncateForShape(t.table, shape);

    if (!t.booking) {
      // Capienza speciale per questo giorno/servizio, solo sui tavoli
      // liberi — un numero grande sovraimpresso, ben visibile, ma solo se
      // è stata davvero impostata (mai un default legato alle sedie).
      const cap = (!editable && dateISO && serviceKey) ? SharedTables.getTableCapacityOverride(dateISO, serviceKey, t.table) : null;
      if (cap) {
        text.classList.add('piantina-table-label-multiline');
        text.setAttribute('y', t.pos.y - 10);
        const capText = 'Fino a ' + cap.max;
        const lines = [
          { text: tableLabel, size: 18, dy: 0 },
          { text: capText, size: 14, dy: 18 },
        ];
        lines.forEach(line => {
          const tspan = document.createElementNS(NS, 'tspan');
          tspan.setAttribute('x', t.pos.x);
          tspan.setAttribute('dy', line.dy);
          tspan.setAttribute('font-size', line.size);
          tspan.classList.add('piantina-capacity-label');
          tspan.textContent = line.text;
          text.appendChild(tspan);
        });
        return text;
      }
      // Solo il numero/nome del tavolo, centrato (dominant-baseline: central via CSS)
      text.setAttribute('y', t.pos.y);
      text.textContent = tableLabel;
      return text;
    }

    // Occupato: 3 righe — tavolo, nome prenotazione, orario + coperti
    text.classList.add('piantina-table-label-multiline');
    text.setAttribute('y', t.pos.y - 19);
    const covers = '×' + (t.booking.people || 0) +
      (t.booking.highchairs > 0 ? '+' + t.booking.highchairs + 'segg' : '');
    const lines = [
      { text: tableLabel, size: 20, dy: 0 },
      { text: Piantina.truncateForShape(t.booking.name || '—', shape), size: 18, dy: 20 },
      { text: (t.booking.time || '') + ' ' + covers, size: 15, dy: 19 },
    ];
    lines.forEach(line => {
      const tspan = document.createElementNS(NS, 'tspan');
      tspan.setAttribute('x', t.pos.x);
      tspan.setAttribute('dy', line.dy);
      tspan.setAttribute('font-size', line.size);
      tspan.textContent = line.text;
      text.appendChild(tspan);
    });
    return text;
  },

  /**
   * Gestisce interazione su un tavolo della piantina:
   * - tap fermo (spostamento minimo) → in modalità editable apre l'editor
   *   forma/rotazione, altrimenti il dettaglio del tavolo
   * - drag in modalità editable → riposiziona il tavolo nella piantina, snap libero
   * - in modalità "sposta prenotazione" attiva (vedi startTableMove), il tap
   *   su un tavolo libero completa lo spostamento — niente trascinamento,
   *   troppo impreciso su touch.
   */
  _bindPiantinaTap(g, svg, zone, table, status, booking, pos, editable, containerId, dateISO, serviceKey) {
    let dragging = false;
    let moved = false;
    let offset = { x: 0, y: 0 };
    let startPoint = null;
    const DRAG_THRESHOLD = 6; // px in coordinate viewBox, sotto soglia = tap

    const svgPoint = (evt) => {
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const scaleX = viewBox.width / rect.width;
      const scaleY = viewBox.height / rect.height;
      // viewBox.x/y non sono più sempre 0 (il contenitore ora può partire
      // da un punto diverso da zero) — vanno sommati, altrimenti il tavolo
      // trascinato finirebbe nel posto sbagliato.
      return {
        x: viewBox.x + (evt.clientX - rect.left) * scaleX,
        y: viewBox.y + (evt.clientY - rect.top) * scaleY,
      };
    };

    // Centro corrente della forma, indipendentemente dal tipo (rect o circle)
    const getCenter = () => {
      const shapeEl = g.querySelector('.piantina-table-shape');
      if (shapeEl.tagName === 'circle') {
        return { x: Number(shapeEl.getAttribute('cx')), y: Number(shapeEl.getAttribute('cy')) };
      }
      return {
        x: Number(shapeEl.getAttribute('x')) + Number(shapeEl.getAttribute('width')) / 2,
        y: Number(shapeEl.getAttribute('y')) + Number(shapeEl.getAttribute('height')) / 2,
      };
    };

    // Sposta la forma corrente al nuovo centro (mantiene dimensioni e rotazione)
    const setCenter = (cx, cy) => {
      const shapeEl = g.querySelector('.piantina-table-shape');
      if (shapeEl.tagName === 'circle') {
        shapeEl.setAttribute('cx', cx);
        shapeEl.setAttribute('cy', cy);
      } else {
        const w = Number(shapeEl.getAttribute('width'));
        const h = Number(shapeEl.getAttribute('height'));
        shapeEl.setAttribute('x', cx - w / 2);
        shapeEl.setAttribute('y', cy - h / 2);
        const rotation = pos.rotation || 0;
        if (rotation) shapeEl.setAttribute('transform', `rotate(${rotation} ${cx} ${cy})`);
      }
      const textEl = g.querySelector('text');
      const isMultiline = textEl.classList.contains('piantina-table-label-multiline');
      textEl.setAttribute('x', cx);
      textEl.setAttribute('y', isMultiline ? cy - 19 : cy);
      textEl.querySelectorAll('tspan').forEach(tp => tp.setAttribute('x', cx));
    };

    const onPointerDown = (evt) => {
      dragging = true;
      moved = false;
      startPoint = svgPoint(evt);
      const c = getCenter();
      offset = { x: startPoint.x - c.x, y: startPoint.y - c.y };
      g.setPointerCapture(evt.pointerId);
      // Segnala che il dito è sul tavolo, così l'aggiornamento automatico
      // in background non ricostruisce la piantina proprio ora (vedi
      // autoRefreshMain in app.js). Si azzera da solo dopo 5 secondi anche
      // se per qualche motivo pointerup/pointercancel non arrivasse mai,
      // così non resta bloccato per sempre.
      this.state.piantinaPointerActive = true;
      clearTimeout(this._piantinaPointerSafety);
      this._piantinaPointerSafety = setTimeout(() => { this.state.piantinaPointerActive = false; }, 5000);
    };

    const onPointerMove = (evt) => {
      if (!dragging) return;
      const p = svgPoint(evt);
      const dist = Math.hypot(p.x - startPoint.x, p.y - startPoint.y);
      if (dist > DRAG_THRESHOLD) moved = true;

      if (editable && moved) {
        g.classList.add('dragging');
        setCenter(p.x - offset.x, p.y - offset.y);
      }
    };

    const onPointerUp = async (evt) => {
      if (!dragging) return;
      dragging = false;
      this.state.piantinaPointerActive = false;

      if (editable && moved) {
        g.classList.remove('dragging');
        // Nessuno snap: posizione libera, arrotondata solo al pixel intero
        const c = getCenter();
        const finalX = Math.round(c.x);
        const finalY = Math.round(c.y);
        setCenter(finalX, finalY);
        await SharedTables.setPosition(zone, table, { x: finalX, y: finalY });
      } else if (!moved) {
        if (editable) {
          UI.openTableStyleModal(zone, table, pos, containerId, dateISO, serviceKey);
        } else {
          await UI.handleLiveTableTap(table, zone, status, booking, dateISO, serviceKey, containerId);
        }
      }
    };

    g.addEventListener('pointerdown', onPointerDown);
    g.addEventListener('pointermove', onPointerMove);
    g.addEventListener('pointerup', onPointerUp);
    g.addEventListener('pointercancel', () => { dragging = false; this.state.piantinaPointerActive = false; g.classList.remove('dragging'); });
  },

  /**
   * Editor forma/rotazione di un tavolo (nell'editor piantina delle
   * Impostazioni). Applica subito la modifica e ridisegna.
   */
  openTableStyleModal(zone, table, pos, containerId, dateISO, serviceKey) {
    let modal = document.getElementById('tableStyleModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tableStyleModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const shape = pos.shape || Piantina.DEFAULT_SHAPE;
    const rotation = pos.rotation || 0;

    const shapeButtons = Object.values(Piantina.SHAPES).map(s =>
      '<button type="button" class="piantina-style-btn' + (s === shape ? ' active' : '') + '" data-shape="' + s + '">' +
        Piantina.SHAPE_LABELS[s] +
      '</button>'
    ).join('');

    const rotationButtons = Object.values(Piantina.ROTATIONS).map(r =>
      '<button type="button" class="piantina-style-btn' + (r === rotation ? ' active' : '') + '" data-rotation="' + r + '">' +
        Piantina.ROTATION_LABELS[r] +
      '</button>'
    ).join('');

    const currentCapacity = SharedTables.getCapacity(zone, table);

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>Tavolo ' + this.escapeHTML(table) + ' · ' + this.escapeHTML(zone) + '</h3>' +
        '<div class="field-group"><label class="field-label">Forma</label>' +
          '<div class="piantina-style-group" id="tableStyleShapeGroup">' + shapeButtons + '</div></div>' +
        '<div class="field-group" style="margin-top:12px"><label class="field-label">Orientamento</label>' +
          '<div class="piantina-style-group" id="tableStyleRotationGroup">' + rotationButtons + '</div></div>' +
        '<div class="field-group" style="margin-top:12px"><label class="field-label">Capienza (persone, da solo)</label>' +
          '<input type="number" min="1" class="config-number-input" id="tableStyleCapacity" placeholder="Non impostata" value="' + (currentCapacity || '') + '">' +
          '<p style="font-size:11px;color:var(--color-ink-soft);margin-top:6px">Se una prenotazione supera questo numero, il form suggerisce di unire un altro tavolo.</p></div>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="tableStyleClose">Chiudi</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');

    const apply = async (patch) => {
      // Include sempre x/y (già risolti con i default in buildLayoutData)
      // così la posizione salvata resta completa anche al primo cambio
      // di forma/orientamento, prima di un eventuale trascinamento.
      await SharedTables.setPosition(zone, table, { x: pos.x, y: pos.y, ...patch });
      this.renderPiantina(containerId, dateISO, serviceKey, true);
      // Riapri il modal aggiornato per continuare a modificare lo stesso tavolo
      const updatedPos = SharedTables.getPosition(zone, table) || pos;
      this.openTableStyleModal(zone, table, { ...pos, ...updatedPos, ...patch }, containerId, dateISO, serviceKey);
    };

    modal.querySelectorAll('#tableStyleShapeGroup .piantina-style-btn').forEach(btn => {
      btn.addEventListener('click', () => apply({ shape: btn.dataset.shape }));
    });
    modal.querySelectorAll('#tableStyleRotationGroup .piantina-style-btn').forEach(btn => {
      btn.addEventListener('click', () => apply({ rotation: Number(btn.dataset.rotation) }));
    });
    modal.querySelector('#tableStyleClose').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#tableStyleCapacity').addEventListener('change', async (e) => {
      await SharedTables.setCapacity(zone, table, Number(e.target.value) || null);
      this.toast('Capienza tavolo ' + table + ' aggiornata ✓');
    });
  },

  /**
   * Tap su un tavolo nella piantina "viva" (Lista): se è attiva una
   * "modalità sposta" (vedi startTableMove), il tap su un tavolo libero
   * completa lo spostamento; altrimenti apre il dettaglio come sempre.
   */
  async handleLiveTableTap(table, zone, status, booking, dateISO, serviceKey, containerId) {
    const move = this.state.piantinaMoveSource;
    // Uno spostamento lasciato a metà per più di 5 minuti (nessuno l'ha né
    // completato né annullato — probabilmente ci si è distratti) scade da
    // solo, invece di continuare a dirottare ogni tocco sui tavoli verso
    // quello spostamento vecchio, dimenticato, invece del normale menu.
    if (move && move.startedAt && Date.now() - move.startedAt > 5 * 60 * 1000) {
      this.state.piantinaMoveSource = null;
      this.toast('Spostamento tavolo annullato (troppo tempo senza conferma)', 'warning');
      this.openTableDetailModal(table, zone, status, booking, dateISO, serviceKey, containerId);
      return;
    }
    if (move) {
      const isMultiMove = move.sourceTables.length > 1;

      if (move.sourceTables.includes(table) && move.zone === zone) {
        this.cancelTableMove(containerId, dateISO, serviceKey);
        return;
      }
      if (SharedTables.isBlocked(table, dateISO, serviceKey)) {
        this.toast('Tavolo ' + table + ' non disponibile', 'warning');
        return;
      }

      if (!isMultiMove) {
        // Un solo tavolo di origine: comportamento invariato, un tocco e fatto
        // (o proposta di scambio se il tavolo scelto è occupato, anche con
        // un gruppo di più tavoli — lo scambio è sempre tra insiemi interi).
        if (booking) {
          const targetTables = booking.tablesAssigned ? booking.tablesAssigned.split(',').map(x => x.trim()).filter(Boolean) : [table];
          const confirmMsg = 'Scambiare i tavoli? ' + move.name + ' (tavolo ' + move.sourceTables.join('+') + ') passa a ' +
            targetTables.join('+') + ', ' + booking.name + ' passa a ' + move.sourceTables.join('+') + '.';
          if (confirm(confirmMsg)) {
            await this.completeTableSwap(booking, containerId, dateISO, serviceKey);
          }
          return;
        }
        await this.completeTableMove(table, zone, containerId, dateISO, serviceKey);
        return;
      }

      // Più tavoli di origine (uniti): un tavolo libero si accumula come
      // destinazione; un tavolo occupato propone subito lo scambio
      // dell'INTERO gruppo di partenza con l'INTERO gruppo dell'altra
      // prenotazione (uno o più tavoli che siano) — uno scambio vero, non
      // un mix ambiguo tavolo per tavolo.
      if (booking) {
        const targetTables = booking.tablesAssigned ? booking.tablesAssigned.split(',').map(x => x.trim()).filter(Boolean) : [table];
        const confirmMsg = 'Scambiare i tavoli? ' + move.name + ' (tavoli ' + move.sourceTables.join('+') + ') passa a ' +
          targetTables.join('+') + ', ' + booking.name + ' passa a ' + move.sourceTables.join('+') + '.';
        if (confirm(confirmMsg)) {
          await this.completeTableSwap(booking, containerId, dateISO, serviceKey);
        }
        return;
      }
      const idx = move.destination.findIndex(d => d.table === table && d.zone === zone);
      if (idx !== -1) move.destination.splice(idx, 1);
      else move.destination.push({ table, zone });
      this.renderPiantina(containerId, dateISO, serviceKey, false);
      return;
    }
    this.openTableDetailModal(table, zone, status, booking, dateISO, serviceKey, containerId);
  },

  /**
   * Scambia gli interi gruppi di tavoli tra la prenotazione in movimento e
   * quella toccata — funziona sia con un tavolo solo che con più tavoli
   * uniti su entrambi i lati, sempre uno scambio completo dei due insiemi.
   */
  async completeTableSwap(targetBooking, containerId, dateISO, serviceKey) {
    const move = this.state.piantinaMoveSource;
    if (!move) return;
    // La prenotazione di ORIGINE è già stata controllata all'avvio dello
    // spostamento (startTableMove) — qui manca solo quella di
    // DESTINAZIONE, che con uno scambio subisce anche lei un cambio tavolo.
    if (!this._confirmIfFixedTable(targetBooking)) return;
    this.state.piantinaMoveSource = null;

    const sourceBookingFresh = Bookings.getById(move.bookingId);
    const targetBookingFresh = Bookings.getById(targetBooking.id);
    const sourceTables = (sourceBookingFresh && sourceBookingFresh.tablesAssigned)
      ? sourceBookingFresh.tablesAssigned.split(',').map(x => x.trim()).filter(Boolean) : move.sourceTables;
    const targetTables = (targetBookingFresh && targetBookingFresh.tablesAssigned)
      ? targetBookingFresh.tablesAssigned.split(',').map(x => x.trim()).filter(Boolean) : [];

    const who = DB.getOperatorWithDevice() || 'sconosciuto';
    const when = new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const traceSource = 'Scambiato tavoli ' + sourceTables.join('+') + ' ↔ ' + targetTables.join('+') + ' (' + who + ', ' + when + ')';
    const traceTarget = 'Scambiato tavoli ' + targetTables.join('+') + ' ↔ ' + sourceTables.join('+') + ' (' + who + ', ' + when + ')';

    this.showSyncIndicator(true);
    // Chi era legato a chi (doppio turno) va calcolato sui tavoli di PRIMA,
    // non dopo — altrimenti lo scambio appena fatto confonderebbe la
    // ricerca (un tavolo "vecchio" di uno potrebbe combaciare per
    // coincidenza con quello "nuovo" dell'altro).
    await Bookings.dragPairedBookingAlong(move.bookingId, sourceTables.join(','), targetTables.join(','), dateISO, serviceKey);
    await Bookings.dragPairedBookingAlong(targetBooking.id, targetTables.join(','), sourceTables.join(','), dateISO, serviceKey);
    await Bookings.assignTables(move.bookingId, targetTables.join(', '), traceSource);
    await Bookings.assignTables(targetBooking.id, sourceTables.join(', '), traceTarget);
    this.showSyncIndicator(false);
    this.toast('Tavoli scambiati ✓');
    if (this.state.currentScreen === 'list') this.renderList();
    else this.renderPiantina(containerId, dateISO, serviceKey, false);
  },

  /**
   * Avvia lo spostamento di una prenotazione: da qui in poi, il prossimo
   * tocco su un tavolo libero della piantina la sposta lì. Niente
   * trascinamento — troppo impreciso su schermi touch piccoli.
   * Se la prenotazione occupa più tavoli uniti, li sposta tutti insieme:
   * si accumulano i tavoli di destinazione toccandoli uno a uno, poi si
   * conferma — così si può spostare un gruppo su un altro gruppo di tavoli.
   * Su dispositivo etichettato (tablet condiviso), chiede prima "chi sei",
   * così si sa chi ha fatto la modifica e quando.
   */
  startTableMove(booking, table, zone, containerId, dateISO, serviceKey) {
    if (!this._confirmIfFixedTable(booking)) return;
    if (DB.getDeviceLabel()) {
      this.openOperatorPicker(false, {
        title: 'Chi sposta questo tavolo?',
        subtitle: 'Da ' + DB.getDeviceLabel() + '.',
        onConfirm: () => this._startTableMoveNow(booking, table, zone, containerId, dateISO, serviceKey),
      });
      return;
    }
    this._startTableMoveNow(booking, table, zone, containerId, dateISO, serviceKey);
  },

  _startTableMoveNow(booking, table, zone, containerId, dateISO, serviceKey) {
    const sourceTables = booking.tablesAssigned
      ? booking.tablesAssigned.split(',').map(x => x.trim()).filter(Boolean)
      : [table];
    // startedAt: se questo spostamento resta "appeso" senza essere né
    // completato né annullato (es. ci si distrae e il tablet resta lì),
    // scade da solo dopo qualche minuto invece di dirottare per sempre
    // ogni tocco successivo sui tavoli verso lo spostamento vecchio.
    this.state.piantinaMoveSource = { bookingId: booking.id, sourceTables, zone, name: booking.name, destination: [], startedAt: Date.now() };
    this.renderPiantina(containerId, dateISO, serviceKey, false);
    if (sourceTables.length > 1) {
      this.toast('Tocca i tavoli di destinazione per ' + booking.name + ', poi conferma');
    } else {
      this.toast('Tocca un tavolo libero per spostare ' + booking.name);
    }
  },

  cancelTableMove(containerId, dateISO, serviceKey) {
    this.state.piantinaMoveSource = null;
    this.renderPiantina(containerId, dateISO, serviceKey, false);
  },

  async completeTableMove(targetTable, targetZone, containerId, dateISO, serviceKey) {
    const move = this.state.piantinaMoveSource;
    if (!move) return;
    this.state.piantinaMoveSource = null;
    const sourceTable = move.sourceTables[0];
    // Rilegge la prenotazione fresca: se unisce più tavoli, sostituisce solo
    // quello che si sta spostando, gli altri restano invariati.
    const currentBooking = Bookings.getById(move.bookingId);
    const currentTables = (currentBooking && currentBooking.tablesAssigned)
      ? currentBooking.tablesAssigned.split(',').map(x => x.trim()).filter(Boolean)
      : [sourceTable];
    const newTables = currentTables.map(x => x === sourceTable ? targetTable : x);
    const trace = 'Tavolo ' + sourceTable + ' → ' + targetTable + ' (' + (DB.getOperatorWithDevice() || 'sconosciuto') +
      ', ' + new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ')';

    this.showSyncIndicator(true);
    await Bookings.assignTables(move.bookingId, newTables.join(', '), trace);
    // Se qualcuno aspettava di ereditare IL tavolo di questa prenotazione
    // (doppio turno), lo segue sul tavolo nuovo — altrimenti resta ad
    // aspettare sul tavolo vecchio, dove non arriva più nessuno.
    await Bookings.dragPairedBookingAlong(move.bookingId, currentTables.join(','), newTables.join(','), dateISO, serviceKey);
    this.showSyncIndicator(false);
    this.toast('Tavolo ' + sourceTable + ' → ' + targetTable + ' ✓');
    if (this.state.currentScreen === 'list') this.renderList();
    else this.renderPiantina(containerId, dateISO, serviceKey, false);
  },

  /**
   * Completa lo spostamento di un gruppo di tavoli uniti sulla destinazione
   * accumulata (uno o più tavoli toccati finora) — sostituisce del tutto
   * l'elenco tavoli della prenotazione con quello nuovo.
   */
  async completeMultiTableMove(containerId, dateISO, serviceKey) {
    const move = this.state.piantinaMoveSource;
    if (!move || move.destination.length === 0) return;
    this.state.piantinaMoveSource = null;

    const newTables = move.destination.map(d => d.table);
    const who = DB.getOperatorWithDevice() || 'sconosciuto';
    const when = new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const trace = 'Tavoli ' + move.sourceTables.join('+') + ' → ' + newTables.join('+') + ' (' + who + ', ' + when + ')';

    this.showSyncIndicator(true);
    await Bookings.assignTables(move.bookingId, newTables.join(', '), trace);
    await Bookings.dragPairedBookingAlong(move.bookingId, move.sourceTables.join(','), newTables.join(','), dateISO, serviceKey);
    this.showSyncIndicator(false);
    this.toast('Tavoli ' + move.sourceTables.join('+') + ' → ' + newTables.join('+') + ' ✓');
    if (this.state.currentScreen === 'list') this.renderList();
    else this.renderPiantina(containerId, dateISO, serviceKey, false);
  },

  openTableDetailModal(table, zone, status, booking, dateISO, serviceKey, containerId) {
    let modal = document.getElementById('tableDetailModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tableDetailModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const statusLabel = Piantina.STATUS_LABELS[status];
    const colorVar = Piantina.STATUS_COLOR_VAR[status];
    const canWalkIn = !booking && status === Piantina.STATUS.FREE && DB.canEdit();
    const joinGroupForButtons = canWalkIn ? SharedTables.getTableJoinGroupFor(dateISO, serviceKey, table) : null;
    const canMove = !!booking && DB.canEdit();
    const canFree = !!booking && DB.canEdit() && booking.status !== STATUS.CANCELLED && booking.status !== STATUS.NOSHOW && booking.status !== STATUS.COMPLETED;

    let bodyHTML = '';
    if (booking) {
      const tags = [];
      if (booking.dogs > 0) tags.push('<span class="tag">🐾 ' + booking.dogs + '</span>');
      if (booking.highchairs > 0) tags.push('<span class="tag">' + booking.highchairs + ' segg.</span>');
      if (booking.intolerances) tags.push('<span class="tag tag-warning">⚠️ ' + this.escapeHTML(booking.intolerances) + '</span>');
      if (Bookings.isFixedTable(booking)) tags.push('<span class="tag tag-fixed-table">🔒 Non spostare</span>');
      const { userNotes, payment } = Bookings.splitNotes(booking.notes);
      if (payment) tags.push('<span class="tag tag-success">💶 ' + payment.amount.toFixed(2) + '€ ' + this.escapeHTML(payment.method) + '</span>');
      bodyHTML =
        '<p style="font-size:16px;font-weight:700;margin-bottom:4px">' + this.escapeHTML(booking.name || 'Senza nome') + '</p>' +
        '<p style="font-size:13px;color:var(--color-ink-soft);margin-bottom:10px">' +
          booking.time + ' · ' + booking.people + ' persone' +
        '</p>' +
        (booking.phone ? '<p style="font-size:13px;margin-bottom:10px"><a href="' + Utils.telLink(booking.phone) + '" style="color:var(--color-primary);font-weight:600">📞 ' + this.escapeHTML(booking.phone) + '</a></p>' : '') +
        this.dietaryAlertHTML(booking) +
        (tags.length ? '<div class="booking-tags" style="margin-bottom:10px">' + tags.join('') + '</div>' : '') +
        // Le tracce di sistema (spostamenti tavolo, ecc.) restano salvate
        // nei dati per chi ne avesse mai bisogno, ma non si mostrano più
        // da nessuna parte — nemmeno dietro la tendina "Modifiche".
        (userNotes ? '<p style="font-size:13px;color:var(--color-ink-soft)">📝 ' + this.escapeHTML(userNotes) + '</p>' : '');
    } else {
      // Sui tavoli liberi si può impostare una capienza speciale solo per
      // questo giorno/servizio — es. un tavolo che di norma ne terrebbe 4
      // ma oggi va tenuto più piccolo. Nessuna dicitura se non è mai stata
      // impostata: non è un default automatico legato al numero di sedie.
      const existingCap = SharedTables.getTableCapacityOverride(dateISO, serviceKey, table);
      // Tavoli fisicamente accostati in sala in questo momento — diverso
      // dal tavolo unito di UNA prenotazione: qui è "questi tavoli sono
      // davvero un unico tavolo più grande adesso", a prescindere da chi
      // li prenota.
      const joinGroup = SharedTables.getTableJoinGroupFor(dateISO, serviceKey, table);
      bodyHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessuna prenotazione su questo tavolo.</p>' +
        (existingCap ? '<p style="font-size:13px;margin-top:8px">📏 Capienza per questo servizio: <strong>fino a ' + existingCap.max + '</strong>' + (existingCap.min ? ' (da ' + existingCap.min + ')' : '') + '</p>' : '') +
        (joinGroup ? '<p style="font-size:13px;margin-top:8px">🔗 Unito fisicamente a: <strong>' + this.escapeHTML(joinGroup.filter(t => t !== table).join(', ')) + '</strong></p>' : '');
    }

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
          '<span style="width:12px;height:12px;border-radius:50%;background:var(' + colorVar + ');flex-shrink:0"></span>' +
          '<h3 style="margin:0">Tavolo ' + this.escapeHTML(table) + ' · ' + zone + '</h3>' +
        '</div>' +
        '<p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(' + colorVar + ');margin-bottom:12px">' + statusLabel + '</p>' +
        bodyHTML +
        '<div class="modal-actions table-detail-actions">' +
          (booking && DB.canEdit() ? '<button class="modal-btn-confirm" id="tableDetailOpenBooking" style="background:var(--color-primary)">Apri prenotazione</button>' : '') +
          (booking && DB.canEdit() ? '<button class="modal-btn-confirm" id="tableDetailDoubleShift" style="background:var(--color-info)">⏱️ ' + (booking.doubleShiftRelease ? 'Libera alle ' + booking.doubleShiftRelease : 'Doppio turno') + '</button>' : '') +
          (booking && DB.canEdit() ? '<button class="modal-btn-confirm" id="tableDetailPayment" style="background:var(--color-warning)">💶 ' + (booking && Bookings.splitNotes(booking.notes).payment ? 'Modifica pagamento' : 'Registra pagamento') + '</button>' : '') +
          (canFree ? '<button class="modal-btn-confirm" id="tableDetailFree" style="background:var(--color-success)">🏁 Tavolo libero</button>' : '') +
          (canMove ? '<button class="modal-btn-confirm" id="tableDetailMove" style="background:var(--color-info)">🔄 Sposta tavolo</button>' : '') +
          (canWalkIn ? '<button class="modal-btn-confirm" id="tableDetailWalkIn" style="background:var(--color-success)">🚶 Occupa (walk-in)</button>' : '') +
          (canWalkIn ? '<button class="modal-btn-confirm" id="tableDetailCapacity" style="background:var(--color-info)">📏 Imposta capienza</button>' : '') +
          (canWalkIn && !joinGroupForButtons ? '<button class="modal-btn-confirm" id="tableDetailJoin" style="background:var(--color-info)">🔗 Unisci ad un altro tavolo</button>' : '') +
          (canWalkIn && joinGroupForButtons ? '<button class="modal-btn-confirm" id="tableDetailUnjoin" style="background:var(--color-warning)">✂️ Separa dal tavolo unito</button>' : '') +
          '<button class="modal-btn-cancel" id="tableDetailClose">Chiudi</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');
    // Tutti i pulsanti qui sotto usano "pointerdown" e ARMANO il blocco
    // centralizzato dei click residui (UI._suppressClickUntil, vedi
    // bindGlobalDelegation in app.js) — il tentativo precedente con solo
    // preventDefault() non bastava a impedire in modo affidabile il click
    // residuo del gesto che ha toccato il tavolo, che a volte atterrava su
    // quello che c'è sotto una volta chiusa la modal (un tab in basso, una
    // card della lista...). Ora quel click viene bloccato esplicitamente,
    // ovunque atterri, per una finestra breve dopo la chiusura.
    const closeAndSuppress = () => { UI._suppressClickUntil = Date.now() + 400; modal.classList.remove('active'); };
    modal.querySelector('#tableDetailClose').addEventListener('pointerdown', (evt) => { evt.preventDefault(); closeAndSuppress(); });
    const openBtn = modal.querySelector('#tableDetailOpenBooking');
    if (openBtn && booking) {
      openBtn.addEventListener('pointerdown', (evt) => {
        evt.preventDefault();
        closeAndSuppress();
        this.openEditForm(booking.id);
      });
    }
    const doubleShiftBtn = modal.querySelector('#tableDetailDoubleShift');
    if (doubleShiftBtn && booking) {
      doubleShiftBtn.addEventListener('pointerdown', (evt) => {
        evt.preventDefault();
        closeAndSuppress();
        this.openDoubleShiftQuickModal(booking, table, containerId, dateISO, serviceKey);
      });
    }
    const paymentBtn = modal.querySelector('#tableDetailPayment');
    if (paymentBtn && booking) {
      paymentBtn.addEventListener('pointerdown', (evt) => {
        evt.preventDefault();
        closeAndSuppress();
        this.openPaymentModal(booking);
      });
    }
    const freeBtn = modal.querySelector('#tableDetailFree');
    if (freeBtn && canFree) {
      freeBtn.addEventListener('pointerdown', async (evt) => {
        evt.preventDefault();
        closeAndSuppress();
        this.showSyncIndicator(true);
        await Bookings.markCompleted(booking.id, true);
        this.showSyncIndicator(false);
        this.toast('Terminata — tavolo ' + table + ' libero 🏁');
        if (this.state.currentScreen === 'list') this.renderList();
        else this.renderPiantina(containerId, dateISO, serviceKey, false);
      });
    }
    const moveBtn = modal.querySelector('#tableDetailMove');
    if (moveBtn && canMove) {
      moveBtn.addEventListener('pointerdown', (evt) => {
        evt.preventDefault();
        closeAndSuppress();
        this.startTableMove(booking, table, zone, containerId, dateISO, serviceKey);
      });
    }
    const walkInBtn = modal.querySelector('#tableDetailWalkIn');
    if (walkInBtn && canWalkIn) {
      walkInBtn.addEventListener('pointerdown', (evt) => {
        evt.preventDefault();
        closeAndSuppress();
        this.openWalkInModal(zone, table, dateISO, serviceKey);
      });
    }
    const capacityBtn = modal.querySelector('#tableDetailCapacity');
    if (capacityBtn && canWalkIn) {
      capacityBtn.addEventListener('pointerdown', (evt) => {
        evt.preventDefault();
        closeAndSuppress();
        this.openTableCapacityModal(table, dateISO, serviceKey, containerId);
      });
    }
    const joinBtn = modal.querySelector('#tableDetailJoin');
    if (joinBtn) {
      joinBtn.addEventListener('pointerdown', (evt) => {
        evt.preventDefault();
        closeAndSuppress();
        this.openTableJoinModal(table, zone, dateISO, serviceKey, containerId);
      });
    }
    const unjoinBtn = modal.querySelector('#tableDetailUnjoin');
    if (unjoinBtn) {
      unjoinBtn.addEventListener('pointerdown', async (evt) => {
        evt.preventDefault();
        closeAndSuppress();
        this.showSyncIndicator(true);
        await SharedTables.removeTableFromJoinGroup(dateISO, serviceKey, table);
        this.showSyncIndicator(false);
        this.toast('Tavolo ' + table + ' separato ✓');
        if (this.state.currentScreen === 'list') this.renderList();
        else this.renderPiantina(containerId, dateISO, serviceKey, false);
      });
    }
  },

  /**
   * Scorciatoia per impostare "Deve liberare il tavolo entro le" senza
   * aprire tutto il form di modifica — comodo quando ci si accorge del
   * doppio turno toccando il tavolo occupato direttamente in piantina.
   */
  /**
   * Inserimento rapido della capienza speciale di un tavolo libero, solo
   * per questo giorno/servizio — un tocco sul tavolo, un numero, salvato
   * subito. "Rimuovi" per tornare a "nessuna capienza impostata" (non un
   * default automatico, uno stato vero e proprio).
   */
  /**
   * Segna due (o più) tavoli come fisicamente accostati in sala per
   * questo giorno/servizio — mostra gli altri tavoli liberi della stessa
   * zona tra cui scegliere. Una volta uniti, prenotarne uno solo (senza
   * l'altro) avvisa prima di procedere, invece di venderli per sbaglio
   * come due tavoli separati.
   */
  openTableJoinModal(table, zone, dateISO, serviceKey, containerId) {
    let modal = document.getElementById('tableJoinModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tableJoinModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }
    const zt = SharedTables.getZoneTavoli();
    const zoneTables = zt[zone] || [];
    const occupiedNow = new Set();
    Bookings.getByDateAndService(dateISO, serviceKey)
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW)
      .forEach(b => { if (b.tablesAssigned) b.tablesAssigned.split(',').forEach(t => occupiedNow.add(t.trim())); });
    const candidates = zoneTables
      .filter(t => t !== table && !occupiedNow.has(t) && !SharedTables.isBlocked(t, dateISO, serviceKey) && !SharedTables.getTableJoinGroupFor(dateISO, serviceKey, t));

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>🔗 Unisci il tavolo ' + this.escapeHTML(table) + '</h3>' +
        '<p style="font-size:13px;color:var(--color-ink-soft);margin-bottom:12px">Scegli con quale altro tavolo libero è accostato adesso — solo per ' + this.dateLabel(dateISO) + ' · ' + (serviceKey === 'lunch' ? 'Pranzo' : 'Cena') + '.</p>' +
        (candidates.length === 0
          ? '<p style="font-size:13px;color:var(--color-ink-soft)">Nessun altro tavolo libero disponibile in questa zona in questo momento.</p>'
          : '<div class="form-table-grid">' +
              candidates.map(t => '<button type="button" class="form-table-pill" data-table="' + this.escapeHTML(t) + '">' + this.escapeHTML(t) + '</button>').join('') +
            '</div>') +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="tableJoinCancel">Annulla</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    modal.querySelector('#tableJoinCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelectorAll('.form-table-pill').forEach(pill => {
      pill.addEventListener('click', async () => {
        const other = pill.dataset.table;
        modal.classList.remove('active');
        this.showSyncIndicator(true);
        await SharedTables.setTableJoinGroup(dateISO, serviceKey, [table, other]);
        this.showSyncIndicator(false);
        this.toast('Tavoli ' + table + ' e ' + other + ' segnati come uniti ✓');
        if (this.state.currentScreen === 'list') this.renderList();
        else this.renderPiantina(containerId, dateISO, serviceKey, false);
      });
    });
  },

  openTableCapacityModal(table, dateISO, serviceKey, containerId) {
    let modal = document.getElementById('tableCapacityModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tableCapacityModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }
    const existing = SharedTables.getTableCapacityOverride(dateISO, serviceKey, table);
    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>📏 Capienza tavolo ' + this.escapeHTML(table) + '</h3>' +
        '<p style="font-size:12px;color:var(--color-ink-soft);margin-bottom:12px">Solo per ' + this.dateLabel(dateISO) + ' · ' + (serviceKey === 'lunch' ? 'Pranzo' : 'Cena') + ' — non cambia la capienza normale del tavolo.</p>' +
        '<div class="field-group"><label class="field-label">Fino a (persone)</label>' +
          '<input type="number" min="1" class="text-input" id="tableCapacityMax" value="' + (existing ? existing.max : '') + '" placeholder="es. 3"></div>' +
        '<div class="field-group" style="margin-top:12px"><label class="field-label">Da (opzionale, per un intervallo)</label>' +
          '<input type="number" min="1" class="text-input" id="tableCapacityMin" value="' + (existing && existing.min ? existing.min : '') + '" placeholder="es. 2"></div>' +
        (existing ? '<a href="#" class="delete-link" id="tableCapacityRemove">Rimuovi capienza impostata</a>' : '') +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="tableCapacityCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="tableCapacitySave" style="background:var(--color-primary)">Salva</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    modal.querySelector('#tableCapacityCancel').addEventListener('click', () => modal.classList.remove('active'));
    if (existing) {
      modal.querySelector('#tableCapacityRemove').addEventListener('click', async (e) => {
        e.preventDefault();
        modal.classList.remove('active');
        this.showSyncIndicator(true);
        await SharedTables.removeTableCapacityOverride(dateISO, serviceKey, table);
        this.showSyncIndicator(false);
        this.toast('Capienza rimossa ✓');
        if (this.state.currentScreen === 'list') this.renderList();
        else this.renderPiantina(containerId, dateISO, serviceKey, false);
      });
    }
    modal.querySelector('#tableCapacitySave').addEventListener('click', async () => {
      const max = Number(document.getElementById('tableCapacityMax').value);
      if (!max || max <= 0) { this.toast('Inserisci un numero valido', 'warning'); return; }
      const minRaw = document.getElementById('tableCapacityMin').value;
      const min = minRaw ? Number(minRaw) : null;
      modal.classList.remove('active');
      this.showSyncIndicator(true);
      await SharedTables.setTableCapacityOverride(dateISO, serviceKey, table, { max, min });
      this.showSyncIndicator(false);
      this.toast('Capienza salvata ✓');
      if (this.state.currentScreen === 'list') this.renderList();
      else this.renderPiantina(containerId, dateISO, serviceKey, false);
    });
  },

  openDoubleShiftQuickModal(booking, table, containerId, dateISO, serviceKey) {
    let modal = document.getElementById('doubleShiftQuickModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'doubleShiftQuickModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    modal.innerHTML =
      '<div class="modal-sheet capacity-confirm-sheet">' +
        '<div class="capacity-confirm-icon">⏱️</div>' +
        '<h3>Doppio turno · Tavolo ' + this.escapeHTML(table) + '</h3>' +
        '<p style="font-size:13px;color:var(--color-ink-soft)">A che ora ' + this.escapeHTML(booking.name || 'questa prenotazione') + ' libera il tavolo? Da quel momento (+15 min) il tavolo si potrà riassegnare senza avvisi di conflitto.</p>' +
        '<div class="field-group" style="width:100%">' +
          '<input type="time" class="text-input" id="doubleShiftQuickInput" value="' + (booking.doubleShiftRelease || '') + '" style="text-align:center;font-size:20px">' +
        '</div>' +
        '<div class="modal-actions" style="margin-top:8px;width:100%">' +
          (booking.doubleShiftRelease ? '<button class="modal-btn-cancel" id="doubleShiftQuickClear">Rimuovi</button>' : '<button class="modal-btn-cancel" id="doubleShiftQuickCancel">Annulla</button>') +
          '<button class="modal-btn-confirm" id="doubleShiftQuickSave" style="background:var(--color-primary)">Salva</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');
    modal.querySelector('#doubleShiftQuickInput').focus();

    const clearBtn = modal.querySelector('#doubleShiftQuickClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        modal.classList.remove('active');
        this.showSyncIndicator(true);
        await Bookings.setDoubleShiftRelease(booking.id, null);
        this.showSyncIndicator(false);
        this.toast('Doppio turno rimosso ✓');
        if (this.state.currentScreen === 'list') this.renderList();
        else this.renderPiantina(containerId, dateISO, serviceKey, false);
      });
    }
    const cancelBtn = modal.querySelector('#doubleShiftQuickCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.remove('active'));

    modal.querySelector('#doubleShiftQuickSave').addEventListener('click', async () => {
      const value = modal.querySelector('#doubleShiftQuickInput').value;
      if (!value) { this.toast('Scegli un orario', 'warning'); return; }
      modal.classList.remove('active');
      this.showSyncIndicator(true);
      await Bookings.setDoubleShiftRelease(booking.id, value);
      this.showSyncIndicator(false);
      this.toast('Tavolo libera alle ' + value + ' ✓');
      if (this.state.currentScreen === 'list') this.renderList();
      else this.renderPiantina(containerId, dateISO, serviceKey, false);
    });
  },

  /**
   * Modal rapida per occupare un tavolo con un cliente senza prenotazione
   * (walk-in): il tavolo è già scelto dalla piantina, chiede persone e
   * ora di arrivo. Crea una prenotazione marcata come walk-in (badge
   * giallo in piantina) con stato "Seduti".
   */
  /**
   * Controllo "ti sei sbagliato di giorno?" prima di azioni legate al
   * momento presente (walk-in, pagamento) — farle per un giorno diverso da
   * oggi è quasi sempre una svista (si stava probabilmente guardando un
   * altro giorno), quindi chiede conferma invece di procedere in silenzio.
   * Guarda solo il giorno, non il servizio specifico: un'azione sulla cena
   * di oggi resta valida anche dopo che la cena è chiusa (es. alle 22:00,
   * sistemando un pagamento della serata appena finita) — l'avviso serve
   * solo per il giorno sbagliato, non per il momento esatto della giornata.
   */
  _confirmIfNotNow(dateISO, serviceKey, actionLabel) {
    const isToday = dateISO === Utils.todayISO();
    if (isToday) return true;
    const when = this.dateLabel(dateISO) + ' · ' + (serviceKey === 'lunch' ? 'Pranzo' : 'Cena');
    return confirm('Stai per registrare ' + actionLabel + ' per ' + when + ', diverso da oggi. Sicuro di non esserti sbagliato di giorno?');
  },

  /**
   * Avviso prima di spostare il tavolo di una prenotazione segnata "🔒 Non
   * spostare" — un tavolo storico o preparato apposta, che non va toccato
   * per sbaglio. Non blocca mai: chiede solo conferma, e forzando si
   * procede comunque, esattamente come chiesto.
   */
  _confirmIfFixedTable(booking) {
    if (!booking || !Bookings.isFixedTable(booking)) return true;
    return confirm('🔒 Il tavolo di ' + (booking.name || 'questa prenotazione') + ' è segnato "Non spostare" — spostarlo comunque?');
  },

  openWalkInModal(zone, table, dateISO, serviceKey) {
    if (!this._confirmIfNotNow(dateISO, serviceKey, 'un walk-in')) return;
    let modal = document.getElementById('walkInModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'walkInModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const now = new Date();
    const nowHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    // Altri tavoli della stessa zona, per poterne unire un secondo se il
    // gruppo non ci sta nel tavolo toccato — solo quelli davvero liberi.
    const occupied = new Set();
    Bookings.getByDateAndService(dateISO, serviceKey)
      .filter(bk => bk.status !== STATUS.CANCELLED && bk.status !== STATUS.COMPLETED && bk.status !== STATUS.NOSHOW)
      .forEach(bk => { if (bk.tablesAssigned) bk.tablesAssigned.split(',').forEach(t => occupied.add(t.trim())); });
    const otherTables = SharedTables.getTablesForZone(zone).filter(t => t !== table);
    const extraTables = new Set();

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>Walk-in · Tavolo ' + this.escapeHTML(table) + '</h3>' +
        '<p style="font-size:13px;color:var(--color-ink-soft);margin-bottom:14px">Cliente senza prenotazione, occupa subito il tavolo.</p>' +
        '<div class="field-group"><label class="field-label">Persone</label>' +
          '<div class="dogs-stepper">' +
            '<button type="button" class="stepper-btn" id="walkInPeopleMinus">−</button>' +
            '<span class="stepper-value" id="walkInPeopleValue">2</span>' +
            '<button type="button" class="stepper-btn" id="walkInPeoplePlus">+</button>' +
          '</div></div>' +
        (otherTables.length > 0 ?
          '<div class="field-group" style="margin-top:12px"><label class="field-label">Unisci un altro tavolo (se serve)</label>' +
            '<div class="form-table-grid" id="walkInExtraTables">' +
              otherTables.map(t => {
                const isOccupied = occupied.has(t);
                const isBlocked = SharedTables.isBlocked(t, dateISO, serviceKey);
                const disabled = isOccupied || isBlocked;
                return '<button type="button" class="form-table-pill' + (disabled ? ' occupied-pill' : '') + '" data-table="' + this.escapeHTML(t) + '"' +
                  (disabled ? ' disabled style="opacity:0.4;cursor:not-allowed;text-decoration:line-through"' : '') + '>' + this.escapeHTML(t) + '</button>';
              }).join('') +
            '</div></div>' : '') +
        '<div class="field-group" style="margin-top:12px"><label class="field-label">Ora di arrivo</label>' +
          '<input type="time" class="config-time-input" id="walkInTime" value="' + nowHHMM + '"></div>' +
        '<div class="field-group" style="margin-top:12px"><label class="field-label">Nome (opzionale)</label>' +
          '<input type="text" class="text-input" id="walkInName" placeholder="Walk-in"></div>' +
        '<div class="field-group" style="margin-top:12px"><label class="field-label">Note (opzionale)</label>' +
          '<input type="text" class="text-input" id="walkInNotes" placeholder="Note…"></div>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="walkInCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="walkInConfirm" style="background:var(--color-warning)">Occupa tavolo</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');
    let walkInPeopleValue = 2;
    const peopleValueEl = modal.querySelector('#walkInPeopleValue');
    modal.querySelector('#walkInPeopleMinus').addEventListener('click', () => {
      walkInPeopleValue = Math.max(1, walkInPeopleValue - 1);
      peopleValueEl.textContent = walkInPeopleValue;
    });
    modal.querySelector('#walkInPeoplePlus').addEventListener('click', () => {
      walkInPeopleValue = Math.min(30, walkInPeopleValue + 1);
      peopleValueEl.textContent = walkInPeopleValue;
    });
    modal.querySelectorAll('#walkInExtraTables .form-table-pill:not([disabled])').forEach(pill => {
      pill.addEventListener('click', () => {
        const t = pill.dataset.table;
        if (extraTables.has(t)) { extraTables.delete(t); pill.classList.remove('selected'); }
        else { extraTables.add(t); pill.classList.add('selected'); }
      });
    });
    modal.querySelector('#walkInCancel').addEventListener('click', () => modal.classList.remove('active'));

    modal.querySelector('#walkInConfirm').addEventListener('click', async () => {
      const name = modal.querySelector('#walkInName').value.trim() || 'Walk-in';
      const people = walkInPeopleValue;
      // Arrotondato allo slot più vicino (es. 19:02 → 19:00) — serve per
      // avere statistiche di affluenza leggibili invece di un orario diverso a ogni arrivo.
      const rawTime = modal.querySelector('#walkInTime').value || nowHHMM;
      const time = Slots.roundToNearestSlot(rawTime);
      const userNotes = modal.querySelector('#walkInNotes').value.trim();
      // Marcatore in testa alle note per riconoscere il walk-in in piantina
      // (badge giallo) senza bisogno di una colonna dedicata sul database.
      const notes = Piantina.WALKIN_MARK + ' walk-in' + (userNotes ? ' · ' + userNotes : '');
      const tablesAssigned = [table, ...extraTables].join(', ');

      modal.classList.remove('active');
      this.showSyncIndicator(true);
      const created = await Bookings.create({
        name, people, date: dateISO, time, service: serviceKey,
        zone: 'any', notes, status: STATUS.SEATED, tablesAssigned,
      });
      if (created) {
        const [hh, mm] = time.split(':').map(Number);
        const [y, m, d] = dateISO.split('-').map(Number);
        const arrivedAt = new Date(y, m - 1, d, hh, mm).toISOString();
        await DB.update(created.id, { arrived_at: arrivedAt });
        await Bookings.loadAll();
      }
      this.showSyncIndicator(false);
      this.toast('Tavolo ' + table + ' occupato ✓');
      if (this.state.currentScreen === 'list') this.renderList();
      else this.renderDashboard();
    });
  },

  renderListAvailableTables(dateISO) {
    const container = document.getElementById('listAvailableTablesBox');
    if (!container) return;
    const serviceKey = this.state.selectedService;
    renderTableGrid(container, dateISO, serviceKey, DB.canEdit());
  },

  /**
   * Chi è un "secondo turno" dentro un elenco di prenotazioni — condivide
   * un tavolo con una prenotazione precedente nello stesso giorno/servizio,
   * in modo voluto (confermato con orario di rilascio, o provvisorio), non
   * un conflitto vero. Riusata sia per evidenziare le righe in Lista, sia
   * per la card dedicata in Home — un solo posto dove questa logica vive.
   * Ritorna una Map id → { earlier, isProvisional } per le prenotazioni
   * che SONO un secondo turno (non tutte quelle passate).
   */
  /**
   * Chi condivide un tavolo con chi, in un elenco di prenotazioni —
   * restituisce due mappe: "later" (chi arriva dopo, con riferimento a chi
   * arriva prima — usata per il tag "Secondo turno") e "earlier" (chi
   * arriva prima, con riferimento a chi arriva dopo — usata per
   * evidenziare anche la prenotazione di apertura, con orario certo o
   * provvisorio che sia: prima veniva evidenziata solo se c'era un orario
   * di rilascio confermato, lasciando invisibile il caso più comune di
   * un doppio turno preso al volo senza orario preciso).
   */
  findSecondTurns(bookings) {
    const later = new Map();
    const earlier = new Map();
    bookings.forEach(b => {
      if (!b.tablesAssigned || b.status === STATUS.CANCELLED || b.status === STATUS.COMPLETED || b.status === STATUS.NOSHOW) return;
      const myTables = b.tablesAssigned.split(',').map(t => t.trim());
      const earlierBooking = bookings.find(other =>
        other.id !== b.id && other.date === b.date && other.service === b.service &&
        other.status !== STATUS.CANCELLED && other.status !== STATUS.COMPLETED && other.status !== STATUS.NOSHOW &&
        other.tablesAssigned && other.tablesAssigned.split(',').map(t => t.trim()).some(t => myTables.includes(t)) &&
        other.time < b.time &&
        Piantina._bookingsAreSeparated(other, b)
      );
      if (earlierBooking) {
        const isProvisional = Bookings.isProvisional(b);
        later.set(b.id, { earlier: earlierBooking, isProvisional });
        earlier.set(earlierBooking.id, { later: b, isProvisional });
      }
    });
    return { later, earlier };
  },

  renderBookingRows(containerId, bookings, emptyConfig) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (bookings.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="empty-icon">' + emptyConfig.emptyIcon + '</span><strong>' + emptyConfig.emptyTitle + '</strong><span>' + emptyConfig.emptyText + '</span></div>';
      return;
    }
    const secondTurns = this.findSecondTurns(bookings);
    for (const b of bookings) container.appendChild(this.buildBookingRow(b, secondTurns.later.has(b.id), secondTurns.earlier.get(b.id)));
  },

  /**
   * Pallino colorato + testo, in cima alla riga — sostituisce lo sfondo
   * colorato pieno di prima come modo principale di comunicare lo stato,
   * più leggibile a colpo d'occhio. Il colore del bordo a sinistra (già
   * calcolato sopra, urgenza compresa) resta com'era: qui aggiungo solo
   * un'etichetta di testo chiara, non tolgo nulla della logica esistente.
   */
  _bookingStatusDisplay(b) {
    if (b.status === STATUS.CANCELLED) return { label: 'Cancellata', color: '#9A9A9A' };
    if (b.status === STATUS.NOSHOW) return { label: 'No-show', color: '#A32D2D' };
    if (b.status === STATUS.COMPLETED) return { label: 'Completata', color: '#6B6B6B' };
    if (b.status === STATUS.WAITLIST) return { label: 'Lista d\'attesa', color: '#9A968A' };
    if (b.status === STATUS.TAKEAWAY) return { label: 'Asporto', color: '#C08A2E' };
    if (b.arrivedAt) return { label: 'Arrivata', color: '#2E7D4F' };
    if (b.date === Utils.todayISO()) {
      const bookingMin = Slots.toMinutes(b.time);
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      if (nowMin > bookingMin + 5) return { label: 'In ritardo · ' + (nowMin - bookingMin) + ' min', color: '#A32D2D' };
    }
    if (!b.tablesAssigned) return { label: 'Senza tavolo', color: '#A32D2D' };
    return { label: 'Confermata', color: '#2E7D4F' };
  },

  buildBookingRow(b, isSecondTurn, upcomingTurn) {
    const row = document.createElement('div');
    row.className = 'booking-row';
    row.dataset.status = b.status;

    // Colori card
    if (b.arrivedAt) {
      row.classList.add('arrived');
    } else if (!b.arrivedAt && b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW) {
      const bookingMin = Slots.toMinutes(b.time);
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (b.date === Utils.todayISO() && nowMin > bookingMin + 5) {
        row.classList.add('late');
      } else if (b.isNew) {
        row.classList.add('is-new-booking');
      }
    }
    if (isSecondTurn) row.classList.add('second-turn');
    // È il "primo turno" di una coppia — con orario di rilascio confermato
    // o provvisorio, non importa: prima si evidenziava solo se c'era un
    // orario preciso, lasciando invisibile il caso più comune (un secondo
    // turno preso al volo, senza orario certo). Ora conta essere il primo
    // di una coppia, punto.
    if (upcomingTurn && b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW) {
      row.classList.add('releases-soon');
      // Se l'orario è confermato (non provvisorio) e la prenotazione è di
      // OGGI (per un altro giorno il conto alla rovescia non avrebbe
      // senso), il colore e il riempimento cambiano in base a quanto
      // tempo resta davvero — un'ora o più: giallo chiaro; sempre più
      // rosso avvicinandosi al momento del cambio.
      if (b.doubleShiftRelease && b.date === Utils.todayISO()) {
        const urgency = this._urgencyStyle(b.doubleShiftRelease);
        row.style.borderLeftColor = urgency.border;
        if (!b.arrivedAt) row.style.background = urgency.bg;
        row.dataset.urgencyFill = Math.round(urgency.t * 100);
      }
    }
    if (b.status === STATUS.WAITLIST || b.status === STATUS.TAKEAWAY) {
      // Niente tavolo è normale qui, non un errore da segnalare in rosso
      // come per una prenotazione vera rimasta senza tavolo.
      row.classList.add('waitlist-row');
    } else if (!b.tablesAssigned && b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW) {
      // Prenotazione salvata senza tavolo (es. da una duplicazione multi-
      // giorno dove il tavolo scelto era già occupato in alcuni giorni) —
      // va segnalata bene, non basta il piccolo pulsante "+Tav" da solo.
      row.classList.add('no-table');
    }

    const tags = [];
    if (isSecondTurn) tags.push('<span class="tag tag-second-turn' + (Bookings.isProvisional(b) ? ' provisional' : '') + '">🔄 Secondo turno' + (Bookings.isProvisional(b) ? ' (provvisorio)' : '') + '</span>');
    if (b.dogs > 0) tags.push('<span class="tag">🐾 ' + b.dogs + '</span>');
    if (b.highchairs > 0) tags.push('<span class="tag">' + b.highchairs + ' segg.</span>');
    if (b.intolerances) tags.push('<span class="tag tag-warning">⚠️ ' + this.escapeHTML(b.intolerances) + '</span>');
    if (upcomingTurn) {
      const laterName = this.escapeHTML(upcomingTurn.later.name || 'un\'altra prenotazione');
      const label = '⏱️ Libera entro ' + b.doubleShiftRelease + ' — poi ' + laterName;
      if (upcomingTurn.isProvisional) {
        const provLabel = '⏱️ Poi ' + laterName + ' (' + upcomingTurn.later.time + ') — provvisorio';
        tags.push('<span class="tag tag-warning tag-doubleshift-edit" data-id="' + b.id + '">' + provLabel + '</span>');
      } else if (b.date === Utils.todayISO()) {
        // Orario confermato e di oggi: colore e riempimento cambiano in
        // base a quanto tempo resta davvero, non solo un colore fisso — il
        // riempimento (in fondo al tag) avanza da sinistra a destra man
        // mano che si avvicina il momento del cambio.
        const urgency = this._urgencyStyle(b.doubleShiftRelease);
        tags.push(
          '<span class="tag tag-doubleshift-edit tag-urgency" data-id="' + b.id + '" style="background:' + urgency.bg + ';border-color:' + urgency.border + '">' +
            '<span class="tag-urgency-fill" style="width:' + Math.round(urgency.t * 100) + '%;background:' + urgency.border + '"></span>' +
            '<span class="tag-urgency-label" style="color:' + urgency.border + '">' + label + '</span>' +
          '</span>'
        );
      } else {
        // Un altro giorno (passato o futuro): niente conto alla rovescia,
        // non avrebbe senso — resta il colore fisso di sempre.
        tags.push('<span class="tag tag-warning tag-doubleshift-edit" data-id="' + b.id + '">' + label + '</span>');
      }
    }
    if (b.zone && b.zone !== 'any') tags.push('<span class="tag">' + (ZONE_LABELS[b.zone] || b.zone) + '</span>');
    const hotelInfo = Bookings.getHotelInfo(b);
    if (hotelInfo) {
      tags.push('<span class="tag tag-hotel">🏨 Camera ' + this.escapeHTML(hotelInfo.roomNumber || '?') +
        (hotelInfo.mealPlan === 'mezza_pensione' ? ' · Mezza pensione' : ' · Alla carta') + '</span>');
      const visitNumber = Bookings.getStayVisitNumber(b);
      if (visitNumber) {
        tags.push('<span class="tag tag-visit-count">' + (visitNumber === 1 ? '👋 Prima volta' : '🔁 ' + visitNumber + 'ª volta') + '</span>');
      }
    }
    if (Bookings.isWorkerMenu(b)) {
      tags.push('<span class="tag tag-worker-menu">👷 Menu operaio</span>');
    }

    const { userNotes, payment, isEvento } = Bookings.splitNotes(b.notes);
    const linkedCustomerId = Bookings.getCustomerId(b);
    const linkedCustomer = linkedCustomerId ? SharedTables.getCustomerById(linkedCustomerId) : null;
    if (payment) tags.push('<span class="tag tag-success">💶 ' + payment.amount.toFixed(2) + '€ ' + this.escapeHTML(payment.method) + '</span>');
    if (isEvento) tags.push('<span class="tag tag-evento">🎉 Evento</span>');
    if (b.status === STATUS.WAITLIST) tags.push('<span class="tag tag-waitlist">🕐 Lista d\'attesa</span>');
    if (b.status === STATUS.TAKEAWAY) tags.push('<span class="tag tag-takeaway">🥡 Asporto</span>');
    if (Bookings.isFixedTable(b)) tags.push('<span class="tag tag-fixed-table">🔒 Non spostare</span>');

    const tableDisplayText = (() => {
      if (!b.tablesAssigned) return null;
      const parts = b.tablesAssigned.split(',').map(t => t.trim());
      if (parts.length <= 2) return 'Tav. ' + parts.join(', ');
      return 'Tav. ' + parts[0] + '…+' + (parts.length - 1);
    })();
    const tableLabel = tableDisplayText
      ? '<div class="table-badge-box" title="' + this.escapeHTML(b.tablesAssigned) + '">' + tableDisplayText + '</div>'
      : (DB.canEdit() ? '<button class="table-assign-btn-sm" type="button">+Tav</button>' : '');

    const checkBtn = DB.canEdit()
      ? '<button class="arrived-check ' + (b.arrivedAt ? 'checked' : '') + '" type="button" title="Segna arrivato">✓</button>'
      : '';
    const noshowBtn = (DB.canEdit() && b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED)
      ? '<button class="noshow-check ' + (b.status === STATUS.NOSHOW ? 'checked' : '') + '" type="button" title="Segna no-show">🚫</button>'
      : '';
    const completedBtn = (DB.canEdit() && b.status !== STATUS.CANCELLED && b.status !== STATUS.NOSHOW)
      ? '<button class="completed-check ' + (b.status === STATUS.COMPLETED ? 'checked' : '') + '" type="button" title="Termina e libera il tavolo">🏁</button>'
      : '';

    const statusDisplay = this._bookingStatusDisplay(b);

    row.innerHTML =
      '<div class="time-block">' +
        '<span class="time-value">' + b.time + '</span>' +
        '<span class="time-service">' + (b.service === 'lunch' ? 'Pranzo' : 'Cena') + '</span>' +
      '</div>' +
      '<div class="booking-info">' +
        '<div class="booking-status-line"><span class="booking-status-dot" style="background:' + statusDisplay.color + '"></span><span class="booking-status-text" style="color:' + statusDisplay.color + '">' + statusDisplay.label + '</span></div>' +
        '<div class="booking-name-row">' +
          '<span class="booking-name ' + (b.arrivedAt ? 'name-arrived' : '') + '">' + (this.escapeHTML(b.name) || '(senza nome)') + '</span>' +
          '<span class="people-badge">' + b.people + ' cop.' + (b.highchairs > 0 ? ' + ' + b.highchairs + ' segg.' : '') + '</span>' +
        '</div>' +
        this.dietaryAlertHTML(b) +
        '<div class="booking-actions-row">' +
          checkBtn +
          noshowBtn +
          completedBtn +
          tableLabel +
        '</div>' +
        (tags.length ? '<div class="booking-tags">' + tags.join('') + '</div>' : '') +
        (b.specialNeeds ? '<div class="booking-notes">ℹ️ ' + this.escapeHTML(b.specialNeeds) + '</div>' : '') +
        // Nota del cliente in archivio — sempre visibile, non solo quando
        // si modifica la prenotazione: è il senso stesso di ricordarsela.
        (linkedCustomer && linkedCustomer.notes ? '<div class="booking-notes booking-customer-notes">👤 ' + this.escapeHTML(linkedCustomer.notes) + '</div>' : '') +
        (userNotes ? '<div class="booking-notes">📝 ' + this.escapeHTML(userNotes) + '</div>' : '') +
        // Le tracce di sistema (spostamenti tavolo, riassegnazioni, ecc.)
        // restano salvate nei dati ma non compaiono più da nessuna parte,
        // nemmeno dietro una tendina — solo le note scritte a mano si vedono.
        (b.phone ? '<a class="booking-phone-link" href="' + Utils.telLink(b.phone) + '" onclick="event.stopPropagation()">📞 ' + this.escapeHTML(b.phone) + '</a>' : '') +
      '</div>' +
      (b.isNew ? '<button class="new-badge" type="button">Nuova</button>' : '') +
      (DB.canEdit() ? '<button class="booking-actions-btn" type="button" title="Azioni rapide">⋯</button>' : '') +
      (DB.canEdit() && b.created_at ? '<span class="booking-created-at">' + (b.createdBy ? b.createdBy + ' · ' : '') + (new Date(b.created_at)).toLocaleDateString('it-IT', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) + '</span>' : '');

    if (DB.canEdit()) {
      const arriveBtn = row.querySelector('.arrived-check');
      if (arriveBtn) {
        arriveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          arriveBtn.textContent = '…';
          await Bookings.markArrived(b.id, !b.arrivedAt);
          this.toast(b.arrivedAt ? 'Arrivo rimosso' : 'Arrivato ✓');
          if (this.state.currentScreen === 'list') this.renderList();
          if (this.state.currentScreen === 'search') this.renderSearch(document.getElementById('searchInput').value);
        });
      }

      const noshowBtnEl = row.querySelector('.noshow-check');
      if (noshowBtnEl) {
        noshowBtnEl.addEventListener('click', async (e) => {
          e.stopPropagation();
          const isNoShow = b.status === STATUS.NOSHOW;
          noshowBtnEl.textContent = '…';
          await Bookings.markNoShow(b.id, !isNoShow);
          this.toast(isNoShow ? 'No-show rimosso' : 'Segnato come no-show 🚫');
          if (this.state.currentScreen === 'list') this.renderList();
          if (this.state.currentScreen === 'search') this.renderSearch(document.getElementById('searchInput').value);
        });
      }

      const completedBtnEl = row.querySelector('.completed-check');
      if (completedBtnEl) {
        completedBtnEl.addEventListener('click', async (e) => {
          e.stopPropagation();
          const isCompleted = b.status === STATUS.COMPLETED;
          completedBtnEl.textContent = '…';
          await Bookings.markCompleted(b.id, !isCompleted);
          this.toast(isCompleted ? 'Riportata a confermata' : 'Terminata — tavolo libero 🏁');
          if (this.state.currentScreen === 'list') this.renderList();
          if (this.state.currentScreen === 'search') this.renderSearch(document.getElementById('searchInput').value);
        });
      }

      const tableBtn = row.querySelector('.table-assign-btn-sm');
      if (tableBtn) {
        tableBtn.addEventListener('click', (e) => { e.stopPropagation(); this.openTablePicker(b.id, b.tablesAssigned); });
      }
      const tableBadge = row.querySelector('.table-badge');
      if (tableBadge) {
        tableBadge.addEventListener('click', (e) => { e.stopPropagation(); this.openTablePicker(b.id, b.tablesAssigned); });
      }
    }

    if (b.isNew) {
      const badge = row.querySelector('.new-badge');
      if (badge) {
        badge.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!DB.canEdit()) return;
          badge.textContent = '…';
          this.showSyncIndicator(true);
          await Bookings.markAsTranscribed(b.id);
          this.showSyncIndicator(false);
          this.toast('Segnata come trascritta ✓');
          if (this.state.currentScreen === 'list') this.renderList();
          if (this.state.currentScreen === 'search') this.renderSearch(document.getElementById('searchInput').value);
        });
      }
    }

    if (DB.canEdit()) {
      const actionsBtn = row.querySelector('.booking-actions-btn');
      if (actionsBtn) {
        actionsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openActionsMenu(b, actionsBtn);
        });
      }
      // Tag "⏱️ libera alle..." toccabile direttamente — prima l'unico modo
      // per correggerlo (es. un refuso) era passare dalla piantina, tre
      // passaggi più in là.
      const doubleShiftTag = row.querySelector('.tag-doubleshift-edit');
      if (doubleShiftTag) {
        doubleShiftTag.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openDoubleShiftQuickModal(b, b.tablesAssigned || '', null, null, null);
        });
      }
    }

    row.addEventListener('click', () => this.openBookingDetailView(b));
    return row;
  },

  /**
   * Il tocco su una card della lista apre QUESTO — una vista di sola
   * lettura con tutte le informazioni ben leggibili, non più direttamente
   * il form di modifica. Per modificare davvero, il pulsante "Modifica"
   * qui dentro apre il form come prima — un passaggio in più voluto,
   * per evitare aperture involontarie del form solo toccando la card
   * per guardare i dettagli.
   */
  /**
   * Chiede un PIN prima di procedere con un'azione — usata per confermare
   * un piatto e per salvare una modifica alle proposte del giorno.
   * Controlla SEMPRE il PIN digitato lì per lì contro l'elenco admin
   * aggiornato E il PIN dello chef (uno solo, impostato dallo chef stesso
   * — vedi UI.openChefPinSettingsModal), non lo stato "sbloccato" della
   * sessione (quello resta per Impostazioni/Statistiche, qui serve una
   * conferma ogni volta, chiunque sia già dentro). onSuccess gira solo se
   * il PIN è uno dei due giusti; altrimenti resta tutto com'era, nessuna
   * azione presa.
   */
  /**
   * "Gestisci accessi" — solo per il chef principale (DB.isHeadChef()),
   * mai per un cuoco normale. A differenza della vecchia vista squadra
   * (tolta perché ogni cuoco vedeva i PIN di tutti), questa mostra e
   * gestisce TUTTI E TRE gli elenchi, admin compreso — chi ha questo
   * pulsante ha già accesso admin pieno tramite canEdit(), vedere anche
   * i PIN admin non aggiunge un rischio nuovo. Riusa le stesse funzioni
   * di rendering di Impostazioni, con container propri.
   */
  /**
   * Ordini/inventario — raggruppata per categoria, ogni articolo con un
   * campo quantità modificabile (chiunque abbia accesso a questa
   * schermata può aggiornarlo, è il conteggio settimanale). Sotto soglia
   * = evidenziato in rosso, e un banner in cima riassume quanti articoli
   * servono un ordine, per vederlo a colpo d'occhio senza dover scorrere
   * tutto.
   */
  renderOrdini() {
    const addBtn = document.getElementById('ordiniAddItemBtn');
    if (addBtn) addBtn.style.display = DB.isFullAdmin() ? '' : 'none';

    // Il conteggio vero e proprio — diverso dal semplice aggiornare un
    // numero: dà a Luca la certezza che quel giorno qualcuno ha
    // DAVVERO fatto il giro del magazzino, non solo che un singolo
    // articolo è stato toccato chissà quando.
    const countBanner = document.getElementById('ordiniCountBanner');
    const activeCount = SharedTables.getActiveInventoryCount();
    if (countBanner) {
      if (activeCount) {
        countBanner.className = 'ordini-count-banner ordini-count-active';
        countBanner.innerHTML =
          '<span>🔵 Conteggio in corso — avviato da ' + this.escapeHTML(activeCount.startedBy || '?') + ' alle ' + activeCount.startedAt.slice(11, 16) + '</span>' +
          '<button type="button" id="ordiniCompleteBtn">✅ Termina conteggio</button>';
        countBanner.querySelector('#ordiniCompleteBtn').addEventListener('click', async () => {
          await SharedTables.completeInventoryCount(activeCount.id, DB.getOperator() || null);
          this.renderOrdini();
          // Il resoconto diviso per urgenza, subito — il momento in cui
          // serve di più vederlo tutto insieme, appena concluso.
          const saved = SharedTables.getInventoryCountHistory()[0];
          if (saved) this.openInventoryCountDetailModal(saved);
        });
      } else {
        countBanner.className = 'ordini-count-banner';
        countBanner.innerHTML = '<button type="button" id="ordiniStartBtn" class="save-btn" style="width:100%">▶️ Avvia conteggio</button>';
        countBanner.querySelector('#ordiniStartBtn').addEventListener('click', async () => {
          await SharedTables.startInventoryCount(DB.getOperator() || null);
          this.renderOrdini();
        });
      }
    }

    const items = SharedTables.getInventoryItems();
    const list = document.getElementById('ordiniList');
    const banner = document.getElementById('ordiniLowStockBanner');
    if (!list) return;

    const lowStock = items.filter(i => i.currentQty != null && i.currentQty <= i.threshold);
    if (banner) {
      if (lowStock.length === 0) {
        banner.classList.add('hidden');
      } else {
        banner.classList.remove('hidden');
        banner.className = 'ordini-low-stock-banner';
        banner.textContent = '🔴 ' + lowStock.length + ' articol' + (lowStock.length === 1 ? 'o sotto soglia' : 'i sotto soglia') + ' — serve un ordine';
      }
    }

    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">📦</span><strong>Nessun articolo ancora</strong><span>' +
        (DB.isFullAdmin() ? 'Tocca "+" in alto per aggiungerne uno.' : 'Chiedi a chi gestisce l\'app di aggiungerne.') + '</span></div>';
      return;
    }

    const categories = SharedTables.getInventoryCategories();
    const uncategorized = items.filter(i => !i.category);
    const groups = categories.map(cat => ({ cat, items: items.filter(i => i.category === cat) }));
    if (uncategorized.length > 0) groups.push({ cat: '', items: uncategorized });

    list.innerHTML = groups.map(g => {
      const rows = g.items.map(i => {
        const isLow = i.currentQty != null && i.currentQty <= i.threshold;
        const neverCounted = i.currentQty == null;
        return '<div class="ordini-item-row' + (isLow ? ' ordini-item-low' : '') + '" data-id="' + i.id + '">' +
          '<div class="ordini-item-info">' +
            '<strong>' + this.escapeHTML(i.name) + '</strong>' +
            '<span class="ordini-item-meta">Soglia: ' + i.threshold + (i.unit ? ' ' + this.escapeHTML(i.unit) : '') +
              (i.updatedAt ? ' · Aggiornato ' + this.dateLabel(i.updatedAt.slice(0, 10)).toLowerCase() + (i.updatedBy ? ' da ' + this.escapeHTML(i.updatedBy) : '') : ' · Mai contato') +
            '</span>' +
          '</div>' +
          '<input type="number" inputmode="numeric" class="text-input ordini-item-qty" data-id="' + i.id + '" placeholder="?" value="' + (neverCounted ? '' : i.currentQty) + '">' +
          (DB.isFullAdmin() ? '<button type="button" class="icon-btn ordini-item-edit" data-id="' + i.id + '" title="Modifica">✏️</button>' : '') +
        '</div>';
      }).join('');
      return (g.cat ? '<h3 class="ordini-category-title">' + this.escapeHTML(g.cat) + '</h3>' : '<h3 class="ordini-category-title">Senza categoria</h3>') +
        '<div class="ordini-category-group">' + rows + '</div>';
    }).join('');

    list.querySelectorAll('.ordini-item-qty').forEach(input => {
      input.addEventListener('change', async () => {
        const id = input.dataset.id;
        const val = input.value.trim();
        const qty = val === '' ? null : Number(val);
        if (val !== '' && (isNaN(qty) || qty < 0)) {
          this.toast('Numero non valido', 'warning');
          const item = SharedTables.getInventoryItems().find(i => i.id === id);
          input.value = item && item.currentQty != null ? item.currentQty : '';
          return;
        }
        await SharedTables.setInventoryQty(id, qty, DB.getOperator() || null);
        this.renderOrdini();
      });
    });

    list.querySelectorAll('.ordini-item-edit').forEach(btn => {
      btn.addEventListener('click', () => this.openInventoryItemModal(SharedTables.getInventoryItems().find(i => i.id === btn.dataset.id)));
    });
  },

  /**
   * Scheda per aggiungere o modificare un articolo — nome, categoria
   * (testo libero), unità, soglia. Mai la quantità attuale: quella si
   * aggiorna dalla riga stessa, non da qui.
   */
  /**
   * Storico + resoconto conteggi — UNA sola finestra, non due che si
   * sovrapponevano (bug corretto: prima il tocco su una riga dello
   * storico apriva una seconda finestra sopra la prima, lasciandole
   * entrambe aperte una dietro l'altra). "← Indietro" torna alla lista
   * solo quando si arriva dallo storico; aperto subito dopo aver
   * concluso un conteggio, si chiude direttamente con "✕".
   */
  openInventoryCountHistoryModal() {
    let modal = document.getElementById('inventoryCountModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'inventoryCountModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }
    const history = SharedTables.getInventoryCountHistory();
    modal.innerHTML =
      '<div class="modal-sheet ordini-modal-sheet">' +
        '<div class="booking-detail-header">' +
          '<h3 style="margin:0">Storico conteggi</h3>' +
          '<button type="button" class="icon-btn" id="inventoryCountModalClose">✕</button>' +
        '</div>' +
        (history.length === 0
          ? '<div class="empty-state"><span class="empty-icon">🕐</span><strong>Nessun conteggio ancora</strong><span>Comparirà qui appena ne concludi uno.</span></div>'
          : '<div class="ordini-history-list">' + history.map(c => {
              const snapshots = c.itemSnapshots || [];
              const missing = snapshots.filter(s => s.qty === 0).length;
              const low = snapshots.filter(s => s.qty != null && s.qty > 0 && s.qty <= s.threshold).length;
              const ok = snapshots.filter(s => s.qty != null && s.qty > s.threshold).length;
              return '<button type="button" class="ordini-history-card" data-id="' + c.id + '">' +
                '<div class="ordini-history-card-main">' +
                  '<div class="ordini-history-date">' + this.dateLabel(c.completedAt.slice(0, 10)) + '</div>' +
                  '<div class="ordini-history-meta">' + this.escapeHTML(c.completedBy || '?') + ' · ' + c.completedAt.slice(11, 16) + ' · ' + snapshots.length + ' articoli</div>' +
                  '<div class="ordini-history-chips">' +
                    (missing > 0 ? '<span class="ordini-chip ordini-chip-missing">' + missing + '</span>' : '') +
                    (low > 0 ? '<span class="ordini-chip ordini-chip-low">' + low + '</span>' : '') +
                    '<span class="ordini-chip ordini-chip-ok">' + ok + '</span>' +
                  '</div>' +
                '</div>' +
                '<span class="ordini-history-chevron">›</span>' +
              '</button>';
            }).join('') + '</div>'
        ) +
      '</div>';
    modal.classList.add('active');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
    modal.querySelector('#inventoryCountModalClose').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelectorAll('.ordini-history-card').forEach(card => {
      card.addEventListener('click', () => {
        const count = history.find(c => c.id === card.dataset.id);
        if (count) this.openInventoryCountDetailModal(count, true);
      });
    });
  },

  /**
   * Il resoconto di un conteggio concluso — le quantità di quel momento
   * (la fotografia, non i valori attuali), divise per urgenza: prima chi
   * manca del tutto, poi chi è sotto soglia ma non a zero, infine chi va
   * bene. Una fila di pallini in alto riassume i numeri a colpo d'occhio
   * prima ancora di scorrere l'elenco.
   */
  openInventoryCountDetailModal(count, fromHistory) {
    let modal = document.getElementById('inventoryCountModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'inventoryCountModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }
    const snapshots = count.itemSnapshots || [];
    const missing = snapshots.filter(s => s.qty === 0);
    const low = snapshots.filter(s => s.qty != null && s.qty > 0 && s.qty <= s.threshold);
    const ok = snapshots.filter(s => s.qty != null && s.qty > s.threshold);
    const uncounted = snapshots.filter(s => s.qty == null);

    const renderTier = (title, cssClass, tierItems) => {
      if (tierItems.length === 0) return '';
      return '<h3 class="ordini-tier-title ' + cssClass + '">' + title + '</h3>' +
        '<div class="ordini-category-group">' +
          tierItems.map(s => '<div class="ordini-item-row ' + cssClass + '-row">' +
            '<div class="ordini-item-info">' +
              '<strong>' + this.escapeHTML(s.name) + '</strong>' +
              (s.category ? '<span class="ordini-item-meta">' + this.escapeHTML(s.category) + '</span>' : '') +
            '</div>' +
            '<span class="ordini-tier-qty">' + (s.qty == null ? '—' : s.qty + (s.unit ? ' ' + this.escapeHTML(s.unit) : '')) + '</span>' +
          '</div>').join('') +
        '</div>';
    };

    modal.innerHTML =
      '<div class="modal-sheet ordini-modal-sheet">' +
        '<div class="booking-detail-header">' +
          (fromHistory ? '<button type="button" class="icon-btn" id="inventoryCountDetailBack">←</button>' : '<span></span>') +
          '<h3 style="margin:0">' + this.dateLabel(count.completedAt.slice(0, 10)) + '</h3>' +
          '<button type="button" class="icon-btn" id="inventoryCountModalClose">✕</button>' +
        '</div>' +
        '<p class="ordini-detail-subtitle">Conteggio di ' + this.escapeHTML(count.completedBy || '?') + ' · ' + count.completedAt.slice(11, 16) + '</p>' +
        '<div class="ordini-summary-row">' +
          (missing.length > 0 ? '<div class="ordini-summary-stat ordini-summary-missing"><span class="ordini-summary-num">' + missing.length + '</span><span>Mancanti</span></div>' : '') +
          (low.length > 0 ? '<div class="ordini-summary-stat ordini-summary-low"><span class="ordini-summary-num">' + low.length + '</span><span>Sotto soglia</span></div>' : '') +
          '<div class="ordini-summary-stat ordini-summary-ok"><span class="ordini-summary-num">' + ok.length + '</span><span>Ok</span></div>' +
          (uncounted.length > 0 ? '<div class="ordini-summary-stat ordini-summary-uncounted"><span class="ordini-summary-num">' + uncounted.length + '</span><span>Non contati</span></div>' : '') +
        '</div>' +
        renderTier('Mancanti', 'ordini-tier-missing', missing) +
        renderTier('Sotto soglia', 'ordini-tier-low', low) +
        renderTier('Ok', 'ordini-tier-ok', ok) +
        renderTier('Non contati quella volta', 'ordini-tier-uncounted', uncounted) +
      '</div>';
    modal.classList.add('active');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
    modal.querySelector('#inventoryCountModalClose').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#inventoryCountDetailBack')?.addEventListener('click', () => this.openInventoryCountHistoryModal());
  },

  openInventoryItemModal(existing) {
    let modal = document.getElementById('inventoryItemModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'inventoryItemModal';
      modal.className = 'modal-overlay modal-overlay-centered';
      document.getElementById('app').appendChild(modal);
    }
    const v = (field) => existing ? this.escapeHTML(existing[field] || '') : '';
    modal.innerHTML =
      '<div class="modal-sheet modal-sheet-centered">' +
        '<h3 style="margin:0 0 12px">📦 ' + (existing ? 'Modifica articolo' : 'Nuovo articolo') + '</h3>' +
        '<div class="field-group"><label class="field-label">Nome</label>' +
          '<input type="text" class="text-input" id="invItemName" placeholder="Es. Farina 00" value="' + v('name') + '"></div>' +
        '<div class="field-group"><label class="field-label">Categoria (facoltativa)</label>' +
          '<input type="text" class="text-input" id="invItemCategory" placeholder="Es. Cucina, Bar, Pulizie" value="' + v('category') + '" list="invCategoryOptions">' +
          '<datalist id="invCategoryOptions">' + SharedTables.getInventoryCategories().map(c => '<option value="' + this.escapeHTML(c) + '">').join('') + '</datalist>' +
        '</div>' +
        '<div class="field-group"><label class="field-label">Unità (facoltativa)</label>' +
          '<input type="text" class="text-input" id="invItemUnit" placeholder="Es. kg, bottiglie, pacchi" value="' + v('unit') + '"></div>' +
        '<div class="field-group"><label class="field-label">Soglia minima</label>' +
          '<input type="number" inputmode="numeric" class="text-input" id="invItemThreshold" placeholder="0" value="' + (existing ? existing.threshold : '') + '"></div>' +
        '<div class="modal-actions">' +
          (existing ? '<button class="btn-danger" id="invItemDelete" style="margin-right:auto">🗑️ Elimina</button>' : '') +
          '<button class="modal-btn-cancel" id="invItemCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="invItemSave" style="background:var(--color-primary)">' + (existing ? 'Salva' : 'Aggiungi') + '</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    modal.querySelector('#invItemName').focus();
    modal.querySelector('#invItemCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#invItemDelete')?.addEventListener('click', async () => {
      if (!confirm('Eliminare "' + existing.name + '"? Anche la quantità registrata va persa.')) return;
      await SharedTables.removeInventoryItem(existing.id);
      modal.classList.remove('active');
      this.renderOrdini();
      this.toast('Articolo eliminato ✓');
    });
    modal.querySelector('#invItemSave').addEventListener('click', async () => {
      const name = modal.querySelector('#invItemName').value.trim();
      if (!name) { this.toast('Serve almeno il nome', 'warning'); return; }
      const category = modal.querySelector('#invItemCategory').value.trim();
      const unit = modal.querySelector('#invItemUnit').value.trim();
      const threshold = Number(modal.querySelector('#invItemThreshold').value) || 0;
      modal.classList.remove('active');
      if (existing) {
        await SharedTables.updateInventoryItem(existing.id, { name, category, unit, threshold });
        this.toast('Articolo modificato ✓');
      } else {
        await SharedTables.addInventoryItem(name, category, unit, threshold);
        this.toast('Articolo aggiunto ✓');
      }
      this.renderOrdini();
    });
  },

  openHeadChefAccessManagementView() {
    if (!DB.isHeadChef()) return;
    let modal = document.getElementById('headChefAccessModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'headChefAccessModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }
    modal.innerHTML =
      '<div class="modal-sheet" style="max-height:88vh">' +
        '<div class="booking-detail-header">' +
          '<h3 style="margin:0">🔐 Gestisci accessi</h3>' +
          '<button type="button" class="icon-btn" id="headChefAccessClose">✕</button>' +
        '</div>' +
        '<div class="config-section" style="padding:0">' +
          '<h3>👑 Amministratori</h3>' +
          '<div id="hcAdminPinsList"></div>' +
          '<button class="zone-add-btn" id="hcAddAdminPinBtn" type="button">＋ Aggiungi amministratore</button>' +
        '</div>' +
        '<div class="config-section" style="padding:0;margin-top:16px">' +
          '<h3>🍳 Cuochi</h3>' +
          '<div id="hcChefPinsList"></div>' +
          '<button class="zone-add-btn" id="hcAddChefPinBtn" type="button">＋ Aggiungi cuoco</button>' +
        '</div>' +
        '<div class="config-section" style="padding:0;margin-top:16px">' +
          '<h3>🔑 Dipendenti (sala)</h3>' +
          '<div id="hcEmployeePinsList"></div>' +
          '<button class="zone-add-btn" id="hcAddEmployeePinBtn" type="button">＋ Aggiungi dipendente</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    this.renderAdminPinsEditor('hcAdminPinsList');
    this.renderChefPinsEditor('hcChefPinsList');
    this.renderEmployeePinsEditor('hcEmployeePinsList');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
    modal.querySelector('#headChefAccessClose').addEventListener('click', () => modal.classList.remove('active'));

    const addFlow = async (kind, addFn, rerenderFn, label) => {
      const name = prompt('Nome del nuovo ' + label + ':');
      if (!name || !name.trim()) return;
      let pin;
      while (true) {
        pin = prompt('PIN o password per ' + name.trim() + ' (almeno 4 caratteri):');
        if (pin === null) return;
        pin = pin.trim();
        if (!/^.{4,20}$/.test(pin)) { alert('Deve avere almeno 4 caratteri (massimo 20).'); continue; }
        if (SharedTables.isPinTaken(pin)) { alert('PIN già usato da un altro cuoco, dipendente o amministratore, scegline un altro.'); continue; }
        break;
      }
      if (!(await addFn(name.trim(), pin))) return;
      rerenderFn();
      this.toast(label.charAt(0).toUpperCase() + label.slice(1) + ' aggiunto ✓');
    };

    modal.querySelector('#hcAddAdminPinBtn').addEventListener('click', () =>
      addFlow('admin', (n, p) => SharedTables.addAdminPin(n, p), () => this.renderAdminPinsEditor('hcAdminPinsList'), 'amministratore'));
    modal.querySelector('#hcAddChefPinBtn').addEventListener('click', () =>
      addFlow('chef', (n, p) => SharedTables.addChefPin(n, p), () => this.renderChefPinsEditor('hcChefPinsList'), 'cuoco'));
    modal.querySelector('#hcAddEmployeePinBtn').addEventListener('click', () =>
      addFlow('employee', (n, p) => SharedTables.addEmployeePin(n, p), () => this.renderEmployeePinsEditor('hcEmployeePinsList'), 'dipendente'));
  },

  promptAdminPin(label, onSuccess) {
    let modal = document.getElementById('adminPinPromptModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'adminPinPromptModal';
      modal.className = 'modal-overlay modal-overlay-centered';
      document.getElementById('app').appendChild(modal);
    }
    modal.innerHTML =
      '<div class="modal-sheet modal-sheet-centered">' +
        '<h3 style="margin:0 0 8px">🔒 ' + this.escapeHTML(label) + '</h3>' +
        '<p style="font-size:14px;color:var(--color-ink-soft);margin:0 0 12px">Serve il PIN di un amministratore o dello chef principale per confermare.</p>' +
        '<input type="password" inputmode="numeric" class="text-input" id="adminPinPromptInput" placeholder="PIN" autocomplete="off">' +
        '<p id="adminPinPromptError" class="hidden" style="font-size:13px;color:var(--color-danger);margin:6px 0 0">PIN non valido.</p>' +
        '<div class="modal-actions">' +
          '<button class="modal-btn-cancel" id="adminPinPromptCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="adminPinPromptConfirm" style="background:var(--color-primary)">Conferma</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    const input = modal.querySelector('#adminPinPromptInput');
    const errorEl = modal.querySelector('#adminPinPromptError');
    input.focus();

    const tryConfirm = async () => {
      const pin = input.value.trim();
      // Il controllo lo fa il server (i PIN non sono più sul dispositivo)
      const r = pin ? await DB.accesso('verifica_capo', { pin }) : null;
      const valid = !!(r && r.ok);
      if (!valid) {
        errorEl.classList.remove('hidden');
        input.value = '';
        input.focus();
        return;
      }
      modal.classList.remove('active');
      onSuccess();
    };
    modal.querySelector('#adminPinPromptConfirm').addEventListener('click', tryConfirm);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryConfirm(); });
    modal.querySelector('#adminPinPromptCancel').addEventListener('click', () => modal.classList.remove('active'));
  },

  /**
   * Più severo di promptAdminPin — SOLO un PIN amministratore vero, mai
   * un PIN cuoco. Usato per dati sensibili (Statistiche) dove "admin o
   * chef" non basta: chiama DB.elevate() direttamente, che già controlla
   * solo gli admin, così questa e l'elevazione restano sempre coerenti
   * tra loro — un solo posto che decide chi è admin vero.
   */
  promptStrictAdminPin(label, onSuccess) {
    let modal = document.getElementById('strictAdminPinPromptModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'strictAdminPinPromptModal';
      modal.className = 'modal-overlay modal-overlay-centered';
      document.getElementById('app').appendChild(modal);
    }
    modal.innerHTML =
      '<div class="modal-sheet modal-sheet-centered">' +
        '<h3 style="margin:0 0 8px">🔒 ' + this.escapeHTML(label) + '</h3>' +
        '<p style="font-size:14px;color:var(--color-ink-soft);margin:0 0 12px">Serve il PIN di un amministratore (non del cuoco) per confermare.</p>' +
        '<input type="password" inputmode="numeric" class="text-input" id="strictAdminPinInput" placeholder="PIN amministratore" autocomplete="off">' +
        '<p id="strictAdminPinError" class="hidden" style="font-size:13px;color:var(--color-danger);margin:6px 0 0">PIN non valido.</p>' +
        '<div class="modal-actions">' +
          '<button class="modal-btn-cancel" id="strictAdminPinCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="strictAdminPinConfirm" style="background:var(--color-primary)">Conferma</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    const input = modal.querySelector('#strictAdminPinInput');
    const errorEl = modal.querySelector('#strictAdminPinError');
    input.focus();

    const tryConfirm = async () => {
      const pin = input.value.trim();
      if (!pin || !(await DB.elevate(pin))) {
        errorEl.classList.remove('hidden');
        input.value = '';
        input.focus();
        return;
      }
      modal.classList.remove('active');
      onSuccess();
    };
    modal.querySelector('#strictAdminPinConfirm').addEventListener('click', tryConfirm);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryConfirm(); });
    modal.querySelector('#strictAdminPinCancel').addEventListener('click', () => modal.classList.remove('active'));
  },

  /**
   * "Ha cambiato camera, o è una persona diversa?" — mostrata quando il
   * nome di un nuovo ospite hotel corrisponde a un soggiorno ancora
   * aperto in un'altra camera. Due bottoni, due esiti diversi, nessuna
   * scelta automatica: è l'unico punto dove serve davvero una persona a
   * decidere, non si può indovinare da soli senza rischiare di sbagliare.
   */
  openRoomChangeCheckModal(guestName, openElsewhere, onChangedRoom, onDifferentPerson) {
    let modal = document.getElementById('roomChangeCheckModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'roomChangeCheckModal';
      modal.className = 'modal-overlay modal-overlay-centered';
      document.getElementById('app').appendChild(modal);
    }
    modal.innerHTML =
      '<div class="modal-sheet modal-sheet-centered">' +
        '<h3 style="margin:0 0 8px">🏨 Stesso ospite?</h3>' +
        '<p style="font-size:14px;color:var(--color-ink-soft);margin:0 0 14px">' +
          this.escapeHTML(guestName) + ' risulta già nella camera ' + this.escapeHTML(openElsewhere.roomNumber) +
          ' fino al ' + this.dateLabel(openElsewhere.departureDate).toLowerCase() + '. Ha cambiato camera, o è una persona diversa?' +
        '</p>' +
        '<div class="modal-actions" style="flex-direction:column;gap:8px">' +
          '<button class="save-btn" id="roomChangeChangedBtn" style="width:100%">Ha cambiato camera</button>' +
          '<button class="btn-secondary" id="roomChangeDifferentBtn" style="width:100%">È una persona diversa</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    modal.querySelector('#roomChangeChangedBtn').addEventListener('click', () => {
      modal.classList.remove('active');
      onChangedRoom();
    });
    modal.querySelector('#roomChangeDifferentBtn').addEventListener('click', () => {
      modal.classList.remove('active');
      onDifferentPerson();
    });
  },

  openBookingDetailView(b) {
    let modal = document.getElementById('bookingDetailModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'bookingDetailModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const { userNotes, isFixedTable } = Bookings.splitNotes(b.notes);
    const hotelInfo = Bookings.getHotelInfo(b);
    const isWorkerMenu = Bookings.isWorkerMenu(b);
    const statusDisplay = this._bookingStatusDisplay(b);
    const isWaitlist = b.status === STATUS.WAITLIST;
    const isTakeaway = b.status === STATUS.TAKEAWAY;

    const rows = [];
    rows.push({ label: 'Quando', value: this.dateLabel(b.date) + ' — ' + b.time + ' (' + (b.service === 'lunch' ? 'Pranzo' : 'Cena') + ')' });
    if (isTakeaway) {
      rows.push({ label: 'Tipo', value: '🥡 Asporto' });
      const items = Bookings.getTakeawayItems(b);
      if (items) rows.push({ label: 'Cosa portare via', value: this.escapeHTML(items) });
    } else {
      rows.push({ label: 'Persone', value: b.people + ' coperti' + (b.highchairs > 0 ? ' · ' + b.highchairs + ' seggioloni' : '') + (b.dogs > 0 ? ' · ' + b.dogs + ' cani' : '') });
    }
    if (!isWaitlist && !isTakeaway) {
      rows.push({ label: 'Tavolo', value: b.tablesAssigned ? 'Tavolo ' + this.escapeHTML(b.tablesAssigned) + (isFixedTable ? ' 🔒' : '') : 'Non ancora assegnato' });
      if (b.zone && b.zone !== 'any') rows.push({ label: 'Zona preferita', value: ZONE_LABELS[b.zone] || b.zone });
    } else if (isWaitlist) {
      rows.push({ label: 'Tavolo', value: 'Lista d\'attesa' });
    }
    if (b.phone) rows.push({ label: 'Telefono', value: '<a href="' + Utils.telLink(b.phone) + '" class="booking-detail-phone">' + this.escapeHTML(b.phone) + '</a>', raw: true });
    if (hotelInfo) {
      rows.push({ label: 'Ospite hotel', value: 'Camera ' + this.escapeHTML(hotelInfo.roomNumber || '?') + ' — ' + (hotelInfo.mealPlan === 'mezza_pensione' ? 'Mezza pensione' : 'Alla carta') });
      const visitNumber = Bookings.getStayVisitNumber(b);
      if (visitNumber) {
        rows.push({ label: 'Soggiorno', value: visitNumber === 1 ? '👋 Prima volta' : '🔁 ' + visitNumber + 'ª volta' });
      }
    }
    if (isWorkerMenu) rows.push({ label: 'Menu', value: '👷 Menu operaio' });
    if (b.intolerances) rows.push({ label: '🍳 Allergie/intolleranze', value: this.escapeHTML(b.intolerances) });
    if (b.specialNeeds) rows.push({ label: '🍳 Esigenze per la cucina', value: this.escapeHTML(b.specialNeeds) });
    if (userNotes) rows.push({ label: '🛎️ Note per la sala', value: this.escapeHTML(userNotes) });

    modal.innerHTML =
      '<div class="modal-sheet booking-detail-sheet">' +
        '<div class="booking-detail-header">' +
          '<div>' +
            '<div class="booking-status-line"><span class="booking-status-dot" style="background:' + statusDisplay.color + '"></span><span class="booking-status-text" style="color:' + statusDisplay.color + '">' + statusDisplay.label + '</span></div>' +
            '<h3 class="booking-detail-name">' + (this.escapeHTML(b.name) || '(senza nome)') + '</h3>' +
          '</div>' +
          '<button type="button" class="icon-btn" id="bookingDetailClose">✕</button>' +
        '</div>' +
        this.dietaryAlertHTML(b) +
        '<div class="booking-detail-rows">' +
          rows.map(r => '<div class="booking-detail-row"><span class="booking-detail-label">' + r.label + '</span><span class="booking-detail-value">' + (r.raw ? r.value : r.value) + '</span></div>').join('') +
        '</div>' +
        (DB.canEdit() ? '<button type="button" class="save-btn" id="bookingDetailEditBtn">Modifica</button>' : '') +
      '</div>';

    modal.classList.add('active');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
    modal.querySelector('#bookingDetailClose').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#bookingDetailEditBtn')?.addEventListener('click', () => {
      modal.classList.remove('active');
      this.openEditForm(b.id);
    });
  },

  // ===== Allergie e intolleranze: avviso per la sala + consenso =====

  /**
   * Riquadro ben visibile "⚠️ Richiesta alimentare da verificare al
   * tavolo" — stringa vuota se la prenotazione non ha allergie.
   * `compact` = versione a etichetta, per le righe strette.
   */
  dietaryAlertHTML(b, compact) {
    const text = Bookings.dietaryAlert(b);
    if (!text) return '';
    return compact
      ? '<span class="tag dietary-alert-tag">⚠️ ' + this.escapeHTML(text) + '</span>'
      : '<div class="dietary-alert" role="note">⚠️ ' + this.escapeHTML(text) + '</div>';
  },

  /** Nel modulo aperto serve ancora il consenso per annotare allergie? */
  _formNeedsAllergyConsent() {
    if (this._formAllergyConsent) return false;
    const id = this.state.editingBookingId;
    if (id && Bookings.hasAllergyConsent(Bookings.getById(id))) return false;
    return true;
  },

  /** Esegue `onOk` subito se il consenso c'è già, altrimenti dopo il pop-up. */
  requestAllergyConsent(onOk) {
    if (!this._formNeedsAllergyConsent()) { onOk(); return; }
    this.openAllergyConsentModal((consent) => {
      this._formAllergyConsent = consent;
      onOk();
    });
  },

  /**
   * POP-UP — ALLERGIE E INTOLLERANZE. Frase da leggere al cliente, casella
   * obbligatoria, CONFERMA (attivo solo con la casella spuntata) / ANNULLA.
   * onConfirm riceve { at, by }: quando e chi ha confermato.
   */
  openAllergyConsentModal(onConfirm, onCancel) {
    let modal = document.getElementById('allergyConsentModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'allergyConsentModal';
      // "bloccante": un tocco fuori non la chiude, serve una scelta esplicita
      modal.className = 'modal-overlay modal-overlay-centered modal-blocking';
      document.getElementById('app').appendChild(modal);
    }
    modal.innerHTML =
      '<div class="modal-sheet modal-sheet-centered allergy-consent-sheet" role="dialog" aria-modal="true" aria-labelledby="allergyConsentTitle">' +
        '<div class="allergy-consent-icon" aria-hidden="true">⚠️</div>' +
        '<h3 id="allergyConsentTitle">Allergie e intolleranze</h3>' +
        '<p class="allergy-consent-lead">Frase da leggere:</p>' +
        '<blockquote class="allergy-consent-question">«' + this.escapeHTML(ALLERGY_CONSENT_QUESTION) + '»</blockquote>' +
        '<label class="allergy-consent-check">' +
          '<input type="checkbox" id="allergyConsentCheck">' +
          '<span>Confermo di aver fornito l\'informazione e ricevuto risposta affermativa.</span>' +
        '</label>' +
        '<div class="modal-actions">' +
          '<button type="button" class="modal-btn-cancel" id="allergyConsentCancel">ANNULLA</button>' +
          '<button type="button" class="modal-btn-confirm" id="allergyConsentConfirm" style="background:var(--color-primary)" disabled>CONFERMA</button>' +
        '</div>' +
      '</div>';
    const check = modal.querySelector('#allergyConsentCheck');
    const confirmBtn = modal.querySelector('#allergyConsentConfirm');
    check.addEventListener('change', () => { confirmBtn.disabled = !check.checked; });
    const close = () => modal.classList.remove('active');
    modal.querySelector('#allergyConsentCancel').addEventListener('click', () => {
      close();
      if (onCancel) onCancel();
    });
    confirmBtn.addEventListener('click', () => {
      if (!check.checked) return; // casella obbligatoria
      close();
      onConfirm({ at: new Date().toISOString(), by: DB.getOperatorWithDevice() || null });
    });
    modal.classList.add('active');
    check.focus();
  },

  openActionsMenu(b, anchorEl) {
    // Rimuovi menu esistente
    document.querySelectorAll('.booking-actions-menu, .booking-actions-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'booking-actions-overlay';

    const menu = document.createElement('div');
    menu.className = 'booking-actions-menu';

    const rect = anchorEl.getBoundingClientRect();
    const margin = 12;
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    // Sceglie di aprirsi sotto o sopra il bottone ⋯ in base a dove c'è più
    // spazio libero, e in ogni caso non supera mai l'altezza visibile —
    // se le voci non ci stanno tutte, scorre invece di tagliarle via.
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    if (spaceBelow >= 260 || spaceBelow >= spaceAbove) {
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.maxHeight = Math.max(150, spaceBelow) + 'px';
    } else {
      menu.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      menu.style.maxHeight = Math.max(150, spaceAbove) + 'px';
    }

    const isEvento = Bookings.isEvento(b);
    const hasPayment = !!Bookings.splitNotes(b.notes).payment;
    menu.innerHTML =
      '<button id="actionEdit">✏️ Modifica prenotazione</button>' +
      '<button id="actionMove">📅 Sposta prenotazione</button>' +
      '<button id="actionDuplicate">📋 Duplica prenotazione</button>' +
      '<button id="actionDuplicateMultiDay">🗓️ Duplica su più giorni</button>' +
      '<button id="actionPayment">💶 ' + (hasPayment ? 'Modifica pagamento' : 'Registra pagamento') + '</button>' +
      '<button id="actionEvento">' + (isEvento ? '🎉 Togli da Eventi' : '🎉 Segna come evento') + '</button>' +
      (b.status !== STATUS.CANCELLED ? '<button id="actionCancel" class="danger">❌ Segna come cancellata</button>' : '') +
      '<button id="actionDelete" class="danger">🗑️ Archivia</button>';

    overlay.addEventListener('click', () => {
      menu.remove(); overlay.remove();
    });

    document.getElementById('app').appendChild(overlay);
    document.getElementById('app').appendChild(menu);

    menu.querySelector('#actionEdit').addEventListener('click', () => {
      menu.remove(); overlay.remove();
      this.openEditForm(b.id);
    });

    menu.querySelector('#actionMove').addEventListener('click', () => {
      menu.remove(); overlay.remove();
      this.openMoveSheet(b);
    });

    menu.querySelector('#actionDuplicate').addEventListener('click', () => {
      menu.remove(); overlay.remove();
      this.openDuplicateSheet(b);
    });

    menu.querySelector('#actionDuplicateMultiDay').addEventListener('click', () => {
      menu.remove(); overlay.remove();
      this.openDuplicateMultiDaySheet(b);
    });

    menu.querySelector('#actionPayment').addEventListener('click', () => {
      menu.remove(); overlay.remove();
      this.openPaymentModal(b);
    });

    menu.querySelector('#actionEvento').addEventListener('click', async () => {
      menu.remove(); overlay.remove();
      this.showSyncIndicator(true);
      await Bookings.toggleEvento(b.id);
      this.showSyncIndicator(false);
      this.toast(isEvento ? 'Tolto dagli eventi' : 'Aggiunto agli eventi 🎉');
      if (this.state.currentScreen === 'list') this.renderList();
      else if (this.state.currentScreen === 'dashboard') this.renderDashboard();
    });

    const cancelBtn = menu.querySelector('#actionCancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        menu.remove(); overlay.remove();
        if (!confirm('Segnare come cancellata la prenotazione di ' + b.name + '?')) return;
        this.showSyncIndicator(true);
        await Bookings.markCancelled(b.id);
        this.showSyncIndicator(false);
        this.toast('Prenotazione cancellata');
        if (this.state.currentScreen === 'list') this.renderList();
        else if (this.state.currentScreen === 'dashboard') this.renderDashboard();
      });
    }

    menu.querySelector('#actionDelete').addEventListener('click', async () => {
      menu.remove(); overlay.remove();
      if (!confirm('Archiviare la prenotazione di ' + b.name + '? Non sarà più visibile in lista, ma resterà consultabile.')) return;
      this.showSyncIndicator(true);
      await Bookings.archive(b.id, DB.getOperatorWithDevice());
      this.showSyncIndicator(false);
      this.toast('Prenotazione archiviata');
      if (this.state.currentScreen === 'list') this.renderList();
    });
  },

  openMoveSheet(b, onMoved) {
    if (!this._confirmIfFixedTable(b)) return;
    let modal = document.getElementById('moveModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'moveModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const zones = SharedTables.getZones();
    let currentZone = (b.zone && zones.includes(b.zone)) ? b.zone : (zones[0] || '');
    let moveService = b.service;
    let moveTime = b.time;
    let moveDate = b.date;
    // I tavoli originali restano selezionati solo se risultano ancora
    // liberi sulla nuova data/servizio — altrimenti si riparte da zero,
    // niente doppie occupazioni copiate in automatico.
    let selectedTables = new Set();

    const tablesFreeOnTarget = (dateISO, serviceKey) => {
      const occupied = new Set();
      Bookings.getByDateAndService(dateISO, serviceKey)
        .filter(bk => bk.id !== b.id && bk.status !== STATUS.CANCELLED && bk.status !== STATUS.COMPLETED && bk.status !== STATUS.NOSHOW)
        .forEach(bk => { if (bk.tablesAssigned) bk.tablesAssigned.split(',').forEach(t => occupied.add(t.trim())); });
      return occupied;
    };

    const resetTablesForTarget = () => {
      const occupied = tablesFreeOnTarget(moveDate, moveService);
      const original = b.tablesAssigned ? b.tablesAssigned.split(',').map(t => t.trim()).filter(Boolean) : [];
      const stillFree = original.every(t => !occupied.has(t) && !SharedTables.isBlocked(t, moveDate, moveService));
      selectedTables = new Set(stillFree ? original : []);
    };
    resetTablesForTarget();

    const render = () => {
      const slotList = Slots.generateSlotsForService(moveService);
      const slotsHTML = slotList.map(s =>
        '<button type="button" class="slot-pill ' + (s === moveTime ? 'active' : '') + '" data-time="' + s + '">' + s + '</button>'
      ).join('');

      const occupied = tablesFreeOnTarget(moveDate, moveService);
      const zoneTabs = zones.map(z =>
        '<button type="button" class="piantina-zone-tab' + (z === currentZone ? ' active' : '') + '" data-zone="' + this.escapeHTML(z) + '">' + this.escapeHTML(z) + '</button>'
      ).join('');
      const tablesInZone = SharedTables.getTablesForZone(currentZone);
      const tablesHTML = tablesInZone.map(t => {
        const isSelected = selectedTables.has(t);
        const isBlocked = SharedTables.isBlocked(t, moveDate, moveService);
        const isOccupied = occupied.has(t) && !isSelected;
        const disabled = (isBlocked || isOccupied) && !isSelected;
        return '<button type="button" class="form-table-pill ' + (isSelected ? 'selected' : '') +
          (disabled ? ' occupied-pill' : '') + '" data-table="' + this.escapeHTML(t) + '"' +
          (disabled ? ' disabled style="opacity:0.4;cursor:not-allowed;text-decoration:line-through"' : '') +
          '>' + this.escapeHTML(t) + '</button>';
      }).join('');

      modal.innerHTML =
        '<div class="modal-sheet move-sheet">' +
          '<h3>Sposta prenotazione</h3>' +
          '<p style="font-size:13px;color:var(--color-ink-soft)">' + this.escapeHTML(b.name) + ' · ' + b.people + ' pers.</p>' +
          '<div class="field-group"><label class="field-label">Nuova data</label>' +
            '<input type="date" class="text-input" id="moveDate" value="' + moveDate + '"></div>' +
          '<div class="field-group"><label class="field-label">Servizio</label>' +
            '<div class="service-options">' +
              '<button class="service-btn ' + (moveService === 'lunch' ? 'active' : '') + '" data-service="lunch">Pranzo</button>' +
              '<button class="service-btn ' + (moveService === 'dinner' ? 'active' : '') + '" data-service="dinner">Cena</button>' +
            '</div></div>' +
          '<div class="field-group"><label class="field-label">Orario</label>' +
            '<div class="slot-grid" id="moveSlotGrid">' + slotsHTML + '</div></div>' +
          '<div class="field-group"><label class="field-label">Tavolo</label>' +
            (zones.length > 1 ? '<div class="piantina-zone-tabs">' + zoneTabs + '</div>' : '') +
            '<div class="form-table-grid">' + tablesHTML + '</div>' +
            (selectedTables.size === 0 ? '<p style="font-size:12px;color:var(--color-danger);margin-top:6px">Nessun tavolo libero preselezionato — sceglilo qui sopra.</p>' : '') +
          '</div>' +
          '<div class="modal-actions">' +
            '<button class="modal-btn-cancel" id="moveCancelBtn">Annulla</button>' +
            '<button class="modal-btn-confirm" id="moveSaveBtn" style="background:var(--color-primary)" ' +
              (selectedTables.size === 0 ? 'disabled' : '') + '>Sposta</button>' +
          '</div>' +
        '</div>';

      modal.querySelectorAll('#moveSlotGrid .slot-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          moveTime = pill.dataset.time;
          render();
        });
      });
      modal.querySelectorAll('.service-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          moveService = btn.dataset.service;
          moveTime = Slots.generateSlotsForService(moveService)[0] || moveTime;
          resetTablesForTarget();
          render();
        });
      });
      modal.querySelector('#moveDate').addEventListener('change', (e) => {
        if (!e.target.value) return;
        moveDate = e.target.value;
        resetTablesForTarget();
        render();
      });
      modal.querySelectorAll('.piantina-zone-tab').forEach(tab => {
        tab.addEventListener('click', () => { currentZone = tab.dataset.zone; render(); });
      });
      modal.querySelectorAll('.form-table-grid .form-table-pill:not([disabled])').forEach(pill => {
        pill.addEventListener('click', () => {
          const t = pill.dataset.table;
          if (selectedTables.has(t)) selectedTables.delete(t); else selectedTables.add(t);
          render();
        });
      });

      modal.querySelector('#moveCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
      const saveBtn = modal.querySelector('#moveSaveBtn');
      if (selectedTables.size > 0) {
        saveBtn.addEventListener('click', async () => {
          modal.classList.remove('active');
          this.showSyncIndicator(true);
          const newTablesStr = Array.from(selectedTables).join(', ');
          await Bookings.update(b.id, {
            ...b, date: moveDate, service: moveService, time: moveTime,
            tablesAssigned: newTablesStr,
            specialNeeds: b.special_needs || b.specialNeeds,
          });
          // Chi era in attesa di ereditare IL tavolo di questa prenotazione
          // (doppio turno) la segue sul tavolo nuovo — solo se resta lo
          // stesso giorno/servizio: se si sposta anche su un altro giorno,
          // la relazione non ha più senso e resta giustamente spezzata.
          if (moveDate === b.date && moveService === b.service && b.tablesAssigned) {
            await Bookings.dragPairedBookingAlong(b.id, b.tablesAssigned, newTablesStr, moveDate, moveService);
          }
          this.showSyncIndicator(false);
          this.toast('Prenotazione spostata ✓');
          if (this.state.currentScreen === 'list') this.renderList();
          if (onMoved) onMoved();
        });
      }
    };

    render();
    modal.classList.add('active');
  },

  /**
   * Duplica una prenotazione: apre il form vero precompilato, con la data
   * di default a domani (modificabile lì, come qualsiasi altro campo).
   * Passa dallo stesso identico picker tavoli di una prenotazione nuova —
   * obbligatorio, e se il tavolo dell'originale è occupato quel giorno
   * propone di spostare l'altra prenotazione o avvisa e permette di forzare.
   */
  /**
   * Registra un pagamento su una prenotazione — pensato soprattutto per i
   * tavoli "amico/prezzo di costo" senza scontrino: un modo per far
   * risultare che quel tavolo è stato davvero incassato, quanto e come.
   * Finisce nelle statistiche (Impostazioni → Statistiche).
   */
  openPaymentModal(b) {
    if (!this._confirmIfNotNow(b.date, b.service, 'un pagamento')) return;
    let modal = document.getElementById('paymentModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'paymentModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const existing = Bookings.splitNotes(b.notes).payment;

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>' + (existing ? 'Modifica pagamento' : 'Registra pagamento') + '</h3>' +
        '<p style="font-size:13px;color:var(--color-ink-soft);margin-bottom:14px">' + this.escapeHTML(b.name) + ' · ' + b.people + ' pers.</p>' +
        '<div class="field-group"><label class="field-label">Importo (€)</label>' +
          '<input type="number" min="0" step="0.5" class="text-input" id="paymentAmount" placeholder="0.00" value="' + (existing ? existing.amount : '') + '"></div>' +
        '<div class="field-group" style="margin-top:12px"><label class="field-label">Metodo</label>' +
          '<div class="piantina-style-group" id="paymentMethodGroup">' +
            ['contanti', 'carta', 'altro'].map(m =>
              '<button type="button" class="piantina-style-btn' + (existing && existing.method === m ? ' active' : '') + '" data-method="' + m + '">' +
                m.charAt(0).toUpperCase() + m.slice(1) +
              '</button>'
            ).join('') +
          '</div></div>' +
        (existing ? '<a href="#" class="delete-link" id="paymentRemoveBtn">Rimuovi pagamento</a>' : '') +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="paymentCancelBtn">Annulla</button>' +
          '<button class="modal-btn-confirm" id="paymentConfirmBtn" style="background:var(--color-primary)">' + (existing ? 'Salva modifiche' : 'Salva') + '</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');
    let method = existing ? existing.method : 'contanti';
    modal.querySelectorAll('#paymentMethodGroup .piantina-style-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.method === method);
      btn.addEventListener('click', () => {
        method = btn.dataset.method;
        modal.querySelectorAll('#paymentMethodGroup .piantina-style-btn').forEach(x => x.classList.toggle('active', x.dataset.method === method));
      });
    });

    modal.querySelector('#paymentCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
    if (existing) {
      modal.querySelector('#paymentRemoveBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!confirm('Rimuovere il pagamento registrato di ' + existing.amount.toFixed(2) + '€?')) return;
        modal.classList.remove('active');
        this.showSyncIndicator(true);
        await Bookings.removePayment(b.id);
        this.showSyncIndicator(false);
        this.toast('Pagamento rimosso ✓');
        if (this.state.currentScreen === 'list') this.renderList();
      });
    }
    modal.querySelector('#paymentConfirmBtn').addEventListener('click', async () => {
      const amount = Number(modal.querySelector('#paymentAmount').value);
      if (!amount || amount <= 0) { this.toast('Inserisci un importo valido', 'warning'); return; }
      modal.classList.remove('active');
      this.showSyncIndicator(true);
      await Bookings.recordPayment(b.id, amount, method, DB.getOperatorWithDevice());
      this.showSyncIndicator(false);
      this.toast(existing ? 'Pagamento aggiornato ✓' : 'Pagamento registrato ✓');
      if (this.state.currentScreen === 'list') this.renderList();
    });
  },

  openDuplicateSheet(b) {
    const tomorrow = this.shiftDate(b.date, 1);
    this.openNewForm({
      formTitle: 'Duplica prenotazione',
      name: b.name,
      phone: b.phone,
      people: b.people,
      date: tomorrow,
      time: b.time,
      service: b.service,
      zone: b.zone,
      dogs: b.dogs,
      highchairs: b.highchairs || 0,
      intolerances: b.intolerances,
      // il consenso già registrato sull'originale vale anche per la copia
      // (se l'originale non ce l'ha, il pop-up si apre al salvataggio)
      allergyConsent: b.consenso_allergie_il ? { at: b.consenso_allergie_il, by: b.consenso_allergie_da || null } : null,
      specialNeeds: b.specialNeeds || b.special_needs || '',
      // Solo la nota vera — una prenotazione duplicata è nuova, non deve
      // ereditare marcatori come "Evento" o un pagamento già registrato.
      notes: Bookings.splitNotes(b.notes).userNotes,
      tablesAssigned: b.tablesAssigned,
      customerId: Bookings.getCustomerId(b),
    });
  },

  /**
   * Duplica la stessa prenotazione su più giorni in un colpo solo — es. un
   * cliente che prenota 4 giorni consecutivi, o lo stesso giorno per 4
   * settimane. Un solo tavolo scelto per tutti i giorni (l'occupazione
   * cambia giorno per giorno, quindi il controllo si fa alla conferma:
   * i giorni dove il tavolo risulta libero si creano, gli altri si
   * segnalano chiaramente per essere gestiti uno a uno con il form normale.
   */
  openDuplicateMultiDaySheet(b) {
    let modal = document.getElementById('multiDayModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'multiDayModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    let dates = [this.shiftDate(b.date, 1)];
    let service = b.service;
    let time = b.time;
    const zones = SharedTables.getZones();
    let currentZone = (b.zone && zones.includes(b.zone)) ? b.zone : (zones[0] || '');
    const selectedTables = new Set(
      b.tablesAssigned ? b.tablesAssigned.split(',').map(t => t.trim()).filter(Boolean) : []
    );

    const render = () => {
      const sortedDates = [...dates].sort();
      const dateChips = sortedDates.map(d =>
        '<span class="multiday-chip" data-date="' + d + '">' + Utils.formatDateShort(d) +
          '<button type="button" class="multiday-chip-remove" data-date="' + d + '">✕</button></span>'
      ).join('');

      const slotList = Slots.generateSlotsForService(service);
      const slotsHTML = slotList.map(s =>
        '<button type="button" class="slot-pill ' + (s === time ? 'active' : '') + '" data-time="' + s + '">' + s + '</button>'
      ).join('');

      const zoneTabs = zones.map(z =>
        '<button type="button" class="piantina-zone-tab' + (z === currentZone ? ' active' : '') + '" data-zone="' + this.escapeHTML(z) + '">' + this.escapeHTML(z) + '</button>'
      ).join('');
      const tablesInZone = SharedTables.getTablesForZone(currentZone);
      const tablesHTML = tablesInZone.map(t =>
        '<button type="button" class="form-table-pill ' + (selectedTables.has(t) ? 'selected' : '') + '" data-table="' + this.escapeHTML(t) + '">' + this.escapeHTML(t) + '</button>'
      ).join('');

      modal.innerHTML =
        '<div class="modal-sheet move-sheet">' +
          '<h3>Duplica su più giorni</h3>' +
          '<p style="font-size:13px;color:var(--color-ink-soft);margin-bottom:12px">' + this.escapeHTML(b.name) + ' · ' + b.people + ' pers.</p>' +

          '<div class="field-group"><label class="field-label">Aggiungi rapidamente</label>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
              '<button type="button" class="piantina-style-btn" id="mdPresetConsecutive">📅 Giorni consecutivi</button>' +
              '<button type="button" class="piantina-style-btn" id="mdPresetWeekly">🔁 Stesso giorno ogni settimana</button>' +
            '</div></div>' +

          '<div class="field-group"><label class="field-label">Giorni selezionati (' + dates.length + ')</label>' +
            '<div class="multiday-chips">' + (dateChips || '<span style="font-size:12px;color:var(--color-ink-soft)">Nessuno — aggiungine uno</span>') + '</div>' +
            '<div style="display:flex;gap:8px;margin-top:8px;align-items:center">' +
              '<input type="date" class="text-input" id="mdAddDate" style="flex:1">' +
              '<button type="button" class="modal-btn-confirm" id="mdAddDateBtn" style="background:var(--color-primary);white-space:nowrap">+ Aggiungi</button>' +
            '</div></div>' +

          '<div class="field-group"><label class="field-label">Servizio</label>' +
            '<div class="service-options">' +
              '<button type="button" class="service-btn ' + (service === 'lunch' ? 'active' : '') + '" data-service="lunch">Pranzo</button>' +
              '<button type="button" class="service-btn ' + (service === 'dinner' ? 'active' : '') + '" data-service="dinner">Cena</button>' +
            '</div></div>' +
          '<div class="field-group"><label class="field-label">Orario (uguale per tutti i giorni)</label>' +
            '<div class="slot-grid">' + slotsHTML + '</div></div>' +

          '<div class="field-group"><label class="field-label">Tavolo (uguale per tutti i giorni, se libero)</label>' +
            (zones.length > 1 ? '<div class="piantina-zone-tabs">' + zoneTabs + '</div>' : '') +
            '<div class="form-table-grid">' + tablesHTML + '</div></div>' +

          '<div class="modal-actions">' +
            '<button class="modal-btn-cancel" id="mdCancelBtn">Annulla</button>' +
            '<button class="modal-btn-confirm" id="mdConfirmBtn" style="background:var(--color-primary)">Crea ' + dates.length + ' prenotazioni</button>' +
          '</div>' +
        '</div>';

      modal.querySelector('#mdCancelBtn').addEventListener('click', () => modal.classList.remove('active'));

      modal.querySelector('#mdPresetConsecutive').addEventListener('click', () => {
        const n = Number(prompt('Quanti giorni consecutivi, a partire da domani?', '4')) || 0;
        if (n <= 0) return;
        dates = [];
        for (let i = 1; i <= n; i++) dates.push(this.shiftDate(b.date, i));
        render();
      });
      modal.querySelector('#mdPresetWeekly').addEventListener('click', () => {
        const n = Number(prompt('Per quante settimane, a partire dalla prossima?', '4')) || 0;
        if (n <= 0) return;
        dates = [];
        for (let i = 1; i <= n; i++) dates.push(this.shiftDate(b.date, i * 7));
        render();
      });

      modal.querySelectorAll('.multiday-chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          dates = dates.filter(d => d !== btn.dataset.date);
          render();
        });
      });
      modal.querySelector('#mdAddDateBtn').addEventListener('click', () => {
        const val = modal.querySelector('#mdAddDate').value;
        if (val && !dates.includes(val)) { dates.push(val); render(); }
      });

      modal.querySelectorAll('.service-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          service = btn.dataset.service;
          time = Slots.generateSlotsForService(service)[0] || time;
          render();
        });
      });
      modal.querySelectorAll('.slot-pill').forEach(pill => {
        pill.addEventListener('click', () => { time = pill.dataset.time; render(); });
      });
      modal.querySelectorAll('.piantina-zone-tab').forEach(tab => {
        tab.addEventListener('click', () => { currentZone = tab.dataset.zone; render(); });
      });
      modal.querySelectorAll('.form-table-grid .form-table-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const t = pill.dataset.table;
          if (selectedTables.has(t)) selectedTables.delete(t); else selectedTables.add(t);
          render();
        });
      });

      modal.querySelector('#mdConfirmBtn').addEventListener('click', async () => {
        if (dates.length === 0) { this.toast('Aggiungi almeno un giorno', 'warning'); return; }
        if (selectedTables.size === 0) { this.toast('Seleziona un tavolo', 'warning'); return; }
        // Le allergie si copiano sui nuovi giorni solo con il consenso:
        // quello già registrato sulla prenotazione originale, oppure (per
        // le prenotazioni più vecchie, senza registro) chiesto adesso.
        let mdConsent = b.consenso_allergie_il ? { at: b.consenso_allergie_il, by: b.consenso_allergie_da || null } : null;
        if (b.intolerances && !mdConsent) {
          mdConsent = await new Promise(res => this.openAllergyConsentModal(c => res(c), () => res(null)));
          if (!mdConsent) { this.toast('Senza conferma del consenso le allergie non si copiano: duplicazione annullata', 'warning'); return; }
        }
        modal.classList.remove('active');
        this.showSyncIndicator(true);

        const tablesStr = Array.from(selectedTables).join(', ');
        let created = 0;
        // Giorni in cui il tavolo scelto era già occupato: la prenotazione
        // si salva comunque (il cliente non deve sparire), semplicemente
        // senza tavolo assegnato — resta da scegliere a mano per quel giorno.
        const needsTable = [];

        for (const d of dates) {
          const occupied = new Set();
          Bookings.getByDateAndService(d, service)
            .filter(bk => bk.status !== STATUS.CANCELLED && bk.status !== STATUS.COMPLETED && bk.status !== STATUS.NOSHOW)
            .forEach(bk => { if (bk.tablesAssigned) bk.tablesAssigned.split(',').forEach(t => occupied.add(t.trim())); });
          const hasConflict = Array.from(selectedTables).some(t => occupied.has(t) || SharedTables.isBlocked(t, d, service));
          if (hasConflict) needsTable.push(d);

          const customerId = Bookings.getCustomerId(b);
          const userNote = Bookings.splitNotes(b.notes).userNotes;
          const duplicatedNotes = [userNote, customerId ? '👤cliente:' + customerId : ''].filter(Boolean).join(' · ');
          await Bookings.create({
            name: b.name, phone: b.phone, people: b.people,
            date: d, time, service, zone: b.zone,
            dogs: b.dogs, highchairs: b.highchairs || 0,
            intolerances: b.intolerances,
            allergyConsent: mdConsent,
            specialNeeds: b.specialNeeds || b.special_needs || '',
            notes: duplicatedNotes, status: STATUS.CONFIRMED,
            tablesAssigned: hasConflict ? null : tablesStr,
          });
          created++;
        }

        this.showSyncIndicator(false);
        if (needsTable.length === 0) {
          this.toast(created + ' prenotazioni create ✓');
        } else {
          this.toast(created + ' create — per ' + needsTable.length + ' giorni il tavolo era occupato, assegna a mano: ' +
            needsTable.map(d => Utils.formatDateShort(d)).join(', '), 'warning');
        }
        if (this.state.currentScreen === 'list') this.renderList();
        else this.renderDashboard();
      });
    };

    render();
    modal.classList.add('active');
  },

  openTablePicker(bookingId, currentTables) {
    const cfg = Config.load();
    const selected = new Set(currentTables ? currentTables.split(',').map(t => t.trim()).filter(Boolean) : []);

    // Calcola tavoli già occupati da altre prenotazioni (stesso giorno e servizio)
    const booking = Bookings.getById(bookingId);
    if (!this._confirmIfFixedTable(booking)) return;
    const occupied = new Set();
    if (booking) {
      Bookings.getByDateAndService(booking.date, booking.service)
        .filter(b => b.id !== bookingId && b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW)
        .forEach(b => {
          if (b.tablesAssigned) b.tablesAssigned.split(',').forEach(t => occupied.add(t.trim()));
        });
    }

    let modal = document.getElementById('tablePickerModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tablePickerModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const zt = SharedTables.getZoneTavoli();
    const zones = SharedTables.getZones();

    const renderGroup = (label, tables) =>
      '<div class="table-picker-group">' +
        '<div class="table-picker-label">' + label + '</div>' +
        '<div class="table-picker-grid">' +
          tables.map(t => {
            const isSelected = selected.has(t);
            const isOccupied = occupied.has(t) && !isSelected;
            return '<button class="table-pill' +
              (isSelected ? ' selected' : '') +
              (isOccupied ? ' occupied-pill' : '') +
              '" data-table="' + t + '" ' +
              (isOccupied ? 'title="Già occupato"' : '') +
              '>' + t + '</button>';
          }).join('') +
        '</div>' +
      '</div>';

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>Assegna tavolo</h3>' +
        '<p style="font-size:13px;color:var(--color-ink-soft);margin-bottom:12px">Tocca per selezionare uno o più tavoli.</p>' +
        zones.map(zone => renderGroup(zone, zt[zone] || [])).join('') +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="tablePickerCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="tablePickerSave" style="background:var(--color-primary)">Salva</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');

    modal.querySelectorAll('.table-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const t = pill.dataset.table;
        if (selected.has(t)) { selected.delete(t); pill.classList.remove('selected'); }
        else { selected.add(t); pill.classList.add('selected'); }
      });
    });

    modal.querySelector('#tablePickerCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#tablePickerSave').addEventListener('click', async () => {
      const tableStr = Array.from(selected).join(', ') || null;
      modal.classList.remove('active');
      this.showSyncIndicator(true);
      await Bookings.assignTables(bookingId, tableStr);
      // Stessa regola degli altri spostamenti: chi era in attesa di
      // ereditare il tavolo di questa prenotazione la segue sul tavolo nuovo.
      if (booking && currentTables && tableStr) {
        await Bookings.dragPairedBookingAlong(bookingId, currentTables, tableStr, booking.date, booking.service);
      }
      this.showSyncIndicator(false);
      this.toast(tableStr ? 'Tavolo ' + tableStr + ' assegnato ✓' : 'Tavolo rimosso');
      if (this.state.currentScreen === 'list') this.renderList();
      if (this.state.currentScreen === 'search') this.renderSearch(document.getElementById('searchInput').value);
    });
  },

  escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // RICERCA
  renderSearch(query) {
    const container = document.getElementById('searchResults');
    if (!query.trim()) { container.innerHTML = ''; return; }
    const results = Bookings.search(query);
    this.renderBookingRows('searchResults', results, {
      emptyIcon: '🔍', emptyTitle: 'Nessun risultato', emptyText: 'Prova con un altro nome, telefono o data.',
    });
  },

  // FORM
  /**
   * Apre il form nuova prenotazione. Se il dispositivo è quello etichettato
   * (il tablet condiviso — vale anche se qualcuno ci si logga con la
   * password personale), chiede prima "chi sei", per non sbagliare mai
   * l'attribuzione anche quando il tablet passa di mano più volte a servizio.
   */
  openNewForm(overrides) {
    if (DB.getDeviceLabel() && DB.canEdit()) {
      this.openOperatorPicker(false, {
        title: 'Chi prende questa prenotazione?',
        subtitle: 'Da ' + DB.getDeviceLabel() + '.',
        onConfirm: () => this._openNewFormNow(overrides),
      });
      return;
    }
    this._openNewFormNow(overrides);
  },

  _openNewFormNow(overrides) {
    overrides = overrides || {};
    this.state.editingBookingId = null;
    this._formAllergyConsent = overrides.allergyConsent || null;
    this._formZoneClosureOverride = null;
    this.state.formZone = overrides.zone || 'any';
    this.state.formStatus = STATUS.CONFIRMED;
    document.getElementById('formTitle').textContent = overrides.formTitle || 'Nuova prenotazione';
    document.getElementById('statusFieldGroup').classList.add('hidden');
    document.getElementById('deleteLink').classList.add('hidden');
    document.getElementById('fName').value = overrides.name || '';
    {
      const { prefix, number } = this.splitPhoneForForm(overrides.phone || '');
      document.getElementById('fPhonePrefix').value = prefix;
      document.getElementById('fPhone').value = number;
    }
    document.getElementById('fIntolerances').value = overrides.intolerances || '';
    document.getElementById('fSpecialNeeds').value = overrides.specialNeeds || '';
    document.getElementById('fNotes').value = overrides.notes || '';
    this.refreshQuickFieldState('fIntolerancesChip', 'fIntolerancesWrap', 'fIntolerances');
    this.refreshQuickFieldState('fSpecialNeedsChip', 'fSpecialNeedsWrap', 'fSpecialNeeds');
    this.refreshQuickFieldState('fNotesChip', 'fNotesWrap', 'fNotes');
    this.state.formSharedTableDecision = null;
    this.setPeopleValue(overrides.people || 2);
    this.setDogsValue(overrides.dogs || 0);
    this.setHighchairsValue(overrides.highchairs || 0);
    document.getElementById('fIsWaitlist').checked = false;
    document.getElementById('fIsTakeaway').checked = false;
    document.getElementById('fTakeawayItems').value = '';
    document.getElementById('takeawayFields').classList.add('hidden');
    document.getElementById('fIsFixedTable').checked = false;
    document.getElementById('fIsWorkerMenu').checked = false;
    document.getElementById('fIsHotelGuest').checked = false;
    document.getElementById('fRoomNumber').value = '';
    document.getElementById('fDepartureDate').value = '';
    document.getElementById('hotelVisitHint').classList.add('hidden');
    document.getElementById('hotelGuestFields').classList.add('hidden');
    document.querySelectorAll('#fMealPlanToggle button').forEach(btn => btn.classList.toggle('active', btn.dataset.plan === 'mezza_pensione'));
    // Una duplicazione eredita il cliente collegato (probabilmente la
    // stessa persona, solo un altro giorno) — una prenotazione davvero
    // nuova invece parte senza nessuno collegato.
    this.state.formCustomerId = overrides.customerId || null;
    this.renderCustomerLinkBox();
    document.getElementById('fPhoneLabel').textContent = 'Telefono';
    document.getElementById('fIsEvento').checked = false;
    document.getElementById('fEventoMenu').value = '';
    document.getElementById('fEventoVino').value = '';
    document.getElementById('fEventoRichieste').value = '';
    document.getElementById('fEventoCosto').value = '';
    document.getElementById('fEventoPagamento').value = '';
    document.getElementById('eventoDetailsFields').classList.add('hidden');
    if (overrides.name) this.expandOptional(); else this.collapseOptional();
    const date = overrides.date || this.state.selectedDate || Utils.todayISO();
    const service = overrides.service || this.state.selectedService || Utils.currentService();
    document.getElementById('fDate').value = date;
    this.updateDateWeekdayLabel();
    this.setFormService(service);
    // Il tavolo dell'originale è solo un suggerimento di partenza — se quel
    // giorno è occupato, il picker si comporta esattamente come per una
    // prenotazione nuova (propone di spostare l'altra o avvisa e permette di forzare).
    this._formTable = null;
    this._formTableSet = new Set();
    this.updateFormTableSelected();
    this.populateZoneOptions();
    this.setFormZone(this.state.formZone);
    // Se sto duplicando, apre il picker già sulla zona vera dove si trovava
    // il tavolo originale, invece di ripartire sempre dalla prima zona.
    if (overrides.tablesAssigned) {
      const wantedSet = new Set(overrides.tablesAssigned.split(',').map(t => t.trim()).filter(Boolean));
      this.state.formTableZone = this._detectTableZone(wantedSet) || SharedTables.getZones()[0] || '';
    } else {
      this.state.formTableZone = SharedTables.getZones()[0] || '';
    }
    this.populateSlotGrid();
    this.populateFormTablePicker();
    if (overrides.time) this.selectSlot(overrides.time);
    else this.autoSelectFirstAvailableSlot();
    if (overrides.tablesAssigned) {
      this._preselectSuggestedTables(overrides.tablesAssigned, date, service);
    }
    this.updateSaveButtonState();
    this.showScreen('form');
  },

  /**
   * Prova a preselezionare i tavoli di una prenotazione duplicata. Solo per
   * i tavoli che risultano davvero liberi in quel giorno/servizio — se sono
   * occupati non forza nulla, resta la scelta manuale (stessa logica di
   * sempre: tocchi il tavolo occupato e il picker propone di spostarlo).
   */
  _preselectSuggestedTables(tablesAssigned, date, service) {
    const wanted = tablesAssigned.split(',').map(t => t.trim()).filter(Boolean);
    const occupied = new Set();
    Bookings.getByDateAndService(date, service)
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW)
      .forEach(b => { if (b.tablesAssigned) b.tablesAssigned.split(',').forEach(t => occupied.add(t.trim())); });
    wanted.forEach(t => {
      if (!occupied.has(t) && !SharedTables.isBlocked(t, date, service)) this._formTableSet.add(t);
    });
    if (this._formTableSet.size > 0) {
      this._formTable = Array.from(this._formTableSet).join(', ');
      this.updateFormTableSelected();
      this.populateFormTablePicker();
      this.updateSaveButtonState();
    }
  },

  /**
   * Trova in quale zona vera della piantina si trova un tavolo già
   * assegnato — usato per aprire il picker già sulla zona giusta invece di
   * ripartire sempre dalla prima, sia in modifica che duplicando.
   */
  _detectTableZone(tableSet) {
    if (!tableSet || tableSet.size === 0) return null;
    const zt = SharedTables.getZoneTavoli();
    const firstTable = Array.from(tableSet)[0];
    return SharedTables.getZones().find(z => (zt[z] || []).includes(firstTable)) || null;
  },

  openEditForm(bookingId) {
    const b = Bookings.getById(bookingId);
    if (!b) return;
    this.state.editingBookingId = bookingId;
    this._formAllergyConsent = null;
    this._formZoneClosureOverride = null;
    this.state.formZone = b.zone;
    this.state.formStatus = b.status;
    document.getElementById('formTitle').textContent = 'Modifica prenotazione';
    document.getElementById('statusFieldGroup').classList.remove('hidden');
    document.getElementById('deleteLink').classList.remove('hidden');
    document.getElementById('fName').value = b.name;
    {
      const { prefix, number } = this.splitPhoneForForm(b.phone);
      document.getElementById('fPhonePrefix').value = prefix;
      document.getElementById('fPhone').value = number;
    }
    document.getElementById('fIsWaitlist').checked = (b.status === STATUS.WAITLIST);
    {
      const isTakeaway = b.status === STATUS.TAKEAWAY;
      document.getElementById('fIsTakeaway').checked = isTakeaway;
      document.getElementById('takeawayFields').classList.toggle('hidden', !isTakeaway);
      document.getElementById('fTakeawayItems').value = isTakeaway ? (Bookings.getTakeawayItems(b) || '') : '';
    }
    document.getElementById('fIsFixedTable').checked = Bookings.isFixedTable(b);
    document.getElementById('fIsWorkerMenu').checked = Bookings.isWorkerMenu(b);
    this.refreshWorkerMenuHint(Bookings.isWorkerMenu(b));
    this.state.formCustomerId = Bookings.getCustomerId(b);
    this.renderCustomerLinkBox();
    {
      const hotelInfo = Bookings.getHotelInfo(b);
      document.getElementById('fIsHotelGuest').checked = !!hotelInfo;
      document.getElementById('fRoomNumber').value = hotelInfo ? hotelInfo.roomNumber : '';
      document.getElementById('fDepartureDate').value = hotelInfo && hotelInfo.departureDate ? hotelInfo.departureDate : '';
      document.getElementById('hotelGuestFields').classList.toggle('hidden', !hotelInfo);
      document.querySelectorAll('#fMealPlanToggle button').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.plan === (hotelInfo ? hotelInfo.mealPlan : 'mezza_pensione'))
      );
      this.refreshHotelVisitHint();
    }
    document.getElementById('fPhoneLabel').textContent = (b.status === STATUS.WAITLIST) ? 'Telefono (obbligatorio)' : 'Telefono';
    document.getElementById('fIntolerances').value = b.intolerances;
    document.getElementById('fSpecialNeeds').value = b.specialNeeds || '';
    // Solo la nota vera nel campo modificabile — le tracce di sistema e i
    // marcatori (evento, pagamento) restano fuori e si preservano da soli
    // al salvataggio, invece di rischiare di sparire modificando il testo.
    document.getElementById('fNotes').value = Bookings.splitNotes(b.notes).userNotes;
    this.refreshQuickFieldState('fIntolerancesChip', 'fIntolerancesWrap', 'fIntolerances');
    this.refreshQuickFieldState('fSpecialNeedsChip', 'fSpecialNeedsWrap', 'fSpecialNeeds');
    this.refreshQuickFieldState('fNotesChip', 'fNotesWrap', 'fNotes');
    {
      const { isEvento, eventoDetails, isProvisional } = Bookings.splitNotes(b.notes);
      document.getElementById('fIsEvento').checked = isEvento;
      document.getElementById('fEventoMenu').value = (eventoDetails && eventoDetails.menu) || '';
      document.getElementById('fEventoVino').value = (eventoDetails && eventoDetails.vino) || '';
      document.getElementById('fEventoRichieste').value = (eventoDetails && eventoDetails.richieste) || '';
      document.getElementById('fEventoCosto').value = (eventoDetails && eventoDetails.costo) || '';
      document.getElementById('fEventoPagamento').value = (eventoDetails && eventoDetails.statoPagamento) || '';
      document.getElementById('eventoDetailsFields').classList.toggle('hidden', !isEvento);
    }
    this.state.formSharedTableDecision = null;
    this.setPeopleValue(b.people);
    this.setDogsValue(b.dogs);
    this.setHighchairsValue(b.highchairs || 0);
    // In modifica mostra sempre i campi opzionali
    this.expandOptional();
    document.getElementById('fDate').value = b.date;
    this.updateDateWeekdayLabel();
    this.setFormService(b.service);
    this._formTable = b.tablesAssigned || null;
    this._formTableSet = new Set(b.tablesAssigned ? b.tablesAssigned.split(',').map(t => t.trim()).filter(Boolean) : []);
    this.updateFormTableSelected();
    this.populateZoneOptions();
    this.setFormZone(b.zone);
    // Apre il picker già sulla zona vera della piantina dove si trova il
    // tavolo assegnato, invece di ripartire sempre dalla prima zona.
    this.state.formTableZone = this._detectTableZone(this._formTableSet) || SharedTables.getZones()[0] || '';
    this.populateSlotGrid();
    this.populateFormTablePicker();
    this.selectSlot(b.time, {skipFullCheck: true});
    this.renderStatusOptions();
    this.updateSaveButtonState();
    this.showScreen('form');
  },

  setFormService(serviceKey) {
    this._formService = serviceKey;
    document.querySelectorAll('#formServiceOptions .service-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.service === serviceKey);
    });
    this.populateSlotGrid();
    this.updateFormTablesHint();
  },

  setFormZone(zone) {
    this.state.formZone = zone;
    document.querySelectorAll('#formZoneOptions .zone-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.zone === zone);
    });
    // Cliente che vuole stare all'esterno: propone da sola la zona giusta
    // in piantina invece di lasciarla scegliere a mano — cerca tra le zone
    // configurate quella che assomiglia a "giardino" o "gazebo" (non
    // nomi fissi nel codice: segue qualunque nome abbia dato il
    // ristorante alle sue zone esterne).
    if (zone === 'outdoor') {
      const zones = SharedTables.getZones();
      const outdoorMatch = zones.find(z => /giardino|gazebo/i.test(z));
      if (outdoorMatch) this.state.formTableZone = outdoorMatch;
    }
    this.updateFormTablesHint();
    this.populateFormTablePicker();
  },

  populateZoneOptions() {
    // I bottoni zona sono fissi nell'HTML (Interno/Esterno/Indifferente)
    // Aggiorna solo lo stato attivo
    document.querySelectorAll('#formZoneOptions .zone-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.zone === this.state.formZone);
    });
  },

  /**
   * L'unica scheda per condividere un tavolo, qualunque sia il caso:
   * prendo prima il tardi e poi il presto, prima il presto e poi il
   * tardi, o li vendo entrambi di proposito — sempre la stessa domanda,
   * rivolta a chi arriva prima cronologicamente (che sia la prenotazione
   * che sto scrivendo ora, o quella già esistente). Un orario dato viene
   * verificato matematicamente; lasciato vuoto resta comunque voluto, solo
   * senza garanzia — sta allo staff decidere quanto è sicuro.
   */
  openShareTableModal(tables, occupyingBooking, onConfirm) {
    let modal = document.getElementById('shareTableModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'shareTableModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const tableLabel = tables.join('+');
    const isGroup = tables.length > 1;
    const myTime = this._selectedTime;
    const iAmEarlier = myTime && occupyingBooking.time ? Slots.toMinutes(myTime) < Slots.toMinutes(occupyingBooking.time) : false;
    // Chi arriva prima è quello a cui si chiede l'orario di rilascio —
    // non conta chi delle due prenotazioni sto scrivendo in questo momento.
    const earlierLabel = iAmEarlier ? 'tu' : this.escapeHTML(occupyingBooking.name || 'l\'altra prenotazione');
    const earlierTime = iAmEarlier ? myTime : occupyingBooking.time;
    const laterTime = iAmEarlier ? occupyingBooking.time : myTime;
    // Il suggerimento deve reggere davvero il controllo dei 15 minuti di
    // margine rispetto a QUANDO ARRIVA CHI VIENE DOPO — prima calcolava
    // solo "90 minuti dopo chi c'è già" senza mai guardare l'orario reale
    // del secondo turno: se arrivava prima di quei 90 minuti (es. dopo
    // 60), il suggerimento proponeva un rilascio che non tornava, e
    // accettandolo così com'era il sistema segnalava (giustamente) una
    // contraddizione invece di un doppio turno valido.
    const earlierMinutes = Slots.toMinutes(earlierTime);
    const laterMinutes = Slots.toMinutes(laterTime);
    const suggestedMinutes = Math.max(earlierMinutes + 1, laterMinutes - Piantina.TURNAROUND_MINUTES);
    const suggested = Slots.toHHMM(suggestedMinutes);

    // Un gruppo di tavoli uniti (es. 8+9+10) non va condiviso per forza
    // tutto insieme — magari il secondo turno ha bisogno solo del 9. Elenco
    // spuntabile solo se davvero più di un tavolo, tutti già selezionati
    // di default (il gesto di un tap resta comunque "condividi tutto",
    // come prima, per il caso comune).
    const checklistHTML = isGroup
      ? '<p style="font-size:13px;margin:10px 0 6px">Quali tavoli di questo gruppo ti servono davvero?</p>' +
        '<div class="share-table-checklist">' +
          tables.map(t =>
            '<label class="share-table-check-item"><input type="checkbox" class="shareTableTableCheck" value="' + this.escapeHTML(t) + '" checked> Tavolo ' + this.escapeHTML(t) + '</label>'
          ).join('') +
        '</div>'
      : '';

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">' +
          '<span style="font-size:20px">🔗</span>' +
          '<h3 style="margin:0">Tavolo ' + this.escapeHTML(tableLabel) + ' ' + (iAmEarlier ? 'già prenotato dopo' : 'già occupato') + '</h3>' +
        '</div>' +
        '<p style="font-size:13px;color:var(--color-ink-soft)">' + this.escapeHTML(occupyingBooking.name || 'senza nome') + ', ore ' + occupyingBooking.time + ' · ' + occupyingBooking.people + ' persone</p>' +
        checklistHTML +
        '<p style="font-size:14px;margin:10px 0 6px">' +
          (iAmEarlier ? 'Questa prenotazione arriva prima — entro che ora ' : 'Entro che ora ') +
          '<strong>' + earlierLabel + '</strong> libera il tavolo?' +
        '</p>' +
        '<input type="time" class="text-input" id="shareTableRelease" value="' + suggested + '" style="width:100%">' +
        '<p style="font-size:12px;color:var(--color-ink-soft);margin-top:6px">Lascia vuoto se non sei sicuro — resta comunque segnato come voluto, solo senza garanzia.</p>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="shareTableCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="shareTableConfirm" style="background:var(--color-primary)">Conferma tavolo condiviso</button>' +
        '</div>' +
        '<button type="button" id="shareTableMoveInstead" class="share-table-move-link">' +
          'Non voglio condividerlo — sposta ' + this.escapeHTML(occupyingBooking.name || 'l\'altra prenotazione') + ' su un altro tavolo' +
        '</button>' +
      '</div>';

    modal.classList.add('active');
    modal.querySelector('#shareTableCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#shareTableConfirm').addEventListener('click', () => {
      // Solo i tavoli rimasti spuntati — se non c'è l'elenco (un solo
      // tavolo), è sempre e solo quello.
      const chosenTables = isGroup
        ? Array.from(modal.querySelectorAll('.shareTableTableCheck:checked')).map(cb => cb.value)
        : tables;
      if (chosenTables.length === 0) {
        this.toast('Scegli almeno un tavolo', 'warning');
        return;
      }
      const releaseTime = modal.querySelector('#shareTableRelease').value || null;
      modal.classList.remove('active');
      this.state.formSharedTableDecision = {
        tables: chosenTables,
        otherBookingId: occupyingBooking.id,
        releaseTime,
        iAmEarlier,
      };
      onConfirm(chosenTables);
    });
    // Alternativa: non è un doppio turno voluto, si vuole solo spostare via
    // chi occupa già il tavolo per liberarlo del tutto per questa
    // prenotazione — stessa scheda "Sposta prenotazione" già esistente,
    // che al termine ripopola il picker così il tavolo appena liberato
    // torna selezionabile normalmente.
    modal.querySelector('#shareTableMoveInstead').addEventListener('click', () => {
      modal.classList.remove('active');
      this.openMoveSheet(occupyingBooking, () => this.populateFormTablePicker());
    });
  },

  /**
   * Colore dell'orario in base a quanto è presto o tardi nel servizio —
   * verde intenso agli estremi (apertura/chiusura), arancione verso il
   * centro. Non calcola nulla rispetto a "adesso": è pensato per pianificare,
   * anche per un giorno diverso da oggi.
   */
  /**
   * Colore e riempimento in base a QUANTO TEMPO RESTA prima che un tavolo
   * debba liberarsi (solo per doppi turni confermati, con un orario
   * preciso — un provvisorio non ha un orario da cui calcolare l'urgenza).
   * Giallo chiaro con un'ora o più di margine, rosso pieno appena scade —
   * lineare nel mezzo, così il colore da solo comunica quanto è vicino il
   * momento del cambio, senza dover leggere l'orario e fare due conti.
   */
  _urgencyStyle(releaseTime) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const releaseMinutes = Slots.toMinutes(releaseTime);
    const minutesLeft = releaseMinutes - nowMinutes;
    const WINDOW = 60; // minuti entro cui la scala comincia a scaldarsi
    const t = Math.max(0, Math.min(1, (WINDOW - minutesLeft) / WINDOW));
    return {
      t,
      bg: this._interpolateColor('#FEF9E7', '#FCEBEB', t),
      border: this._interpolateColor('#E8C34A', '#A32D2D', t),
      minutesLeft,
    };
  },

  _serviceTimeColor(bookingTime, serviceKey) {
    const cfg = Config.load();
    const service = cfg.services[serviceKey];
    if (!service) return '#8A6A2E';
    const start = Slots.toMinutes(service.start);
    const end = Slots.toMinutes(service.end);
    const mid = (start + end) / 2;
    const half = (end - start) / 2 || 1;
    const t = Slots.toMinutes(bookingTime);
    // 0 = proprio al centro del servizio, 1 = agli estremi (apertura o chiusura)
    const distFromMid = Math.max(0, Math.min(1, Math.abs(t - mid) / half));
    return this._interpolateColor('#B8752E', '#1D8A4A', distFromMid);
  },

  _interpolateColor(hexA, hexB, t) {
    const a = this._hexToRgb(hexA), b = this._hexToRgb(hexB);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  },

  _hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  },

  /**
   * Disegna il riquadro cliente nel form: se non è ancora collegato nessuno,
   * un campo di ricerca (per nome o telefono); se è collegato, la sua
   * scheda con le note, e un modo per cambiarlo o modificarle.
   */
  renderCustomerLinkBox() {
    const box = document.getElementById('customerLinkBox');
    if (!box) return;
    const customerId = this.state.formCustomerId;
    if (customerId) {
      const customer = SharedTables.getCustomerById(customerId);
      if (!customer) {
        // Cliente scomparso da sotto i piedi (rimosso da un altro
        // dispositivo nel frattempo) — torna alla ricerca invece di
        // restare bloccato su una scheda fantasma.
        this.state.formCustomerId = null;
        this.renderCustomerLinkBox();
        return;
      }
      box.innerHTML =
        '<div class="customer-linked-card">' +
          '<div class="customer-linked-header">' +
            '<strong>👤 ' + this.escapeHTML(customer.name || 'Senza nome') + '</strong>' +
            (customer.phone ? '<span class="customer-linked-phone">' + this.escapeHTML(customer.phone) + '</span>' : '') +
            '<button type="button" id="customerUnlinkBtn">Cambia</button>' +
          '</div>' +
          (customer.notes
            ? '<div class="customer-linked-notes">' + this.escapeHTML(customer.notes) + '</div>'
            : '<div class="customer-linked-notes empty">Nessuna nota per questo cliente</div>') +
          '<button type="button" class="customer-edit-notes-link" id="customerEditNotesBtn">Modifica note cliente</button>' +
        '</div>';
      box.querySelector('#customerUnlinkBtn').addEventListener('click', () => {
        this.state.formCustomerId = null;
        this.renderCustomerLinkBox();
      });
      box.querySelector('#customerEditNotesBtn').addEventListener('click', () => this.openCustomerNotesEditor(customerId));
    } else {
      box.innerHTML =
        '<input type="text" class="text-input" id="customerSearchInput" placeholder="Cerca per nome o telefono…" autocomplete="off">' +
        '<div id="customerSearchResults"></div>';
      const input = box.querySelector('#customerSearchInput');
      input.addEventListener('input', () => this.updateCustomerSearchResults(input.value));
    }
  },

  /**
   * Aggiorna l'elenco di candidati mentre si scrive — da due lettere in
   * su, abbastanza per non mostrare risultati inutili con una sola
   * lettera ma senza far aspettare troppo prima di vedere qualcosa.
   */
  updateCustomerSearchResults(query) {
    const resultsBox = document.getElementById('customerSearchResults');
    if (!resultsBox) return;
    const q = query.trim();
    if (q.length < 2) { resultsBox.innerHTML = ''; return; }
    const matches = SharedTables.searchCustomers(q);
    resultsBox.innerHTML =
      matches.slice(0, 5).map(c =>
        '<button type="button" class="customer-search-result" data-id="' + c.id + '">' +
          '<strong>' + this.escapeHTML(c.name || 'Senza nome') + '</strong>' +
          (c.phone ? ' · ' + this.escapeHTML(c.phone) : '') +
          (c.notes ? '<span class="customer-search-note">' + this.escapeHTML(c.notes) + '</span>' : '') +
        '</button>'
      ).join('') +
      '<button type="button" class="customer-search-new" id="customerCreateNewBtn">＋ Nuovo cliente "' + this.escapeHTML(q) + '"</button>';
    resultsBox.querySelectorAll('.customer-search-result').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.formCustomerId = btn.dataset.id;
        this.renderCustomerLinkBox();
      });
    });
    resultsBox.querySelector('#customerCreateNewBtn').addEventListener('click', () => this.openCustomerCreateModal(q));
  },

  /**
   * Crea un nuovo cliente al volo, senza uscire dal form — precompilato
   * con quello che si stava già cercando, e con nome/telefono del form se
   * presenti (spesso è la stessa persona che si sta prenotando ora).
   */
  openCustomerCreateModal(searchedText) {
    let modal = document.getElementById('customerCreateModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'customerCreateModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }
    const formName = document.getElementById('fName')?.value.trim() || '';
    const formPhone = document.getElementById('fPhone')?.value.trim() || '';
    const prefillName = searchedText && !/^\d+$/.test(searchedText) ? searchedText : formName;
    const prefillPhone = searchedText && /^\d+$/.test(searchedText) ? searchedText : formPhone;

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>👤 Nuovo cliente</h3>' +
        '<div class="field-group"><label class="field-label">Nome</label>' +
          '<input type="text" class="text-input" id="newCustomerName" value="' + this.escapeHTML(prefillName) + '"></div>' +
        '<div class="field-group" style="margin-top:12px"><label class="field-label">Telefono</label>' +
          '<input type="tel" class="text-input" id="newCustomerPhone" value="' + this.escapeHTML(prefillPhone) + '"></div>' +
        '<div class="field-group" style="margin-top:12px"><label class="field-label">Note (allergie ricorrenti, tavolo preferito, quello che serve)</label>' +
          '<textarea class="text-input" id="newCustomerNotes" rows="3"></textarea></div>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="newCustomerCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="newCustomerSave" style="background:var(--color-primary)">Crea e collega</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    modal.querySelector('#newCustomerCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#newCustomerSave').addEventListener('click', async () => {
      const name = document.getElementById('newCustomerName').value.trim();
      if (!name) { this.toast('Serve almeno il nome', 'warning'); return; }
      const phone = document.getElementById('newCustomerPhone').value.trim();
      const notes = document.getElementById('newCustomerNotes').value.trim();
      modal.classList.remove('active');
      this.showSyncIndicator(true);
      const customer = await SharedTables.addCustomer({ name, phone, notes });
      this.showSyncIndicator(false);
      this.state.formCustomerId = customer.id;
      this.renderCustomerLinkBox();
      this.toast('Cliente creato e collegato ✓');
    });
  },

  /**
   * Modifica le note di un cliente già collegato, senza uscire dal form —
   * es. "questa volta ha detto anche che non vuole il tavolo vicino alla
   * cucina", si aggiunge lì per la prossima volta.
   */
  openCustomerNotesEditor(customerId) {
    const customer = SharedTables.getCustomerById(customerId);
    if (!customer) return;
    let modal = document.getElementById('customerNotesModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'customerNotesModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }
    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>Note di ' + this.escapeHTML(customer.name || 'questo cliente') + '</h3>' +
        '<p style="font-size:12px;color:var(--color-ink-soft);margin-bottom:10px">Restano collegate a lui, si ritrovano ogni volta che torna — non solo su questa prenotazione.</p>' +
        '<textarea class="text-input" id="editCustomerNotes" rows="4">' + this.escapeHTML(customer.notes || '') + '</textarea>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="editCustomerNotesCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="editCustomerNotesSave" style="background:var(--color-primary)">Salva</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    modal.querySelector('#editCustomerNotesCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#editCustomerNotesSave').addEventListener('click', async () => {
      const notes = document.getElementById('editCustomerNotes').value.trim();
      modal.classList.remove('active');
      this.showSyncIndicator(true);
      await SharedTables.updateCustomer(customerId, { notes });
      this.showSyncIndicator(false);
      this.renderCustomerLinkBox();
      this.toast('Note aggiornate ✓');
    });
  },

  populateFormTablePicker() {
    const container = document.getElementById('formTablePicker');
    if (!container) return;

    // Lista d'attesa e asporto: niente tavolo da scegliere, si nasconde
    // tutto il riquadro invece di mostrare una griglia che non serve a
    // nulla.
    const fieldGroup = document.getElementById('formTableFieldGroup');
    const isWaitlist = document.getElementById('fIsWaitlist')?.checked;
    const isTakeaway = document.getElementById('fIsTakeaway')?.checked;
    if (fieldGroup) fieldGroup.classList.toggle('hidden', !!isWaitlist || !!isTakeaway);
    if (isWaitlist || isTakeaway) {
      if (this._formTableSet) this._formTableSet.clear();
      this._formTable = null;
      this.updateFormTableSelected();
      return;
    }

    const date = document.getElementById('fDate').value;
    const service = this._formService;
    const editingId = this.state.editingBookingId;
    const zones = SharedTables.getZones();
    // formTableZone è la zona VERA della piantina (es. "Interno"/"Giardino"),
    // diversa da formZone che è solo la preferenza cliente (interno/esterno/
    // indifferente) — prima venivano confuse e la ricerca tavoli/capienza
    // non trovava mai nulla perché i nomi non combaciano mai per davvero.
    if (!this.state.formTableZone || !zones.includes(this.state.formTableZone)) {
      this.state.formTableZone = zones[0] || '';
    }
    const currentZone = this.state.formTableZone;

    const zoneTabsHTML = zones.length > 1 ? '<div class="piantina-zone-tabs">' +
      zones.map(z => '<button type="button" class="piantina-zone-tab' + (z === currentZone ? ' active' : '') +
        '" data-zone="' + this.escapeHTML(z) + '">' + this.escapeHTML(z) + '</button>').join('') +
      '</div>' : '';

    // Zona chiusa per questo giorno/servizio (es. il giardino aperto solo
    // a cena in bassa stagione) — un avviso al posto dei tavoli, con
    // un'eccezione SOLO per questa prenotazione: non tocca la chiusura
    // salvata, che potrebbe coprire settimane intere — un'eccezione su
    // una prenotazione non deve riaprire tutta la stagione per sbaglio.
    const zoneClosure = date && service ? SharedTables.getZoneClosureFor(currentZone, date, service) : null;
    const overriddenKey = currentZone + '|' + date + '|' + service;
    if (zoneClosure && this._formZoneClosureOverride !== overriddenKey) {
      const serviceLabel = zoneClosure.service === 'all' ? 'oggi' : (service === 'lunch' ? 'a pranzo' : 'a cena');
      container.innerHTML = zoneTabsHTML +
        '<div class="zone-closed-notice">' +
          '<p>🌿 <strong>' + this.escapeHTML(currentZone) + '</strong> è chiusa ' + serviceLabel +
          (zoneClosure.reason ? ' — ' + this.escapeHTML(zoneClosure.reason) : '') + '.</p>' +
          '<button type="button" class="zone-closed-override-btn" id="zoneClosedOverrideBtn">Prenota comunque qui, solo per questa volta</button>' +
        '</div>';
      container.querySelectorAll('.piantina-zone-tab').forEach(tab => {
        tab.addEventListener('click', () => { this.state.formTableZone = tab.dataset.zone; this.populateFormTablePicker(); });
      });
      document.getElementById('zoneClosedOverrideBtn')?.addEventListener('click', () => {
        this._formZoneClosureOverride = overriddenKey;
        this.populateFormTablePicker();
      });
      return;
    }

    // Se la zona ha una chiusura ma è attiva l'eccezione "prenota comunque
    // qui, solo per questa volta" (gestita sopra), i controlli sui singoli
    // tavoli qui sotto non devono considerare la chiusura di zona — solo
    // un blocco messo a mano su quel tavolo preciso conta ancora.
    const ignoreZoneClosureHere = this._formZoneClosureOverride === overriddenKey;

    // Tavoli della zona selezionata
    const zt = SharedTables.getZoneTavoli();
    const zoneTables = zt[currentZone] || [];

    if (zoneTables.length === 0) {
      container.innerHTML = zoneTabsHTML + '<p style="font-size:12px;color:var(--color-ink-soft)">Nessun tavolo configurato per questa zona.</p>';
      container.querySelectorAll('.piantina-zone-tab').forEach(tab => {
        tab.addEventListener('click', () => { this.state.formTableZone = tab.dataset.zone; this.populateFormTablePicker(); });
      });
      return;
    }

    // Calcola tavoli occupati: tavolo → TUTTE le prenotazioni che lo
    // occupano (con un doppio turno confermato sono due, non una — prima
    // qui ne restava visibile solo una, la seconda scriveva sopra alla
    // prima nella mappa e spariva dal selettore). Una prenotazione
    // "Terminata" ha già liberato il tavolo, quindi non conta.
    const occupiedBy = new Map();
    if (date && service) {
      Bookings.getByDateAndService(date, service)
        .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW && b.id !== editingId)
        .forEach(b => {
          if (b.tablesAssigned) b.tablesAssigned.split(',').forEach(t => {
            const key = t.trim();
            if (!occupiedBy.has(key)) occupiedBy.set(key, []);
            occupiedBy.get(key).push(b);
          });
        });
    }
    // Scorciatoia: il primo occupante di un tavolo (il più presto, dato che
    // getByDateAndService è già ordinata per orario) — usato per capire chi
    // proporre nella scheda di condivisione e per raggruppare i tavoli uniti.
    const primaryOccupant = (t) => { const list = occupiedBy.get(t); return list && list.length ? list[0] : null; };

    // Un tavolo occupato non blocca più nulla: si vede subito chi c'è (nome
    // e orario dentro al riquadro), e toccandolo si apre l'unica scheda per
    // condividerlo come doppio turno — un solo meccanismo, sempre uguale,
    // qualunque sia l'ordine in cui le due prenotazioni vengono prese.
    //
    // Tavoli uniti occupati dalla STESSA prenotazione diventano un unico
    // riquadro (es. "1+2") invece di due quadrati separati che ripetono lo
    // stesso nome — solo per quelli occupati da altri: la selezione che sto
    // costruendo io resta tavolo per tavolo, per poterli unire liberamente.
    const renderUnits = [];
    const consumedTables = new Set();
    zoneTables.forEach(t => {
      if (consumedTables.has(t)) return;
      const occupyingBooking = primaryOccupant(t);
      const isSelected = this._formTableSet ? this._formTableSet.has(t) : this._formTable === t;
      if (occupyingBooking && !isSelected) {
        const group = zoneTables.filter(other => {
          if (consumedTables.has(other)) return false;
          // Un tavolo già selezionato singolarmente (es. hai scelto solo
          // il 9 da un gruppo "8+9+10") non va risucchiato di nuovo nel
          // riquadro "ancora occupato" insieme ai fratelli non scelti —
          // altrimenti la selezione sparisce alla vista al ridisegno, pur
          // restando valida nei dati: un problema di sola visualizzazione,
          // ma che porta a ritoccare per sbaglio e annullare la scelta.
          const otherSelected = this._formTableSet ? this._formTableSet.has(other) : this._formTable === other;
          if (otherSelected) return false;
          const p = primaryOccupant(other);
          return p && p.id === occupyingBooking.id;
        });
        group.forEach(g => consumedTables.add(g));
        // Occupanti extra (doppio turno): il tavolo/gruppo ha più di una
        // prenotazione sopra — mostrarli tutti, non solo il primo.
        const extraOccupants = (occupiedBy.get(group[0]) || []).slice(1);
        renderUnits.push({ tables: group, occupyingBooking, extraOccupants, isSelected: false });
      } else {
        consumedTables.add(t);
        renderUnits.push({ tables: [t], occupyingBooking, extraOccupants: [], isSelected });
      }
    });

    container.innerHTML = zoneTabsHTML + '<div class="form-table-grid">' +
      renderUnits.map(unit => {
        const { tables, occupyingBooking, extraOccupants, isSelected } = unit;
        const tableLabel = tables.join('+');
        const isBlocked = tables.some(t => SharedTables.isBlocked(t, date, service, ignoreZoneClosureHere));
        let title = '';
        if (isBlocked) title = 'Tavolo non disponibile';
        else if (occupyingBooking && !isSelected) {
          title = 'Occupato da ' + this.escapeHTML(occupyingBooking.name) + ' (' + occupyingBooking.people + ' cop.) alle ' + occupyingBooking.time +
            (extraOccupants.length ? ', poi ' + extraOccupants.map(e => this.escapeHTML(e.name) + ' (' + e.people + ' cop.) alle ' + e.time).join(', ') : '') +
            ' — tocca per condividerlo';
        }
        // Colore dell'orario in base a quanto è presto o tardi nel servizio
        // (non a "adesso" — qui si pianifica, anche per un altro giorno):
        // verde intenso a inizio/fine servizio, arancione verso il centro
        // — un tavolo agli estremi ha più probabilità di liberarsi in
        // tempo per un secondo turno, un colpo d'occhio invece di doverci
        // ragionare sopra ogni volta.
        const timeColor = occupyingBooking ? this._serviceTimeColor(occupyingBooking.time, service) : null;
        // I coperti servono a capire al volo quanti posti si libereranno
        // con quel tavolo — utile per giudicare se ci sta un gruppo simile.
        // Se ha già un doppio turno (o più) sopra, si vede subito anche
        // qui — non solo il primo occupante, altrimenti sembrerebbe un
        // tavolo normale con una sola prenotazione.
        const extraLine = extraOccupants.length
          ? '<br><span style="opacity:0.85">+ ' + extraOccupants.map(e => this.escapeHTML(e.name) + ' ' + e.people + 'p ' + e.time).join(', ') + '</span>'
          : '';
        // Capienza speciale per questo giorno/servizio, solo se davvero
        // impostata — accanto ai tavoli liberi, per sapere già in fase di
        // scelta se quel tavolo va tenuto più piccolo oggi.
        const freeCap = (!occupyingBooking && !isSelected && tables.length === 1) ? SharedTables.getTableCapacityOverride(date, service, tables[0]) : null;
        const occupantInfo = (occupyingBooking && !isSelected)
          ? '<span class="form-table-pill-occupant">' + this.escapeHTML(occupyingBooking.name || 'occupato') + ' ' + occupyingBooking.people + 'p · <strong style="color:' + timeColor + '">' + occupyingBooking.time + '</strong>' + extraLine + '</span>'
          : (isSelected ? '' : '<span class="form-table-pill-occupant form-table-pill-free">' + (freeCap ? 'fino a ' + freeCap.max : 'libero') + '</span>');
        return '<button class="form-table-pill ' +
          (isSelected ? 'selected' : '') +
          (isBlocked && !isSelected ? ' occupied-pill' : '') +
          (occupyingBooking && !isSelected ? ' double-shift-pill' : '') +
          (tables.length > 1 ? ' form-table-pill-joined' : '') +
          '" data-tables="' + tables.join(',') + '"' +
          (isBlocked ? ' disabled style="opacity:0.4;cursor:not-allowed;text-decoration:line-through"' : '') +
          (title ? ' title="' + title + '"' : '') +
          '>' + tableLabel + occupantInfo + '</button>';
      }).join('') +
    '</div>';

    container.querySelectorAll('.piantina-zone-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.state.formTableZone = tab.dataset.zone;
        this.populateFormTablePicker();
      });
    });

    container.querySelectorAll('.form-table-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        if (pill.disabled) return;
        const groupTables = pill.dataset.tables.split(',');
        const currentDate = document.getElementById('fDate').value;
        if (groupTables.some(t => SharedTables.isBlocked(t, currentDate, this._formService, ignoreZoneClosureHere))) return;

        // Tutti i tavoli di un riquadro unito appartengono sempre alla
        // stessa prenotazione (o sono tutti liberi/selezionati) — basta
        // controllarne uno per sapere lo stato dell'intero gruppo.
        const occupyingBooking = primaryOccupant(groupTables[0]);
        const isSelected = this._formTableSet && groupTables.every(t => this._formTableSet.has(t));

        // Aggiunge/toglie SOLO i tavoli passati (non necessariamente
        // l'intero gruppo unito) — serve quando il secondo turno ha
        // bisogno solo di una parte di un gruppo occupato (es. solo il 9
        // di un "8+9+10"), non per forza tutta la configurazione attuale.
        const selectTables = (chosenTables) => {
          if (!this._formTableSet) this._formTableSet = new Set();
          const alreadyIn = chosenTables.every(t => this._formTableSet.has(t));
          chosenTables.forEach(t => {
            if (alreadyIn) this._formTableSet.delete(t);
            else this._formTableSet.add(t);
          });
          if (alreadyIn && this.state.formSharedTableDecision &&
              chosenTables.some(t => this.state.formSharedTableDecision.tables.includes(t))) {
            // Uno dei tavoli tolti apparteneva alla decisione di
            // condivisione in sospeso: non vale più.
            this.state.formSharedTableDecision = null;
          }
          this._formTable = this._formTableSet.size > 0 ? Array.from(this._formTableSet).join(', ') : null;
          this.updateFormTableSelected();
          this.populateFormTablePicker();
          this.updateSaveButtonState();
        };

        if (occupyingBooking && !isSelected) {
          if (!this._selectedTime) {
            this.toast('Scegli prima un orario', 'warning');
            return;
          }
          this.openShareTableModal(groupTables, occupyingBooking, selectTables);
          return;
        }

        // Tavolo libero fisicamente accostato a un altro: tocca uno e si
        // seleziona anche il compagno in automatico, senza nessun avviso
        // che interrompe. Per forzare (venderlo da solo), tocca di nuovo
        // uno dei due mentre è già selezionato: si toglie solo quello,
        // lasciando l'altro. Solo per i tavoli liberi — quelli occupati
        // seguono già il loro percorso sopra (condivisione/doppio turno).
        if (!occupyingBooking && !isSelected) {
          const joinGroup = SharedTables.getTableJoinGroupFor(date, service, groupTables[0]);
          if (joinGroup && joinGroup.length > 1) {
            selectTables(joinGroup);
            return;
          }
        }

        selectTables(groupTables);
      });
    });

    this.updateCapacityWarning();
  },

  /**
   * Confronta i coperti della prenotazione con la capienza totale dei
   * tavoli selezionati (solo quelli con capienza impostata — un tavolo mai
   * configurato non genera avvisi). Se non basta, propone un tavolo libero
   * della stessa zona da aggiungere con un tocco solo.
   */
  updateCapacityWarning() {
    const box = document.getElementById('formCapacityWarning');
    if (!box) return;

    const people = this._peopleValue || 0;
    const selected = this._formTableSet ? Array.from(this._formTableSet) : [];
    if (selected.length === 0 || people === 0) { box.innerHTML = ''; return; }

    let totalCapacity = 0;
    let anyConfigured = false;
    selected.forEach(t => {
      const cap = SharedTables.getCapacity(this.state.formTableZone, t);
      if (cap) { totalCapacity += cap; anyConfigured = true; }
    });

    if (!anyConfigured || totalCapacity >= people) { box.innerHTML = ''; return; }

    // Cerca un tavolo libero della stessa zona da suggerire, escludendo
    // quelli già scelti — il controllo occupazione/blocco è già disponibile
    // qui sopra tramite occupiedBy, ma rifarlo semplice è più sicuro che
    // portarsi dietro variabili di chiusura tra due funzioni diverse.
    const date = document.getElementById('fDate').value;
    const service = this._formService;
    const zone = this.state.formTableZone;
    const zoneTables = SharedTables.getTablesForZone(zone);
    const occupied = new Set();
    Bookings.getByDateAndService(date, service)
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW && b.id !== this.state.editingBookingId)
      .forEach(b => { if (b.tablesAssigned) b.tablesAssigned.split(',').forEach(t => occupied.add(t.trim())); });

    const suggestion = zoneTables.find(t =>
      !selected.includes(t) && !occupied.has(t) && !SharedTables.isBlocked(t, date, service)
    );

    box.innerHTML =
      '<div class="capacity-warning">' +
        '⚠️ ' + selected.join('+') + ' regge' + (selected.length > 1 ? 'ono' : '') + ' max ' + totalCapacity + ' persone, ma sono ' + people + '.' +
        (suggestion ? ' <button type="button" id="capacityAddTableBtn" data-table="' + this.escapeHTML(suggestion) + '">+ Aggiungi tavolo ' + this.escapeHTML(suggestion) + '</button>' : ' Aggiungi un altro tavolo.') +
      '</div>';

    const addBtn = box.querySelector('#capacityAddTableBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this._formTableSet.add(addBtn.dataset.table);
        this._formTable = Array.from(this._formTableSet).join(', ');
        this.updateFormTableSelected();
        this.populateFormTablePicker();
        this.updateSaveButtonState();
      });
    }
  },

  updateFormTableSelected() {
    const el = document.getElementById('formTableSelected');
    const label = document.getElementById('formTableSelectedLabel');
    if (!el || !label) return;
    if (this._formTable) {
      label.textContent = this._formTable;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  },

  setPeopleValue(n) {
    this._peopleValue = Math.max(1, n);
    document.getElementById('peopleValue').textContent = this._peopleValue;
    this.updateCapacityWarning();
  },
  setDogsValue(n) { this._dogsValue = Math.max(0, n); document.getElementById('dogsValue').textContent = this._dogsValue; },

  /**
   * Campi "chip → si espande al tocco" (allergie, note): compatti quando
   * vuoti, mostrano subito il testo se c'è già qualcosa da editare — così
   * non si perde nulla riaprendo una prenotazione che aveva già un'allergia
   * segnata, ma il form resta snello nel caso comune (niente da segnalare).
   */
  /**
   * Mentre si spunta "Menu operaio" nel form, mostra subito cosa dice il
   * menu di oggi (scritto dalla cucina) — così chi prende la prenotazione
   * lo sa già, senza dover andare a controllare altrove.
   */
  /**
   * Mostra "prima volta" o "Nª volta" nel form, aggiornandosi mentre si
   * scrive camera/data di partenza — funziona sia per una prenotazione
   * nuova (conta quante ce ne sono già) sia per una in modifica (si
   * esclude da sé dal conteggio, altrimenti si contarebbe due volte).
   */
  refreshHotelVisitHint() {
    const hint = document.getElementById('hotelVisitHint');
    if (!hint) return;
    const roomNumber = document.getElementById('fRoomNumber').value.trim();
    const departureDate = document.getElementById('fDepartureDate').value;
    const mealPlan = document.querySelector('#fMealPlanToggle button.active')?.dataset.plan;
    // Solo mezza pensione — alla carta mangia come qualunque altro
    // cliente, il conteggio non ha senso lì.
    if (!roomNumber || !departureDate || mealPlan !== 'mezza_pensione') {
      hint.classList.add('hidden');
      return;
    }
    const stay = Bookings.getStayBookings(roomNumber, departureDate)
      .filter(b => b.id !== this.state.editingBookingId);
    const visitNumber = stay.length + 1;
    hint.classList.remove('hidden');
    hint.textContent = visitNumber === 1
      ? '👋 Prima volta questo soggiorno'
      : '🔁 ' + visitNumber + 'ª volta questo soggiorno';
  },

  refreshWorkerMenuHint(checked) {
    const hint = document.getElementById('workerMenuHint');
    if (!hint) return;
    if (!checked) {
      hint.textContent = 'Segnala alla cucina che questo tavolo ha il menu operaio.';
      return;
    }
    const date = document.getElementById('fDate').value;
    const menu = date ? SharedTables.getWorkerMenu(date) : null;
    const summary = menu ? SharedTables.HALF_BOARD_COURSES
      .filter(c => menu[c] && menu[c].length)
      .map(c => SharedTables.HALF_BOARD_COURSE_LABELS[c] + ': ' + menu[c].join(', '))
      .join(' · ') : '';
    hint.textContent = summary
      ? 'Menu di oggi — ' + summary
      : 'Nessun menu operaio ancora scritto dalla cucina per questa data.';
  },

  refreshQuickFieldState(chipId, wrapId, fieldId) {
    const chip = document.getElementById(chipId);
    const wrap = document.getElementById(wrapId);
    const hasContent = !!document.getElementById(fieldId).value.trim();
    chip.classList.toggle('hidden', hasContent);
    wrap.classList.toggle('hidden', !hasContent);
  },
  expandQuickField(chipId, wrapId, fieldId) {
    document.getElementById(chipId).classList.add('hidden');
    document.getElementById(wrapId).classList.remove('hidden');
    document.getElementById(fieldId).focus();
  },
  setHighchairsValue(n) { this._highchairsValue = Math.max(0, n); document.getElementById('highchairsValue').textContent = this._highchairsValue; },

  expandOptional() {
    document.getElementById('optionalToggle').classList.add('expanded');
    document.getElementById('optionalFields').classList.add('expanded');
  },

  collapseOptional() {
    document.getElementById('optionalToggle').classList.remove('expanded');
    document.getElementById('optionalFields').classList.remove('expanded');
  },

  updateFormTablesHint() {
    const container = document.getElementById('formTablesHint');
    if (!container) return;
    const date = document.getElementById('fDate').value;
    const service = this._formService;
    const zone = this.state.formTableZone;
    if (!date || !service) { container.innerHTML = ''; return; }

    const cfg = Config.load();
    const editingId = this.state.editingBookingId;
    const bookings = Bookings.getByDateAndService(date, service)
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW && b.id !== editingId);

    const assigned = new Set();
    bookings.forEach(b => {
      if (b.tablesAssigned) b.tablesAssigned.split(',').forEach(t => assigned.add(t.trim()));
    });

    const formDate = document.getElementById('fDate').value;
    const makeRow = (label, tables) => {
      const free = tables.filter(t => !assigned.has(t) && !SharedTables.isBlocked(t, formDate, service));
      const total = tables.length;
      const pct = total > 0 ? Math.round((free.length / total) * 100) : 0;
      const color = free.length === 0 ? '#c0392b' : free.length <= 3 ? '#e67e22' : '#27ae60';
      return '<div class="hint-row" style="color:' + color + '">' +
        '<span>' + label + ' liberi: <strong>' + free.length + ' / ' + total + '</strong></span>' +
        '<span class="hint-bar"><span class="hint-bar-fill" style="width:' + pct + '%;background:' + color + '"></span></span>' +
        '<div class="hint-table-list">' + free.map(t => '<span class="hint-table-pill">' + t + '</span>').join('') + '</div>' +
      '</div>';
    };

    let html = '<div class="form-tables-hint-inner">';
    const zt = SharedTables.getZoneTavoli();
    if (zone && zt[zone]) {
      html += makeRow(zone, zt[zone]);
    } else {
      SharedTables.getZones().forEach(z => { html += makeRow(z, zt[z] || []); });
    }
    html += '</div>';
    container.innerHTML = html;
  },

  populateSlotGrid() {
    const date = document.getElementById('fDate').value;
    const service = this._formService;
    const cfg = Config.load();
    const counts = Slots.countBookingsPerSlot(service, date, Bookings.getCached());
    const grid = document.getElementById('formSlotGrid');
    grid.innerHTML = '';
    for (const slot of Slots.generateSlotsForService(service)) {
      let count = counts[slot] || 0;
      const editing = this.state.editingBookingId ? Bookings.getById(this.state.editingBookingId) : null;
      if (editing && editing.time === slot && editing.date === date && editing.service === service) count = Math.max(0, count - 1);
      const level = this.slotLevel(count, cfg.maxBookingsPerSlot);
      const pill = document.createElement('button');
      pill.className = 'slot-pill';
      pill.dataset.time = slot;
      pill.dataset.level = level;
      pill.textContent = slot;
      pill.addEventListener('click', () => this.selectSlot(slot));
      grid.appendChild(pill);
    }
  },

  selectSlot(time, options) {
    options = options || {};
    const date = document.getElementById('fDate').value;
    const service = this._formService;
    const bookings = Bookings.getCached();
    const isAvailable = options.skipFullCheck || Slots.isSlotAvailable(service, date, time, bookings);

    if (!isAvailable) {
      this.showSlotSuggestion(time, service, date, bookings);
    } else {
      document.getElementById('slotSuggestionBox').classList.add('hidden');
    }

    // Seleziona sempre (limite flessibile)
    this._selectedTime = time;
    document.querySelectorAll('#formSlotGrid .slot-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.time === time);
    });
    // Il picker tavoli dipende dall'orario scelto (doppio turno: un tavolo
    // può diventare selezionabile solo a partire da un certo orario)
    this.populateFormTablePicker();
    this.updateSaveButtonState();
  },

  autoSelectFirstAvailableSlot() {
    const date = document.getElementById('fDate').value;
    const service = this._formService;
    const bookings = Bookings.getCached();
    const allSlots = Slots.generateSlotsForService(service);
    if (allSlots.length === 0) return;
    let fromTime = allSlots[0];
    if (date === Utils.todayISO()) {
      const now = new Date();
      const nowHHMM = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
      if (Slots.toMinutes(nowHHMM) > Slots.toMinutes(allSlots[0])) fromTime = nowHHMM;
    }
    const next = Slots.findNextAvailableSlot(service, date, fromTime, bookings) || allSlots[0];
    this.selectSlot(next);
  },

  showSlotSuggestion(requestedTime, service, date, bookings) {
    const alternatives = Slots.findAvailableSlotsFrom(service, date, requestedTime, bookings, 4);
    const box = document.getElementById('slotSuggestionBox');
    const chips = document.getElementById('suggestionChips');
    chips.innerHTML = '';
    if (alternatives.length === 0) {
      document.getElementById('suggestionText').textContent = '⚠️ Slot al completo — puoi comunque salvare.';
    } else {
      document.getElementById('suggestionText').textContent = '⚠️ Slot al completo — puoi salvare o scegliere un orario libero:';
      for (const alt of alternatives) {
        const chip = document.createElement('button');
        chip.className = 'suggestion-chip';
        chip.textContent = alt;
        chip.addEventListener('click', () => this.selectSlot(alt));
        chips.appendChild(chip);
      }
    }
    box.classList.remove('hidden');
  },

  renderStatusOptions() {
    const container = document.getElementById('formStatusOptions');
    container.innerHTML = '';
    // "Lista d'attesa" si attiva solo dalla casella dedicata sopra, non da
    // qui — altrimenti due controlli diversi finirebbero per litigarsi lo
    // stesso valore, con l'ultimo che scrive sopra all'altro per sbaglio.
    for (const [key, label] of Object.entries(STATUS_LABELS)) {
      if (key === STATUS.WAITLIST) continue;
      const btn = document.createElement('button');
      btn.className = 'status-btn';
      btn.classList.toggle('active', this.state.formStatus === key);
      btn.innerHTML = '<span class="status-dot ' + key + '"></span>' + label;
      btn.addEventListener('click', () => { this.state.formStatus = key; this.renderStatusOptions(); });
      container.appendChild(btn);
    }
  },

  updateSaveButtonState() {
    const name = document.getElementById('fName').value.trim();
    const phone = document.getElementById('fPhone').value.trim();
    const btn = document.getElementById('saveBtn');
    const isWaitlist = document.getElementById('fIsWaitlist')?.checked;
    const isTakeaway = document.getElementById('fIsTakeaway')?.checked;
    const isHotelGuest = document.getElementById('fIsHotelGuest')?.checked;
    const hasTable = !!(this._formTableSet && this._formTableSet.size > 0);
    // Lista d'attesa: niente tavolo da avere per forza, ma il telefono è
    // l'unico modo per poterli richiamare — qui diventa obbligatorio.
    // Cliente hotel: stesso discorso sul tavolo — di solito lo si assegna
    // in un secondo momento, non al momento della prenotazione.
    // Asporto: niente tavolo per definizione, ma serve sapere cosa
    // portare via, altrimenti in cucina non saprebbero cosa preparare.
    const tableOk = isWaitlist || isTakeaway || isHotelGuest || hasTable;
    const phoneOk = !isWaitlist || phone.length > 0;
    const takeawayOk = !isTakeaway || document.getElementById('fTakeawayItems').value.trim().length > 0;
    // Chiuso è un blocco vero, prima di tutti gli altri — non ha senso
    // controllare se manca il tavolo quando quel giorno non si può
    // proprio prenotare.
    const isClosed = this.checkFormClosureBlock();
    if (isClosed) {
      btn.disabled = true;
      btn.textContent = 'Giorno/servizio chiuso';
      return;
    }
    btn.disabled = !(name.length > 0 && !!this._selectedTime && tableOk && phoneOk && takeawayOk);
    if (!btn.disabled) btn.textContent = isWaitlist ? 'Salva in lista d\'attesa' : 'Salva prenotazione';
    else if (name.length > 0 && this._selectedTime && !tableOk) btn.textContent = 'Seleziona un tavolo';
    else if (name.length > 0 && this._selectedTime && !phoneOk) btn.textContent = 'Serve il telefono per richiamarli';
  },

  async saveForm() {
    if (!DB.canEdit()) return;
    // Allergie: senza il consenso confermato nel pop-up non si salvano.
    // (Il pop-up si apre già toccando "+ Allergia"; questo è il controllo
    // finale, per ogni altro modo in cui il campo può essersi riempito.)
    const intolValue = (document.getElementById('fIntolerances').value || '').trim();
    if (intolValue && this._formNeedsAllergyConsent()) {
      this.openAllergyConsentModal(
        (consent) => { this._formAllergyConsent = consent; this.saveForm(); },
        () => this.toast('Senza consenso l\'allergia non si può annotare: conferma oppure cancella il testo', 'warning')
      );
      return;
    }
    // Rete di sicurezza finale: ricontrolla la chiusura appena prima di
    // salvare, indipendentemente da quanto già impedito nell'interfaccia.
    const dateVal = document.getElementById('fDate').value;
    const serviceVal = this._formService;
    if (dateVal && serviceVal && SharedTables.getClosureFor(dateVal, serviceVal)) {
      this.toast('Questo giorno/servizio è chiuso — non prenotabile', 'warning');
      return;
    }
    const isWaitlist = document.getElementById('fIsWaitlist')?.checked;
    const isTakeaway = document.getElementById('fIsTakeaway')?.checked;
    const isHotelGuest = document.getElementById('fIsHotelGuest')?.checked;
    if (isHotelGuest && !document.getElementById('fDepartureDate').value) {
      this.toast('Serve la data di partenza per un cliente hotel', 'warning');
      return;
    }
    if (isTakeaway && !document.getElementById('fTakeawayItems').value.trim()) {
      this.toast('Scrivi cosa portare via prima di salvare', 'warning');
      return;
    }
    if (!isWaitlist && !isTakeaway && !isHotelGuest && (!this._formTableSet || this._formTableSet.size === 0)) {
      this.toast('Seleziona almeno un tavolo prima di salvare', 'warning');
      return;
    }
    if (isWaitlist && !document.getElementById('fPhone').value.trim()) {
      this.toast('Il telefono è obbligatorio per la lista d\'attesa', 'warning');
      return;
    }
    // In lista d'attesa e in asporto non c'è un tavolo da controllare —
    // salta tutta la verifica conflitti, non ha senso senza un tavolo
    // scelto.
    if (!isWaitlist && !isTakeaway) {
    // Rete di sicurezza: ricontrolla i conflitti veri appena prima di
    // salvare, non solo quando si sceglie il tavolo — copre il caso in cui
    // si cambia data/servizio dopo aver già scelto un tavolo, che altrimenti
    // resterebbe "scelto" anche se ora confligge con qualcun altro.
    const conflictCheckDate = document.getElementById('fDate').value;
    const conflictCheckService = this._formService;
    const decision = this.state.formSharedTableDecision;
    const currentBookingCheck = this.state.editingBookingId ? Bookings.getById(this.state.editingBookingId) : null;
    // Se sto modificando una prenotazione con il tavolo segnato "Non
    // spostare" e il tavolo scelto ora è diverso da quello che aveva,
    // avviso prima di salvare — non blocca, chiede solo conferma.
    if (currentBookingCheck && Bookings.isFixedTable(currentBookingCheck)) {
      const originalTables = currentBookingCheck.tablesAssigned
        ? currentBookingCheck.tablesAssigned.split(',').map(x => x.trim()).sort().join(',') : '';
      const newTables = Array.from(this._formTableSet).sort().join(',');
      if (originalTables !== newTables && !this._confirmIfFixedTable(currentBookingCheck)) return;
    }
    const othersOnDate = Bookings.getByDateAndService(conflictCheckDate, conflictCheckService)
      .filter(bk => bk.status !== STATUS.CANCELLED && bk.status !== STATUS.COMPLETED && bk.status !== STATUS.NOSHOW && bk.id !== this.state.editingBookingId);
    for (const t of this._formTableSet) {
      const occupying = othersOnDate.find(bk => bk.tablesAssigned && bk.tablesAssigned.split(',').map(x => x.trim()).includes(t));
      if (!occupying) continue;
      // Va bene se: c'è già un rilascio confermato che regge l'orario
      // scelto (in un verso o nell'altro — non conta chi delle due
      // prenotazioni sto modificando ora), la coppia è già segnata
      // provvisoria, oppure è proprio la decisione appena presa nella
      // scheda "tavolo condiviso" per questo preciso tavolo.
      let ok = false;
      if (occupying.doubleShiftRelease && this._selectedTime && Slots.toMinutes(this._selectedTime) >= Slots.toMinutes(occupying.doubleShiftRelease) + Piantina.TURNAROUND_MINUTES) ok = true;
      if (currentBookingCheck && currentBookingCheck.doubleShiftRelease && Slots.toMinutes(occupying.time) >= Slots.toMinutes(currentBookingCheck.doubleShiftRelease) + Piantina.TURNAROUND_MINUTES) ok = true;
      if (Bookings.isProvisional(occupying)) ok = true;
      if (decision && decision.tables && decision.tables.includes(t) && decision.otherBookingId === occupying.id) ok = true;
      if (!ok) {
        this.toast('Tavolo ' + t + ' è occupato da ' + occupying.name + ' su questa data/servizio — tocca di nuovo il tavolo per condividerlo', 'warning');
        this.state.formSharedTableDecision = null;
        this._formTableSet.delete(t);
        this._formTable = this._formTableSet.size > 0 ? Array.from(this._formTableSet).join(', ') : null;
        this.updateFormTableSelected();
        this.populateFormTablePicker();
        return;
      }
    }
    }

    // Ultimo controllo capienza appena prima di salvare — non solo l'avviso
    // sotto al picker, che si può aver visto e ignorato per sbaglio (o non
    // notato affatto, es. modificando una prenotazione esistente).
    const finishSave = () => {
      const capacityIssue = this._checkCapacityIssue();
      if (capacityIssue) {
        this.openCapacityConfirmModal(capacityIssue, () => this._submitForm());
        return;
      }
      this._submitForm();
    };

    // Cliente hotel con lo stesso nome già registrato in un'ALTRA camera,
    // con un soggiorno ancora aperto — potrebbe aver semplicemente
    // cambiato camera. Non lo si può sapere con certezza da soli, quindi
    // si chiede, invece di indovinare (sbagliare qui vorrebbe dire
    // collegare due persone diverse, o perdere il conteggio di chi è
    // davvero la stessa persona).
    if (isHotelGuest) {
      const guestName = document.getElementById('fName').value.trim();
      const roomNumber = document.getElementById('fRoomNumber').value.trim();
      const openElsewhere = Bookings.findOpenStayByNameInOtherRoom(guestName, roomNumber, Utils.todayISO());
      if (openElsewhere) {
        this.openRoomChangeCheckModal(guestName, openElsewhere, () => {
          // "Ha cambiato camera": la data di partenza già nota si
          // precompila da sola, così questa prenotazione si collega
          // correttamente allo stesso soggiorno (stessa camera nuova +
          // stessa partenza = stesso conteggio).
          document.getElementById('fDepartureDate').value = openElsewhere.departureDate;
          this.refreshHotelVisitHint();
          finishSave();
        }, () => {
          // "Persona diversa": procede così com'è, resta un soggiorno a sé.
          finishSave();
        });
        return;
      }
    }

    finishSave();
  },

  /**
   * Ritorna i dettagli del problema di capienza sui tavoli attualmente
   * selezionati, o null se non c'è nulla da segnalare (capienza sufficiente
   * o non configurata su nessuno dei tavoli scelti).
   */
  _checkCapacityIssue() {
    const selected = this._formTableSet ? Array.from(this._formTableSet) : [];
    const people = this._peopleValue || 0;
    if (selected.length === 0 || people === 0) return null;
    let totalCapacity = 0;
    let anyConfigured = false;
    selected.forEach(t => {
      const cap = SharedTables.getCapacity(this.state.formTableZone, t);
      if (cap) { totalCapacity += cap; anyConfigured = true; }
    });
    if (!anyConfigured || totalCapacity >= people) return null;
    return { tables: selected, totalCapacity, people };
  },

  /**
   * Conferma professionale prima di salvare una prenotazione dove i tavoli
   * scelti risultano troppo piccoli per il numero di persone — non blocca,
   * ma costringe a un secondo pensiero esplicito invece di lasciar passare
   * l'avviso inosservato.
   */
  openCapacityConfirmModal(issue, onConfirm) {
    let modal = document.getElementById('capacityConfirmModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'capacityConfirmModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    modal.innerHTML =
      '<div class="modal-sheet capacity-confirm-sheet">' +
        '<div class="capacity-confirm-icon">⚠️</div>' +
        '<h3>Tavolo forse troppo piccolo</h3>' +
        '<p style="font-size:14px;color:var(--color-ink-soft);line-height:1.5">' +
          'Il tavolo' + (issue.tables.length > 1 ? 'i ' + issue.tables.join('+') : ' ' + issue.tables[0]) +
          ' regge' + (issue.tables.length > 1 ? 'ono' : '') + ' fino a <strong>' + issue.totalCapacity + ' persone</strong>, ' +
          'ma la prenotazione è per <strong>' + issue.people + '</strong>.' +
        '</p>' +
        '<p style="font-size:13px;color:var(--color-ink-soft)">Ricontrolla il tavolo prima di continuare, o salva comunque se sei sicuro.</p>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="modal-btn-cancel" id="capacityConfirmBack">Torna indietro</button>' +
          '<button class="modal-btn-confirm" id="capacityConfirmProceed" style="background:var(--color-warning)">Salva comunque</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');
    modal.querySelector('#capacityConfirmBack').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#capacityConfirmProceed').addEventListener('click', () => {
      modal.classList.remove('active');
      onConfirm();
    });
  },

  async _submitForm() {
    this.showSyncIndicator(true);
    // Ricostruisce le note: la parte scritta a mano nel form, più le
    // tracce/marcatori (pagamento, spostamenti) letti freschi dalla
    // prenotazione attuale — così modificare il testo visibile non cancella
    // mai per sbaglio un pagamento registrato in precedenza. L'evento invece
    // si prende dal checkbox/campi del form: qui si può accendere,
    // spegnere o aggiornare menu e richieste direttamente.
    const currentBooking = this.state.editingBookingId ? Bookings.getById(this.state.editingBookingId) : null;
    const existing = Bookings.splitNotes(currentBooking ? currentBooking.notes : '');
    const newUserNotes = document.getElementById('fNotes').value.trim();
    const noteParts = [newUserNotes, ...existing.traces];
    if (existing.payment) noteParts.push(Bookings.PAYMENT_MARK + ' ' + existing.payment.amount.toFixed(2) + '€ ' + existing.payment.method);
    const isEventoNow = document.getElementById('fIsEvento').checked;
    if (isEventoNow) {
      const eventoDetails = {
        menu: document.getElementById('fEventoMenu').value.trim(),
        vino: document.getElementById('fEventoVino').value.trim(),
        richieste: document.getElementById('fEventoRichieste').value.trim(),
        costo: document.getElementById('fEventoCosto').value.trim(),
        statoPagamento: document.getElementById('fEventoPagamento').value,
      };
      noteParts.push(Bookings._eventoMarker(eventoDetails));
    }
    // Il provvisorio non ha un campo diretto nel form (si accende dalla
    // scheda "tavolo condiviso" quando si lascia vuoto l'orario) — si
    // preserva così com'era finché non lo tocca quella scheda.
    if (existing.isProvisional) noteParts.push(Bookings.PROVISIONAL_MARK);
    if (document.getElementById('fIsFixedTable').checked) noteParts.push(Bookings.NO_MOVE_MARK);
    if (document.getElementById('fIsWorkerMenu').checked) noteParts.push(Bookings.WORKER_MENU_MARK);
    if (this.state.formCustomerId) noteParts.push('👤cliente:' + this.state.formCustomerId);
    // Cliente hotel — letto dai campi del form, non da quello che aveva
    // prima: così togliere la spunta durante una modifica lo rimuove
    // davvero, non resta appeso per sempre.
    if (document.getElementById('fIsHotelGuest')?.checked) {
      const roomNumber = document.getElementById('fRoomNumber').value.trim();
      const mealPlan = document.querySelector('#fMealPlanToggle button.active')?.dataset.plan || 'mezza_pensione';
      const departureDate = document.getElementById('fDepartureDate').value;
      noteParts.push(Bookings._hotelMarker(roomNumber, mealPlan, departureDate));
    }

    // Asporto — stessa idea: letto dai campi del form, così togliere la
    // spunta durante una modifica lo rimuove davvero.
    if (document.getElementById('fIsTakeaway')?.checked) {
      const items = document.getElementById('fTakeawayItems').value.trim().replace(/ · /g, ', ');
      if (items) noteParts.push(Bookings.TAKEAWAY_MARK_PREFIX + items);
    }

    const data = {
      name: document.getElementById('fName').value,
      phone: this.combinePhoneFromForm(),
      people: this._peopleValue,
      date: document.getElementById('fDate').value,
      time: this._selectedTime,
      service: this._formService,
      zone: this.state.formZone,
      tablesAssigned: this._formTable || null,
      // Non c'è più un campo dedicato nel form — si preserva quello che la
      // prenotazione aveva già (impostato dalla scheda "tavolo condiviso"
      // o dalla scorciatoia rapida in piantina), altrimenti si perderebbe
      // ogni volta che si modifica una prenotazione già collegata.
      doubleShiftRelease: currentBooking ? currentBooking.doubleShiftRelease : null,
      dogs: this._dogsValue,
      highchairs: this._highchairsValue || 0,
      intolerances: document.getElementById('fIntolerances').value,
      allergyConsent: this._formAllergyConsent || null,
      specialNeeds: document.getElementById('fSpecialNeeds').value,
      notes: noteParts.filter(Boolean).join(' · '),
      // Se tolgono la spunta lista d'attesa/asporto da una prenotazione che
      // lo era (hanno trovato un tavolo, ora è reale), lo stato torna
      // Confermata invece di restare bloccato su uno stato senza più senso.
      status: document.getElementById('fIsWaitlist')?.checked
        ? STATUS.WAITLIST
        : document.getElementById('fIsTakeaway')?.checked
        ? STATUS.TAKEAWAY
        : ((this.state.formStatus === STATUS.WAITLIST || this.state.formStatus === STATUS.TAKEAWAY) ? STATUS.CONFIRMED : this.state.formStatus),
    };
    let myBookingId = this.state.editingBookingId;
    let saveSucceeded = false;
    try {
      if (myBookingId) {
        await Bookings.update(myBookingId, data);
      } else {
        const created = await Bookings.create(data);
        myBookingId = created ? created.id : null;
      }
      // Applica la decisione presa nella scheda "tavolo condiviso" (se ce
      // n'è una in sospeso per il tavolo effettivamente salvato) — va fatto
      // ORA perché per una prenotazione nuova serve il suo id, che prima
      // di questo momento non esiste ancora.
      const decision = this.state.formSharedTableDecision;
      if (myBookingId && decision && this._formTableSet && decision.tables.some(t => this._formTableSet.has(t))) {
        await Bookings.applySharedTableDecision(myBookingId, decision.otherBookingId, decision.releaseTime, decision.iAmEarlier);
      }
      saveSucceeded = true;
    } catch(err) {
      this.toast('Errore nel salvataggio', 'warning');
    }
    this.state.formSharedTableDecision = null;
    this.showSyncIndicator(false);
    this.state.selectedDate = data.date;
    this.state.selectedService = data.service;
    // Stesso principio del pulsante "indietro" — un chef principale
    // torna alla sua vista, non alla dashboard admin.
    this.showScreen(DB.isHeadChef() ? 'readonly' : 'dashboard');
    if (saveSucceeded && myBookingId) this.openBookingConfirmationModal(myBookingId, data);
  },

  /**
   * Riepilogo dopo il salvataggio — sostituisce il vecchio tostino: un
   * elenco ordinato si verifica al volo molto più facilmente di quattro
   * campi del form riletti uno per uno, proprio dove capitano più spesso
   * gli errori (giorno sbagliato, orario sbagliato, tavolo sbagliato).
   * Centrata e più grande delle altre schede (quelle a foglio dal basso),
   * per distinguerla come il momento di verifica finale. Sparisce da sola
   * dopo 10 secondi se non si tocca nulla.
   */
  openBookingConfirmationModal(bookingId, data) {
    let modal = document.getElementById('bookingConfirmModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'bookingConfirmModal';
      modal.className = 'modal-overlay modal-overlay-centered';
      document.getElementById('app').appendChild(modal);
    }
    const dateLabel = this.bookingSummaryDateLabel(data.date);
    const zoneLabel = ZONE_LABELS[data.zone] || '';
    const tableLabel = data.tablesAssigned || '—';
    const name = data.name || 'Senza nome';
    const rows = [
      ['Data', dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)],
      ['Orario', data.time],
      ['Coperti', String(data.people)],
      ['Cliente', name],
    ];
    if (data.highchairs > 0) rows.push(['Seggiolini', String(data.highchairs)]);
    if (data.dogs > 0) rows.push(['Cani', String(data.dogs)]);
    if (zoneLabel) rows.push(['Zona', zoneLabel]);
    rows.push(['Tavolo', tableLabel]);

    modal.innerHTML =
      '<div class="modal-sheet modal-sheet-centered">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
          '<span style="font-size:24px">✅</span>' +
          '<h3 style="margin:0">Prenotazione salvata</h3>' +
        '</div>' +
        '<div class="booking-confirm-summary">' +
          rows.map(([label, value]) =>
            '<div class="booking-confirm-row"><span class="booking-confirm-label">' + label + '</span><span class="booking-confirm-value">' + this.escapeHTML(value) + '</span></div>'
          ).join('') +
        '</div>' +
        '<div class="modal-actions booking-confirm-actions">' +
          '<button class="modal-btn-confirm" id="bookingConfirmEdit" style="background:var(--color-primary)">Modifica prenotazione</button>' +
          '<button class="modal-btn-cancel" id="bookingConfirmDelete" style="color:var(--color-danger)">Segna come cancellata</button>' +
          '<button class="modal-btn-cancel" id="bookingConfirmClose">Chiudi</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');

    let autoTimer = setTimeout(() => modal.classList.remove('active'), 10000);
    const closeModal = () => { clearTimeout(autoTimer); modal.classList.remove('active'); };

    modal.querySelector('#bookingConfirmClose').addEventListener('click', closeModal);
    modal.querySelector('#bookingConfirmEdit').addEventListener('click', () => {
      closeModal();
      this.openEditForm(bookingId);
    });
    modal.querySelector('#bookingConfirmDelete').addEventListener('click', async () => {
      if (!confirm('Segnare questa prenotazione come cancellata?')) return;
      closeModal();
      this.showSyncIndicator(true);
      await Bookings.markCancelled(bookingId);
      this.showSyncIndicator(false);
      this.toast('Prenotazione cancellata');
      if (this.state.currentScreen === 'list') this.renderList();
      else this.renderDashboard();
    });
  },

  confirmDelete() { document.getElementById('deleteModal').classList.add('active'); },

  async executeDelete() {
    if (this.state.editingBookingId && DB.canEdit()) {
      this.showSyncIndicator(true);
      await Bookings.archive(this.state.editingBookingId, DB.getOperatorWithDevice());
      this.showSyncIndicator(false);
      this.toast('Prenotazione archiviata');
    }
    document.getElementById('deleteModal').classList.remove('active');
    this.showScreen('dashboard');
  },

  // CONFIGURAZIONE
  // STATISTICHE
  renderStats() {
    if (!this.state.statsRange) this.state.statsRange = 'week';
    document.querySelectorAll('#statsRangeTabs button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === this.state.statsRange);
    });

    const todayISO = Utils.todayISO();
    let fromISO, toISO;
    if (this.state.statsRange === 'today') {
      fromISO = toISO = todayISO;
    } else if (this.state.statsRange === 'week') {
      fromISO = this.shiftDate(todayISO, -6);
      toISO = todayISO;
    } else if (this.state.statsRange === 'month') {
      fromISO = this.shiftDate(todayISO, -29);
      toISO = todayISO;
    } else {
      const fromInput = document.getElementById('statsFromDate');
      const toInput = document.getElementById('statsToDate');
      if (!fromInput.value) fromInput.value = this.shiftDate(todayISO, -6);
      if (!toInput.value) toInput.value = todayISO;
      fromISO = fromInput.value;
      toISO = toInput.value;
    }

    const bookings = Stats.filterRange(Bookings.getCached(), fromISO, toISO);
    const s = Stats.summary(bookings);
    const byService = Stats.byService(bookings);
    const byTime = Stats.byTimeSlot(bookings).filter(t => t.covers > 0);
    const byWeekday = Stats.byWeekday(bookings);
    const topCustomers = Stats.topCustomers(bookings, 8);
    const tableUsage = Stats.tableUsage(bookings).slice(0, 8);
    const turnovers = Stats.tableTurnovers(bookings);
    const turnoverByTable = turnovers.byTable.slice(0, 8);

    const pct = (n) => Math.round(n * 100) + '%';
    const maxTimeCovers = Math.max(1, ...byTime.map(t => t.covers));
    const maxWeekdayCovers = Math.max(1, ...byWeekday.map(w => w.covers));
    const maxTableCount = Math.max(1, ...tableUsage.map(t => t.count));
    const maxTurnoverCount = Math.max(1, ...turnoverByTable.map(t => t.count));

    const archived = Bookings.getArchived(fromISO, toISO);
    const payments = Stats.paymentsSummary(bookings);

    const card = (label, value, sub) =>
      '<div class="stats-card"><div class="stats-card-value">' + value + '</div>' +
      '<div class="stats-card-label">' + label + '</div>' +
      (sub ? '<div class="stats-card-sub">' + sub + '</div>' : '') + '</div>';

    const barRow = (label, value, max, valueText, colorVar) =>
      '<div class="stats-bar-row">' +
        '<span class="stats-bar-label">' + this.escapeHTML(label) + '</span>' +
        '<div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + Math.max(4, (value / max) * 100) + '%;background:var(' + (colorVar || '--color-primary') + ')"></div></div>' +
        '<span class="stats-bar-value">' + valueText + '</span>' +
      '</div>';

    const html =
      '<div class="stats-cards-grid">' +
        card('Coperti totali', s.totalCovers, s.activeBookings + ' prenotazioni') +
        card('Persone medie', s.avgPartySize.toFixed(1), 'per prenotazione') +
        card('No-show', s.noShowCount, pct(s.noShowRate) + ' sul totale') +
        card('Cancellazioni', s.cancelledCount, pct(s.cancelRate) + ' sul totale') +
        card('Prenotati', s.regularCount, s.regularCovers + ' coperti') +
        card('Walk-in', s.walkinCount, s.walkinCovers + ' coperti · ' + pct(s.walkinRate)) +
        card('Ritardi', s.lateCount, pct(s.lateRate) + ' degli arrivati') +
        card('Ricambi tavolo', turnovers.total, 'stesso tavolo, stesso servizio') +
      '</div>' +

      '<div class="config-section">' +
        '<details class="stats-archive-details">' +
          '<summary><h3 style="display:inline">🗄️ Archivio — controllo interno (' + archived.length + ')</h3></summary>' +
          '<p style="font-size:12px;color:var(--color-ink-soft);margin:8px 0 12px">Prenotazioni rimosse dalle liste in questo periodo: chi le ha create e chi le ha archiviate.</p>' +
          (archived.length
            ? archived.map(b =>
                '<div class="stats-customer-row" style="align-items:flex-start;flex-direction:column;gap:4px">' +
                  '<div style="display:flex;justify-content:space-between;width:100%">' +
                    '<strong>' + this.escapeHTML(b.name || 'Senza nome') + '</strong>' +
                    '<span style="font-size:12px;color:var(--color-ink-soft)">' + Utils.formatDateShort(b.date) + ' · ' + b.time + '</span>' +
                  '</div>' +
                  '<div style="font-size:12px;color:var(--color-ink-soft)">Creata da: ' + this.escapeHTML(b.createdBy || 'sconosciuto') + '</div>' +
                  (Bookings.splitNotes(b.notes).userNotes ? '<div style="font-size:12px;color:var(--color-warning);font-weight:600">' + this.escapeHTML(Bookings.splitNotes(b.notes).userNotes) + '</div>' : '') +
                '</div>'
              ).join('')
            : '<p style="font-size:13px;color:var(--color-ink-soft)">Nessuna prenotazione archiviata nel periodo.</p>') +
        '</details>' +
      '</div>' +

      '<div class="config-section">' +
        '<h3>💶 Pagamenti registrati</h3>' +
        '<p style="font-size:12px;color:var(--color-ink-soft);margin-bottom:12px">Incassi dichiarati manualmente (es. tavoli "amico") — non sostituisce la cassa, è un riscontro.</p>' +
        (payments.entries.length ? (
          '<div class="stats-cards-grid" style="margin-bottom:12px">' +
            card('Totale', payments.total.toFixed(2) + '€', payments.entries.length + ' pagamenti') +
            Object.entries(payments.byMethod).map(([m, amt]) =>
              card(m.charAt(0).toUpperCase() + m.slice(1), amt.toFixed(2) + '€', '')
            ).join('') +
          '</div>' +
          '<details class="stats-archive-details">' +
            '<summary><strong style="font-size:13px">Elenco pagamenti (' + payments.entries.length + ')</strong></summary>' +
            '<div style="margin-top:8px">' +
            payments.entries.map(e =>
              '<div class="stats-customer-row">' +
                '<div><strong>' + this.escapeHTML(e.name || 'Senza nome') + '</strong>' +
                  '<div style="font-size:12px;color:var(--color-ink-soft)">' + Utils.formatDateShort(e.date) + ' · ' + e.time + ' · ' + this.escapeHTML(e.method) + '</div></div>' +
                '<span class="stats-customer-visits">' + e.amount.toFixed(2) + '€</span>' +
              '</div>'
            ).join('') +
            '</div>' +
          '</details>'
        ) : '<p style="font-size:13px;color:var(--color-ink-soft)">Nessun pagamento registrato nel periodo.</p>') +
      '</div>' +

      '<div class="config-section">' +
        '<h3>Pranzo vs Cena</h3>' +
        barRow('Pranzo', byService.lunch, Math.max(1, byService.lunch, byService.dinner), byService.lunch + ' cop.', '--color-warning') +
        barRow('Cena', byService.dinner, Math.max(1, byService.lunch, byService.dinner), byService.dinner + ' cop.', '--color-primary') +
      '</div>' +

      '<div class="config-section">' +
        '<h3>Richieste speciali</h3>' +
        '<div class="stats-cards-grid">' +
          card('🐾 Cani', s.dogsCount, '') +
          card('Seggiolini', s.highchairsCount, '') +
          card('⚠️ Intolleranze', s.intolerancesCount, 'prenotazioni') +
        '</div>' +
      '</div>' +

      (byTime.length ? '<div class="config-section"><h3>Orari di punta (coperti)</h3>' +
        byTime.map(t => barRow(t.time, t.covers, maxTimeCovers, t.covers + ' cop. · ' + t.count + ' pren.')).join('') +
      '</div>' : '') +

      '<div class="config-section"><h3>Giorni della settimana (coperti)</h3>' +
        byWeekday.filter(w => w.covers > 0).map(w => barRow(w.label, w.covers, maxWeekdayCovers, String(w.covers))).join('') +
      '</div>' +

      (tableUsage.length ? '<div class="config-section"><h3>Tavoli più usati</h3>' +
        tableUsage.map(t => barRow('Tavolo ' + t.table, t.count, maxTableCount, t.count + '×')).join('') +
      '</div>' : '') +

      (turnoverByTable.length ? '<div class="config-section"><h3>🔄 Ricambi per tavolo</h3>' +
        '<p style="font-size:12px;color:var(--color-ink-soft);margin-bottom:12px">Stesso tavolo rivenduto più volte nello stesso servizio.</p>' +
        turnoverByTable.map(t => barRow('Tavolo ' + t.table, t.count, maxTurnoverCount, t.count + '×', '--color-info')).join('') +
      '</div>' : '') +

      (topCustomers.length ? '<div class="config-section"><h3>Clienti abituali</h3>' +
        topCustomers.map(c =>
          '<div class="stats-customer-row">' +
            '<div><strong>' + this.escapeHTML(c.name || 'Senza nome') + '</strong>' +
            '<div style="font-size:12px;color:var(--color-ink-soft)">' + this.escapeHTML(c.phone) + '</div></div>' +
            '<span class="stats-customer-visits">' + c.visits + ' visite</span>' +
          '</div>'
        ).join('') +
      '</div>' : '<div class="config-section"><p style="font-size:13px;color:var(--color-ink-soft)">Nessun cliente con più visite nel periodo (serve il numero di telefono salvato).</p></div>');

    document.getElementById('statsContent').innerHTML = html;
  },

  /**
   * Sblocco temporaneo delle sezioni riservate — chiede il PIN/password di
   * Luca o Davy, non cambia la sessione attuale (resti tracciato come te
   * stesso), vale solo finché non chiudi l'app o fai logout.
   */
  openAdminElevateModal() {
    let modal = document.getElementById('adminElevateModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'adminElevateModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    modal.innerHTML =
      '<div class="modal-sheet capacity-confirm-sheet">' +
        '<div class="capacity-confirm-icon">🔒</div>' +
        '<h3>Sblocca sezione riservata</h3>' +
        '<p style="font-size:13px;color:var(--color-ink-soft)">Inserisci il PIN di Luca o Davy per continuare.</p>' +
        '<div class="field-group" style="width:100%">' +
          '<input type="password" class="text-input" id="adminElevateInput" placeholder="PIN o password" autocomplete="off" style="text-align:center;font-size:20px;letter-spacing:0.2em">' +
        '</div>' +
        '<p class="setup-error hidden" id="adminElevateError" style="margin:0">PIN non corretto.</p>' +
        '<div class="modal-actions" style="margin-top:8px">' +
          '<button class="modal-btn-cancel" id="adminElevateCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="adminElevateConfirm" style="background:var(--color-primary)">Sblocca</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');
    const input = modal.querySelector('#adminElevateInput');
    input.focus();

    const attempt = async () => {
      const ok = await DB.elevate(input.value.trim());
      if (ok) {
        modal.classList.remove('active');
        this.toast('Sezione sbloccata ✓');
        this.renderConfig();
      } else {
        modal.querySelector('#adminElevateError').classList.remove('hidden');
        input.value = '';
        input.focus();
      }
    };

    modal.querySelector('#adminElevateCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#adminElevateConfirm').addEventListener('click', attempt);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  },

  renderConfig() {
    const cfg = Config.load();

    // Scheda "sezione riservata" — visibile solo a chi non ha ancora
    // sbloccato, sparisce da sola una volta inserito il PIN giusto.
    const lockedCard = document.getElementById('cfgAdminLockedCard');
    if (lockedCard) lockedCard.classList.toggle('hidden', DB.isFullAdmin());

    // Sezioni strutturali (Tavoli/Orari/Slot/Doppio turno): solo admin pieno
    const fullAdminSection = document.getElementById('cfgFullAdminSection');
    if (fullAdminSection) fullAdminSection.style.display = DB.isFullAdmin() ? '' : 'none';

    // Mostra editor zone+tavoli solo per admin pieno
    const ztSection = document.getElementById('cfgZoneTavoliSection');
    if (ztSection) ztSection.style.display = DB.isFullAdmin() ? '' : 'none';
    if (DB.isFullAdmin()) this.renderZoneTavoliEditor();

    // Editor piantina: solo admin pieno. Prima era limitato a mouse/trackpad
    // (pointer:fine) perché il trascinamento touch confliggeva con lo scroll
    // della pagina — ora risolto con touch-action:none sui tavoli, quindi
    // funziona anche da tablet, che è dove serve davvero.
    const piantinaSection = document.getElementById('cfgPiantinaSection');
    const showPiantinaEditor = DB.isFullAdmin();
    if (piantinaSection) piantinaSection.style.display = showPiantinaEditor ? '' : 'none';
    if (showPiantinaEditor) {
      const date = this.state.selectedDate;
      const service = this.state.selectedService || Utils.currentService();
      this.renderPiantina('cfgPiantinaBox', date, service, true);
    }
    // Statistiche: solo admin pieno
    const statsSection = document.getElementById('cfgStatsSection');
    if (statsSection) statsSection.style.display = DB.isFullAdmin() ? '' : 'none';

    // Nomi staff per l'accesso condiviso: solo admin pieno
    const staffNamesSection = document.getElementById('cfgStaffNamesSection');
    if (staffNamesSection) staffNamesSection.style.display = DB.isFullAdmin() ? '' : 'none';
    if (DB.isFullAdmin()) this.renderStaffNamesEditor();

    // PIN dipendenti: solo admin pieno — qui mancava il toggle esplicito,
    // si affidava solo al giro una tantum al login (che non rivedeva mai
    // lo sblocco successivo con PIN).
    const employeePinsSection = document.getElementById('cfgEmployeePinsSection');
    if (employeePinsSection) employeePinsSection.style.display = DB.isFullAdmin() ? '' : 'none';
    if (DB.isFullAdmin()) this.renderEmployeePinsEditor();

    // Password condivisa tablet: stesso trattamento — solo admin pieno
    const sharedPasswordSection = document.getElementById('cfgSharedPasswordSection');
    if (sharedPasswordSection) sharedPasswordSection.style.display = DB.isFullAdmin() ? '' : 'none';

    // Chiusure: chi può modificare (admin/staff), non solo admin pieno
    const closuresSection = document.getElementById('cfgClosuresSection');
    if (closuresSection) closuresSection.style.display = DB.canEdit() ? '' : 'none';
    if (DB.canEdit()) this.renderClosuresEditor();

    // Chiusure di zona: stesso trattamento delle chiusure generali
    const zoneClosuresSection = document.getElementById('cfgZoneClosuresSection');
    if (zoneClosuresSection) zoneClosuresSection.style.display = DB.canEdit() ? '' : 'none';
    if (DB.canEdit()) this.renderZoneClosuresEditor();

    // Vini al calice: stesso trattamento delle chiusure generali
    const winesSection = document.getElementById('cfgWinesByGlassSection');
    if (winesSection) winesSection.style.display = DB.canEdit() ? '' : 'none';
    // Vini al calice: sezione tolta (carta vini su Cantina360)

    // PIN amministratore (Luca/Davy): stesso trattamento
    const adminPinsSection = document.getElementById('cfgAdminPinsSection');
    if (adminPinsSection) adminPinsSection.style.display = DB.isFullAdmin() ? '' : 'none';
    if (DB.isFullAdmin()) this.renderAdminPinsEditor();

    // Sicurezza accessi — reset totale e codice tablet
    const securitySection = document.getElementById('cfgSecuritySection');
    if (securitySection) securitySection.style.display = DB.isFullAdmin() ? '' : 'none';
    if (DB.isFullAdmin()) {
      const codeInput = document.getElementById('cfgTabletEditCodeInput');
      if (codeInput) codeInput.value = SharedTables.getTabletEditCode() || '';
    }

    // PIN cuochi — un elenco vero, un profilo per cuoco, come i dipendenti.
    const chefPinSection = document.getElementById('cfgChefPinsSection');
    if (chefPinSection) chefPinSection.style.display = DB.isFullAdmin() ? '' : 'none';
    if (DB.isFullAdmin()) this.renderChefPinsEditor();

    if (DB.isFullAdmin()) {
      document.getElementById('cfgTablesIndoor').value = cfg.tablesIndoor;
      document.getElementById('cfgTablesOutdoor').value = cfg.tablesOutdoor;
      document.getElementById('cfgLunchStart').value = cfg.services.lunch.start;
      document.getElementById('cfgLunchEnd').value = cfg.services.lunch.end;
      document.getElementById('cfgDinnerStart').value = cfg.services.dinner.start;
      document.getElementById('cfgDinnerEnd').value = cfg.services.dinner.end;
      document.getElementById('cfgSlotDuration').value = cfg.slotDurationMinutes;
      document.getElementById('cfgMaxPerSlot').value = cfg.maxBookingsPerSlot;
    }

    // Ruolo e operatore attuale
    const roleEl = document.getElementById('cfgRole');
    const roleLabels = { admin: 'Admin', staff: 'Staff', read: 'Lettura' };
    if (roleEl) roleEl.textContent = roleLabels[DB.getRole()] || 'Lettura';

    const operatorRow = document.getElementById('cfgOperatorRow');
    const operatorNameEl = document.getElementById('cfgOperatorName');
    const switchBtn = document.getElementById('cfgSwitchOperatorBtn');
    const showOperator = DB.getRole() === 'staff';
    if (operatorRow) operatorRow.classList.toggle('hidden', !showOperator);
    if (operatorNameEl) operatorNameEl.textContent = DB.getOperator() || '—';
    if (switchBtn) switchBtn.classList.toggle('hidden', !showOperator);

    // Dispositivo: visibile se già etichettato, o se questo è un accesso
    // staff condiviso (dove ha senso poterlo impostare/correggere)
    const deviceRow = document.getElementById('cfgDeviceRow');
    const deviceNameEl = document.getElementById('cfgDeviceName');
    const editDeviceBtn = document.getElementById('cfgEditDeviceBtn');
    const showDevice = !!DB.getDeviceLabel() || DB.getRole() === 'staff';
    if (deviceRow) deviceRow.classList.toggle('hidden', !showDevice);
    if (deviceNameEl) deviceNameEl.textContent = DB.getDeviceLabel() || 'Non impostato';
    if (editDeviceBtn) editDeviceBtn.classList.toggle('hidden', !showDevice);
  },

  /**
   * Editor dei nomi staff (solo admin pieno) per la selezione rapida
   * "chi sei" sull'accesso condiviso.
   */
  renderStaffNamesEditor() {
    const container = document.getElementById('cfgStaffNamesList');
    if (!container) return;
    const names = SharedTables.getStaffNames();
    container.innerHTML = names.map((name, i) =>
      '<div class="config-row" data-idx="' + i + '">' +
        '<input type="text" class="text-input staff-name-input" value="' + this.escapeHTML(name) + '" style="flex:1">' +
        '<button type="button" class="icon-btn staff-name-remove" title="Rimuovi">🗑️</button>' +
      '</div>'
    ).join('');

    const persist = async () => {
      const updatedNames = Array.from(container.querySelectorAll('.staff-name-input'))
        .map(inp => inp.value.trim()).filter(Boolean);
      await SharedTables.saveStaffNames(updatedNames);
    };

    container.querySelectorAll('.staff-name-input').forEach(inp => {
      inp.addEventListener('change', persist);
    });
    container.querySelectorAll('.staff-name-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.closest('.config-row').remove();
        await persist();
      });
    });
  },

  /**
   * Editor PIN dipendenti — solo Luca/Davy lo vedono (sezione fulladmin-only
   * già gestita a livello di visibilità). Ogni riga: nome + PIN, modificabili
   * sul posto; il PIN deve essere numerico di 4-6 cifre e diverso dagli altri.
   */
  /**
   * Editor PIN amministratore — Luca/Davy si impostano il proprio PIN
   * corto da soli, al posto (o accanto) alla password lunga fissa. Stessa
   * struttura dell'editor dipendenti, ma questi danno accesso admin pieno.
   */
  renderAdminPinsEditor() {
    const container = document.getElementById('cfgAdminPinsList');
    if (!container) return;
    const pins = SharedTables.getAdminPins();
    if (pins.length === 0) {
      container.innerHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessun PIN impostato ancora — aggiungine uno per te, e uno per Davy (o viceversa).</p>';
    } else {
      container.innerHTML = pins.map(p =>
        '<div class="config-row employee-pin-row' + (p.disabled ? ' pin-row-disabled' : '') + '" data-id="' + p.id + '">' +
          '<input type="text" class="text-input admin-pin-name" value="' + this.escapeHTML(p.name) + '" placeholder="Nome">' +
          '<input type="text" class="text-input admin-pin-pin" value="" placeholder="Nuovo PIN (nascosto)" autocomplete="off" maxlength="20" style="text-align:center;letter-spacing:0.1em">' +
          '<button type="button" class="icon-btn admin-pin-toggle" title="' + (p.disabled ? 'Riattiva' : 'Sospendi temporaneamente') + '">' + (p.disabled ? '▶️' : '⏸️') + '</button>' +
          '<button type="button" class="icon-btn admin-pin-kick" title="Buttalo fuori adesso">🚪</button>' +
          '<button type="button" class="icon-btn admin-pin-remove" title="Rimuovi">🗑️</button>' +
        '</div>'
      ).join('');
    }

    container.querySelectorAll('.employee-pin-row').forEach(row => {
      const id = row.dataset.id;
      const nameInput = row.querySelector('.admin-pin-name');
      const pinInput = row.querySelector('.admin-pin-pin');

      nameInput.addEventListener('change', async () => {
        const name = nameInput.value.trim();
        if (!name) { this.toast('Il nome non può essere vuoto', 'warning'); nameInput.value = SharedTables.getAdminPins().find(p => p.id === id)?.name || ''; return; }
        if (!(await SharedTables.updateAdminPin(id, { name }))) return;
        this.toast('Nome aggiornato ✓');
      });

      pinInput.addEventListener('change', async () => {
        const pin = pinInput.value.trim();
        if (!pin) return; // vuoto = PIN invariato
        const valid = /^.{4,20}$/.test(pin);
        if (!valid) {
          this.toast('Deve avere almeno 4 caratteri (massimo 20)', 'warning');
          pinInput.value = SharedTables.getAdminPins().find(p => p.id === id)?.pin || '';
          return;
        }
        if (SharedTables.isPinTaken(pin, id)) {
          this.toast('PIN già usato da un altro dipendente o amministratore', 'warning');
          pinInput.value = SharedTables.getAdminPins().find(p => p.id === id)?.pin || '';
          return;
        }
        if (!(await SharedTables.updateAdminPin(id, { pin }))) return;
        pinInput.value = '';
        this.toast('PIN aggiornato ✓');
      });

      row.querySelector('.admin-pin-toggle').addEventListener('click', async () => {
        const current = SharedTables.getAdminPins().find(p => p.id === id);
        if (!current) return;
        const nowDisabled = !current.disabled;
        if (!(await SharedTables.updateAdminPin(id, { disabled: nowDisabled }))) return;
        this.renderAdminPinsEditor();
        this.toast(nowDisabled ? 'Sospeso — non può più entrare finché non lo riattivi' : 'Riattivato ✓');
      });

      row.querySelector('.admin-pin-kick').addEventListener('click', async () => {
        const name = SharedTables.getAdminPins().find(p => p.id === id)?.name || 'questa persona';
        await SharedTables.kickOperator(name);
        this.toast(name + ' buttato fuori — esce entro pochi secondi da ogni dispositivo dove è collegato');
      });

      row.querySelector('.admin-pin-remove').addEventListener('click', async () => {
        const name = SharedTables.getAdminPins().find(p => p.id === id)?.name || 'questo PIN';
        if (!confirm('Rimuovere ' + name + '? La password lunga resta comunque valida.')) return;
        if (!(await SharedTables.removeAdminPin(id))) return;
        this.renderAdminPinsEditor();
        this.toast('PIN rimosso ✓');
      });
    });
  },

  /**
   * Elenco chiusure con un tasto per rimuoverle — l'aggiunta è nel form
   * fisso sotto (non serve un modal apposito, sono pochi campi).
   */
  renderClosuresEditor() {
    const list = document.getElementById('cfgClosuresList');
    if (!list) return;
    const closures = SharedTables.getClosures().slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (closures.length === 0) {
      list.innerHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessuna chiusura impostata.</p>';
      return;
    }
    const SERVICE_LABELS = { all: 'Tutto il giorno', lunch: 'Solo pranzo', dinner: 'Solo cena' };
    list.innerHTML = closures.map(c => {
      const rangeLabel = c.startDate === c.endDate
        ? this.dateLabel(c.startDate)
        : this.dateLabel(c.startDate) + ' → ' + this.dateLabel(c.endDate);
      return '<div class="closure-row">' +
        '<div><strong>' + this.escapeHTML(rangeLabel) + '</strong>' +
        '<span class="closure-row-meta">' + SERVICE_LABELS[c.service] + (c.reason ? ' · ' + this.escapeHTML(c.reason) : '') + '</span></div>' +
        '<button type="button" class="closure-remove-btn" data-id="' + c.id + '">🗑️</button>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.closure-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Togliere questa chiusura?')) return;
        await SharedTables.removeClosure(btn.dataset.id);
        this.renderClosuresEditor();
        this.toast('Chiusura rimossa ✓');
      });
    });
  },

  /**
   * Stessa idea di renderClosuresEditor sopra, ma per le chiusure di
   * singola zona — popola anche il selettore zona nel modulo, dato che
   * le zone sono configurabili e non fisse.
   */
  renderZoneClosuresEditor() {
    const list = document.getElementById('cfgZoneClosuresList');
    const zoneSelect = document.getElementById('cfgZoneClosureZone');
    if (!list || !zoneSelect) return;

    const zones = SharedTables.getZones();
    const currentValue = zoneSelect.value;
    zoneSelect.innerHTML = zones.map(z => '<option value="' + this.escapeHTML(z) + '">' + this.escapeHTML(z) + '</option>').join('');
    if (zones.includes(currentValue)) zoneSelect.value = currentValue;

    const closures = SharedTables.getZoneClosures().slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (closures.length === 0) {
      list.innerHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessuna chiusura di zona impostata.</p>';
      return;
    }
    const SERVICE_LABELS = { all: 'Tutto il giorno', lunch: 'Solo pranzo', dinner: 'Solo cena' };
    list.innerHTML = closures.map(c => {
      const rangeLabel = c.startDate === c.endDate
        ? this.dateLabel(c.startDate)
        : this.dateLabel(c.startDate) + ' → ' + this.dateLabel(c.endDate);
      return '<div class="closure-row">' +
        '<div><strong>' + this.escapeHTML(c.zone) + '</strong> — ' + this.escapeHTML(rangeLabel) +
        '<span class="closure-row-meta">' + SERVICE_LABELS[c.service] + (c.reason ? ' · ' + this.escapeHTML(c.reason) : '') + '</span></div>' +
        '<button type="button" class="zone-closure-remove-btn" data-id="' + c.id + '">🗑️</button>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.zone-closure-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Togliere questa chiusura di zona?')) return;
        await SharedTables.removeZoneClosure(btn.dataset.id);
        this.renderZoneClosuresEditor();
        this.toast('Chiusura di zona rimossa ✓');
      });
    });
  },

  /**
   * Lista dei vini al calice — righe compatte, tocco per modificare (una
   * scheda, dato che sono tanti campi), pulsante ✕ per togliere.
   */
  renderWinesByGlassEditor() {
    const container = document.getElementById('cfgWinesByGlassList');
    if (!container) return;
    const wines = SharedTables.getWinesByGlass();
    if (wines.length === 0) {
      container.innerHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessun vino al calice ancora — aggiungine uno qui sotto.</p>';
      return;
    }
    container.innerHTML = SharedTables.WINE_CATEGORIES.map(cat => {
      const inCat = wines.filter(w => w.categoria === cat);
      if (inCat.length === 0) return '';
      return '<div class="wine-category-group">' +
        '<h4 class="course-menu-course-title">' + cat + '</h4>' +
        inCat.map(w => '<div class="wine-row" data-id="' + w.id + '">' +
          '<div class="wine-row-info">' +
            '<strong>' + this.escapeHTML(w.nome) + '</strong>' +
            '<span>' + this.escapeHTML(w.produttore) + (w.regione ? ' · ' + this.escapeHTML(w.regione) : '') + '</span>' +
          '</div>' +
          '<span class="wine-row-price">' + (w.prezzo != null ? '€ ' + Number(w.prezzo).toFixed(2) : '') + '</span>' +
          '<button type="button" class="icon-btn wine-row-remove" title="Rimuovi">🗑️</button>' +
        '</div>').join('') +
      '</div>';
    }).join('');

    container.querySelectorAll('.wine-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.wine-row-info').addEventListener('click', () => {
        const wine = SharedTables.getWinesByGlass().find(w => w.id === id);
        if (wine) this.openWineAddModal(wine);
      });
      row.querySelector('.wine-row-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        const wine = SharedTables.getWinesByGlass().find(w => w.id === id);
        if (!confirm('Togliere "' + (wine?.nome || 'questo vino') + '"?')) return;
        await SharedTables.removeWineByGlass(id);
        this.renderWinesByGlassEditor();
        this.toast('Vino rimosso ✓ (aggiornato anche sul sito pubblico)');
      });
    });
  },

  /**
   * Scheda per aggiungere o modificare un vino al calice — più campi
   * delle proposte del giorno (produttore, regione, vitigno...), stessa
   * idea di scheda unica per aggiungere/modificare.
   */
  openWineAddModal(existing) {
    let modal = document.getElementById('wineAddModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'wineAddModal';
      modal.className = 'modal-overlay modal-overlay-centered';
      document.getElementById('app').appendChild(modal);
    }
    let selectedCat = existing ? existing.categoria : 'Bianchi';
    const v = (field) => existing ? this.escapeHTML(existing[field] || '') : '';
    modal.innerHTML =
      '<div class="modal-sheet modal-sheet-centered">' +
        '<h3 style="margin:0 0 12px">🍷 ' + (existing ? 'Modifica vino' : 'Nuovo vino al calice') + '</h3>' +
        '<div class="field-group"><label class="field-label">Categoria</label>' +
          '<div class="project-includes-grid" id="wineCatGrid">' +
            SharedTables.WINE_CATEGORIES.map(c => '<button type="button" class="project-include-chip' + (c === selectedCat ? ' active' : '') + '" data-cat="' + c + '">' + c + '</button>').join('') +
          '</div></div>' +
        '<div class="field-group"><label class="field-label">Nome del vino</label>' +
          '<input type="text" class="text-input" id="wineNome" placeholder="Es. Blanc de Morgex" value="' + v('nome') + '"></div>' +
        '<div class="field-group"><label class="field-label">Produttore</label>' +
          '<input type="text" class="text-input" id="wineProduttore" placeholder="Es. Cave Mont Blanc" value="' + v('produttore') + '"></div>' +
        '<div class="field-group"><label class="field-label">Regione (facoltativa)</label>' +
          '<input type="text" class="text-input" id="wineRegione" placeholder="Es. Valle d\'Aosta" value="' + v('regione') + '"></div>' +
        '<div class="field-group"><label class="field-label">Tipologia</label>' +
          '<input type="text" class="text-input" id="wineTipologia" placeholder="Es. Fermo, secco" value="' + v('tipologia') + '"></div>' +
        '<div class="field-group"><label class="field-label">Vitigno (facoltativo)</label>' +
          '<input type="text" class="text-input" id="wineVitigno" placeholder="Es. Prié Blanc" value="' + v('vitigno') + '"></div>' +
        '<div class="field-group"><label class="field-label">Descrizione (facoltativa)</label>' +
          '<textarea class="text-input" id="wineDescrizione" rows="2" placeholder="Note di degustazione">' + v('descrizione') + '</textarea></div>' +
        '<div class="field-group"><label class="field-label">Prezzo al calice (€)</label>' +
          '<input type="number" class="text-input" id="winePrezzo" step="0.50" min="0" inputmode="decimal" value="' + (existing && existing.prezzo != null ? existing.prezzo : '') + '"></div>' +
        '<div class="modal-actions">' +
          '<button class="modal-btn-cancel" id="wineCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="wineSave" style="background:var(--color-primary)">' + (existing ? 'Salva modifiche' : 'Aggiungi') + '</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    modal.querySelector('#wineNome').focus();

    modal.querySelectorAll('#wineCatGrid .project-include-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        selectedCat = chip.dataset.cat;
        modal.querySelectorAll('#wineCatGrid .project-include-chip').forEach(c => c.classList.toggle('active', c === chip));
      });
    });
    modal.querySelector('#wineCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#wineSave').addEventListener('click', async () => {
      const nome = modal.querySelector('#wineNome').value.trim();
      if (!nome) { this.toast('Serve almeno il nome del vino', 'warning'); return; }
      const wineData = {
        categoria: selectedCat,
        nome,
        produttore: modal.querySelector('#wineProduttore').value.trim(),
        regione: modal.querySelector('#wineRegione').value.trim(),
        tipologia: modal.querySelector('#wineTipologia').value.trim(),
        vitigno: modal.querySelector('#wineVitigno').value.trim(),
        descrizione: modal.querySelector('#wineDescrizione').value.trim(),
        prezzo: modal.querySelector('#winePrezzo').value !== '' ? Number(modal.querySelector('#winePrezzo').value) : null,
      };
      modal.classList.remove('active');
      if (existing) {
        await SharedTables.updateWineByGlass(existing.id, wineData);
        this.toast('Vino modificato ✓ (aggiornato anche sul sito pubblico)');
      } else {
        await SharedTables.addWineByGlass(wineData);
        this.toast('Vino aggiunto ✓ (aggiornato anche sul sito pubblico)');
      }
      this.renderWinesByGlassEditor();
    });
  },

  /**
   * Elenco PIN cuochi — stesso schema di quello dipendenti/admin.
   * containerId è parametrizzato (anche se oggi lo chiama solo
   * Impostazioni, col suo id di default) — visibile solo a Luca/Davy: i
   * cuochi non vedono più i PIN di nessuno, nemmeno i propri colleghi.
   * Chi tra loro deve gestire la squadra ha semplicemente anche un PIN
   * amministratore vero (stessa lista sopra), non un ruolo apposito.
   */
  renderChefPinsEditor(containerId) {
    const container = document.getElementById(containerId || 'cfgChefPinsList');
    if (!container) return;
    const pins = SharedTables.getChefPins();
    if (pins.length === 0) {
      container.innerHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessun cuoco ancora — aggiungine uno qui sotto.</p>';
    } else {
      container.innerHTML = pins.map(p =>
        '<div class="config-row employee-pin-row' + (p.disabled ? ' pin-row-disabled' : '') + '" data-id="' + p.id + '">' +
          '<input type="text" class="text-input chef-pin-name" value="' + this.escapeHTML(p.name) + '" placeholder="Nome">' +
          '<input type="text" class="text-input chef-pin-pin" value="" placeholder="Nuovo PIN (nascosto)" autocomplete="off" maxlength="20" style="text-align:center;letter-spacing:0.1em">' +
          '<button type="button" class="icon-btn chef-pin-head" title="' + (p.isHeadChef ? 'Chef principale — tocca per togliere' : 'Rendi chef principale (poteri admin dentro la sua vista)') + '">' + (p.isHeadChef ? '⭐' : '☆') + '</button>' +
          '<button type="button" class="icon-btn chef-pin-toggle" title="' + (p.disabled ? 'Riattiva' : 'Sospendi temporaneamente') + '">' + (p.disabled ? '▶️' : '⏸️') + '</button>' +
          '<button type="button" class="icon-btn chef-pin-kick" title="Buttalo fuori adesso">🚪</button>' +
          '<button type="button" class="icon-btn chef-pin-remove" title="Rimuovi">🗑️</button>' +
        '</div>'
      ).join('');
    }

    const allPins = () => SharedTables.getChefPins();
    const rerender = () => this.renderChefPinsEditor(containerId);

    container.querySelectorAll('.employee-pin-row').forEach(row => {
      const id = row.dataset.id;
      const nameInput = row.querySelector('.chef-pin-name');
      const pinInput = row.querySelector('.chef-pin-pin');

      nameInput.addEventListener('change', async () => {
        const name = nameInput.value.trim();
        if (!name) { this.toast('Il nome non può essere vuoto', 'warning'); nameInput.value = allPins().find(p => p.id === id)?.name || ''; return; }
        if (!(await SharedTables.updateChefPin(id, { name }))) return;
        this.toast('Nome aggiornato ✓');
      });

      pinInput.addEventListener('change', async () => {
        const pin = pinInput.value.trim();
        if (!pin) return; // vuoto = PIN invariato
        const valid = /^.{4,20}$/.test(pin);
        if (!valid) {
          this.toast('Deve avere almeno 4 caratteri (massimo 20)', 'warning');
          pinInput.value = allPins().find(p => p.id === id)?.pin || '';
          return;
        }
        if (SharedTables.isPinTaken(pin, id)) {
          this.toast('PIN già usato da un altro cuoco, dipendente o amministratore', 'warning');
          pinInput.value = allPins().find(p => p.id === id)?.pin || '';
          return;
        }
        if (!(await SharedTables.updateChefPin(id, { pin }))) return;
        pinInput.value = '';
        this.toast('PIN aggiornato ✓');
      });

      row.querySelector('.chef-pin-head').addEventListener('click', async () => {
        const current = allPins().find(p => p.id === id);
        if (!current) return;
        const nowHead = !current.isHeadChef;
        if (nowHead && !confirm(current.name + ' diventa chef principale: dentro la sua vista potrà aggiungere prenotazioni, modificare eventi e vedere/gestire tutti i PIN, admin compresi. Continuare?')) return;
        if (!(await SharedTables.updateChefPin(id, { isHeadChef: nowHead }))) return;
        rerender();
        this.toast(nowHead ? current.name + ' è ora chef principale ✓' : 'Poteri da chef principale tolti ✓');
      });

      row.querySelector('.chef-pin-toggle').addEventListener('click', async () => {
        const current = allPins().find(p => p.id === id);
        if (!current) return;
        const nowDisabled = !current.disabled;
        if (!(await SharedTables.updateChefPin(id, { disabled: nowDisabled }))) return;
        rerender();
        this.toast(nowDisabled ? 'Sospeso — non può più entrare finché non lo riattivi' : 'Riattivato ✓');
      });

      row.querySelector('.chef-pin-kick').addEventListener('click', async () => {
        const name = allPins().find(p => p.id === id)?.name || 'questa persona';
        await SharedTables.kickOperator(name);
        this.toast(name + ' buttato fuori — esce entro pochi secondi da ogni dispositivo dove è collegato');
      });

      row.querySelector('.chef-pin-remove').addEventListener('click', async () => {
        const name = allPins().find(p => p.id === id)?.name || 'questo cuoco';
        if (!confirm('Rimuovere il PIN di ' + name + '? Non potrà più accedere con quello finché non gliene crei uno nuovo.')) return;
        if (!(await SharedTables.removeChefPin(id))) return;
        rerender();
        this.toast('PIN rimosso ✓');
      });
    });
  },

  renderEmployeePinsEditor(containerId) {
    const container = document.getElementById(containerId || 'cfgEmployeePinsList');
    if (!container) return;
    const pins = SharedTables.getEmployeePins();
    if (pins.length === 0) {
      container.innerHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessun dipendente ancora — aggiungine uno qui sotto.</p>';
    } else {
      container.innerHTML = pins.map(p =>
        '<div class="config-row employee-pin-row' + (p.disabled ? ' pin-row-disabled' : '') + '" data-id="' + p.id + '">' +
          '<input type="text" class="text-input employee-pin-name" value="' + this.escapeHTML(p.name) + '" placeholder="Nome">' +
          '<input type="text" class="text-input employee-pin-pin" value="" placeholder="Nuovo PIN (nascosto)" autocomplete="off" maxlength="20" style="text-align:center;letter-spacing:0.1em">' +
          '<button type="button" class="icon-btn employee-pin-toggle" title="' + (p.disabled ? 'Riattiva' : 'Sospendi temporaneamente') + '">' + (p.disabled ? '▶️' : '⏸️') + '</button>' +
          '<button type="button" class="icon-btn employee-pin-kick" title="Buttalo fuori adesso">🚪</button>' +
          '<button type="button" class="icon-btn employee-pin-remove" title="Rimuovi">🗑️</button>' +
        '</div>'
      ).join('');
    }

    const allPins = () => SharedTables.getEmployeePins();
    const rerender = () => this.renderEmployeePinsEditor(containerId);

    container.querySelectorAll('.employee-pin-row').forEach(row => {
      const id = row.dataset.id;
      const nameInput = row.querySelector('.employee-pin-name');
      const pinInput = row.querySelector('.employee-pin-pin');

      nameInput.addEventListener('change', async () => {
        const name = nameInput.value.trim();
        if (!name) { this.toast('Il nome non può essere vuoto', 'warning'); nameInput.value = allPins().find(p => p.id === id)?.name || ''; return; }
        if (!(await SharedTables.updateEmployeePin(id, { name }))) return;
        this.toast('Nome aggiornato ✓');
      });

      pinInput.addEventListener('change', async () => {
        const pin = pinInput.value.trim();
        if (!pin) return; // vuoto = PIN invariato
        const valid = /^.{4,20}$/.test(pin);
        if (!valid) {
          this.toast('Deve avere almeno 4 caratteri (massimo 20)', 'warning');
          pinInput.value = allPins().find(p => p.id === id)?.pin || '';
          return;
        }
        const duplicate = SharedTables.isPinTaken(pin, id);
        if (duplicate) {
          this.toast('PIN già usato da un altro dipendente', 'warning');
          pinInput.value = allPins().find(p => p.id === id)?.pin || '';
          return;
        }
        if (!(await SharedTables.updateEmployeePin(id, { pin }))) return;
        pinInput.value = '';
        this.toast('PIN aggiornato ✓');
      });

      row.querySelector('.employee-pin-toggle').addEventListener('click', async () => {
        const current = allPins().find(p => p.id === id);
        if (!current) return;
        const nowDisabled = !current.disabled;
        if (!(await SharedTables.updateEmployeePin(id, { disabled: nowDisabled }))) return;
        rerender();
        this.toast(nowDisabled ? 'Sospeso — non può più entrare finché non lo riattivi' : 'Riattivato ✓');
      });

      row.querySelector('.employee-pin-kick').addEventListener('click', async () => {
        const name = allPins().find(p => p.id === id)?.name || 'questa persona';
        await SharedTables.kickOperator(name);
        this.toast(name + ' buttato fuori — esce entro pochi secondi da ogni dispositivo dove è collegato');
      });

      row.querySelector('.employee-pin-remove').addEventListener('click', async () => {
        const name = allPins().find(p => p.id === id)?.name || 'questo dipendente';
        if (!confirm('Rimuovere il PIN di ' + name + '? Non potrà più accedere con quello finché non gliene crei uno nuovo.')) return;
        if (!(await SharedTables.removeEmployeePin(id))) return;
        rerender();
        this.toast('PIN rimosso ✓');
      });
    });
  },

  /**
   * Modal "chi sei stasera": selezione rapida (nessuna password) per far
   * corrispondere ogni azione alla persona reale sul tablet condiviso.
   * Bloccante (senza pulsante Annulla) se non c'è ancora un operatore
   * scelto; altrimenti richiamabile in ogni momento per cambiare persona.
   */
  /**
   * "Chi sei?" — usato sia una tantum dopo il login condiviso, sia (con
   * onConfirm) come primo passo prima di prendere una prenotazione o
   * spostare un tavolo, così l'attribuzione è sempre certa anche se il
   * dispositivo passa di mano più volte nella stessa serata.
   * Il nome attualmente impostato è preselezionato per una riconferma rapida.
   */
  openOperatorPicker(blocking, opts) {
    opts = opts || {};
    let modal = document.getElementById('operatorPickerModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'operatorPickerModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const currentOperator = DB.getOperator();
    const names = SharedTables.getStaffNames();
    const nameButtons = names.map(name =>
      '<button type="button" class="piantina-style-btn' + (name === currentOperator ? ' active' : '') + '" data-name="' + this.escapeHTML(name) + '" style="width:100%;text-align:left;margin-bottom:8px;padding:14px">' +
        this.escapeHTML(name) + (name === currentOperator ? ' ✓' : '') +
      '</button>'
    ).join('');

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>' + (opts.title || 'Chi sei?') + '</h3>' +
        '<p style="font-size:13px;color:var(--color-ink-soft);margin-bottom:14px">' + (opts.subtitle || 'Ogni prenotazione registra chi l\'ha fatta.') + '</p>' +
        (names.length ? '<div>' + nameButtons + '</div>' : '<p style="font-size:13px;color:var(--color-ink-soft)">Nessun nome configurato — chiedi a Luca o Davy di aggiungerli in Impostazioni.</p>') +
        '<div class="field-group" style="margin-top:4px"><label class="field-label">Oppure scrivi il nome</label>' +
          '<input type="text" class="text-input" id="operatorPickerCustomName" placeholder="Nome"></div>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          (blocking ? '' : '<button class="modal-btn-cancel" id="operatorPickerCancel">Annulla</button>') +
          '<button class="modal-btn-confirm" id="operatorPickerConfirm" style="background:var(--color-primary)">Conferma</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');
    // Bloccante (es. "chi sei stasera" senza Annulla): non deve poter
    // essere chiusa toccando fuori, altrimenti aggirerebbe il motivo per
    // cui è bloccante — solo confermando un nome si esce da qui.
    modal.classList.toggle('modal-blocking', !!blocking);

    const confirmWith = (name) => {
      if (!name || !name.trim()) return;
      DB.setOperator(name.trim());
      modal.classList.remove('active');
      this.renderConfig();
      this.toast('Sei ' + name.trim() + ' ✓');
      // Prima volta su questo dispositivo con l'accesso condiviso: chiede
      // anche l'etichetta del dispositivo (es. "Tablet Ingresso"), una
      // volta sola per sempre — non dipende da chi si logga dopo.
      if (DB.needsDeviceLabel()) {
        this.openDeviceLabelPicker(true, opts.onConfirm);
      } else if (opts.onConfirm) {
        opts.onConfirm();
      }
    };

    modal.querySelectorAll('[data-name]').forEach(btn => {
      btn.addEventListener('click', () => confirmWith(btn.dataset.name));
    });
    const cancelBtn = modal.querySelector('#operatorPickerCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#operatorPickerConfirm').addEventListener('click', () => {
      confirmWith(modal.querySelector('#operatorPickerCustomName').value);
    });
  },

  /**
   * Etichetta del dispositivo fisico (es. "Tablet Ingresso") — così ogni
   * azione risulta fatta da quel dispositivo condiviso, indipendentemente
   * da chi lo sta usando in quel momento (o con quale password si logga).
   * Chiesta una sola volta per dispositivo, poi richiamabile da
   * Impostazioni → Account per correggerla.
   */
  openDeviceLabelPicker(blocking, onConfirm) {
    let modal = document.getElementById('deviceLabelModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'deviceLabelModal';
      modal.className = 'modal-overlay';
      document.getElementById('app').appendChild(modal);
    }

    const current = DB.getDeviceLabel() || 'Tablet Ingresso';

    modal.innerHTML =
      '<div class="modal-sheet">' +
        '<h3>Che dispositivo è questo?</h3>' +
        '<p style="font-size:13px;color:var(--color-ink-soft);margin-bottom:14px">' +
          'Serve a distinguere le azioni fatte da questo tablet condiviso da quelle fatte dal cellulare personale di un operatore. Si chiede una sola volta.' +
        '</p>' +
        '<div class="field-group"><label class="field-label">Nome dispositivo</label>' +
          '<input type="text" class="text-input" id="deviceLabelInput" value="' + this.escapeHTML(current) + '"></div>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          (blocking ? '' : '<button class="modal-btn-cancel" id="deviceLabelCancel">Annulla</button>') +
          '<button class="modal-btn-confirm" id="deviceLabelConfirm" style="background:var(--color-primary)">Conferma</button>' +
        '</div>' +
      '</div>';

    modal.classList.add('active');
    modal.classList.toggle('modal-blocking', !!blocking);
    const input = modal.querySelector('#deviceLabelInput');
    input.focus();
    input.select();

    const cancelBtn = modal.querySelector('#deviceLabelCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#deviceLabelConfirm').addEventListener('click', () => {
      const label = input.value.trim();
      if (!label) return;
      DB.setDeviceLabel(label);
      modal.classList.remove('active');
      this.renderConfig();
      this.toast('Dispositivo: ' + label + ' ✓');
      if (onConfirm) onConfirm();
    });
  },



  renderZoneTavoliEditor() {
    const container = document.getElementById('cfgZoneTavoliList');
    if (!container) return;
    const zt = SharedTables.getZoneTavoli();
    const zones = SharedTables.getZones(); // rispetta l'ordine
    container.innerHTML = '';
    zones.forEach(zona => {
      container.appendChild(this.buildZoneEditor(zona, zt[zona] || []));
    });
  },

  buildZoneEditor(zona, tavoli) {
    const div = document.createElement('div');
    div.className = 'zone-editor-block';
    div.dataset.zona = zona;
    div.draggable = true;
    div.innerHTML =
      '<div class="zone-editor-header">' +
        '<span class="zone-drag-handle" title="Trascina per riordinare">⠿</span>' +
        '<input class="zone-editor-name text-input" value="' + this.escapeHTML(zona) + '" placeholder="Nome zona" style="flex:1;height:40px;font-size:15px;font-weight:700">' +
        '<button class="zone-editor-del" type="button" title="Elimina zona">🗑️</button>' +
      '</div>' +
      '<div class="field-group" style="margin-top:8px">' +
        '<label class="field-label" style="font-size:11px">Tavoli (separati da virgola)</label>' +
        '<textarea class="text-input zone-editor-tables" rows="2" placeholder="Es. 1, 2, 3, Sala privata...">' + this.escapeHTML(tavoli.join(', ')) + '</textarea>' +
      '</div>';

    div.querySelector('.zone-editor-del').addEventListener('click', () => {
      if (confirm('Eliminare la zona "' + zona + '"?')) div.remove();
    });

    // Drag & drop per riordinare
    div.addEventListener('dragstart', (e) => {
      div.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
      document.querySelectorAll('.zone-editor-block').forEach(b => b.classList.remove('drag-over'));
    });
    div.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const dragging = document.querySelector('.zone-editor-block.dragging');
      if (dragging && dragging !== div) {
        document.querySelectorAll('.zone-editor-block').forEach(b => b.classList.remove('drag-over'));
        div.classList.add('drag-over');
        const container = document.getElementById('cfgZoneTavoliList');
        const blocks = [...container.querySelectorAll('.zone-editor-block')];
        const draggingIdx = blocks.indexOf(dragging);
        const targetIdx = blocks.indexOf(div);
        if (draggingIdx < targetIdx) {
          container.insertBefore(dragging, div.nextSibling);
        } else {
          container.insertBefore(dragging, div);
        }
      }
    });

    return div;
  },

  getZoneTavoliFromEditor() {
    const result = {};
    document.querySelectorAll('#cfgZoneTavoliList .zone-editor-block').forEach(block => {
      const name = block.querySelector('.zone-editor-name').value.trim();
      const tablesStr = block.querySelector('.zone-editor-tables').value;
      const tables = tablesStr.split(/[,\n]/).map(t => t.trim()).filter(Boolean);
      if (name) result[name] = tables;
    });
    return result;
  },

  saveConfigFromForm() {
    if (!DB.isFullAdmin()) return;
    Config.save({
      tablesIndoor: Number(document.getElementById('cfgTablesIndoor').value) || 0,
      tablesOutdoor: Number(document.getElementById('cfgTablesOutdoor').value) || 0,
      services: {
        lunch: { label: 'Pranzo', start: document.getElementById('cfgLunchStart').value, end: document.getElementById('cfgLunchEnd').value },
        dinner: { label: 'Cena', start: document.getElementById('cfgDinnerStart').value, end: document.getElementById('cfgDinnerEnd').value },
      },
      slotDurationMinutes: Number(document.getElementById('cfgSlotDuration').value) || 15,
      maxBookingsPerSlot: Number(document.getElementById('cfgMaxPerSlot').value) || 1,
    });
    const confirmEl = document.getElementById('cfgSaveConfirm');
    confirmEl.classList.add('visible');
    clearTimeout(this._cfgConfirmTimer);
    this._cfgConfirmTimer = setTimeout(() => confirmEl.classList.remove('visible'), 1500);
  },

  // ANTEPRIMA
  openPreview() {
    this.state.previewDate = this.state.selectedDate;
    this.state.previewService = this.state.selectedService;
    this.showScreen('preview');
  },

  renderPreview() {
    const date = this.state.previewDate;
    const service = this.state.previewService;
    document.getElementById('previewDateLabel').textContent = this.dateLabel(date);
    document.getElementById('previewBtnLunch').classList.toggle('active', service === 'lunch');
    document.getElementById('previewBtnDinner').classList.toggle('active', service === 'dinner');
    const bookings = Bookings.getByDateAndService(date, service);
    const active = bookings.filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.WAITLIST);
    const totalGuests = active.reduce((s, b) => s + b.people, 0);
    document.getElementById('previewSheetTitle').textContent = this.serviceLabel(service) + ' · ' + this.dateLabel(date);
    document.getElementById('previewSheetStats').textContent = totalGuests + ' coperti · ' + active.length + ' tavoli';
    const list = document.getElementById('previewSheetList');
    list.innerHTML = '';
    if (bookings.length === 0) { list.innerHTML = '<div class="preview-empty">Nessuna prenotazione.</div>'; return; }
    for (const b of bookings) list.appendChild(this.buildPreviewRow(b));
  },

  buildPreviewRow(b) {
    const row = document.createElement('div');
    row.className = 'preview-row';
    if (b.status === STATUS.CANCELLED) row.classList.add('cancelled');
    const extras = [];
    if (b.zone && b.zone !== 'any') extras.push(ZONE_LABELS[b.zone] || b.zone);
    if (b.dogs > 0) extras.push('🐾 ' + b.dogs);
    if (b.highchairs > 0) extras.push(b.highchairs + ' segg.');
    if (Bookings.dietaryAlert(b)) extras.push('⚠️ ' + Bookings.dietaryAlert(b).toUpperCase());
    if (b.intolerances) extras.push('⚠️ ' + b.intolerances);
    if (b.doubleShift) extras.push('libera ' + b.doubleShift.releaseTime);
    if (b.tablesAssigned) extras.push('Tav. ' + b.tablesAssigned);
    if (b.status === STATUS.CANCELLED) extras.push('CANCELLATA');
    row.innerHTML = '<span class="preview-time">' + b.time + '</span><div class="preview-main"><span class="preview-name">' + (this.escapeHTML(b.name) || '(senza nome)') + '</span><span class="preview-people">· ' + b.people + ' pers.</span>' + (extras.length ? '<div class="preview-extra">' + extras.map(e => this.escapeHTML(e)).join(' · ') + '</div>' : '') + '</div>';
    return row;
  },

  // VISTA SOLA LETTURA
  /**
   * Pagina dedicata Eventi, nella vista chef — stessa lista già usata nel
   * popover del badge, così non ci sono due logiche diverse da tenere
   * allineate, solo due punti diversi dove viene mostrata.
   */
  renderRoEventiPage() {
    const list = document.getElementById('roEventiPageList');
    if (!list) return;
    const eventi = this.getAllUpcomingEvents();
    if (eventi.length === 0) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">🎉</span><strong>Nessun evento</strong><span>Non ci sono eventi in arrivo.</span></div>';
      return;
    }
    list.innerHTML = eventi.map(item => this.buildEventoRowHTML(item, true)).join('');
    list.querySelectorAll('.event-row').forEach(row => {
      row.addEventListener('click', () => {
        if (row.dataset.kind === 'day') this.openDayEventoDetailView(row.dataset.id);
        else this.openEventoDetailView(row.dataset.id);
      });
    });
  },

  /**
   * Pagina dedicata Chiusure, nella vista chef — sola lettura: lo chef
   * vede cosa è già impostato, ma la gestione (aggiungere/togliere) resta
   * in Impostazioni, riservata a chi può modificare.
   */
  renderRoChiusurePage() {
    const list = document.getElementById('roChiusurePageList');
    if (!list) return;
    const today = Utils.todayISO();
    const closures = SharedTables.getClosures().slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    const upcoming = closures.filter(c => (c.endDate || c.startDate) >= today);
    if (upcoming.length === 0) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">🚫</span><strong>Nessuna chiusura</strong><span>Non ci sono giorni di chiusura impostati per i prossimi giorni.</span></div>';
      return;
    }
    const SERVICE_LABELS = { all: 'Tutto il giorno', lunch: 'Solo pranzo', dinner: 'Solo cena' };
    list.innerHTML = upcoming.map(c => {
      const rangeLabel = c.startDate === c.endDate
        ? this.dateLabel(c.startDate)
        : this.dateLabel(c.startDate) + ' → ' + this.dateLabel(c.endDate);
      return '<div class="closure-row">' +
        '<div><strong>' + this.escapeHTML(rangeLabel.charAt(0).toUpperCase() + rangeLabel.slice(1)) + '</strong>' +
        '<span class="closure-row-meta">' + SERVICE_LABELS[c.service] + (c.reason ? ' · ' + this.escapeHTML(c.reason) : '') + '</span></div>' +
      '</div>';
    }).join('');
  },


  /**
   * Proposte del giorno — condivisa tra la vista chef e la Dashboard
   * (sala), stesso identico rendering: entrambi lavorano sulla stessa
   * lista, non due copie separate da tenere allineate. Ogni piatto ha
   * stato (disponibile/esaurito/modificato), porzioni facoltative, e una
   * nota dello chef visibile solo quando lo stato è "modificato".
   */
  /**
   * Punto d'ingresso pubblico — prima si assicura che il giorno abbia
   * qualcosa (riprendendolo dai giorni precedenti se è la prima volta che
   * lo si guarda), poi disegna. Il controllo è comunque veloce quando il
   * giorno ha già dati suoi: non c'è un vero ritardo percepibile.
   */
  /**
   * which limita a quali contenitori si applica ('ro' per la scheda dello
   * chef, 'dash' per il pannello di sala, entrambi di default) — permette
   * allo chef di sfogliare avanti nella sua scheda Piatti senza che sala
   * veda cambiare la propria data, dato che i due contesti condividono lo
   * stesso codice di disegno ma non devono condividere la stessa data.
   */
  renderDailySpecials(date, which) {
    SharedTables.ensureDailySpecialsForDate(date).then(() => this._renderDailySpecialsBody(date, which));
  },

  /**
   * Disegna un menu diviso per portata (menu operai o menu di mezza
   * pensione — stessa forma per entrambi) dentro i contenitori indicati.
   * A tendina: il titolo si clicca per aprire il modulo di aggiunta,
   * resta chiuso finché non serve — lo stato aperto/chiuso si preserva
   * tra un ridisegno e l'altro, così non si richiude da sola mentre la
   * pagina si aggiorna per un altro motivo.
   */
  _renderCourseMenu(containerIds, { date, title, menu, addFn, removeFn }) {
    const canManage = DB.canManageDailySpecials();
    const courses = SharedTables.HALF_BOARD_COURSES;
    const totalDishes = courses.reduce((sum, c) => sum + (menu[c] || []).length, 0);
    const coursesHTML = courses.map(course => {
      const dishes = menu[course] || [];
      return '<div class="course-menu-course">' +
        '<h4 class="course-menu-course-title">' + SharedTables.HALF_BOARD_COURSE_LABELS[course] + '</h4>' +
        (dishes.length ? '<ul class="course-menu-dish-list">' + dishes.map((dish, i) =>
          '<li>' + this.escapeHTML(dish) +
            (canManage ? '<button type="button" class="course-menu-dish-remove" data-course="' + course + '" data-index="' + i + '">✕</button>' : '') +
          '</li>'
        ).join('') + '</ul>' : '<p class="course-menu-empty">Nessun piatto ancora.</p>') +
        (canManage ? '<div class="course-menu-add-row">' +
          '<input type="text" class="text-input course-menu-add-input" data-course="' + course + '" placeholder="Aggiungi un piatto…">' +
          '<button type="button" class="course-menu-add-btn" data-course="' + course + '">＋</button>' +
        '</div>' : '') +
      '</div>';
    }).join('');

    containerIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      // Se sta scrivendo (davvero scrivendo, non solo il pulsante "+" che
      // ha appena preso il focus dopo il clic) dentro proprio questo
      // contenitore, non lo ricostruisco — altrimenti gli sparirebbe il
      // testo e la tastiera sotto le dita, anche solo aggiungendo un
      // piatto in un'altra portata dello stesso menu. Controllare solo
      // "il focus è dentro" bloccava anche il pulsante "+" stesso: dopo
      // il clic il bottone diventa l'elemento attivo, e sembrava che il
      // ridisegno (quindi il piatto appena aggiunto) non comparisse mai.
      const active = document.activeElement;
      const isReallyTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && el.contains(active);
      if (isReallyTyping) return;
      // Stato aperto/chiuso tenuto in memoria (non letto dal DOM) — così
      // sopravvive anche se qualcos'altro ricostruisce il contenitore da
      // zero (es. l'aggiornamento periodico della vista chef in sola
      // lettura), invece di richiudersi ogni volta.
      if (!this.state.courseMenuOpen) this.state.courseMenuOpen = {};
      const wasOpen = this.state.courseMenuOpen[id] || false;
      el.innerHTML = '<details class="course-menu-details"' + (wasOpen ? ' open' : '') + '>' +
        '<summary class="course-menu-summary">' + title +
          (totalDishes ? ' <span class="course-menu-count">· ' + totalDishes + '</span>' : '') +
        '</summary>' +
        '<div class="course-menu-body">' + coursesHTML + '</div>' +
      '</details>';
      el.querySelector('details').addEventListener('toggle', (e) => {
        this.state.courseMenuOpen[id] = e.target.open;
      });
      el.querySelectorAll('.course-menu-dish-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          await removeFn(date, btn.dataset.course, Number(btn.dataset.index));
          this.renderDailySpecials(date);
        });
      });
      el.querySelectorAll('.course-menu-add-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const input = el.querySelector('.course-menu-add-input[data-course="' + btn.dataset.course + '"]');
          if (!input || !input.value.trim()) return;
          await addFn(date, btn.dataset.course, input.value);
          this.renderDailySpecials(date);
        });
      });
      el.querySelectorAll('.course-menu-add-input').forEach(input => {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') el.querySelector('.course-menu-add-btn[data-course="' + input.dataset.course + '"]')?.click();
        });
      });
    });
  },

  _renderDailySpecialsBody(date, which) {
    const CATEGORY_ORDER = ['antipasti', 'primi', 'secondi', 'contorni', 'dolci', 'altro'];
    const CATEGORY_LABELS = { antipasti: 'Antipasti', primi: 'Primi', secondi: 'Secondi', contorni: 'Contorni', dolci: 'Dolci', altro: 'Altro' };
    // which limita quali contenitori aggiornare in questa chiamata — vedi
    // renderDailySpecials sopra per il motivo.
    const wantsRo = !which || which.includes('ro');
    const wantsDash = !which || which.includes('dash');
    const filterIds = (ids) => ids.filter(id => (id.startsWith('ro') && wantsRo) || (id.startsWith('dash') && wantsDash));

    // Menu operai e menu di mezza pensione — stessa impostazione per
    // entrambi (diviso per portata, lo chef aggiunge quanti piatti vuole),
    // quindi un'unica funzione di disegno condivisa invece di ripetere la
    // stessa logica due volte. A tendina: il titolo si clicca per aprire
    // il modulo con cui aggiungere i piatti, così restano compatti quando
    // non servono.
    this._renderCourseMenu(filterIds(['roWorkerMenuBox', 'dashWorkerMenuBox']), {
      date, title: '👷 Menu operai di oggi',
      menu: SharedTables.getWorkerMenu(date),
      addFn: SharedTables.addWorkerMenuDish.bind(SharedTables),
      removeFn: SharedTables.removeWorkerMenuDish.bind(SharedTables),
    });
    this._renderCourseMenu(filterIds(['roHalfBoardMenuBox', 'dashHalfBoardMenuBox']), {
      date, title: '🍽️ Menu di mezza pensione',
      menu: SharedTables.getHalfBoardMenu(date),
      addFn: SharedTables.addHalfBoardDish.bind(SharedTables),
      removeFn: SharedTables.removeHalfBoardDish.bind(SharedTables),
    });

    filterIds(['roDailySpecialsBox', 'dashDailySpecialsBox']).forEach(containerId => {
      const box = document.getElementById(containerId);
      if (!box) return;
      // Novembre 2026: la gestione dei piatti vive nella nuova sezione
      // "Piatti del giorno" (js/piatti.js). In cucina la si mostra per
      // intero; nel pannello "Menu di oggi" resta un riepilogo con il
      // pulsante per aprirla.
      if (containerId === 'roDailySpecialsBox' && this.renderSpecialsStudio) {
        this.renderSpecialsStudio(box, date, {});
        return;
      }
      if (containerId === 'dashDailySpecialsBox' && this.openSpecialsScreen) {
        const list = SharedTables.getDailySpecials(date);
        const st = (s) => s.status === 'confermato' || (!s.status && s.approval === 'approved') ? 'ok'
          : (s.status === 'non_disponibile' || s.status === 'esaurito' || s.approval === 'rejected') ? 'ko' : (s.status === 'modificato' ? 'mod' : 'pending');
        const nOk = list.filter(s => st(s) === 'ok').length;
        const nPend = list.filter(s => st(s) === 'pending').length;
        const hasKo = list.some(s => st(s) === 'ko');
        const countEl = document.getElementById('dailySpecialsDrawerCount');
        if (countEl) countEl.textContent = list.length ? '(' + list.length + ')' : '';
        const urgentDot = document.getElementById('dailySpecialsDrawerUrgentDot');
        if (urgentDot) urgentDot.classList.toggle('hidden', !hasKo);
        box.innerHTML = '<div class="ps-mini">' +
          '<div class="ps-mini-head"><strong>Piatti del giorno</strong><span>' + list.length + ' piatti · ' + nOk + ' sul menu QR' + (nPend ? ' · ' + nPend + ' da confermare' : '') + '</span></div>' +
          (list.length ? '<ul class="ps-mini-list">' + list.map(s => '<li class="ps-mini-' + st(s) + '">' + this.escapeHTML(s.name) + '</li>').join('') + '</ul>' : '') +
          '<button type="button" class="ps-mini-open" id="psMiniOpen">Apri piatti del giorno</button>' +
        '</div>';
        box.querySelector('#psMiniOpen').addEventListener('click', () => this.openSpecialsScreen(date));
        return;
      }
      const specials = SharedTables.getDailySpecials(date);
      const canManage = DB.canManageDailySpecials();

      const isChef = DB.isHeadChef();   // solo lo chef principale conferma; un cuoco no

      const STATUS_META = {
        pending: { label: 'In attesa', short: '⏳', color: '#9A9A9A' },
        confermato: { label: 'Disponibile', short: '✅', color: '#2E7D4F' },
        non_disponibile: { label: 'Non disponibile', short: '❌', color: '#A32D2D' },
        modificato: { label: 'Modificato', short: '✏️', color: '#C08A2E' },
      };

      // Retrocompatibilità: le proposte create prima di questo aggiornamento
      // avevano due campi separati (stato disponibilità + approvazione
      // dello chef) invece di uno solo — questa funzione li traduce nel
      // nuovo stato unico, senza dover toccare i dati salvati.
      const unifiedStatus = (s) => {
        if (STATUS_META[s.status]) return s.status; // già nel formato nuovo
        if (s.approval === 'rejected') return 'non_disponibile';
        if (s.status === 'esaurito') return 'non_disponibile';
        if (s.status === 'modificato') return 'modificato';
        if (s.approval === 'approved') return 'confermato';
        return 'pending';
      };

      const renderItem = (s) => {
        const statusKey = unifiedStatus(s);
        const meta = STATUS_META[statusKey];
        // Un pallino di colore al posto del bordo pesante di prima — lo
        // stato resta subito riconoscibile, ma non domina più la card.
        const statusDot = statusKey === 'pending' ? '' : '<span class="ds-status-dot" style="background:' + meta.color + '"></span>';
        // Chi può confermare/rifiutare un piatto — non solo lo chef: anche
        // sala/admin, per i casi in cui lo chef si dimentica. Entrambi
        // passano comunque dal PIN amministratore prima che l'azione
        // abbia effetto davvero (vedi il gestore del clic più sotto).
        const canApprove = isChef || DB.canEdit();
        const priceLabel = DB.canEdit() && s.price != null ? '<span class="daily-special-price">€ ' + Number(s.price).toFixed(2) + '</span>' : '';

        return '<div class="daily-special-item" data-id="' + s.id + '">' +
          '<div class="daily-special-header">' +
            '<strong>' + this.escapeHTML(s.name) + '</strong>' +
            priceLabel +
            (canManage ? '<span class="daily-special-header-actions">' +
              '<button type="button" class="ds-edit ds-action-link" data-id="' + s.id + '" title="Modifica nome/descrizione">Modifica</button>' +
              '<button type="button" class="ds-repropose ds-action-link" data-id="' + s.id + '" title="Riproponi domani">Programma</button>' +
              '<button type="button" class="daily-special-remove ds-action-link ds-action-link-danger" data-id="' + s.id + '" title="Togli">Elimina</button>' +
            '</span>' : '') +
          '</div>' +
          (s.description ? '<p class="daily-special-desc">' + this.escapeHTML(s.description) + '</p>' : '') +

          // Un'unica scelta invece delle due sovrapposte di prima — sala e
          // chef possono entrambi cambiarla (con PIN amministratore),
          // così non resta bloccata se lo chef si dimentica.
          (canApprove
            ? '<div class="ds-field-label">Confermi questo piatto?</div>' +
              '<div class="ds-status-row" data-id="' + s.id + '">' +
                Object.entries(STATUS_META).filter(([key]) => key !== 'pending').map(([key, m]) =>
                  '<button type="button" class="ds-status-btn' + (statusKey === key ? ' active' : '') + '" data-id="' + s.id + '" data-status="' + key + '" style="' + (statusKey === key ? 'background:' + m.color + ';border-color:' + m.color : '') + '">' + m.label + '</button>'
                ).join('') +
              '</div>' +
              (statusKey === 'modificato'
                ? '<textarea class="text-input ds-chef-note" data-id="' + s.id + '" placeholder="Cosa è cambiato?" rows="1">' + this.escapeHTML(s.chefNote || '') + '</textarea>'
                : '')
            : '<div class="ds-status-label">' + statusDot + '<span style="color:' + meta.color + '">' + meta.label + '</span></div>' +
              (statusKey === 'modificato' && s.chefNote ? '<p class="daily-special-desc">' + this.escapeHTML(s.chefNote) + '</p>' : '')
          ) +

          (canManage
            ? '<div class="ds-portions-row">' +
                '<span class="ds-portions-label">Porzioni</span>' +
                '<div class="dogs-stepper">' +
                  '<button type="button" class="stepper-btn ds-portions-minus" data-id="' + s.id + '">−</button>' +
                  '<span class="stepper-value">' + (s.portionsLeft != null ? s.portionsLeft : '—') + '</span>' +
                  '<button type="button" class="stepper-btn ds-portions-plus" data-id="' + s.id + '">+</button>' +
                '</div>' +
              '</div>'
            : (s.portionsLeft != null ? '<div class="ds-status-label">' + s.portionsLeft + ' porzioni</div>' : '')
          ) +
        '</div>';
      };

      // Nella vista chef (roDailySpecialsBox) resta come prima — pagina
      // dedicata con titolo fisso. Nella Dashboard (dashDailySpecialsBox)
      // ora vive dentro il pannello laterale, che ha già la sua intestazione
      // statica nell'HTML — qui basta il contenuto, niente più tendina.
      const isDashboard = containerId === 'dashDailySpecialsBox';
      const hasUrgent = specials.some(s => unifiedStatus(s) === 'non_disponibile');

      let bodyHTML = '';
      if (specials.length === 0) {
        bodyHTML = '<p style="font-size:13px;color:var(--color-ink-soft)">Nessuna proposta per questo giorno.</p>';
      } else {
        // Raggruppate per portata — solo le categorie che hanno davvero
        // qualcosa dentro, niente titoli vuoti a occupare spazio.
        bodyHTML = CATEGORY_ORDER.filter(cat => specials.some(s => (s.category || 'altro') === cat)).map(cat => {
          const items = specials.filter(s => (s.category || 'altro') === cat);
          return '<div class="ds-category-group">' +
            '<h4 class="ds-category-title">' + CATEGORY_LABELS[cat] + '</h4>' +
            items.map(renderItem).join('') +
          '</div>';
        }).join('');
      }
      if (canManage) {
        bodyHTML += '<button type="button" class="project-add-course-btn" id="dsAddBtn_' + containerId + '">＋ Aggiungi proposta</button>';
      }

      let html;
      // Stesso trattamento a tendina di menu operai e mezza pensione qui
      // sopra, per coerenza — prima questa era l'unica delle tre sempre
      // aperta per intero. Stesso meccanismo di stato aperto/chiuso
      // tenuto in memoria (non nel DOM), per non richiudersi da sola a
      // ogni aggiornamento automatico.
      if (!this.state.courseMenuOpen) this.state.courseMenuOpen = {};
      const specialsOpenKey = containerId + '_specials';
      const wasSpecialsOpen = this.state.courseMenuOpen[specialsOpenKey] ?? hasUrgent;
      html = '<details class="course-menu-details"' + (wasSpecialsOpen ? ' open' : '') + '>' +
        '<summary class="course-menu-summary">🍽️ Proposte del giorno' +
          (specials.length ? ' <span class="course-menu-count">· ' + specials.length + '</span>' : '') +
        '</summary>' +
        '<div class="course-menu-body daily-specials-body">' + bodyHTML + '</div>' +
      '</details>';
      if (isDashboard) {
        // Il conteggio e il pallino "urgente" vivono ANCHE sul pulsante che
        // apre il pannello, non solo dentro — vanno aggiornati qui perché
        // sono fuori da "box".
        const countEl = document.getElementById('dailySpecialsDrawerCount');
        if (countEl) countEl.textContent = specials.length ? '(' + specials.length + ')' : '';
        const urgentDot = document.getElementById('dailySpecialsDrawerUrgentDot');
        if (urgentDot) urgentDot.classList.toggle('hidden', !hasUrgent);
      }
      box.innerHTML = html;
      box.querySelector('details').addEventListener('toggle', (e) => {
        this.state.courseMenuOpen[specialsOpenKey] = e.target.open;
      });

      if (!canManage) return;

      box.querySelectorAll('.daily-special-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!confirm('Togliere questa proposta? Sparisce anche dai giorni successivi che l\'avevano già ricevuta.')) return;
          // Non aspettiamo il salvataggio in rete per ridisegnare — i dati
          // locali sono già aggiornati appena la chiamata parte, il
          // salvataggio vero prosegue in sottofondo. Così un tocco si vede
          // subito anche con una connessione lenta.
          SharedTables.removeDailySpecial(date, btn.dataset.id);
          UI.renderDailySpecials(date);
        });
      });
      box.querySelectorAll('.ds-status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const statusLabel = STATUS_META[btn.dataset.status]?.label || 'questo piatto';
          const doConfirm = () => {
            SharedTables.updateDailySpecial(date, btn.dataset.id, { status: btn.dataset.status });
            this.renderDailySpecials(date);
          };
          // Già identificato personalmente al login (PIN admin o PIN
          // cuoco) — chiedere un altro PIN per la stessa conferma sarebbe
          // ridondante. Il codice resta richiesto solo per il tablet
          // condiviso, dove non si sa con certezza chi lo sta usando in
          // questo preciso momento.
          if (DB.getRole() === 'admin' || DB.isHeadChef()) { doConfirm(); return; }
          this.promptAdminPin('Confermi "' + statusLabel + '"?', doConfirm);
        });
      });
      box.querySelectorAll('.ds-portions-minus').forEach(btn => {
        btn.addEventListener('click', () => {
          const s = specials.find(x => x.id === btn.dataset.id);
          const current = s.portionsLeft != null ? s.portionsLeft : 0;
          SharedTables.updateDailySpecial(date, btn.dataset.id, { portionsLeft: Math.max(0, current - 1) });
          UI.renderDailySpecials(date);
        });
      });
      box.querySelectorAll('.ds-portions-plus').forEach(btn => {
        btn.addEventListener('click', () => {
          const s = specials.find(x => x.id === btn.dataset.id);
          const current = s.portionsLeft != null ? s.portionsLeft : 0;
          SharedTables.updateDailySpecial(date, btn.dataset.id, { portionsLeft: current + 1 });
          UI.renderDailySpecials(date);
        });
      });
      box.querySelectorAll('.ds-chef-note').forEach(el => {
        el.addEventListener('change', () => {
          SharedTables.updateDailySpecial(date, el.dataset.id, { chefNote: el.value.trim() });
        });
      });
      box.querySelectorAll('.ds-repropose').forEach(btn => {
        btn.addEventListener('click', () => {
          const tm = Utils.isoToDate(date);
          tm.setDate(tm.getDate() + 1);
          const toDate = Utils.dateToISO(tm);
          SharedTables.duplicateDailySpecialToDate(date, btn.dataset.id, toDate);
          UI.toast('Riproposto per ' + UI.dateLabel(toDate).toLowerCase() + ' ✓');
        });
      });
      box.querySelectorAll('.ds-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const s = specials.find(x => x.id === btn.dataset.id);
          if (s) UI.openDailySpecialAddModal(date, s);
        });
      });
      const addBtn = document.getElementById('dsAddBtn_' + containerId);
      if (addBtn) {
        addBtn.addEventListener('click', () => UI.openDailySpecialAddModal(date));
      }
    });
  },

  /**
   * Scheda per aggiungere O modificare una proposta — nome, descrizione,
   * categoria a pulsanti (niente prompt() da compilare a mano, molto più
   * affidabile su telefono). Passa un piatto esistente per modificarlo
   * invece di crearne uno nuovo — stessa scheda, così non serve
   * eliminare e riscrivere da capo per un piccolo ritocco.
   */
  openDailySpecialAddModal(date, existing) {
    let modal = document.getElementById('dailySpecialAddModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dailySpecialAddModal';
      modal.className = 'modal-overlay modal-overlay-centered';
      document.getElementById('app').appendChild(modal);
    }
    const CATS = [['antipasti', 'Antipasti'], ['primi', 'Primi'], ['secondi', 'Secondi'], ['contorni', 'Contorni'], ['dolci', 'Dolci']];
    let selectedCat = existing ? (existing.category || 'antipasti') : 'antipasti';
    modal.innerHTML =
      '<div class="modal-sheet modal-sheet-centered">' +
        '<h3 style="margin:0 0 12px">🍽️ ' + (existing ? 'Modifica proposta' : 'Nuova proposta') + '</h3>' +
        '<div class="field-group"><label class="field-label">Nome del piatto</label>' +
          '<input type="text" class="text-input" id="dsNewName" placeholder="Es. Risotto ai funghi porcini" autocomplete="off" value="' + (existing ? this.escapeHTML(existing.name) : '') + '">' +
          '<div id="dsNameSuggestions" class="dish-suggestions hidden"></div>' +
        '</div>' +
        '<div class="field-group"><label class="field-label">Descrizione (facoltativa)</label>' +
          '<textarea class="text-input" id="dsNewDesc" rows="2" placeholder="Es. Con tartufo nero">' + (existing ? this.escapeHTML(existing.description || '') : '') + '</textarea></div>' +
        (DB.canEdit() ? '<div class="field-group"><label class="field-label">Prezzo (€)</label>' +
          '<input type="number" class="text-input" id="dsNewPrice" placeholder="Es. 18.50" step="0.50" min="0" inputmode="decimal" value="' + (existing && existing.price != null ? existing.price : '') + '"></div>' : '') +
        '<div class="field-group"><label class="field-label">Categoria</label>' +
          '<div class="project-includes-grid" id="dsNewCatGrid">' +
            CATS.map(([key, label]) => '<button type="button" class="project-include-chip' + (key === selectedCat ? ' active' : '') + '" data-cat="' + key + '">' + label + '</button>').join('') +
          '</div></div>' +
        '<details class="course-menu-details" id="dsTranslationsDetails">' +
          '<summary class="course-menu-summary">🌍 Traduzioni (facoltative) — per il sito con il QR code</summary>' +
          '<div class="course-menu-body">' +
            '<div class="field-group"><label class="field-label">Nome — Inglese</label>' +
              '<input type="text" class="text-input" id="dsNewNameEn" placeholder="Es. Porcini mushroom risotto" autocomplete="off" value="' + (existing ? this.escapeHTML(existing.nameEn || '') : '') + '"></div>' +
            '<div class="field-group"><label class="field-label">Descrizione — Inglese</label>' +
              '<textarea class="text-input" id="dsNewDescEn" rows="2" placeholder="Es. With black truffle">' + (existing ? this.escapeHTML(existing.descriptionEn || '') : '') + '</textarea></div>' +
            '<div class="field-group"><label class="field-label">Nome — Francese</label>' +
              '<input type="text" class="text-input" id="dsNewNameFr" placeholder="Es. Risotto aux cèpes" autocomplete="off" value="' + (existing ? this.escapeHTML(existing.nameFr || '') : '') + '"></div>' +
            '<div class="field-group"><label class="field-label">Descrizione — Francese</label>' +
              '<textarea class="text-input" id="dsNewDescFr" rows="2" placeholder="Es. Avec truffe noire">' + (existing ? this.escapeHTML(existing.descriptionFr || '') : '') + '</textarea></div>' +
          '</div>' +
        '</details>' +
        '<div class="modal-actions">' +
          '<button class="modal-btn-cancel" id="dsNewCancel">Annulla</button>' +
          '<button class="modal-btn-confirm" id="dsNewSave" style="background:var(--color-primary)">' + (existing ? 'Salva modifiche' : 'Aggiungi') + '</button>' +
        '</div>' +
      '</div>';
    modal.classList.add('active');
    modal.querySelector('#dsNewName').focus();

    // Suggerimenti dalla libreria mentre si scrive — un tocco su un
    // risultato riempie subito nome, descrizione e categoria, senza
    // dover riscrivere un piatto già proposto in passato.
    const nameInput = modal.querySelector('#dsNewName');
    const suggestBox = modal.querySelector('#dsNameSuggestions');
    nameInput.addEventListener('input', () => {
      const matches = SharedTables.searchDishLibrary(nameInput.value);
      if (matches.length === 0) { suggestBox.classList.add('hidden'); suggestBox.innerHTML = ''; return; }
      suggestBox.classList.remove('hidden');
      suggestBox.innerHTML = matches.map(d =>
        '<button type="button" class="dish-suggestion-item" data-id="' + d.id + '">' +
          '<strong>' + this.escapeHTML(d.name) + '</strong>' +
          (d.description ? '<span>' + this.escapeHTML(d.description) + '</span>' : '') +
        '</button>'
      ).join('');
      suggestBox.querySelectorAll('.dish-suggestion-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const dish = matches.find(d => d.id === btn.dataset.id);
          if (!dish) return;
          nameInput.value = dish.name;
          modal.querySelector('#dsNewDesc').value = dish.description || '';
          modal.querySelector('#dsNewNameEn').value = dish.nameEn || '';
          modal.querySelector('#dsNewNameFr').value = dish.nameFr || '';
          modal.querySelector('#dsNewDescEn').value = dish.descriptionEn || '';
          modal.querySelector('#dsNewDescFr').value = dish.descriptionFr || '';
          selectedCat = dish.category || 'antipasti';
          modal.querySelectorAll('#dsNewCatGrid .project-include-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === selectedCat));
          suggestBox.classList.add('hidden');
          suggestBox.innerHTML = '';
        });
      });
    });

    modal.querySelectorAll('#dsNewCatGrid .project-include-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        selectedCat = chip.dataset.cat;
        modal.querySelectorAll('#dsNewCatGrid .project-include-chip').forEach(c => c.classList.toggle('active', c === chip));
      });
    });
    modal.querySelector('#dsNewCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#dsNewSave').addEventListener('click', () => {
      const name = modal.querySelector('#dsNewName').value.trim();
      if (!name) { UI.toast('Serve almeno il nome del piatto', 'warning'); return; }
      const description = modal.querySelector('#dsNewDesc').value.trim();
      const priceInput = modal.querySelector('#dsNewPrice');
      const price = priceInput && priceInput.value !== '' ? Number(priceInput.value) : (existing ? existing.price : null);
      const nameEn = modal.querySelector('#dsNewNameEn').value.trim();
      const nameFr = modal.querySelector('#dsNewNameFr').value.trim();
      const descriptionEn = modal.querySelector('#dsNewDescEn').value.trim();
      const descriptionFr = modal.querySelector('#dsNewDescFr').value.trim();

      const doSave = () => {
        modal.classList.remove('active');
        // Non aspettiamo il salvataggio: si vede subito nella lista, il
        // salvataggio vero prosegue in sottofondo.
        if (existing) {
          SharedTables.updateDailySpecial(date, existing.id, { name, description, category: selectedCat, price, nameEn, nameFr, descriptionEn, descriptionFr }, true);
          SharedTables.addToDishLibrary(name, description, selectedCat, nameEn, nameFr, descriptionEn, descriptionFr);
          UI.toast('Proposta modificata ✓ (anche nei giorni successivi)');
        } else {
          SharedTables.addDailySpecial(date, { name, description, category: selectedCat, price, nameEn, nameFr, descriptionEn, descriptionFr, createdBy: DB.getOperator() }, true);
          UI.toast('Proposta aggiunta ✓ (anche nei giorni successivi)');
        }
        UI.renderDailySpecials(date);
      };

      // Solo MODIFICARE un piatto già esistente richiede conferma —
      // aggiungerne uno nuovo resta libero, altrimenti proporre piatti
      // diventerebbe scomodo per chi lavora in sala. E la conferma stessa
      // chiede il PIN solo a chi non si è già identificato personalmente
      // al login (il tablet condiviso) — un admin o un cuoco già dentro
      // col proprio PIN non deve reinserirlo per la stessa azione.
      if (existing) {
        if (DB.getRole() === 'admin' || DB.isHeadChef()) { doSave(); return; }
        UI.promptAdminPin('Salvare le modifiche a "' + name + '"?', doSave);
      } else {
        doSave();
      }
    });
  },

  renderReadOnlyView() {
    const date = this.state.selectedDate;
    const service = this.state.roService || 'lunch';
    this.state.roService = service;

    document.getElementById('roDateLabel').textContent = this.dateLabel(date);
    document.getElementById('roBtnLunch')?.classList.toggle('active', service === 'lunch');
    document.getElementById('roBtnDinner')?.classList.toggle('active', service === 'dinner');

    const bookings = Bookings.getByDateAndService(date, service).filter(b => b.status !== STATUS.CANCELLED);

    // Coperti di tutta la giornata, pranzo e cena insieme — non solo il
    // servizio selezionato, così chi apre in sola lettura (tipicamente lo
    // chef) vede subito la giornata intera senza dover cambiare tab.
    const lunchGuests = Bookings.getByDateAndService(date, 'lunch').filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.WAITLIST).reduce((s, b) => s + b.people, 0);
    const dinnerGuests = Bookings.getByDateAndService(date, 'dinner').filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.WAITLIST).reduce((s, b) => s + b.people, 0);
    document.getElementById('roCoversLunch').textContent = lunchGuests;
    document.getElementById('roCoversDinner').textContent = dinnerGuests;

    // Mezze pensioni del servizio selezionato — conteggio totale persone,
    // non prenotazioni: una mezza pensione di 4 persone conta 4, non 1.
    const halfBoardBadge = document.getElementById('roHalfBoardBadge');
    if (halfBoardBadge) {
      const halfBoardBookings = bookings.filter(b => {
        const hotelInfo = Bookings.getHotelInfo(b);
        return hotelInfo && hotelInfo.mealPlan === 'mezza_pensione' && b.status !== STATUS.WAITLIST;
      });
      const halfBoardTotal = halfBoardBookings.reduce((s, b) => s + b.people, 0);
      if (halfBoardTotal > 0) {
        halfBoardBadge.classList.remove('hidden');
        halfBoardBadge.innerHTML = '🏨 ' + halfBoardTotal + ' person' + (halfBoardTotal > 1 ? 'e' : 'a') + ' in mezza pensione (' + halfBoardBookings.length + ' prenotazion' + (halfBoardBookings.length > 1 ? 'i' : 'e') + ')';
      } else {
        halfBoardBadge.classList.add('hidden');
        halfBoardBadge.innerHTML = '';
      }
    }

    // Chiusura — icona ben visibile se il giorno/servizio che sta
    // guardando è chiuso, così anche in sola lettura non c'è dubbio.
    const closureBox = document.getElementById('roClosureBox');
    if (closureBox) {
      const closure = SharedTables.getClosureFor(date, service);
      if (closure) {
        closureBox.classList.remove('hidden');
        closureBox.innerHTML = '🚫 Chiuso' + (closure.reason ? ' — ' + this.escapeHTML(closure.reason) : '');
      } else {
        closureBox.classList.add('hidden');
        closureBox.innerHTML = '';
      }
    }

    // Preparazioni speciali — un banner fisso, non richiudibile, con le
    // richieste particolari di TUTTI i prossimi giorni (non solo quello
    // che si sta guardando): un cliente che tra due giorni vuole il foie
    // gras, lo chef lo deve sapere ORA per poterlo ordinare in tempo, non
    // solo il giorno stesso quando è troppo tardi.
    // Preparazioni speciali — divise in due: un piccolo spazio sempre
    // visibile per OGGI (quello davvero urgente, da agire subito) e un
    // menu a tendina per i prossimi giorni (da consultare quando si vuole
    // pianificare, non deve stare sempre sott'occhio). Dopo le 15, il
    // pranzo di oggi è ormai concluso — non ha più senso segnalarlo.
    const prepBox = document.getElementById('roSpecialPrepBox');
    if (prepBox) {
      const todayISO = Utils.todayISO();
      const currentHour = new Date().getHours();
      const windowEndDate = Utils.isoToDate(todayISO);
      windowEndDate.setDate(windowEndDate.getDate() + 30);
      const windowEnd = Utils.dateToISO(windowEndDate);

      const allActive = Bookings.getCached().filter(b =>
        b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED && b.status !== STATUS.NOSHOW &&
        (b.specialNeeds || '').trim()
      );
      const todayPrep = allActive.filter(b =>
        b.date === todayISO && !(b.service === 'lunch' && currentHour >= 15)
      ).sort((a, b) => a.time.localeCompare(b.time));
      const upcomingPrep = allActive.filter(b =>
        b.date > todayISO && b.date <= windowEnd
      ).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

      if (todayPrep.length === 0 && upcomingPrep.length === 0) {
        prepBox.classList.add('hidden');
        prepBox.innerHTML = '';
      } else {
        prepBox.classList.remove('hidden');
        const prepRow = (b, showDate) =>
          '<div class="chef-prep-row"><strong>' + this.escapeHTML(b.name || 'Senza nome') + '</strong>' +
          (showDate ? ' — ' + this.dateLabel(b.date).toLowerCase() : '') +
          ' (' + b.time + (b.service === 'lunch' ? ' pranzo' : ' cena') + ')<br>' + this.escapeHTML(b.specialNeeds) + '</div>';

        prepBox.innerHTML =
          (todayPrep.length > 0
            ? '<h3>👨‍🍳 ' + todayPrep.length + ' preparazione' + (todayPrep.length > 1 ? 'i' : '') + ' speciale' + (todayPrep.length > 1 ? 'i' : '') + ' oggi</h3>' +
              todayPrep.map(b => prepRow(b, false)).join('')
            : '<h3 style="color:var(--color-ink-soft)">Nessuna preparazione speciale oggi</h3>') +
          (upcomingPrep.length > 0
            ? '<details class="chef-prep-upcoming">' +
                '<summary>📅 ' + upcomingPrep.length + ' nei prossimi giorni</summary>' +
                '<div class="chef-prep-upcoming-body">' + upcomingPrep.map(b => prepRow(b, true)).join('') + '</div>' +
              '</details>'
            : '');
      }
    }

    // Proposte del giorno — visibili e gestibili da entrambi (sala e
    // chef), qui la parte di visualizzazione/aggiornamento. Usa la data
    // propria della scheda Piatti (può essere diversa da quella che sta
    // guardando qui in Lista, se lo chef è andato avanti a scrivere il
    // menu di domani) — solo i contenitori dello chef, mai quelli di sala.
    this.renderDailySpecials(this.state.piattiSelectedDate || date, ['ro']);

    const now = new Date();
    const todayISO = Utils.todayISO();

    // Tavoli con doppio turno CONFERMATO (orario di rilascio certo, non
    // provvisorio — un provvisorio non ha un tempo preciso da comunicare,
    // sarebbe un'informazione inventata). Ordinati per urgenza: chi ha
    // meno tempo prima.
    const speedupCard = document.getElementById('roSpeedupCard');
    const speedupList = document.getElementById('roSpeedupList');
    if (speedupCard && speedupList) {
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const isToday = date === todayISO;
      const speedupRows = bookings
        .filter(b => b.doubleShiftRelease && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW)
        .map(b => ({ booking: b, minutesLeft: isToday ? Slots.toMinutes(b.doubleShiftRelease) - nowMinutes : null }))
        .sort((a, b) => (a.minutesLeft ?? 999999) - (b.minutesLeft ?? 999999));

      if (speedupRows.length === 0) {
        speedupCard.classList.add('hidden');
      } else {
        speedupCard.classList.remove('hidden');
        speedupList.innerHTML = speedupRows.map(r => {
          const b = r.booking;
          let timeLabel;
          if (r.minutesLeft === null) {
            timeLabel = 'libera entro le ' + b.doubleShiftRelease;
          } else if (r.minutesLeft <= 0) {
            timeLabel = 'già in ritardo — doveva liberare alle ' + b.doubleShiftRelease;
          } else {
            timeLabel = 'tra ' + r.minutesLeft + ' min (entro le ' + b.doubleShiftRelease + ')';
          }
          const urgent = r.minutesLeft !== null && r.minutesLeft <= 20;
          return '<div class="chef-speedup-row' + (urgent ? ' urgent' : '') + '">' +
            '<span class="chef-speedup-table">Tav. ' + this.escapeHTML(b.tablesAssigned || '?') + '</span>' +
            '<span class="chef-speedup-info"><strong>' + this.escapeHTML(b.name || 'senza nome') + '</strong> · ' + b.people + ' cop. · ' + timeLabel + '</span>' +
          '</div>';
        }).join('');
      }
    }

    const lateBookings = date === todayISO ? bookings.filter(b => {
      if (b.arrivedAt || b.status === STATUS.COMPLETED) return false;
      return (now.getHours() * 60 + now.getMinutes()) > Slots.toMinutes(b.time) + 5;
    }) : [];

    const lateAlert = document.getElementById('roLateAlert');
    if (lateAlert) {
      if (lateBookings.length > 0) {
        lateAlert.classList.remove('hidden');
        lateAlert.innerHTML = '⚠️ ' + lateBookings.length + ' ' + (lateBookings.length === 1 ? 'tavolo in ritardo' : 'tavoli in ritardo') + ': ' + lateBookings.map(b => '<strong>' + this.escapeHTML(b.name) + '</strong> (' + b.time + ')').join(', ');
      } else { lateAlert.classList.add('hidden'); }
    }

    // Eventi: badge compatto nel topbar invece di una card grande — sempre
    // visibile, zero spazio rubato al resto. Si apre in un piccolo popover,
    // e toccando un evento si apre una pagina dedicata con tutti i dettagli.
    const eventi = this.getAllUpcomingEvents().slice(0, 8);
    const badgeBtn = document.getElementById('roEventsBadgeBtn');
    const badgeCount = document.getElementById('roEventsBadgeCount');
    const popoverList = document.getElementById('roEventsPopoverList');
    if (badgeBtn && badgeCount) {
      badgeBtn.classList.toggle('hidden', eventi.length === 0);
      badgeCount.textContent = eventi.length;
    }
    if (popoverList) {
      popoverList.innerHTML = eventi.map(item => this.buildEventoRowHTML(item, true)).join('');
      popoverList.querySelectorAll('.event-row').forEach(row => {
        row.addEventListener('click', () => {
          document.getElementById('roEventsPopover').classList.add('hidden');
          if (row.dataset.kind === 'day') this.openDayEventoDetailView(row.dataset.id);
          else this.openEventoDetailView(row.dataset.id);
        });
      });
    }

    // Asporti: stesso schema del badge eventi, finestra a sé in stile
    // preparazione — orario e cosa portare via ben in vista, non
    // mescolati con la lista tavoli.
    const takeaways = bookings.filter(b => b.status === STATUS.TAKEAWAY).sort((a, b) => a.time.localeCompare(b.time));
    const takeawayBadgeBtn = document.getElementById('roTakeawayBadgeBtn');
    const takeawayBadgeCount = document.getElementById('roTakeawayBadgeCount');
    const takeawayPopoverList = document.getElementById('roTakeawayPopoverList');
    if (takeawayBadgeBtn && takeawayBadgeCount) {
      takeawayBadgeBtn.classList.toggle('hidden', takeaways.length === 0);
      takeawayBadgeCount.textContent = takeaways.length;
    }
    if (takeawayPopoverList) {
      takeawayPopoverList.innerHTML = takeaways.length === 0
        ? '<p style="font-size:13px;color:var(--color-ink-soft);padding:12px">Nessun asporto per questo servizio.</p>'
        : takeaways.map(b => {
            const items = Bookings.getTakeawayItems(b);
            const { userNotes } = Bookings.splitNotes(b.notes);
            return '<div class="takeaway-prep-card">' +
              '<div class="takeaway-prep-time">' + b.time + '</div>' +
              '<div class="takeaway-prep-body">' +
                '<div class="takeaway-prep-name">' + (this.escapeHTML(b.name) || '(senza nome)') + '</div>' +
                (items ? '<div class="takeaway-prep-items">' + this.escapeHTML(items) + '</div>' : '') +
                (userNotes ? '<div class="chef-row-note">📝 ' + this.escapeHTML(userNotes) + '</div>' : '') +
              '</div>' +
            '</div>';
          }).join('');
    }

    const roRemindersList = document.getElementById('roRemindersList');
    if (roRemindersList) {
      const reminders = SharedTables.getReminders();
      roRemindersList.innerHTML = reminders.length === 0
        ? '<p style="font-size:13px;color:var(--color-ink-soft);margin-top:10px">Nessun promemoria al momento.</p>'
        : reminders.map(r => {
            const when = new Date(r.createdAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            return '<div class="reminder-row">' +
              '<div class="reminder-row-text">' + this.escapeHTML(r.text) + (r.recipient ? ' <span class="reminder-recipient-tag">per ' + this.escapeHTML(r.recipient) + '</span>' : '') + '</div>' +
              '<div class="reminder-row-meta"><span>' + this.escapeHTML(r.author) + ' · ' + when + '</span></div>' +
            '</div>';
          }).join('');
    }

    // Lista prenotazioni, ridotta all'essenziale per la cucina: orario,
    // coperti, allergie ben in vista, nome piccolo per riferimento, note se
    // ci sono. Niente tavolo/zona/cani/esigenze — roba da sala, non da cucina.
    // Gli asporti NON compaiono qui — hanno una finestra a sé (vedi
    // renderTakeawayPopover), in stile preparazione, per non confonderli
    // con i tavoli veri.
    const list = document.getElementById('roBookingList');
    if (!list) return;
    const tableBookings = bookings.filter(b => b.status !== STATUS.TAKEAWAY);
    if (tableBookings.length === 0) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">🍽️</span><strong>Nessuna prenotazione</strong><span>Nessuna prenotazione per questo servizio.</span></div>';
      return;
    }
    list.innerHTML = '';
    tableBookings.forEach(b => {
      const row = document.createElement('div');
      row.className = 'ro-row chef-row' + (b.arrivedAt ? ' arrived' : '');
      row.dataset.id = b.id;
      const { userNotes } = Bookings.splitNotes(b.notes);
      const hotelInfo = Bookings.getHotelInfo(b);
      const isWorkerMenu = Bookings.isWorkerMenu(b);
      row.innerHTML =
        '<div class="chef-row-time-badge">' + b.time + '</div>' +
        '<div class="ro-info">' +
          '<div class="chef-row-top">' +
            '<span class="chef-row-covers">' + b.people + ' cop.' + (b.highchairs > 0 ? ' + ' + b.highchairs + ' segg.' : '') + '</span>' +
            '<span class="chef-row-name">' + (this.escapeHTML(b.name) || '(senza nome)') + '</span>' +
            (b.arrivedAt ? '<span class="ro-arrived-badge">✓</span>' : '') +
          '</div>' +
          (hotelInfo ? '<div class="chef-row-hotel">🏨 Camera ' + this.escapeHTML(hotelInfo.roomNumber || '?') + ' · ' + (hotelInfo.mealPlan === 'mezza_pensione' ? 'Mezza pensione' : 'Alla carta') +
            (Bookings.getStayVisitNumber(b) ? ' · ' + (Bookings.getStayVisitNumber(b) === 1 ? '👋 Prima volta' : '🔁 ' + Bookings.getStayVisitNumber(b) + 'ª volta') : '') +
          '</div>' : '') +
          (isWorkerMenu ? '<div class="chef-row-worker-menu">👷 Menu operaio</div>' : '') +
          // In cucina conta l'allergene: l'avviso "da verificare al tavolo"
          // (pensato per la sala) compare solo se l'allergene non c'è.
          (b.intolerances ? '' : this.dietaryAlertHTML(b, true)) +
          (b.intolerances ? '<div class="chef-row-allergy">⚠️ ' + this.escapeHTML(b.intolerances) + '</div>' : '') +
          (userNotes ? '<div class="chef-row-note">📝 ' + this.escapeHTML(userNotes) + '</div>' : '') +
        '</div>';
      list.appendChild(row);
    });
  },
};

window.UI = UI;

UI.renderMise = function() {
  const date = this.state.selectedDate;
  const service = this.state.miseService || Utils.currentService();
  this.state.miseService = service;

  document.getElementById('miseDateLabel').textContent = this.dateLabel(date);
  document.getElementById('miseBtnLunch')?.classList.toggle('active', service === 'lunch');
  document.getElementById('miseBtnDinner')?.classList.toggle('active', service === 'dinner');

  const container = document.getElementById('miseContent');
  if (!container) return;

  const zt = SharedTables.getZoneTavoli();
  const zones = SharedTables.getZones();
  // Una prenotazione "Terminata" ha già liberato il tavolo: non serve più preparla per lei.
  // Chi è in lista d'attesa non ha un tavolo garantito: non conta nel riepilogo coperti da preparare.
  // L'asporto non ha nessun tavolo da preparare per definizione: stesso discorso.
  const bookings = Bookings.getByDateAndService(date, service)
    .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW && b.status !== STATUS.WAITLIST && b.status !== STATUS.TAKEAWAY);

  // Mappa: tavolo singolo → prenotazione (per sapere quali tavoli sono occupati)
  const singleTableMap = {};
  // Lista di card da mostrare: { tableKey, tables[], booking }
  // Per tavoli uniti (es. "1, 2") creiamo una sola card
  const groupedCards = []; // { tableKey: "1, 2", tables: ["1","2"], bookings: [b] }
  const handledTables = new Set();

  bookings.forEach(b => {
    if (b.tablesAssigned) {
      const assignedTables = b.tablesAssigned.split(',').map(t => t.trim()).filter(Boolean);
      const key = assignedTables.join(', ');
      // Cerca se esiste già una card per questo gruppo
      let existing = groupedCards.find(c => c.tableKey === key);
      if (existing) {
        existing.bookings.push(b);
      } else {
        groupedCards.push({ tableKey: key, tables: assignedTables, bookings: [b] });
      }
      assignedTables.forEach(t => { singleTableMap[t] = key; handledTables.add(t); });
    }
  });

  if (zones.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">🍽️</span><strong>Nessuna zona configurata</strong></div>';
    return;
  }

  container.innerHTML = '';
  zones.forEach(zone => {
    const tables = zt[zone] || [];
    if (tables.length === 0) return;

    const section = document.createElement('div');
    section.className = 'mise-zone';

    const zoneHeader = document.createElement('div');
    zoneHeader.className = 'mise-zone-header';
    zoneHeader.textContent = zone;
    section.appendChild(zoneHeader);

    const grid = document.createElement('div');
    grid.className = 'mise-grid';

    // Tavoli già mostrati come parte di un gruppo unito
    const shownInZone = new Set();

    tables.forEach(t => {
      if (shownInZone.has(t)) return;

      const isBlocked = SharedTables.isBlocked(t, date, service);
      const groupKey = singleTableMap[t];
      const group = groupedCards.find(c => c.tableKey === groupKey && c.tables.includes(t));

      const card = document.createElement('div');

      if (isBlocked && !group) {
        card.className = 'mise-card mise-blocked';
        card.innerHTML = '<div class="mise-table-name">' + t + '</div><div class="mise-table-status">🚫 Non disponibile</div>';
      } else if (!group) {
        // Tavolo libero
        card.className = 'mise-card mise-free';
        card.innerHTML = '<div class="mise-table-name">' + t + '</div><div class="mise-table-status mise-free-label">Libero</div>';
      } else {
        // Tavolo prenotato (anche unito)
        const cardName = group.tableKey; // es. "1, 2"
        const totalPeople = group.bookings.reduce((s, b) => s + b.people, 0);
        const totalChairs = group.bookings.reduce((s, b) => s + (b.highchairs || 0), 0);
        const times = group.bookings.map(b => b.time).join(', ');
        const names = group.bookings.map(b => b.name).join(' + ');
        const hasIntolerances = group.bookings.some(b => b.intolerances);
        const hasNotes = group.bookings.some(b => b.notes || b.specialNeeds);
        const isMulti = group.tables.length > 1;

        card.className = 'mise-card mise-booked' + (isMulti ? ' mise-multi' : '');
        card.innerHTML =
          '<div class="mise-table-name">' + cardName + '</div>' +
          '<div class="mise-people">' + totalPeople + ' pers.' + (totalChairs > 0 ? ' + ' + totalChairs + ' segg.' : '') + '</div>' +
          '<div class="mise-time">' + times + '</div>' +
          '<div class="mise-name">' + UI.escapeHTML(names) + '</div>' +
          (hasIntolerances ? '<div class="mise-alert">⚠️ Intolleranze</div>' : '') +
          (hasNotes ? '<div class="mise-alert">📝 Note</div>' : '');

        // Marca tutti i tavoli del gruppo come già mostrati
        group.tables.forEach(gt => shownInZone.add(gt));
      }

      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  });

  // Riepilogo finale
  const totalPeople = bookings.reduce((s, b) => s + b.people, 0);
  const totalChairs = bookings.reduce((s, b) => s + (b.highchairs || 0), 0);
  const summary = document.createElement('div');
  summary.className = 'mise-summary';
  summary.innerHTML = '📊 Totale: <strong>' + totalPeople + ' persone</strong>' +
    (totalChairs > 0 ? ' + <strong>' + totalChairs + ' seggiolini</strong>' : '') +
    ' · ' + bookings.length + ' tavoli';
  container.appendChild(summary);
};

// Funzione globale per il rendering della griglia tavoli (usata da admin e readonly)
function renderTableGrid(container, dateISO, serviceKey, interactive) {
  const bookings = Bookings.getByDateAndService(dateISO, serviceKey)
    .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW);
  const assigned = new Set();
  bookings.forEach(b => {
    if (b.tablesAssigned) b.tablesAssigned.split(',').forEach(t => assigned.add(t.trim()));
  });
  const zt = SharedTables.getZoneTavoli();
  const zones = SharedTables.getZones();
  if (zones.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = '';
  zones.forEach(zone => {
    const tables = zt[zone] || [];
    const freeCount = tables.filter(t => !assigned.has(t) && !SharedTables.isBlocked(t, dateISO, serviceKey)).length;
    const allBlocked = tables.length > 0 && tables.every(t => SharedTables.isBlocked(t, dateISO, serviceKey));

    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom:4px';

    const zoneLabel = document.createElement('span');
    zoneLabel.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:' +
      (allBlocked ? 'var(--color-danger)' : 'var(--color-ink-soft)') +
      (interactive ? ';cursor:pointer;user-select:none' : '');
    zoneLabel.textContent = zone + ' — ' + freeCount + '/' + tables.length + ' liberi' + (allBlocked ? ' 🚫' : '');
    if (interactive) zoneLabel.title = 'Doppio click per bloccare/sbloccare tutta la zona';

    if (interactive) {
      const doToggleZone = async () => {
        const shouldBlock = !allBlocked;
        for (const t of tables) {
          if (shouldBlock !== SharedTables.isBlocked(t, dateISO, serviceKey)) await SharedTables.toggleBlocked(t, dateISO, serviceKey);
        }
        const screen = UI.state.currentScreen;
        if (screen === 'list') UI.renderList();
        else UI.renderDashboard();
      };
      zoneLabel.addEventListener('dblclick', (e) => { e.preventDefault(); doToggleZone(); });
      let lastTapZone = 0;
      zoneLabel.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTapZone < 350) { e.preventDefault(); doToggleZone(); }
        lastTapZone = now;
      }, { passive: false });
    }

    header.appendChild(zoneLabel);
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'available-tables-grid';
    grid.style.marginBottom = '8px';

    tables.forEach(t => {
      const pill = document.createElement('span');
      const isOccupied = assigned.has(t);
      const isBlocked = SharedTables.isBlocked(t, dateISO, serviceKey);
      pill.className = 'avail-table-pill ' + (isBlocked ? 'blocked' : isOccupied ? 'occupied' : 'free');
      pill.textContent = t;
      if (interactive) {
        pill.style.cursor = 'pointer';
        pill.title = 'Doppio click per bloccare/sbloccare';
        pill.style.userSelect = 'none';

        const doToggle = async () => {
          const nowBlocked = !SharedTables.isBlocked(t, dateISO, serviceKey);
          pill.className = 'avail-table-pill ' + (nowBlocked ? 'blocked' : (assigned.has(t) ? 'occupied' : 'free'));
          await SharedTables.toggleBlocked(t, dateISO, serviceKey);
          const screen = UI.state.currentScreen;
          if (screen === 'list') UI.renderList();
          else UI.renderDashboard();
        };

        pill.addEventListener('dblclick', (e) => { e.preventDefault(); doToggle(); });

        let lastTap = 0;
        pill.addEventListener('touchend', (e) => {
          const now = Date.now();
          if (now - lastTap < 350) { e.preventDefault(); doToggle(); }
          lastTap = now;
        }, { passive: false });
      }
      grid.appendChild(pill);
    });
    container.appendChild(grid);
  });
}


// Estensione UI per i Progetti Gastronomici (solo Luca/Davy)
// Strumento decisionale, non un registro prenotazioni — pensato per essere
// consultato in pochi minuti mentre si valuta se accettare un evento o come
// impostarlo economicamente.

/**
 * Elenco progetti salvati — un pannello a scomparsa con contatore, come
 * l'archivio delle statistiche, così non affolla lo schermo se ce ne sono
 * tanti accumulati nel tempo.
 */
/**
 * Modalità semplice: nasconde percentuali, barre di scomposizione e i tre
 * prezzi tecnici (pareggio/minimo/consigliato), mostrando solo un verdetto
 * in linguaggio comune — pensata per chi non mastica food cost e margine
 * di contribuzione. Ricordata sul dispositivo, non per singolo progetto.
 */
UI.isProjectSimpleMode = function() {
  return Storage.get('projectSimpleMode', false);
};

/**
 * Scheda con le spunte per le notifiche — richiamabile sia dal pulsante
 * in Impostazioni (sala/admin) che dalla campanella nella vista chef,
 * stessa identica scheda. Se il dispositivo non è ancora sottoscritto,
 * lo sottoscrive prima con preferenze di partenza ragionevoli in base al
 * ruolo — poi apre comunque la scheda, così si può aggiustare subito.
 */
UI.openNotificationPrefsModal = async function() {
  const existing = await getExistingPushSubscription();
  if (!existing) {
    UI.toast('Attiva prima le notifiche col pulsante 🔔', 'warning');
    return;
  }
  const subs = SharedTables.getPushSubscriptions();
  const mySub = subs.find(s => s.endpoint === existing.endpoint);
  // Sottoscrizioni create prima di questo aggiornamento non hanno ancora
  // preferenze: parto da tutto spento, tranne "preparazione speciale" per
  // lo chef — era già l'unica cosa che ricevevano, non voglio che una
  // sottoscrizione già funzionante smetta di colpo di avvisare.
  const role = DB.getRole();
  const defaultPrefs = Object.keys(NOTIFICATION_TYPES).reduce((acc, key) => {
    // Le notifiche dell'ODS partono accese per tutti: sono il modo in cui
    // chi lavora a un evento sa che qualcosa è cambiato o è stato fatto.
    acc[key] = key.indexOf('ods_') === 0 ? true : (role === 'read' && key === 'special_needs');
    return acc;
  }, {});
  const prefs = (mySub && mySub.notificationPrefs) ? { ...defaultPrefs, ...mySub.notificationPrefs } : defaultPrefs;

  let modal = document.getElementById('notificationPrefsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'notificationPrefsModal';
    modal.className = 'modal-overlay modal-overlay-centered';
    document.getElementById('app').appendChild(modal);
  }
  modal.innerHTML =
    '<div class="modal-sheet modal-sheet-centered">' +
      '<h3 style="margin:0 0 4px">🔔 Notifiche</h3>' +
      '<p style="font-size:12px;color:var(--color-ink-soft);margin:0 0 12px">Scegli cosa vuoi ricevere su questo dispositivo.</p>' +
      '<div id="notifPrefsList">' +
        Object.entries(NOTIFICATION_TYPES).map(([key, label]) =>
          '<label class="notif-pref-row"><input type="checkbox" class="notif-pref-check" data-key="' + key + '"' + (prefs[key] ? ' checked' : '') + '> ' + label + '</label>'
        ).join('') +
      '</div>' +
      '<div class="modal-actions" style="margin-top:16px">' +
        '<button class="modal-btn-cancel" id="notifPrefsClose">Chiudi</button>' +
        '<button class="modal-btn-confirm" id="notifPrefsSave" style="background:var(--color-primary)">Salva</button>' +
      '</div>' +
      '<a href="#" class="delete-link" id="notifPrefsDisableAll" style="display:block;text-align:center;margin-top:12px">Disattiva tutte le notifiche su questo dispositivo</a>' +
    '</div>';
  modal.classList.add('active');
  modal.querySelector('#notifPrefsClose').addEventListener('click', () => modal.classList.remove('active'));
  modal.querySelector('#notifPrefsSave').addEventListener('click', async () => {
    const newPrefs = {};
    modal.querySelectorAll('.notif-pref-check').forEach(cb => { newPrefs[cb.dataset.key] = cb.checked; });
    modal.classList.remove('active');
    UI.showSyncIndicator(true);
    await SharedTables.updatePushSubscriptionPrefs(existing.endpoint, newPrefs);
    UI.showSyncIndicator(false);
    UI.toast('Preferenze salvate ✓');
  });
  modal.querySelector('#notifPrefsDisableAll').addEventListener('click', async (e) => {
    e.preventDefault();
    modal.classList.remove('active');
    await togglePushNotifications(); // sa già che è sottoscritto e disattiva
  });
};

UI.renderProjects = function() {
  const list = document.getElementById('projectsList');
  if (!list) return;
  const modeBtn = document.getElementById('projectsModeToggle');
  if (modeBtn) {
    const simple = UI.isProjectSimpleMode();
    modeBtn.textContent = simple ? '😊' : '👔';
    modeBtn.title = simple ? 'Modalità semplice attiva — tocca per passare a professionale' : 'Modalità professionale attiva — tocca per passare a semplice';
  }
  const projects = SharedTables.getProjects().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  if (projects.length === 0) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><strong>Nessun progetto</strong><span>Crea il primo progetto per valutare economicamente un evento prima che accada.</span></div>';
    return;
  }

  list.innerHTML = '<details class="stats-archive-details" open>' +
    '<summary>Progetti salvati (' + projects.length + ')</summary>' +
    '<p style="font-size:12px;color:var(--color-ink-soft);margin:8px 0">Spunta due o più progetti per metterli a confronto fianco a fianco.</p>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
      projects.map(p => {
        // Se ci sono portate, il food cost vero è la loro somma (non il
        // campo semplice, che a quel punto resta solo una copia vecchia).
        const coursesFoodCost = SharedTables.computeCoursesFoodCost(p.courses);
        const effectiveFoodCost = coursesFoodCost !== null ? coursesFoodCost : p.foodCostPerPerson;
        const econ = SharedTables.computeProjectEconomics({ pricePerPerson: p.pricePerPerson, foodCostPerPerson: effectiveFoodCost, marginTargetPct: p.marginTargetPct, coperti: p.coperti, staffCostTotal: p.staffCostTotal, otherCostsTotal: p.otherCostsTotal });
        const semaforoColor = econ.semaforo === 'verde' ? '#2E7D4F' : (econ.semaforo === 'giallo' ? '#C08A2E' : '#A32D2D');
        const dateLabel = p.date ? UI.dateLabel(p.date) : 'data da definire';
        return '<div class="project-card-wrap">' +
          '<input type="checkbox" class="project-compare-check" data-id="' + p.id + '" title="Seleziona per confrontare">' +
          '<button type="button" class="project-card" data-id="' + p.id + '">' +
            '<div class="project-card-top">' +
              '<span class="project-card-dot" style="background:' + semaforoColor + '"></span>' +
              '<strong class="project-card-name">' + UI.escapeHTML(p.name || 'Senza nome') + '</strong>' +
              '<span class="project-card-status">' + (PROJECT_STATUS_LABELS[p.status] || p.status) + '</span>' +
            '</div>' +
            '<div class="project-card-meta">' + dateLabel + ' · ' + (PROJECT_EVENT_TYPE_LABELS[p.eventType] || p.eventType) + ' · ' + p.coperti + ' cop.</div>' +
            '<div class="project-card-meta">Margine target ' + p.marginTargetPct + '% · budget vino ' + econ.wineBudgetPct.toFixed(0) + '%</div>' +
          '</button>' +
        '</div>';
      }).join('') +
    '</div>' +
  '</details>' +
  '<div class="project-compare-bar hidden" id="projectCompareBar">' +
    '<span id="projectCompareCount">0</span> selezionati' +
    '<button type="button" class="modal-btn-confirm" id="projectCompareBtn" style="background:var(--color-primary)">Confronta</button>' +
  '</div>';

  list.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => UI.openProjectForm(card.dataset.id));
  });
  list.querySelectorAll('.project-compare-check').forEach(cb => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      const n = list.querySelectorAll('.project-compare-check:checked').length;
      const bar = document.getElementById('projectCompareBar');
      document.getElementById('projectCompareCount').textContent = n;
      bar.classList.toggle('hidden', n < 2);
    });
  });
  const compareBtn = document.getElementById('projectCompareBtn');
  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      const ids = Array.from(list.querySelectorAll('.project-compare-check:checked')).map(cb => cb.dataset.id);
      UI.openProjectComparisonModal(ids);
    });
  }
};

/**
 * Confronto fianco a fianco (impilato, più leggibile su telefono) tra due
 * o più progetti salvati — non un documento da stampare per il cliente
 * (quello ha senso nel gestionale vini, qui è uno strumento vostro
 * interno): solo i numeri messi vicini, per decidere più facilmente.
 */
UI.openProjectComparisonModal = function(ids) {
  const projects = ids.map(id => SharedTables.getProjectById(id)).filter(Boolean);
  if (projects.length < 2) return;
  let modal = document.getElementById('projectComparisonModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'projectComparisonModal';
    modal.className = 'modal-overlay modal-overlay-centered';
    document.getElementById('app').appendChild(modal);
  }

  const cards = projects.map(p => {
    const coursesFoodCost = SharedTables.computeCoursesFoodCost(p.courses);
    const effectiveFoodCost = coursesFoodCost !== null ? coursesFoodCost : p.foodCostPerPerson;
    const e = SharedTables.computeProjectEconomics({ pricePerPerson: p.pricePerPerson, foodCostPerPerson: effectiveFoodCost, marginTargetPct: p.marginTargetPct, coperti: p.coperti, staffCostTotal: p.staffCostTotal, otherCostsTotal: p.otherCostsTotal });
    const semaforoColor = e.semaforo === 'verde' ? '#2E7D4F' : (e.semaforo === 'giallo' ? '#C08A2E' : '#A32D2D');
    return '<div class="project-compare-card">' +
      '<h4 style="margin:0 0 8px;color:' + semaforoColor + '">' + UI.escapeHTML(p.name || 'Senza nome') + '</h4>' +
      '<div class="project-econ-row"><span>Coperti</span><strong>' + p.coperti + '</strong></div>' +
      '<div class="project-econ-row"><span>Prezzo a persona</span><strong>' + p.pricePerPerson.toFixed(2) + '€</strong></div>' +
      '<div class="project-econ-row"><span>Food cost a persona</span><strong>' + effectiveFoodCost.toFixed(2) + '€</strong></div>' +
      '<div class="project-econ-row"><span>Margine target</span><strong>' + p.marginTargetPct + '%</strong></div>' +
      '<div class="project-econ-row"><span>Budget vino</span><strong>' + e.wineBudgetPct.toFixed(1) + '%</strong></div>' +
      '<div class="project-econ-row"><span>Margine lordo totale</span><strong>' + e.margineTotale.toFixed(2) + '€</strong></div>' +
    '</div>';
  }).join('');

  modal.innerHTML =
    '<div class="modal-sheet modal-sheet-centered">' +
      '<h3 style="margin:0 0 4px">Confronto progetti</h3>' +
      '<p style="font-size:12px;color:var(--color-ink-soft);margin:0 0 12px">' + projects.length + ' progetti a confronto</p>' +
      cards +
      '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="modal-btn-cancel" id="projectComparisonClose">Chiudi</button>' +
      '</div>' +
    '</div>';
  modal.classList.add('active');
  modal.querySelector('#projectComparisonClose').addEventListener('click', () => modal.classList.remove('active'));
};

/**
 * Apre il form — vuoto per un progetto nuovo, precompilato per uno
 * esistente. Il quadro economico (Fase 2) si aggiorna da solo appena si
 * apre, e ad ogni modifica dei campi della Fase 1.
 */
UI.openProjectForm = function(id) {
  UI.state.editingProjectId = id || null;
  const p = id ? SharedTables.getProjectById(id) : null;

  document.getElementById('projectFormTitle').textContent = p ? 'Modifica progetto' : 'Nuovo progetto';
  document.getElementById('pjName').value = p ? p.name : '';
  document.getElementById('pjClientName').value = p ? (p.clientName || '') : '';
  document.getElementById('pjClientCompany').value = p ? (p.clientCompany || '') : '';
  document.getElementById('pjClientPhone').value = p ? (p.clientPhone || '') : '';
  document.getElementById('pjClientEmail').value = p ? (p.clientEmail || '') : '';
  document.getElementById('pjDate').value = p ? (p.date || '') : '';
  document.getElementById('pjEventType').value = p ? p.eventType : 'cena_privata';
  UI._projectCoperti = p ? p.coperti : 20;
  document.getElementById('pjCopertiValue').textContent = UI._projectCoperti;

  // Cosa è incluso — spuntato/non spuntato sulle stesse chip, niente
  // elenco a parte da tenere sincronizzato.
  UI._projectIncludes = p && Array.isArray(p.includes) ? [...p.includes] : [];
  UI.renderProjectIncludes();
  document.getElementById('pjWineCount').value = p && p.wineCount ? p.wineCount : '';
  document.getElementById('pjBudgetMaxPerPerson').value = p && p.budgetMaxPerPerson ? p.budgetMaxPerPerson : '';
  document.getElementById('pjBudgetTotal').value = p && p.budgetTotal ? p.budgetTotal : '';
  document.getElementById('pjArrivalTime').value = p ? (p.arrivalTime || '') : '';
  document.getElementById('pjEndTime').value = p ? (p.endTime || '') : '';
  const dietary = (p && p.dietary) || { vegetarians: 0, vegans: 0, celiac: 0, other: '' };
  UI._projectDietary = { ...dietary };
  document.getElementById('pjVegValue').textContent = UI._projectDietary.vegetarians;
  document.getElementById('pjVeganValue').textContent = UI._projectDietary.vegans;
  document.getElementById('pjCeliacValue').textContent = UI._projectDietary.celiac;
  document.getElementById('pjDietaryOther').value = UI._projectDietary.other || '';
  document.getElementById('pjRequestNotes').value = p ? (p.requestNotes || '') : '';

  document.getElementById('pjPrice').value = p ? p.pricePerPerson : '';
  document.getElementById('pjFoodCost').value = p ? p.foodCostPerPerson : '';
  document.getElementById('pjMarginTarget').value = p ? p.marginTargetPct : 30;
  document.getElementById('pjFoodCostMax').value = p && p.foodCostMaxPct != null ? p.foodCostMaxPct : '';
  document.getElementById('pjStaffCost').value = p && p.staffCostTotal ? p.staffCostTotal : '';
  document.getElementById('pjOtherCosts').value = p && p.otherCostsTotal ? p.otherCostsTotal : '';
  document.getElementById('pjNotes').value = p ? p.notes : '';
  UI.state.projectStatus = p ? p.status : 'idea';
  UI.renderProjectStatusOptions();
  document.getElementById('projectDeleteLink').classList.toggle('hidden', !p);

  // Scheda operativa: visibile solo da Confermato in poi — non ha senso
  // prima, l'evento potrebbe non succedere mai.
  const opBox = document.getElementById('projectOperationalBox');
  const isOperational = PROJECT_OPERATIONAL_STATUSES.includes(UI.state.projectStatus);
  opBox.classList.toggle('hidden', !isOperational);
  opBox.dataset.initialized = isOperational ? '1' : ''; // si riparte da zero ogni volta che si apre un progetto
  if (isOperational) {
    opBox.innerHTML =
      '<div class="field-group">' +
        '<label class="field-label">📋 Scheda operativa (cucina, sala, personale)</label>' +
        '<textarea class="text-input" id="pjOperationalNotes" rows="4" placeholder="Porzioni, allergie da segnalare in cucina, disposizione tavoli, orari personale…">' + UI.escapeHTML(p ? (p.operationalNotes || '') : '') + '</textarea>' +
        '<p style="font-size:12px;color:var(--color-ink-soft);margin-top:6px">Scritta a mano — non collegata a moduli cucina/magazzino che non esistono ancora.</p>' +
      '</div>';
  }

  // Portate: se il progetto le usa già, si apre direttamente con quelle
  // visibili — non deve servire ritoccare il link per ritrovarle.
  UI._projectCourses = p && Array.isArray(p.courses) ? JSON.parse(JSON.stringify(p.courses)) : [];
  const coursesBox = document.getElementById('pjCoursesBox');
  const hasCourses = UI._projectCourses.length > 0;
  coursesBox.classList.toggle('hidden', !hasCourses);
  document.getElementById('pjCoursesToggle').textContent = hasCourses
    ? '📋 Nascondi la scomposizione per portata'
    : '📋 Scomponi il food cost per portata (facoltativo)';
  UI.renderProjectCourses();

  UI.updateProjectEconomicsBox();
  UI.showScreen('project-form');
};

/**
 * "Cosa è incluso" — chip che si spuntano toccandole, come i giorni
 * rapidi nel form prenotazioni. Il vino mostra in più un campo "quanti"
 * solo se è tra gli inclusi, altrimenti non ha senso chiederlo.
 */
UI.renderProjectIncludes = function() {
  const grid = document.getElementById('pjIncludesGrid');
  if (!grid) return;
  grid.querySelectorAll('.project-include-chip').forEach(chip => {
    chip.classList.toggle('active', UI._projectIncludes.includes(chip.dataset.key));
  });
  document.getElementById('pjWineCountGroup').classList.toggle('hidden', !UI._projectIncludes.includes('vino'));
};

/**
 * Le portate — pensate per essere capite senza spiegazioni: ogni piatto è
 * una riga con nome e costo, e se una portata ne ha più di uno da
 * confrontare basta toccarne uno per dire "è questo che useremo" — niente
 * "proposta 1/2/3", niente indici, solo un tocco su quello giusto, come si
 * sceglie un tavolo nel form prenotazione.
 */
UI.renderProjectCourses = function() {
  const box = document.getElementById('pjCoursesBox');
  if (!box) return;
  const courses = UI._projectCourses || [];

  box.innerHTML = courses.map(c => {
    const multi = (c.options || []).length > 1;
    return '<div class="project-course-card" data-course-id="' + c.id + '">' +
      '<div class="project-course-header">' +
        '<input type="text" class="text-input project-course-name" data-course-id="' + c.id + '" value="' + UI.escapeHTML(c.name || '') + '" placeholder="Nome portata (es. Antipasto)">' +
        '<button type="button" class="project-course-remove" data-course-id="' + c.id + '" title="Togli portata">🗑️</button>' +
      '</div>' +
      (c.options || []).map(o => {
        const chosen = multi && o.id === c.chosenId;
        return '<div class="project-option-row' + (multi ? ' project-option-row-selectable' : '') + (chosen ? ' project-option-chosen' : '') + '" data-course-id="' + c.id + '" data-option-id="' + o.id + '">' +
          (multi ? '<span class="project-option-check">' + (chosen ? '✓' : '') + '</span>' : '') +
          '<input type="text" class="text-input project-option-name" data-course-id="' + c.id + '" data-option-id="' + o.id + '" value="' + UI.escapeHTML(o.name || '') + '" placeholder="Nome piatto">' +
          '<input type="number" class="text-input project-option-cost" data-course-id="' + c.id + '" data-option-id="' + o.id + '" value="' + (o.foodCost != null ? o.foodCost : '') + '" min="0" step="0.5" inputmode="decimal" placeholder="€">' +
          (multi ? '<button type="button" class="project-option-remove" data-course-id="' + c.id + '" data-option-id="' + o.id + '" title="Togli questa alternativa">✕</button>' : '') +
        '</div>';
      }).join('') +
      '<button type="button" class="project-add-option-link" data-course-id="' + c.id + '">＋ Aggiungi un\'alternativa da confrontare</button>' +
    '</div>';
  }).join('') +
  '<button type="button" class="project-add-course-btn" id="pjAddCourseBtn">＋ Aggiungi portata</button>';

  // Riaggancio: tocco sulla riga (non sugli input dentro) sceglie quella
  // opzione; gli input aggiornano nome/costo senza mai perdere la scelta.
  box.querySelectorAll('.project-option-row-selectable').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('input') || e.target.closest('button')) return;
      const course = UI._projectCourses.find(c => c.id === row.dataset.courseId);
      if (course) { course.chosenId = row.dataset.optionId; UI.renderProjectCourses(); UI.updateProjectEconomicsBox(); }
    });
  });
  box.querySelectorAll('.project-course-name').forEach(input => {
    input.addEventListener('input', () => {
      const course = UI._projectCourses.find(c => c.id === input.dataset.courseId);
      if (course) course.name = input.value;
    });
  });
  box.querySelectorAll('.project-option-name').forEach(input => {
    input.addEventListener('input', () => {
      const course = UI._projectCourses.find(c => c.id === input.dataset.courseId);
      const opt = course && (course.options || []).find(o => o.id === input.dataset.optionId);
      if (opt) opt.name = input.value;
    });
  });
  box.querySelectorAll('.project-option-cost').forEach(input => {
    input.addEventListener('input', () => {
      const course = UI._projectCourses.find(c => c.id === input.dataset.courseId);
      const opt = course && (course.options || []).find(o => o.id === input.dataset.optionId);
      if (opt) { opt.foodCost = Number(input.value) || 0; UI.updateProjectEconomicsBox(); }
    });
  });
  box.querySelectorAll('.project-option-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const course = UI._projectCourses.find(c => c.id === btn.dataset.courseId);
      if (!course) return;
      course.options = (course.options || []).filter(o => o.id !== btn.dataset.optionId);
      if (course.chosenId === btn.dataset.optionId) course.chosenId = course.options[0] ? course.options[0].id : null;
      UI.renderProjectCourses();
      UI.updateProjectEconomicsBox();
    });
  });
  box.querySelectorAll('.project-course-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      UI._projectCourses = UI._projectCourses.filter(c => c.id !== btn.dataset.courseId);
      UI.renderProjectCourses();
      UI.updateProjectEconomicsBox();
    });
  });
  box.querySelectorAll('.project-add-option-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const course = UI._projectCourses.find(c => c.id === btn.dataset.courseId);
      if (!course) return;
      const newOpt = { id: Utils.uid('opt'), name: '', foodCost: 0 };
      course.options = [...(course.options || []), newOpt];
      if (!course.chosenId) course.chosenId = course.options[0].id;
      UI.renderProjectCourses();
      UI.updateProjectEconomicsBox();
    });
  });
  const addCourseBtn = document.getElementById('pjAddCourseBtn');
  if (addCourseBtn) {
    addCourseBtn.addEventListener('click', () => {
      const firstOpt = { id: Utils.uid('opt'), name: '', foodCost: 0 };
      UI._projectCourses.push({ id: Utils.uid('course'), name: '', options: [firstOpt], chosenId: firstOpt.id });
      UI.renderProjectCourses();
      UI.updateProjectEconomicsBox();
    });
  }
};

UI.renderProjectStatusOptions = function() {
  const container = document.getElementById('projectStatusOptions');
  if (!container) return;
  container.innerHTML = '';
  for (const [key, label] of Object.entries(PROJECT_STATUS_LABELS)) {
    const btn = document.createElement('button');
    btn.className = 'status-btn';
    btn.classList.toggle('active', UI.state.projectStatus === key);
    btn.textContent = label;
    btn.addEventListener('click', () => {
      UI.state.projectStatus = key;
      UI.renderProjectStatusOptions();
      // La scheda operativa compare/sparisce subito col cambio di stato,
      // senza dover uscire e rientrare dal form per vederla.
      const opBox = document.getElementById('projectOperationalBox');
      const isOperational = PROJECT_OPERATIONAL_STATUSES.includes(key);
      opBox.classList.toggle('hidden', !isOperational);
      // Genera il contenuto solo la prima volta che compare in questa
      // sessione di modifica — altrimenti, cambiando stato avanti e
      // indietro, si perderebbe quello scritto nel frattempo.
      if (isOperational && !opBox.dataset.initialized) {
        opBox.dataset.initialized = '1';
        const p = UI.state.editingProjectId ? SharedTables.getProjectById(UI.state.editingProjectId) : null;
        opBox.innerHTML =
          '<div class="field-group">' +
            '<label class="field-label">📋 Scheda operativa (cucina, sala, personale)</label>' +
            '<textarea class="text-input" id="pjOperationalNotes" rows="4" placeholder="Porzioni, allergie da segnalare in cucina, disposizione tavoli, orari personale…">' + UI.escapeHTML(p ? (p.operationalNotes || '') : '') + '</textarea>' +
            '<p style="font-size:12px;color:var(--color-ink-soft);margin-top:6px">Scritta a mano — non collegata a moduli cucina/magazzino che non esistono ancora.</p>' +
          '</div>';
      }
    });
    container.appendChild(btn);
  }
};

/**
 * Fase 2 — il quadro economico, ricalcolato dal vivo. Il budget vino non
 * si digita mai: è quello che resta del ricavo dopo food cost e margine
 * target, quindi se questi due insieme superano il 100% non resta nulla
 * per il vino — segnalato chiaramente invece di mostrare un numero
 * negativo senza spiegazione.
 */
/**
 * Riepilogo pulito del menu scelto — pensato per essere mostrato così
 * com'è a un cliente per il preventivo: solo le portate con il piatto
 * SCELTO (non le alternative scartate), il prezzo, e in una sezione
 * separata — solo per te, non per il cliente — il margine vero.
 */
UI.openProjectSummaryModal = function() {
  let modal = document.getElementById('projectSummaryModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'projectSummaryModal';
    modal.className = 'modal-overlay modal-overlay-centered';
    document.getElementById('app').appendChild(modal);
  }

  const name = document.getElementById('pjName').value.trim() || 'Evento senza nome';
  const clientName = document.getElementById('pjClientName').value.trim();
  const clientCompany = document.getElementById('pjClientCompany').value.trim();
  const dateVal = document.getElementById('pjDate').value;
  const dateLabel = dateVal ? UI.dateLabel(dateVal) : 'data da definire';
  const coperti = UI._projectCoperti || 0;
  const price = Number(document.getElementById('pjPrice').value) || 0;
  const marginPct = Number(document.getElementById('pjMarginTarget').value) || 0;
  const staffCostTotal = Number(document.getElementById('pjStaffCost').value) || 0;
  const otherCostsTotal = Number(document.getElementById('pjOtherCosts').value) || 0;
  const courses = UI._projectCourses || [];
  const coursesFoodCost = SharedTables.computeCoursesFoodCost(courses);
  const foodCost = coursesFoodCost !== null ? coursesFoodCost : (Number(document.getElementById('pjFoodCost').value) || 0);
  const e = SharedTables.computeProjectEconomics({ pricePerPerson: price, foodCostPerPerson: foodCost, marginTargetPct: marginPct, coperti, staffCostTotal, otherCostsTotal });

  const menuRows = courses.length > 0
    ? courses.map(c => {
        const chosen = (c.options || []).find(o => o.id === c.chosenId) || (c.options || [])[0];
        return '<div class="project-summary-row"><span>' + UI.escapeHTML(c.name || 'Portata') + '</span><strong>' + UI.escapeHTML(chosen ? chosen.name || '—' : '—') + '</strong></div>';
      }).join('')
    : '<p style="font-size:13px;color:var(--color-ink-soft)">Nessuna portata scomposta — solo il food cost totale.</p>';

  // "Cosa è incluso" tradotto in un elenco leggibile — il vino mostra
  // anche quanti, se impostato.
  const INCLUDE_LABELS = { aperitivo: 'Aperitivo', vino: 'Vino', acqua: 'Acqua', caffe: 'Caffè', digestivo: 'Digestivo', torta: 'Torta', open_bar: 'Open bar', servizio_tavolo: 'Servizio al tavolo', allestimento: 'Allestimento' };
  const includes = UI._projectIncludes || [];
  const wineCountVal = document.getElementById('pjWineCount').value;
  const includesRows = includes.length > 0
    ? '<ul class="project-summary-includes">' + includes.map(k => {
        const extra = (k === 'vino' && wineCountVal) ? ' (' + wineCountVal + ')' : '';
        return '<li>' + UI.escapeHTML(INCLUDE_LABELS[k] || k) + extra + '</li>';
      }).join('') + '</ul>'
    : '';

  const eventTypeLabel = PROJECT_EVENT_TYPE_LABELS[document.getElementById('pjEventType').value] || '';

  modal.innerHTML =
    '<div class="modal-sheet modal-sheet-centered">' +
      '<p class="project-summary-header">Lou Tchappé — Preventivo evento</p>' +
      '<h3 style="margin:0 0 2px">' + UI.escapeHTML(name) + '</h3>' +
      '<p style="font-size:13px;color:var(--color-ink-soft);margin:0 0 12px">' +
        (clientName ? UI.escapeHTML(clientName) + (clientCompany ? ' · ' + UI.escapeHTML(clientCompany) : '') + ' · ' : '') +
        dateLabel + (coperti ? ' · ' + coperti + ' coperti' : '') + (eventTypeLabel ? ' · ' + eventTypeLabel : '') +
      '</p>' +
      '<div class="project-summary-section">' +
        '<h4>Il menu</h4>' +
        menuRows +
        (includesRows ? '<h4 style="margin-top:10px">Incluso</h4>' + includesRows : '') +
        '<div class="project-summary-row project-summary-price"><span>Prezzo a persona</span><strong>' + price.toFixed(2) + '€</strong></div>' +
        (coperti ? '<div class="project-summary-row"><span>Totale per ' + coperti + ' persone</span><strong>' + (price * coperti).toFixed(2) + '€</strong></div>' : '') +
        '<p style="font-size:11px;color:var(--color-ink-soft);margin-top:8px">Preventivo indicativo, valido 15 giorni dalla data odierna.</p>' +
      '</div>' +
      '<div class="project-summary-section project-summary-internal">' +
        '<h4>Il tuo margine — solo per te, non mostrare al cliente</h4>' +
        '<div class="project-summary-row"><span>Food cost a persona</span><strong>' + foodCost.toFixed(2) + '€</strong></div>' +
        (staffCostTotal > 0 ? '<div class="project-summary-row"><span>Costo personale</span><strong>' + staffCostTotal.toFixed(2) + '€</strong></div>' : '') +
        (otherCostsTotal > 0 ? '<div class="project-summary-row"><span>Altri costi</span><strong>' + otherCostsTotal.toFixed(2) + '€</strong></div>' : '') +
        '<div class="project-summary-row"><span>Budget vino</span><strong>' + e.wineBudgetPct.toFixed(1) + '% · ' + e.wineBudgetPerPerson.toFixed(2) + '€/persona</strong></div>' +
        '<div class="project-summary-row"><span>Margine lordo totale</span><strong>' + e.margineTotale.toFixed(2) + '€</strong></div>' +
      '</div>' +
      '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="modal-btn-cancel" id="projectSummaryClose">Chiudi</button>' +
      '</div>' +
    '</div>';
  modal.classList.add('active');
  modal.querySelector('#projectSummaryClose').addEventListener('click', () => modal.classList.remove('active'));
};

UI.updateProjectEconomicsBox = function() {
  const box = document.getElementById('projectEconomicsBox');
  if (!box) return;
  const price = Number(document.getElementById('pjPrice').value) || 0;
  const foodCostInput = document.getElementById('pjFoodCost');
  // Se ci sono portate, il food cost è la somma delle scelte fatte lì —
  // il campo diventa di sola lettura, per non lasciare due numeri diversi
  // in giro che possono disallinearsi.
  const coursesFoodCost = SharedTables.computeCoursesFoodCost(UI._projectCourses);
  const usingCourses = coursesFoodCost !== null;
  foodCostInput.readOnly = usingCourses;
  foodCostInput.classList.toggle('project-foodcost-computed', usingCourses);
  if (usingCourses) foodCostInput.value = coursesFoodCost.toFixed(2);
  const foodCost = usingCourses ? coursesFoodCost : (Number(foodCostInput.value) || 0);
  const marginPct = Number(document.getElementById('pjMarginTarget').value) || 0;
  const coperti = UI._projectCoperti || 0;
  const staffCostTotal = Number(document.getElementById('pjStaffCost').value) || 0;
  const otherCostsTotal = Number(document.getElementById('pjOtherCosts').value) || 0;

  const e = SharedTables.computeProjectEconomics({ pricePerPerson: price, foodCostPerPerson: foodCost, marginTargetPct: marginPct, coperti, staffCostTotal, otherCostsTotal });
  const semaforoColor = e.semaforo === 'verde' ? '#2E7D4F' : (e.semaforo === 'giallo' ? '#C08A2E' : '#A32D2D');
  const semaforoBg = e.semaforo === 'verde' ? '#E6F2EB' : (e.semaforo === 'giallo' ? '#FBF1E2' : '#FCEBEB');

  // Modalità semplice: un verdetto solo, in linguaggio comune — niente
  // percentuali, niente barra di scomposizione, niente tre prezzi tecnici.
  // Chi vuole tutti i numeri passa a modalità professionale col pulsante
  // in alto nella lista progetti.
  if (UI.isProjectSimpleMode()) {
    if (!e.feasible) {
      box.innerHTML =
        '<div class="project-economics-box" style="background:' + semaforoBg + ';border-color:' + semaforoColor + '">' +
          '<p style="font-weight:700;color:' + semaforoColor + ';margin:0 0 6px">⚠️ Con questi numeri ci rimetti</p>' +
          (e.prezzoConsigliato ? '<p style="font-size:14px;margin:0">Per guadagnarci quello che vuoi, il prezzo dovrebbe salire ad almeno <strong>' + e.prezzoConsigliato.toFixed(2) + '€</strong> a persona.</p>' : '') +
        '</div>';
    } else {
      box.innerHTML =
        '<div class="project-economics-box" style="background:' + semaforoBg + ';border-color:' + semaforoColor + '">' +
          '<p style="font-weight:700;color:' + semaforoColor + ';margin:0 0 6px">✅ Con questi numeri va bene</p>' +
          '<p style="font-size:14px;margin:0">Guadagni circa <strong>' + e.margineTotale.toFixed(0) + '€</strong> su tutto l\'evento (' + coperti + ' persone).</p>' +
        '</div>';
    }
    UI.renderProjectConstraintAlert(e, marginPct, price);
    return;
  }

  if (!e.feasible) {
    box.innerHTML =
      '<div class="project-economics-box" style="background:' + semaforoBg + ';border-color:' + semaforoColor + '">' +
        '<p style="font-weight:700;color:' + semaforoColor + ';margin:0 0 6px">⚠️ Costi fissi + margine target superano il ricavo</p>' +
        '<p style="font-size:13px;color:var(--color-ink-soft);margin:0">Food cost, costo personale e altri costi insieme non lasciano nulla per il vino con questi numeri.</p>' +
        (e.prezzoMinimoSostenibile ? '<div class="project-econ-row" style="margin-top:8px"><span>Prezzo minimo per centrare il target</span><strong>' + e.prezzoMinimoSostenibile.toFixed(2) + '€</strong></div>' : '') +
        (e.prezzoDiPareggio ? '<div class="project-econ-row"><span>Prezzo di pareggio (margine zero)</span><strong>' + e.prezzoDiPareggio.toFixed(2) + '€</strong></div>' : '') +
      '</div>';
    UI.renderProjectConstraintAlert(e, marginPct, price);
    return;
  }

  box.innerHTML =
    '<div class="project-economics-box" style="background:' + semaforoBg + ';border-color:' + semaforoColor + '">' +
      '<div class="project-econ-row"><span>Food cost sul ricavo</span><strong>' + e.foodCostPct.toFixed(1) + '%</strong></div>' +
      '<div class="project-econ-row"><span>Budget vino</span><strong>' + e.wineBudgetPct.toFixed(1) + '% · ' + e.wineBudgetPerPerson.toFixed(2) + '€/persona</strong></div>' +
      '<div class="project-econ-row"><span>Margine target</span><strong>' + marginPct.toFixed(1) + '%</strong></div>' +
      '<div class="project-econ-bar">' +
        '<div class="project-econ-bar-seg" style="width:' + e.foodCostPct + '%;background:#8A6A2E" title="Food cost"></div>' +
        '<div class="project-econ-bar-seg" style="width:' + e.wineBudgetPct + '%;background:#5A7A9E" title="Vino"></div>' +
        '<div class="project-econ-bar-seg" style="width:' + marginPct + '%;background:' + semaforoColor + '" title="Margine"></div>' +
      '</div>' +
      '<div class="project-econ-totals">' +
        '<div class="project-econ-row"><span>Ricavo totale (' + coperti + ' cop.)</span><strong>' + e.ricavoTotale.toFixed(2) + '€</strong></div>' +
        '<div class="project-econ-row"><span>Food cost totale</span><strong>' + e.foodCostTotale.toFixed(2) + '€</strong></div>' +
        (staffCostTotal > 0 ? '<div class="project-econ-row"><span>Costo personale</span><strong>' + staffCostTotal.toFixed(2) + '€</strong></div>' : '') +
        (otherCostsTotal > 0 ? '<div class="project-econ-row"><span>Altri costi</span><strong>' + otherCostsTotal.toFixed(2) + '€</strong></div>' : '') +
        '<div class="project-econ-row"><span>Budget vino totale</span><strong>' + e.budgetVinoTotale.toFixed(2) + '€</strong></div>' +
        '<div class="project-econ-row"><span>Margine lordo totale</span><strong>' + e.margineTotale.toFixed(2) + '€</strong></div>' +
      '</div>' +
      '<div class="project-econ-totals">' +
        '<div class="project-econ-row"><span>Prezzo di pareggio</span><strong>' + (e.prezzoDiPareggio != null ? e.prezzoDiPareggio.toFixed(2) + '€' : '—') + '</strong></div>' +
        '<div class="project-econ-row"><span>Prezzo minimo sostenibile</span><strong>' + (e.prezzoMinimoSostenibile != null ? e.prezzoMinimoSostenibile.toFixed(2) + '€' : '—') + '</strong></div>' +
        '<div class="project-econ-row"><span>Prezzo consigliato</span><strong>' + (e.prezzoConsigliato != null ? e.prezzoConsigliato.toFixed(2) + '€' : '—') + '</strong></div>' +
      '</div>' +
    '</div>';

  UI.renderProjectConstraintAlert(e, marginPct, price);
};

/**
 * Spiega PERCHÉ un vincolo non torna, con suggerimenti concreti — non un
 * generico "margine troppo basso". Il prezzo suggerito è sempre un
 * calcolo vero (stessa formula del prezzo minimo sostenibile); le altre
 * proposte (ridurre vini, togliere l'open bar) restano qualitative perché
 * non ho un costo reale per ciascuna da sottrarre — inventarlo sarebbe
 * disonesto.
 */
UI.renderProjectConstraintAlert = function(e, marginPct, price) {
  const box = document.getElementById('projectConstraintAlert');
  if (!box) return;
  const foodCostMaxPct = document.getElementById('pjFoodCostMax').value ? Number(document.getElementById('pjFoodCostMax').value) : null;
  const budgetMaxPerPerson = document.getElementById('pjBudgetMaxPerPerson').value ? Number(document.getElementById('pjBudgetMaxPerPerson').value) : null;
  const includes = UI._projectIncludes || [];
  const wineCount = document.getElementById('pjWineCount').value ? Number(document.getElementById('pjWineCount').value) : null;

  const problems = [];
  if (!e.feasible) {
    problems.push('Il margine minimo del ' + marginPct.toFixed(0) + '% non è raggiungibile con questi coperti e costi — manca budget anche solo per coprire food cost, personale e altri costi.');
  }
  if (foodCostMaxPct != null && e.foodCostPct > foodCostMaxPct) {
    problems.push('Il food cost è al ' + e.foodCostPct.toFixed(1) + '% del ricavo, sopra il limite che ti eri dato (' + foodCostMaxPct + '%).');
  }
  if (budgetMaxPerPerson != null && price > budgetMaxPerPerson) {
    problems.push('Il prezzo (' + price.toFixed(2) + '€) supera il budget massimo dichiarato dal cliente (' + budgetMaxPerPerson.toFixed(2) + '€ a persona).');
  }

  if (problems.length === 0) { box.innerHTML = ''; return; }

  const suggestions = [];
  if (e.prezzoConsigliato != null && e.prezzoConsigliato > price) {
    suggestions.push('Portare il prezzo a ' + e.prezzoConsigliato.toFixed(2) + '€ a persona.');
  }
  if (includes.includes('vino') && wineCount && wineCount > 1) {
    suggestions.push('Ridurre i vini inclusi da ' + wineCount + ' a ' + (wineCount - 1) + '.');
  }
  if (includes.includes('open_bar')) {
    suggestions.push('Valutare di togliere l\'open bar.');
  }
  if ((UI._projectCourses || []).length > 3) {
    suggestions.push('Ridurre il numero di portate (attualmente ' + UI._projectCourses.length + ').');
  }
  suggestions.push('Aumentare il numero minimo di partecipanti, se possibile — i costi fissi si spalmano su più persone.');

  box.innerHTML =
    '<div class="project-constraint-alert">' +
      '<p style="font-weight:700;margin:0 0 6px">⚠️ ' + UI.escapeHTML(problems[0]) + '</p>' +
      (problems.length > 1 ? problems.slice(1).map(p => '<p style="font-size:13px;margin:2px 0">' + UI.escapeHTML(p) + '</p>').join('') : '') +
      '<p style="font-size:13px;font-weight:700;margin:10px 0 4px">Suggerimenti:</p>' +
      '<ul style="margin:0;padding-left:18px;font-size:13px">' +
        suggestions.map(s => '<li>' + UI.escapeHTML(s) + '</li>').join('') +
      '</ul>' +
    '</div>';
};

UI.saveProject = async function() {
  if (!DB.isFullAdmin()) return;
  const name = document.getElementById('pjName').value.trim();
  if (!name) { UI.toast('Serve almeno il nome dell\'evento', 'warning'); return; }
  const data = {
    name,
    clientName: document.getElementById('pjClientName').value.trim(),
    clientCompany: document.getElementById('pjClientCompany').value.trim(),
    clientPhone: document.getElementById('pjClientPhone').value.trim(),
    clientEmail: document.getElementById('pjClientEmail').value.trim(),
    date: document.getElementById('pjDate').value || null,
    eventType: document.getElementById('pjEventType').value,
    coperti: UI._projectCoperti || 0,
    includes: UI._projectIncludes || [],
    wineCount: document.getElementById('pjWineCount').value ? Number(document.getElementById('pjWineCount').value) : null,
    budgetMaxPerPerson: document.getElementById('pjBudgetMaxPerPerson').value ? Number(document.getElementById('pjBudgetMaxPerPerson').value) : null,
    budgetTotal: document.getElementById('pjBudgetTotal').value ? Number(document.getElementById('pjBudgetTotal').value) : null,
    arrivalTime: document.getElementById('pjArrivalTime').value,
    endTime: document.getElementById('pjEndTime').value,
    dietary: {
      vegetarians: UI._projectDietary?.vegetarians || 0,
      vegans: UI._projectDietary?.vegans || 0,
      celiac: UI._projectDietary?.celiac || 0,
      other: document.getElementById('pjDietaryOther').value.trim(),
    },
    requestNotes: document.getElementById('pjRequestNotes').value.trim(),
    pricePerPerson: Number(document.getElementById('pjPrice').value) || 0,
    // Il campo mostra già la somma delle portate quando sono attive (sola
    // lettura in quel caso) — leggerlo così com'è tiene un solo numero
    // vero, senza calcolarlo due volte in punti diversi.
    foodCostPerPerson: Number(document.getElementById('pjFoodCost').value) || 0,
    courses: UI._projectCourses || [],
    marginTargetPct: Number(document.getElementById('pjMarginTarget').value) || 0,
    foodCostMaxPct: document.getElementById('pjFoodCostMax').value ? Number(document.getElementById('pjFoodCostMax').value) : null,
    staffCostTotal: Number(document.getElementById('pjStaffCost').value) || 0,
    otherCostsTotal: Number(document.getElementById('pjOtherCosts').value) || 0,
    status: UI.state.projectStatus || 'idea',
    notes: document.getElementById('pjNotes').value.trim(),
    operationalNotes: document.getElementById('pjOperationalNotes') ? document.getElementById('pjOperationalNotes').value.trim() : '',
  };
  UI.showSyncIndicator(true);
  if (UI.state.editingProjectId) {
    await SharedTables.updateProject(UI.state.editingProjectId, data);
  } else {
    await SharedTables.addProject(data);
  }
  UI.showSyncIndicator(false);
  UI.toast('Progetto salvato ✓');
  UI.showScreen('projects');
};

UI.deleteProject = async function() {
  if (!UI.state.editingProjectId) return;
  if (!confirm('Eliminare questo progetto? Non si può annullare.')) return;
  UI.showSyncIndicator(true);
  await SharedTables.removeProject(UI.state.editingProjectId);
  UI.showSyncIndicator(false);
  UI.toast('Progetto eliminato');
  UI.showScreen('projects');
};

UI.duplicateProjectQuick = async function(id) {
  UI.showSyncIndicator(true);
  const copy = await SharedTables.duplicateProject(id);
  UI.showSyncIndicator(false);
  if (copy) {
    UI.toast('Progetto duplicato ✓');
    UI.openProjectForm(copy.id);
  }
};

// Estensione UI per i Buoni Regalo
UI.renderBuoni = function(query) {
  const list = document.getElementById('buoniList');
  if (!list) return;
  const items = query ? Buoni.search(query) : Buoni.getCached();

  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">🎁</span><strong>Nessun buono</strong><span>' + (query ? 'Nessun risultato per questa ricerca.' : 'Nessun buono regalo ancora.') + '</span></div>';
    return;
  }

  list.innerHTML = '';
  items.forEach(b => {
    const row = document.createElement('div');
    row.className = 'buono-row' + (b.usato ? ' buono-used' : '');

    const scadenza = b.scadenza ? new Date(b.scadenza).toLocaleDateString('it-IT') : '—';
    const usatoIl = b.usato_il ? new Date(b.usato_il).toLocaleDateString('it-IT') : null;
    const isExpired = b.scadenza && !b.usato && new Date(b.scadenza) < new Date();

    const valoreLabel = b.valore ? '€ ' + Number(b.valore).toFixed(2) : '';
    const personeLabel = b.persone ? b.persone + (b.persone === 1 ? ' persona' : ' persone') : '';
    row.innerHTML =
      '<div class="buono-header">' +
        '<span class="buono-code">' + b.codice + '</span>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">' +
          (valoreLabel ? '<span class="buono-value">' + valoreLabel + '</span>' : '') +
          (personeLabel ? '<span class="buono-persone">' + personeLabel + '</span>' : '') +
        '</div>' +
      '</div>' +
      (b.contenuto ? '<div class="buono-contenuto">' + this.escapeHTML(b.contenuto) + '</div>' : '') +
      '<div class="buono-details">' +
        (b.nome ? '<span>👤 ' + this.escapeHTML(b.nome) + '</span>' : '') +
        (b.telefono ? '<span>📞 ' + this.escapeHTML(b.telefono) + '</span>' : '') +
        (b.scadenza ? '<span>📅 Scade: ' + (isExpired ? '<strong style="color:var(--color-danger)">' + scadenza + ' (SCADUTO)</strong>' : scadenza) + '</span>' : '') +
        (b.usato ? '<span class="buono-used-badge">✓ Utilizzato' + (usatoIl ? ' il ' + usatoIl : '') + '</span>' : '') +
        (b.note ? '<span>📝 ' + this.escapeHTML(b.note) + '</span>' : '') +
      '</div>' +
      '<div class="buono-actions">' +
        '<button class="buono-print-btn" data-id="' + b.id + '">🖨️ Stampa</button>' +
        (!b.usato ? '<button class="buono-use-btn" data-id="' + b.id + '">Segna utilizzato</button>' : '<button class="buono-unuse-btn" data-id="' + b.id + '">Ripristina</button>') +
        '<button class="buono-delete-btn" data-id="' + b.id + '">🗑️</button>' +
      '</div>';

    const printBtn = row.querySelector('.buono-print-btn');
    if (printBtn) {
      printBtn.addEventListener('click', () => UI.printBuono(b));
    }

    const useBtn = row.querySelector('.buono-use-btn, .buono-unuse-btn');
    if (useBtn) {
      useBtn.addEventListener('click', async () => {
        const nowUsed = useBtn.classList.contains('buono-use-btn');
        if (nowUsed && !confirm('Segnare il buono ' + b.codice + ' come utilizzato?')) return;
        UI.showSyncIndicator(true);
        await Buoni.markUsed(b.id, nowUsed);
        UI.showSyncIndicator(false);
        UI.toast(nowUsed ? 'Buono segnato come utilizzato ✓' : 'Buono ripristinato');
        UI.renderBuoni(document.getElementById('buoniSearchInput')?.value || '');
      });
    }

    const delBtn = row.querySelector('.buono-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm('Eliminare il buono ' + b.codice + '?')) return;
        UI.showSyncIndicator(true);
        await Buoni.remove(b.id);
        UI.showSyncIndicator(false);
        UI.toast('Buono eliminato');
        UI.renderBuoni(document.getElementById('buoniSearchInput')?.value || '');
      });
    }

    list.appendChild(row);
  });
};

/**
 * Chiede in che lingua stampare il buono (italiano/inglese/francese),
 * poi genera e apre la stampa in quella lingua.
 */
UI.printBuono = function(b) {
  let modal = document.getElementById('buonoLangModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'buonoLangModal';
    modal.className = 'modal-overlay';
    document.getElementById('app').appendChild(modal);
  }

  modal.innerHTML =
    '<div class="modal-sheet capacity-confirm-sheet">' +
      '<h3>In che lingua?</h3>' +
      '<div class="piantina-style-group" style="justify-content:center">' +
        '<button type="button" class="piantina-style-btn" data-lang="it">🇮🇹 Italiano</button>' +
        '<button type="button" class="piantina-style-btn" data-lang="en">🇬🇧 English</button>' +
        '<button type="button" class="piantina-style-btn" data-lang="fr">🇫🇷 Français</button>' +
      '</div>' +
      '<div class="modal-actions" style="margin-top:16px">' +
        '<button class="modal-btn-cancel" id="buonoLangCancel">Annulla</button>' +
      '</div>' +
    '</div>';

  modal.classList.add('active');
  modal.querySelector('#buonoLangCancel').addEventListener('click', () => modal.classList.remove('active'));
  modal.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.classList.remove('active');
      UI._generateBuonoPrint(b, btn.dataset.lang);
    });
  });
};

UI._generateBuonoPrint = function(b, lang) {
  const template = document.getElementById('buonoPrintTemplate');
  if (!template) return;
  const t = Buoni.I18N[lang] || Buoni.I18N.it;
  const localeMap = { it: 'it-IT', en: 'en-GB', fr: 'fr-FR' };
  const locale = localeMap[lang] || 'it-IT';

  const valoreLabel = b.valore ? '€ ' + Number(b.valore).toFixed(2) : '';
  const personeLabel = b.persone ? t.people(b.persone) : '';
  const scadenzaLabel = b.scadenza ? new Date(b.scadenza).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  const issuedLabel = new Date(b.created_at || Date.now()).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });

  template.innerHTML =
    '<div class="buono-print-frame"><div class="buono-print-card"><div class="buono-print-main">' +
      '<img src="icons/logo-mark.png" class="buono-print-logo" alt="">' +
      '<div class="buono-print-restaurant">' + t.restaurant + '</div>' +
      '<div class="buono-print-place">' + t.place + '</div>' +
      '<div class="buono-print-divider">✻</div>' +
      '<div class="buono-print-title">' + t.title + '</div>' +
      (valoreLabel
        ? '<div class="buono-print-value-box">' + valoreLabel + '</div>'
        : '<div class="buono-print-value-box buono-print-value-free">' + t.freeValue + '</div>') +
      (personeLabel ? '<div class="buono-print-people">' + personeLabel + '</div>' : '') +
      (b.contenuto ? '<div class="buono-print-content">' + this.escapeHTML(b.contenuto) + '</div>' : '') +
      (b.nome ? '<div class="buono-print-recipient">' + t.recipient + ': <strong>' + this.escapeHTML(b.nome) + '</strong></div>' : '') +
      (scadenzaLabel ? '<div class="buono-print-expiry">' + t.validUntil + ' ' + scadenzaLabel + '</div>' : '') +
      '</div>' +
      '<img src="icons/mountains.png" class="buono-print-mountains" alt="">' +
      '<div class="buono-print-footer">' +
        '<span>' + t.voucherNo + ' ' + this.escapeHTML(b.codice) + '</span>' +
        '<span>' + t.issued + ' ' + issuedLabel + '</span>' +
      '</div>' +
    '</div></div>';

  // Piccola pausa per lasciare che le immagini si carichino prima di stampare
  setTimeout(() => window.print(), 150);
};

UI.openBuonoForm = function() {
  document.getElementById('buonoFormTitle').textContent = 'Nuovo buono';
  document.getElementById('bCodice').value = Buoni.nextCode();
  document.getElementById('bContenuto').value = '';
  document.getElementById('bValore').value = '';
  document.getElementById('bNome').value = '';
  document.getElementById('bTelefono').value = '';
  document.getElementById('bScadenza').value = '';
  document.getElementById('bNote').value = '';
  UI._buonoPersone = 0;
  document.getElementById('bPersoneValue').textContent = '—';
  // Il codice è già proposto in automatico (resta modificabile), quindi il
  // pulsante può partire abilitato invece che bloccato in attesa di un input.
  document.getElementById('buonoSaveBtn').disabled = false;
  this.showScreen('buono-form');
};

UI.saveBuono = async function() {
  const codice = document.getElementById('bCodice').value.trim();
  if (!codice) { this.toast('Inserisci il codice del buono', 'warning'); return; }

  const btn = document.getElementById('buonoSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Salvo…';
  this.showSyncIndicator(true);

  try {
    const created = await Buoni.create({
      codice,
      contenuto: document.getElementById('bContenuto').value,
      persone: UI._buonoPersone > 0 ? UI._buonoPersone : null,
      valore: document.getElementById('bValore').value || null,
      nome: document.getElementById('bNome').value,
      telefono: document.getElementById('bTelefono').value,
      scadenza: document.getElementById('bScadenza').value || null,
      note: document.getElementById('bNote').value,
    });
    this.toast('Buono salvato ✓');
    this.showScreen('buoni');
    UI.renderBuoni('');
    // Genera subito il PDF del buono appena creato — un tocco in meno,
    // e si può sempre rigenerare più tardi dal pulsante sulla riga.
    if (created) UI.printBuono(created);
  } catch(err) {
    if (err.message === 'DUPLICATE') {
      this.toast('Codice già esistente — usa un altro codice', 'warning');
    } else {
      this.toast('Errore nel salvataggio', 'warning');
    }
    btn.disabled = false;
    btn.textContent = 'Salva buono';
  }
  this.showSyncIndicator(false);
};
