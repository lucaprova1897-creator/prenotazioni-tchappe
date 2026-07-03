/**
 * ui.js
 * Logica di presentazione. I metodi che toccano prenotazioni sono ora async
 * perché Bookings legge/scrive su JSONBin. Tutto il resto (slot, config,
 * navigazione) resta sincrono come prima.
 */

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

  /* ======================================================================
     NAVIGAZIONE
     ====================================================================== */

  showScreen(screenName) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    const target = document.getElementById(`screen-${screenName}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.screen === screenName);
    });

    this.state.currentScreen = screenName;

    if (screenName === 'dashboard') this.renderDashboard();
    if (screenName === 'list') this.renderList();
    if (screenName === 'config') this.renderConfig();
    if (screenName === 'search') document.getElementById('searchInput').focus();
    if (screenName === 'preview') this.renderPreview();
    if (screenName === 'readonly') this.renderReadOnlyView();
  },

  toast(message, type = 'default') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = `toast visible ${type}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
  },

  showSyncIndicator(show) {
    const el = document.getElementById('syncIndicator');
    if (el) el.classList.toggle('visible', show);
  },

  /* ======================================================================
     DASHBOARD
     ====================================================================== */

  renderDashboard() {
    const { selectedDate, selectedService } = this.state;
    document.getElementById('dashDateLabel').textContent = this.dateLabel(selectedDate);
    document.getElementById('btnServiceLunch').classList.toggle('active', selectedService === 'lunch');
    document.getElementById('btnServiceDinner').classList.toggle('active', selectedService === 'dinner');

    const stats = Bookings.getStatsForDateAndService(selectedDate, selectedService);
    document.getElementById('statGuests').textContent = stats.totalGuests;
    document.getElementById('statTables').textContent = stats.totalTablesBooked;

    this.renderTimeline('dashTimeline', selectedDate, selectedService, true);
  },

  dateLabel(iso) {
    const today = Utils.todayISO();
    const todayDate = Utils.isoToDate(today);
    const tomorrowDate = new Date(todayDate); tomorrowDate.setDate(todayDate.getDate() + 1);
    const yesterdayDate = new Date(todayDate); yesterdayDate.setDate(todayDate.getDate() - 1);
    const tomorrow = Utils.dateToISO(tomorrowDate);
    const yesterday = Utils.dateToISO(yesterdayDate);
    if (iso === today) return `Oggi · ${Utils.formatDateShort(iso)}`;
    if (iso === tomorrow) return `Domani · ${Utils.formatDateShort(iso)}`;
    if (iso === yesterday) return `Ieri · ${Utils.formatDateShort(iso)}`;
    return Utils.formatDateLong(iso);
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
      const count = counts[slot] ?? 0;
      const level = this.slotLevel(count, cfg.maxBookingsPerSlot);
      const div = document.createElement('div');
      div.className = 'timeline-slot';
      div.dataset.level = level;
      div.innerHTML = `<span class="slot-time">${slot}</span><span class="slot-count">${count}/${cfg.maxBookingsPerSlot}</span>`;
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
    return 'partial';
  },

  serviceLabel(key) {
    const cfg = Config.load();
    return cfg.services[key]?.label || key;
  },

  /* ======================================================================
     LISTA PRENOTAZIONI
     ====================================================================== */

  renderList() {
    const { selectedDate, selectedService } = this.state;
    document.getElementById('listDateLabel').textContent = this.dateLabel(selectedDate);
    document.getElementById('listBtnLunch').classList.toggle('active', selectedService === 'lunch');
    document.getElementById('listBtnDinner').classList.toggle('active', selectedService === 'dinner');

    const bookings = Bookings.getByDateAndService(selectedDate, selectedService);
    this.renderBookingRows('listContent', bookings, {
      emptyIcon: '🍽️',
      emptyTitle: 'Nessuna prenotazione',
      emptyText: `Nessuna prenotazione per questo servizio.`,
    });
  },

  renderBookingRows(containerId, bookings, emptyConfig) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (bookings.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">${emptyConfig.emptyIcon}</span>
          <strong>${emptyConfig.emptyTitle}</strong>
          <span>${emptyConfig.emptyText}</span>
        </div>`;
      return;
    }
    for (const b of bookings) container.appendChild(this.buildBookingRow(b));
  },

  buildBookingRow(b) {
    const row = document.createElement('div');
    row.className = 'booking-row';
    row.dataset.status = b.status;

    const tags = [];
    if (b.dogs > 0) tags.push(`<span class="tag">🐾 ${b.dogs}</span>`);
    if (b.intolerances) tags.push(`<span class="tag tag-warning">⚠️ ${this.escapeHTML(b.intolerances)}</span>`);
    if (b.doubleShift) tags.push(`<span class="tag tag-warning">⏱️ libera per le ${b.doubleShift.releaseTime}</span>`);
    if (b.zone !== 'any') tags.push(`<span class="tag">${ZONE_LABELS[b.zone]}</span>`);

    row.innerHTML = `
      <div class="time-block">
        <span class="time-value">${b.time}</span>
        <span class="time-service">${b.service === 'lunch' ? 'Pranzo' : 'Cena'}</span>
      </div>
      <div class="booking-info">
        <div class="booking-name-line">
          <span>${this.escapeHTML(b.name) || '(senza nome)'}</span>
          <span class="people-badge">· ${b.people} ${b.people === 1 ? 'persona' : 'persone'}</span>
        </div>
        ${tags.length ? `<div class="booking-tags">${tags.join('')}</div>` : ''}
        ${b.phone ? `<a class="booking-phone-link" href="${Utils.telLink(b.phone)}" onclick="event.stopPropagation()">📞 ${this.escapeHTML(b.phone)}</a>` : ''}
      </div>
      ${b.isNew ? `<button class="new-badge" type="button" aria-label="Segna come trascritta">Nuova</button>` : ''}
    `;

    if (b.isNew) {
      const badge = row.querySelector('.new-badge');
      badge.addEventListener('click', async (e) => {
        e.stopPropagation();
        badge.textContent = '…';
        this.showSyncIndicator(true);
        await Bookings.markAsTranscribed(b.id);
        this.showSyncIndicator(false);
        this.toast('Segnata come trascritta ✓');
        if (this.state.currentScreen === 'list') this.renderList();
        if (this.state.currentScreen === 'search') {
          this.renderSearch(document.getElementById('searchInput').value);
        }
      });
    }

    row.addEventListener('click', () => { if (DB.canEdit()) this.openEditForm(b.id); });
    return row;
  },

  escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /* ======================================================================
     RICERCA
     ====================================================================== */

  renderSearch(query) {
    const container = document.getElementById('searchResults');
    if (!query.trim()) { container.innerHTML = ''; return; }
    const results = Bookings.search(query);
    this.renderBookingRows('searchResults', results, {
      emptyIcon: '🔍',
      emptyTitle: 'Nessun risultato',
      emptyText: 'Prova con un altro nome, telefono o data.',
    });
  },

  /* ======================================================================
     FORM PRENOTAZIONE
     ====================================================================== */

  openNewForm(overrides = {}) {
    this.state.editingBookingId = null;
    this.state.formZone = 'any';
    this.state.formStatus = STATUS.CONFIRMED;

    document.getElementById('formTitle').textContent = 'Nuova prenotazione';
    document.getElementById('statusFieldGroup').classList.add('hidden');
    document.getElementById('deleteLink').classList.add('hidden');

    document.getElementById('fName').value = '';
    document.getElementById('fPhone').value = '';
    document.getElementById('fIntolerances').value = '';
    document.getElementById('fSpecialNeeds').value = '';
    document.getElementById('fNotes').value = '';
    this.setPeopleValue(2);
    this.setDogsValue(0);
    this.collapseOptional();

    const date = overrides.date || this.state.selectedDate || Utils.todayISO();
    const service = overrides.service || this.state.selectedService || Utils.currentService();

    document.getElementById('fDate').value = date;
    this.setFormService(service);
    this.setFormZone('any');
    this.populateSlotGrid();
    if (overrides.time) this.selectSlot(overrides.time);
    else this.autoSelectFirstAvailableSlot();

    this.updateSaveButtonState();
    this.showScreen('form');
  },

  openEditForm(bookingId) {
    const b = Bookings.getById(bookingId);
    if (!b) return;

    this.state.editingBookingId = bookingId;
    this.state.formZone = b.zone;
    this.state.formStatus = b.status;

    document.getElementById('formTitle').textContent = 'Modifica prenotazione';
    document.getElementById('statusFieldGroup').classList.remove('hidden');
    document.getElementById('deleteLink').classList.remove('hidden');

    document.getElementById('fName').value = b.name;
    document.getElementById('fPhone').value = b.phone;
    document.getElementById('fIntolerances').value = b.intolerances;
    document.getElementById('fSpecialNeeds').value = b.specialNeeds;
    document.getElementById('fNotes').value = b.notes;
    this.setPeopleValue(b.people);
    this.setDogsValue(b.dogs);

    if (b.intolerances || b.specialNeeds || b.notes || b.dogs > 0) this.expandOptional();
    else this.collapseOptional();

    document.getElementById('fDate').value = b.date;
    this.setFormService(b.service);
    this.setFormZone(b.zone);
    this.populateSlotGrid();
    this.selectSlot(b.time, { skipFullCheck: true });
    this.renderStatusOptions();
    this.updateDoubleShiftAlert();
    this.updateSaveButtonState();
    this.showScreen('form');
  },

  setFormService(serviceKey) {
    this._formService = serviceKey;
    document.querySelectorAll('#formServiceOptions .service-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.service === serviceKey);
    });
    this.populateSlotGrid();
  },

  setFormZone(zone) {
    this.state.formZone = zone;
    document.querySelectorAll('#formZoneOptions .zone-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.zone === zone);
    });
  },

  setPeopleValue(n) {
    this._peopleValue = Math.max(1, n);
    document.getElementById('peopleValue').textContent = this._peopleValue;
  },

  setDogsValue(n) {
    this._dogsValue = Math.max(0, n);
    document.getElementById('dogsValue').textContent = this._dogsValue;
  },

  expandOptional() {
    document.getElementById('optionalToggle').classList.add('expanded');
    document.getElementById('optionalFields').classList.add('expanded');
  },

  collapseOptional() {
    document.getElementById('optionalToggle').classList.remove('expanded');
    document.getElementById('optionalFields').classList.remove('expanded');
  },

  populateSlotGrid() {
    const date = document.getElementById('fDate').value;
    const service = this._formService;
    const cfg = Config.load();
    const counts = Slots.countBookingsPerSlot(service, date, Bookings.getCached());

    const grid = document.getElementById('formSlotGrid');
    grid.innerHTML = '';

    for (const slot of Slots.generateSlotsForService(service)) {
      let count = counts[slot] ?? 0;
      const editing = this.state.editingBookingId ? Bookings.getById(this.state.editingBookingId) : null;
      if (editing && editing.time === slot && editing.date === date && editing.service === service) {
        count = Math.max(0, count - 1);
      }
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

  selectSlot(time, options = {}) {
    const date = document.getElementById('fDate').value;
    const service = this._formService;
    const bookings = Bookings.getCached();
    const isAvailable = options.skipFullCheck || Slots.isSlotAvailable(service, date, time, bookings);

    if (!isAvailable) {
      this.showSlotSuggestion(time, service, date, bookings);
      return;
    }

    document.getElementById('slotSuggestionBox').classList.add('hidden');
    this._selectedTime = time;
    document.querySelectorAll('#formSlotGrid .slot-pill').forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.time === time);
    });
    this.updateDoubleShiftAlert();
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
      const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
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
      document.getElementById('suggestionText').textContent = 'Nessun orario libero per il resto del servizio.';
    } else {
      document.getElementById('suggestionText').textContent = 'Orario al completo. Orari liberi suggeriti:';
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

  updateDoubleShiftAlert() {
    const alertBox = document.getElementById('doubleShiftAlert');
    if (!this._selectedTime) { alertBox.classList.add('hidden'); return; }
    const date = document.getElementById('fDate').value;
    const info = Slots.getDoubleShiftInfo(this._formService, date, this._selectedTime);
    if (info) {
      document.getElementById('doubleShiftText').textContent =
        Slots.formatDoubleShiftMessage(this._selectedTime, info.releaseTime);
      alertBox.classList.remove('hidden');
    } else {
      alertBox.classList.add('hidden');
    }
  },

  renderStatusOptions() {
    const container = document.getElementById('formStatusOptions');
    container.innerHTML = '';
    for (const [key, label] of Object.entries(STATUS_LABELS)) {
      const btn = document.createElement('button');
      btn.className = 'status-btn';
      btn.classList.toggle('active', this.state.formStatus === key);
      btn.innerHTML = `<span class="status-dot ${key}"></span>${label}`;
      btn.addEventListener('click', () => {
        this.state.formStatus = key;
        this.renderStatusOptions();
      });
      container.appendChild(btn);
    }
  },

  updateSaveButtonState() {
    const name = document.getElementById('fName').value.trim();
    const btn = document.getElementById('saveBtn');
    btn.disabled = !(name.length > 0 && !!this._selectedTime);
  },

  async saveForm() {
    if (!DB.canEdit()) return;
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvo…';
    this.showSyncIndicator(true);

    const data = {
      name: document.getElementById('fName').value,
      phone: document.getElementById('fPhone').value,
      people: this._peopleValue,
      date: document.getElementById('fDate').value,
      time: this._selectedTime,
      service: this._formService,
      zone: this.state.formZone,
      dogs: this._dogsValue,
      intolerances: document.getElementById('fIntolerances').value,
      specialNeeds: document.getElementById('fSpecialNeeds').value,
      notes: document.getElementById('fNotes').value,
      status: this.state.formStatus,
    };

    try {
      if (this.state.editingBookingId) {
        await Bookings.update(this.state.editingBookingId, data);
        this.toast('Prenotazione aggiornata ✓');
      } else {
        await Bookings.create(data);
        this.toast('Prenotazione salvata ✓');
      }
    } catch(err) {
      this.toast('Errore nel salvataggio', 'warning');
      console.error(err);
    }

    this.showSyncIndicator(false);
    this.state.selectedDate = data.date;
    this.state.selectedService = data.service;
    this.showScreen('dashboard');
  },

  confirmDelete() {
    document.getElementById('deleteModal').classList.add('active');
  },

  async executeDelete() {
    if (this.state.editingBookingId && DB.canEdit()) {
      this.showSyncIndicator(true);
      await Bookings.remove(this.state.editingBookingId);
      this.showSyncIndicator(false);
      this.toast('Prenotazione cancellata');
    }
    document.getElementById('deleteModal').classList.remove('active');
    this.showScreen('dashboard');
  },

  /* ======================================================================
     CONFIGURAZIONE
     ====================================================================== */

  renderConfig() {
    const cfg = Config.load();
    document.getElementById('cfgTablesIndoor').value = cfg.tablesIndoor;
    document.getElementById('cfgTablesOutdoor').value = cfg.tablesOutdoor;
    document.getElementById('cfgLunchStart').value = cfg.services.lunch.start;
    document.getElementById('cfgLunchEnd').value = cfg.services.lunch.end;
    document.getElementById('cfgDinnerStart').value = cfg.services.dinner.start;
    document.getElementById('cfgDinnerEnd').value = cfg.services.dinner.end;
    document.getElementById('cfgSlotDuration').value = cfg.slotDurationMinutes;
    document.getElementById('cfgMaxPerSlot').value = cfg.maxBookingsPerSlot;
    document.getElementById('cfgDoubleShiftDuration').value = cfg.doubleShiftDurationMinutes;

    document.querySelectorAll('#cfgDoubleShiftDays .day-toggle').forEach((btn) => {
      btn.classList.toggle('active', cfg.doubleShiftDays.includes(Number(btn.dataset.day)));
    });

    // Mostra bin ID corrente (non la chiave, per sicurezza)
    const binEl = document.getElementById('cfgBinId');
    if (binEl) binEl.textContent = Api.getBinId() || '(non configurato)';
  },

  saveConfigFromForm() {
    const activeDays = Array.from(
      document.querySelectorAll('#cfgDoubleShiftDays .day-toggle.active')
    ).map((btn) => Number(btn.dataset.day));

    Config.save({
      tablesIndoor: Number(document.getElementById('cfgTablesIndoor').value) || 0,
      tablesOutdoor: Number(document.getElementById('cfgTablesOutdoor').value) || 0,
      services: {
        lunch: { label: 'Pranzo', start: document.getElementById('cfgLunchStart').value, end: document.getElementById('cfgLunchEnd').value },
        dinner: { label: 'Cena', start: document.getElementById('cfgDinnerStart').value, end: document.getElementById('cfgDinnerEnd').value },
      },
      slotDurationMinutes: Number(document.getElementById('cfgSlotDuration').value) || 15,
      maxBookingsPerSlot: Number(document.getElementById('cfgMaxPerSlot').value) || 1,
      doubleShiftDays: activeDays,
      doubleShiftDurationMinutes: Number(document.getElementById('cfgDoubleShiftDuration').value) || 75,
    });

    const confirmEl = document.getElementById('cfgSaveConfirm');
    confirmEl.classList.add('visible');
    clearTimeout(this._cfgConfirmTimer);
    this._cfgConfirmTimer = setTimeout(() => confirmEl.classList.remove('visible'), 1500);
  },

  /* ======================================================================
     ANTEPRIMA (foglio da screenshottare)
     ====================================================================== */

  openPreview() {
    this.state.previewDate = this.state.selectedDate;
    this.state.previewService = this.state.selectedService;
    this.showScreen('preview');
  },

  renderPreview() {
    const { previewDate, previewService } = this.state;
    document.getElementById('previewDateLabel').textContent = this.dateLabel(previewDate);
    document.getElementById('previewBtnLunch').classList.toggle('active', previewService === 'lunch');
    document.getElementById('previewBtnDinner').classList.toggle('active', previewService === 'dinner');

    const bookings = Bookings.getByDateAndService(previewDate, previewService);
    const activeBookings = bookings.filter((b) => b.status !== STATUS.CANCELLED);
    const totalGuests = activeBookings.reduce((sum, b) => sum + b.people, 0);

    document.getElementById('previewSheetTitle').textContent =
      `${this.serviceLabel(previewService)} · ${this.dateLabel(previewDate)}`;
    document.getElementById('previewSheetStats').textContent =
      `${totalGuests} ${totalGuests === 1 ? 'coperto' : 'coperti'} · ${activeBookings.length} ${activeBookings.length === 1 ? 'tavolo' : 'tavoli'}`;

    const list = document.getElementById('previewSheetList');
    list.innerHTML = '';

    if (bookings.length === 0) {
      list.innerHTML = `<div class="preview-empty">Nessuna prenotazione per questo servizio.</div>`;
      return;
    }
    for (const b of bookings) list.appendChild(this.buildPreviewRow(b));
  },

  buildPreviewRow(b) {
    const row = document.createElement('div');
    row.className = 'preview-row';
    if (b.status === STATUS.CANCELLED) row.classList.add('cancelled');

    const extras = [];
    if (b.zone !== 'any') extras.push(ZONE_LABELS[b.zone]);
    if (b.dogs > 0) extras.push(`🐾 ${b.dogs}`);
    if (b.intolerances) extras.push(`⚠️ ${b.intolerances}`);
    if (b.doubleShift) extras.push(`libera ${b.doubleShift.releaseTime}`);
    if (b.specialNeeds) extras.push(b.specialNeeds);
    if (b.status === STATUS.CANCELLED) extras.push('CANCELLATA');

    row.innerHTML = `
      <span class="preview-time">${b.time}</span>
      <div class="preview-main">
        <span class="preview-name">${this.escapeHTML(b.name) || '(senza nome)'}</span>
        <span class="preview-people">· ${b.people} pers.</span>
        ${extras.length ? `<div class="preview-extra">${extras.map((e) => this.escapeHTML(e)).join(' · ')}</div>` : ''}
      </div>
    `;
    return row;
  },

  /* ======================================================================
     SETUP INIZIALE (prima configurazione API Key + Bin ID)
     ====================================================================== */

  async runSetup() {
    this.showScreen('setup');
  },

  async handleSetupSubmit() {
    const keyInput = document.getElementById('setupApiKey');
    const binInput = document.getElementById('setupBinId');
    const btn = document.getElementById('setupSubmitBtn');
    const errEl = document.getElementById('setupError');

    const key = keyInput.value.trim();
    const binId = binInput.value.trim();

    if (!key) { errEl.textContent = 'Inserisci la API Key.'; errEl.classList.remove('hidden'); return; }

    btn.disabled = true;
    btn.textContent = 'Verifico…';
    errEl.classList.add('hidden');

    // Salva la chiave per poterla usare in testApiKey
    Api.saveApiKey(key);

    const valid = await Api.testApiKey(key);
    if (!valid) {
      errEl.textContent = 'API Key non valida. Ricontrolla su jsonbin.io.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Collega';
      Api.saveApiKey(''); // reset
      return;
    }

    if (binId) {
      // Bin esistente fornito dall'utente (condivisione con colleghi)
      Api.saveBinId(binId);
    } else {
      // Primo accesso: crea un nuovo bin
      btn.textContent = 'Creo il database…';
      const newBinId = await Api.createBin();
      if (!newBinId) {
        errEl.textContent = 'Errore nella creazione del database. Riprova.';
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Collega';
        return;
      }
    }

    btn.textContent = 'Carico le prenotazioni…';
    await Bookings.loadAll();
    this.showScreen('dashboard');
    this.toast('App configurata e pronta ✓');
  },
  /* ======================================================================
     VISTA SOLA LETTURA (colleghi senza permesso di modifica)
     ====================================================================== */

  renderReadOnlyView() {
    const date = this.state.selectedDate;
    document.getElementById('roDateLabel').textContent = this.dateLabel(date);

    const services = ['lunch', 'dinner'];
    const cfg = Config.load();

    services.forEach(serviceKey => {
      const bookings = Bookings.getByDateAndService(date, serviceKey)
        .filter(b => b.status !== STATUS.CANCELLED);
      const container = document.getElementById(`ro-${serviceKey}-list`);
      const section = document.getElementById(`ro-${serviceKey}-section`);
      const stats = document.getElementById(`ro-${serviceKey}-stats`);

      const totalGuests = bookings.reduce((s, b) => s + b.people, 0);
      stats.textContent = `${bookings.length} tavoli · ${totalGuests} coperti`;

      container.innerHTML = '';

      if (bookings.length === 0) {
        container.innerHTML = '<div class="ro-empty">Nessuna prenotazione</div>';
        return;
      }

      bookings.forEach(b => {
        const row = document.createElement('div');
        row.className = 'ro-row';

        const extras = [];
        if (b.zone !== 'any') extras.push(ZONE_LABELS[b.zone]);
        if (b.dogs > 0) extras.push(`🐾 ${b.dogs} ${b.dogs === 1 ? 'cane' : 'cani'}`);
        if (b.doubleShift) extras.push(`⏱️ libera ${b.doubleShift.releaseTime}`);

        const details = [];
        if (b.intolerances) details.push(`⚠️ <strong>Intolleranze:</strong> ${this.escapeHTML(b.intolerances)}`);
        if (b.specialNeeds) details.push(`♿ <strong>Esigenze:</strong> ${this.escapeHTML(b.specialNeeds)}`);
        if (b.notes) details.push(`📝 <strong>Note:</strong> ${this.escapeHTML(b.notes)}`);

        row.innerHTML = `
          <div class="ro-row-main">
            <span class="ro-time">${b.time}</span>
            <div class="ro-info">
              <div class="ro-name-line">
                <span class="ro-name">${this.escapeHTML(b.name) || '(senza nome)'}</span>
                <span class="ro-people">${b.people} ${b.people === 1 ? 'pers.' : 'pers.'}</span>
              </div>
              ${extras.length ? `<div class="ro-tags">${extras.map(e => `<span class="tag">${e}</span>`).join('')}</div>` : ''}
              ${details.length ? `<div class="ro-details">${details.join('<br>')}</div>` : ''}
              ${b.phone ? `<a class="booking-phone-link" href="${Utils.telLink(b.phone)}">📞 ${this.escapeHTML(b.phone)}</a>` : ''}
            </div>
          </div>
        `;
        container.appendChild(row);
      });
    });
  },

};

window.UI = UI;
