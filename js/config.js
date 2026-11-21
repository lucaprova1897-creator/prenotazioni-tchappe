/**
 * config.js
 * Tutti i parametri che il gestore può modificare senza toccare il codice.
 * Letti/scritti tramite Storage. Un solo oggetto di configurazione versionato.
 */

const CONFIG_KEY = 'config';
const CONFIG_VERSION = 1;

const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  tablesIndoor: 15,
  tablesOutdoor: 15,
  services: {
    lunch: { label: 'Pranzo', start: '12:00', end: '14:30' },
    dinner: { label: 'Cena', start: '19:00', end: '22:00' },
  },
  slotDurationMinutes: 15,
  maxBookingsPerSlot: 3,
};

const Config = {
  _cache: null,

  load() {
    if (this._cache) return this._cache;
    const stored = Storage.get(CONFIG_KEY);
    if (!stored) {
      this._cache = structuredClone(DEFAULT_CONFIG);
      Storage.set(CONFIG_KEY, this._cache);
    } else {
      // Merge con i default per tollerare versioni precedenti con campi mancanti
      this._cache = { ...structuredClone(DEFAULT_CONFIG), ...stored };
    }
    return this._cache;
  },

  save(partial) {
    const current = this.load();
    this._cache = { ...current, ...partial };
    Storage.set(CONFIG_KEY, this._cache);
    return this._cache;
  },

  reset() {
    this._cache = structuredClone(DEFAULT_CONFIG);
    Storage.set(CONFIG_KEY, this._cache);
    return this._cache;
  },

  get totalTables() {
    const c = this.load();
    return c.tablesIndoor + c.tablesOutdoor;
  },
};

window.Config = Config;

// Configurazione zone+tavoli condivisa (da Supabase)
// Struttura: { "Sala": ["1","2","3"], "Terrazza": ["T1","T2"] }
const SharedTables = {
  _zoneTavoli: null, // { zoneName: [tavoli] }

  _blocked: {}, // { "2026-07-05_lunch": Set, "2026-07-05_dinner": Set }
  _blockedKey: null,

  _getKey(date, service) {
    return (date || Utils.todayISO()) + '_' + (service || 'lunch');
  },

  async load() {
    // Se c'è ancora un salvataggio in corso (partito da questo o da un
    // altro pezzo di codice, es. mentre si stanno aggiungendo più piatti
    // di fila), salta questo aggiornamento invece di rischiare di
    // sovrascrivere con dati che potrebbero non includerlo ancora — si
    // riprova al giro successivo, quando il salvataggio sarà concluso.
    if (DB._pendingSharedSaves > 0) return;
    const data = await DB.fetchSharedConfig();
    if (data) {
      const zt = data.zone_tavoli;
      this._zoneTavoli = (zt && typeof zt === 'object' && !Array.isArray(zt))
        ? zt
        : (typeof zt === 'string' ? JSON.parse(zt) : {});
      Storage.set('sharedZoneTavoli', this._zoneTavoli);

      // Nuova struttura: oggetto { "2026-07-05_lunch": ["1","2"], ... }
      const tb = data.tavoli_bloccati;
      let blockedObj = {};
      if (tb && typeof tb === 'object' && !Array.isArray(tb)) {
        blockedObj = tb;
      } else if (typeof tb === 'string') {
        try { blockedObj = JSON.parse(tb); } catch(e) { blockedObj = {}; }
      }
      // Converti arrays in Sets
      this._blocked = {};
      Object.entries(blockedObj).forEach(([k, v]) => {
        this._blocked[k] = new Set(Array.isArray(v) ? v : []);
      });
      Storage.set('sharedBlocked', blockedObj);
      // Copia "ufficiale" dal server: è la base rispetto a cui ogni
      // salvataggio calcola cosa è cambiato davvero (vedi db.js).
      DB.noteSharedBase(this._zoneTavoli, blockedObj);
    } else {
      this._zoneTavoli = Storage.get('sharedZoneTavoli', {});
      const blockedObj = Storage.get('sharedBlocked', {});
      this._blocked = {};
      Object.entries(blockedObj).forEach(([k, v]) => {
        this._blocked[k] = new Set(Array.isArray(v) ? v : []);
      });
      // Senza rete si parte dalla copia locale — ma solo se non c'è già
      // una base più recente presa dal server in questa sessione.
      if (DB._sharedBase.zone_tavoli === null) DB.noteSharedBase(this._zoneTavoli, blockedObj);
    }
    await this._migrateFlatCapacities();
    if (DB._sess) { try { await this.loadAccessi(); } catch (e) { /* offline */ } }
  },

  /**
   * Applica un aggiornamento arrivato dal tempo reale — il dato è già
   * dentro l'avviso stesso, non serve richiederlo di nuovo.
   *
   * Due protezioni, non una sola:
   * 1. Se c'è un salvataggio locale ancora IN CORSO in questo momento,
   *    salta — il dato in arrivo potrebbe non includerlo ancora.
   * 2. Se l'avviso è più vecchio (o della stessa epoca) dell'ultimo
   *    salvataggio fatto DA NOI, salta comunque — è l'eco del nostro
   *    stesso salvataggio che torna indietro DOPO che il salvataggio è
   *    già concluso (quindi il controllo 1 da solo non basta), ma
   *    rappresenta comunque uno stato che potremmo già aver superato.
   *    Era proprio questo a far sparire un piatto appena aggiunto: il
   *    "salvataggio in corso" tornava a zero prima che arrivasse l'eco,
   *    e l'eco veniva applicata come se fosse un aggiornamento nuovo.
   *
   * updatedAt è il campo "updated_at" della riga arrivato con l'avviso —
   * se manca, si applica comunque (compatibilità con chi chiama senza
   * passarlo). Restituisce true/false a seconda che l'abbia applicato.
   */
  applyRealtimeUpdate(zoneTavoli, updatedAt) {
    if (DB._pendingSharedSaves > 0) return false;
    if (!zoneTavoli || typeof zoneTavoli !== 'object' || Array.isArray(zoneTavoli)) return false;
    if (updatedAt && DB._lastSavedUpdatedAt && updatedAt <= DB._lastSavedUpdatedAt) return false;
    this._zoneTavoli = zoneTavoli;
    Storage.set('sharedZoneTavoli', zoneTavoli);
    DB.noteSharedBase(zoneTavoli, undefined);
    return true;
  },

  // Riallinea i tavoli bloccati a una copia arrivata dal server (usato
  // dopo un salvataggio "a fusione", vedi DB.saveSharedConfig).
  _setBlockedFromObject(blockedObj) {
    this._blocked = {};
    Object.entries(blockedObj || {}).forEach(([k, v]) => {
      this._blocked[k] = new Set(Array.isArray(v) ? v : []);
    });
    Storage.set('sharedBlocked', blockedObj || {});
  },

  /**
   * Ripara capienze salvate col vecchio formato (prima del fix): erano
   * salvate come numero diretto sotto il nome del tavolo, senza zona
   * (es. _capacities["1"] = 4), invece che dentro la zona giusta
   * (_capacities["Interno"]["1"] = 4). Le sposta al posto corretto,
   * cercando in quale zona si trova ogni tavolo, e salva la correzione.
   * Una tantum: dopo la prima volta non trova più nulla da spostare.
   */
  async _migrateFlatCapacities() {
    const zt = this._zoneTavoli || {};
    const caps = zt._capacities;
    if (!caps) return;

    // Formato vecchio: valori diretti (numeri), non oggetti per zona
    const flatEntries = Object.entries(caps).filter(([, v]) => typeof v === 'number');
    if (flatEntries.length === 0) return;

    const zones = this.getZones();
    const newCapacities = { ...caps };
    let migrated = 0;
    flatEntries.forEach(([table, value]) => {
      delete newCapacities[table];
      const zone = zones.find(z => (zt[z] || []).includes(table));
      if (zone) {
        newCapacities[zone] = { ...(newCapacities[zone] || {}), [table]: value };
        migrated++;
      }
    });
    if (migrated === 0) return;

    const updated = { ...zt, _capacities: newCapacities };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
      console.info('Capienze tavoli: recuperate ' + migrated + ' impostazioni salvate nel formato precedente.');
    } catch (e) { console.warn('_migrateFlatCapacities save failed', e); }
  },

  /**
   * A quale zona appartiene un tavolo — serve per collegare il blocco
   * per singolo tavolo (sotto) con le chiusure per zona intera.
   */
  getZoneOfTable(table) {
    const zt = this.getZoneTavoli();
    for (const zone of this.getZones()) {
      if ((zt[zone] || []).includes(table)) return zone;
    }
    return null;
  },

  isBlocked(table, date, service, ignoreZoneClosure) {
    const key = this._getKey(date, service);
    if (this._blocked[key] && this._blocked[key].has(table)) return true;
    // Anche se nessuno ha bloccato QUESTO tavolo a mano, conta comunque
    // come non disponibile se l'intera zona a cui appartiene è chiusa per
    // questo giorno/servizio — così Dashboard, piantina e tavoli
    // disponibili restano sempre d'accordo con quello che si vede nel
    // form di prenotazione, senza dover ripetere il controllo ovunque.
    // ignoreZoneClosure salta solo QUESTO pezzo — serve al form quando
    // chi prenota ha scelto "prenota comunque qui, solo per questa
    // volta": un blocco messo a mano sul singolo tavolo conta comunque.
    if (ignoreZoneClosure) return false;
    const zone = this.getZoneOfTable(table);
    if (zone && this.getZoneClosureFor(zone, date, service)) return true;
    return false;
  },

  async toggleBlocked(table, date, service) {
    const key = this._getKey(date, service);
    if (!this._blocked[key]) this._blocked[key] = new Set();
    if (this._blocked[key].has(table)) {
      this._blocked[key].delete(table);
    } else {
      this._blocked[key].add(table);
    }
    // Serializza per Supabase
    const blockedObj = {};
    Object.entries(this._blocked).forEach(([k, v]) => {
      if (v.size > 0) blockedObj[k] = Array.from(v);
    });
    Storage.set('sharedBlocked', blockedObj);
    try {
      await DB.saveSharedConfig(null, null, null, null, blockedObj);
    } catch(e) { console.warn('toggleBlocked save failed', e); }
    return this.isBlocked(table, date, service);
  },

  getZoneTavoli() {
    if (this._zoneTavoli) return this._zoneTavoli;
    return Storage.get('sharedZoneTavoli', {});
  },

  getZones() {
    const zt = this.getZoneTavoli();
    // Usa _order se presente per mantenere l'ordine
    if (zt._order && Array.isArray(zt._order)) return zt._order;
    return Object.keys(zt).filter(k => k !== '_order' && k !== '_positions' && k !== '_staffNames' && k !== '_capacities' && k !== '_reminders' && k !== '_employeePins' && k !== '_adminPins' && k !== '_credentialsMigrated' && k !== '_dayEvents' && k !== '_customers' && k !== '_tableCapacity' && k !== '_tableJoins' && k !== '_sharedPassword' && k !== '_activeSessions' && k !== '_gastronomicProjects' && k !== '_closures' && k !== '_dailySpecials' && k !== '_pushSubscriptions' && k !== '_dishLibrary' && k !== '_zoneClosures' && k !== '_workerMenus' && k !== '_halfBoardMenus' && k !== '_winesByGlass' && k !== '_chefPins' && k !== '_kickList' && k !== '_globalKickAt' && k !== '_tabletEditCode' && k !== '_inventoryItems' && k !== '_inventoryCounts' && k !== '_odsDepts');
  },

  getTablesForZone(zone) {
    return this.getZoneTavoli()[zone] || [];
  },

  getAll() {
    const zones = this.getZones();
    const zt = this.getZoneTavoli();
    return zones.flatMap(z => zt[z] || []);
  },

  // Mantieni per compatibilità con codice esistente
  getIndoor() { return this.getAll(); },
  getOutdoor() { return []; },

  async save(zoneTavoli) {
    // Aggiungi _order per preservare l'ordine delle zone
    const order = Object.keys(zoneTavoli).filter(k => k !== '_order' && k !== '_positions' && k !== '_staffNames' && k !== '_capacities' && k !== '_reminders' && k !== '_employeePins' && k !== '_adminPins' && k !== '_credentialsMigrated' && k !== '_dayEvents' && k !== '_customers' && k !== '_tableCapacity' && k !== '_tableJoins' && k !== '_sharedPassword' && k !== '_activeSessions' && k !== '_gastronomicProjects' && k !== '_closures' && k !== '_dailySpecials' && k !== '_pushSubscriptions' && k !== '_dishLibrary' && k !== '_zoneClosures' && k !== '_workerMenus' && k !== '_halfBoardMenus' && k !== '_winesByGlass' && k !== '_chefPins' && k !== '_kickList' && k !== '_globalKickAt' && k !== '_tabletEditCode' && k !== '_inventoryItems' && k !== '_inventoryCounts' && k !== '_odsDepts');
    // Preserva le posizioni piantina, i nomi staff, le capienze, i
    // promemoria, i PIN (dipendenti e admin) e il flag di migrazione
    // credenziali già salvati (l'editor zone/tavoli non li tocca)
    const existingPositions = this.getZoneTavoli()._positions || {};
    const existingStaffNames = this.getZoneTavoli()._staffNames || [];
    const existingCapacities = this.getZoneTavoli()._capacities || {};
    const existingReminders = this.getZoneTavoli()._reminders || [];
    const existingEmployeePins = this.getZoneTavoli()._employeePins || [];
    const existingAdminPins = this.getZoneTavoli()._adminPins || [];
    const existingMigrated = this.getZoneTavoli()._credentialsMigrated || false;
    const existingDayEvents = this.getZoneTavoli()._dayEvents || [];
    const existingCustomers = this.getZoneTavoli()._customers || [];
    const existingTableCapacity = this.getZoneTavoli()._tableCapacity || {};
    const existingTableJoins = this.getZoneTavoli()._tableJoins || {};
    const existingSharedPassword = this.getZoneTavoli()._sharedPassword || null;
    const existingActiveSessions = this.getZoneTavoli()._activeSessions || {};
    const existingProjects = this.getZoneTavoli()._gastronomicProjects || [];
    const existingClosures = this.getZoneTavoli()._closures || [];
    const existingDailySpecials = this.getZoneTavoli()._dailySpecials || {};
    const existingPushSubscriptions = this.getZoneTavoli()._pushSubscriptions || [];
    const existingDishLibrary = this.getZoneTavoli()._dishLibrary || [];
    const existingZoneClosures = this.getZoneTavoli()._zoneClosures || [];
    const existingWorkerMenus = this.getZoneTavoli()._workerMenus || {};
    const existingHalfBoardMenus = this.getZoneTavoli()._halfBoardMenus || {};
    const existingWinesByGlass = this.getZoneTavoli()._winesByGlass || [];
    const existingChefPin = this.getZoneTavoli()._chefPins || [];
    const existingKickList = this.getZoneTavoli()._kickList || [];
    const existingGlobalKickAt = this.getZoneTavoli()._globalKickAt || null;
    const existingTabletEditCode = this.getZoneTavoli()._tabletEditCode || null;
    const existingInventoryItems = this.getZoneTavoli()._inventoryItems || [];
    const existingInventoryCounts = this.getZoneTavoli()._inventoryCounts || [];
    const existingOdsDepts = this.getZoneTavoli()._odsDepts || {};
    const withOrder = { _order: order, _positions: existingPositions, _staffNames: existingStaffNames, _capacities: existingCapacities, _reminders: existingReminders, _employeePins: existingEmployeePins, _adminPins: existingAdminPins, _credentialsMigrated: existingMigrated, _dayEvents: existingDayEvents, _customers: existingCustomers, _tableCapacity: existingTableCapacity, _tableJoins: existingTableJoins, _sharedPassword: existingSharedPassword, _activeSessions: existingActiveSessions, _gastronomicProjects: existingProjects, _closures: existingClosures, _dailySpecials: existingDailySpecials, _pushSubscriptions: existingPushSubscriptions, _dishLibrary: existingDishLibrary, _zoneClosures: existingZoneClosures, _workerMenus: existingWorkerMenus, _halfBoardMenus: existingHalfBoardMenus, _winesByGlass: existingWinesByGlass, _chefPins: existingChefPin, _kickList: existingKickList, _globalKickAt: existingGlobalKickAt, _tabletEditCode: existingTabletEditCode, _inventoryItems: existingInventoryItems, _inventoryCounts: existingInventoryCounts, _odsDepts: existingOdsDepts, ...zoneTavoli };
    this._zoneTavoli = withOrder;
    Storage.set('sharedZoneTavoli', withOrder);
    return await DB.saveSharedConfig(null, null, null, withOrder);
  },

  // ===== Nomi staff per l'accesso condiviso (persistiti dentro zone_tavoli._staffNames) =====

  getStaffNames() {
    const zt = this.getZoneTavoli();
    return Array.isArray(zt._staffNames) ? zt._staffNames : [];
  },

  async saveStaffNames(names) {
    const zt = this.getZoneTavoli();
    const updated = { ...zt, _staffNames: names };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('saveStaffNames failed', e); }
    return updated;
  },

  // ===== Capienza per singolo tavolo: vedi più sotto (versione con zona) =====

  // ===== Piantina: posizioni tavoli (persistite dentro zone_tavoli._positions) =====

  getPosition(zone, table) {
    const zt = this.getZoneTavoli();
    const pos = zt._positions && zt._positions[zone] && zt._positions[zone][table];
    return pos || null;
  },

  /**
   * Salva (in merge) posizione/forma/rotazione di un tavolo e persiste
   * l'intera struttura zone_tavoli su Supabase. `patch` può contenere
   * uno o più campi tra x, y, shape, rotation — quelli omessi restano
   * quelli già salvati (o i default).
   */
  async setPosition(zone, table, patch) {
    const zt = this.getZoneTavoli();
    const positions = { ...(zt._positions || {}) };
    const current = (positions[zone] && positions[zone][table]) || {};
    positions[zone] = { ...(positions[zone] || {}), [table]: { ...current, ...patch } };
    const updated = { ...zt, _positions: positions };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('setPosition save failed', e); }
    return updated;
  },

  removePosition(zone, table) {
    const zt = this.getZoneTavoli();
    if (!zt._positions || !zt._positions[zone]) return;
    const positions = { ...zt._positions };
    positions[zone] = { ...positions[zone] };
    delete positions[zone][table];
    const updated = { ...zt, _positions: positions };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
  },

  // ===== Capienza tavoli (persistita dentro zone_tavoli._capacities) =====
  // Serve per correggere in automatico quando un tavolo troppo piccolo viene
  // scelto per un gruppo grande: se non impostata, il controllo non scatta
  // (nessun avviso finché l'admin non configura le capienze).

  getCapacity(zone, table) {
    const zt = this.getZoneTavoli();
    const cap = zt._capacities && zt._capacities[zone] && zt._capacities[zone][table];
    return cap || null;
  },

  async setCapacity(zone, table, capacity) {
    const zt = this.getZoneTavoli();
    const capacities = { ...(zt._capacities || {}) };
    capacities[zone] = { ...(capacities[zone] || {}) };
    if (capacity) capacities[zone][table] = capacity;
    else delete capacities[zone][table];
    const updated = { ...zt, _capacities: capacities };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('setCapacity save failed', e); }
    return updated;
  },

  // ===== Promemoria squadra (persistiti dentro zone_tavoli._reminders) =====
  // Stesso principio delle capienze: nessuna colonna nuova, un'altra chiave
  // dentro il blob condiviso già esistente.

  getReminders() {
    const zt = this.getZoneTavoli();
    return (zt._reminders || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async addReminder(text, author, recipient) {
    const zt = this.getZoneTavoli();
    const reminders = [...(zt._reminders || [])];
    reminders.push({
      id: Utils.uid('rem'),
      text: text.trim(),
      author: author || 'sconosciuto',
      recipient: recipient || null, // null = per tutti, altrimenti un nome preciso
      createdAt: new Date().toISOString(),
    });
    const updated = { ...zt, _reminders: reminders };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addReminder save failed', e); }
    return updated;
  },

  async removeReminder(id) {
    const zt = this.getZoneTavoli();
    const reminders = (zt._reminders || []).filter(r => r.id !== id);
    const updated = { ...zt, _reminders: reminders };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeReminder save failed', e); }
    return updated;
  },

  /**
   * Modifica il testo di un promemoria già scritto — chi lo modifica non
   * cambia (resta l'autore originale, si tocca solo il contenuto).
   */
  async updateReminder(id, text) {
    const zt = this.getZoneTavoli();
    const reminders = (zt._reminders || []).map(r => r.id === id ? { ...r, text: text.trim() } : r);
    const updated = { ...zt, _reminders: reminders };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('updateReminder save failed', e); }
    return updated;
  },

  // ===== PIN dipendenti (persistiti dentro zone_tavoli._employeePins) =====
  // Ogni PIN identifica una persona vera — chi entra con quello risulta
  // subito riconosciuto, senza dover scegliere "chi sei" come sul tablet
  // condiviso. Creati e visibili solo da chi ha accesso admin pieno
  // (controllo fatto lato interfaccia, in Impostazioni).

  // ===== Profili di accesso (sul SERVER, cifrati) =====
  // Prima i PIN stavano qui dentro, in chiaro, leggibili da chiunque
  // avesse la chiave pubblica. Ora l'app riceve dal server solo NOMI e
  // RUOLI (mai i PIN); creare, cambiare, sospendere o togliere un
  // profilo passa dalla funzione "accesso", che controlla i permessi.
  // Le funzioni sotto mantengono la stessa forma di prima ({id, name,
  // pin, disabled, isHeadChef}) così il resto dell'interfaccia non cambia:
  // "pin" è sempre vuoto.
  _accessi: null,

  _getAccessi() {
    if (Array.isArray(this._accessi)) return this._accessi;
    const cached = Storage.get('accessiCache', null);
    return Array.isArray(cached) ? cached : [];
  },

  async loadAccessi() {
    if (!DB._sess) return;
    const r = await DB.accesso('elenco');
    if (r && Array.isArray(r.elenco)) {
      this._accessi = r.elenco;
      Storage.set('accessiCache', r.elenco);
    }
  },

  _pinsByRole(ruolo) {
    return this._getAccessi().filter(a => a.ruolo === ruolo).map(a => ({
      id: a.id, name: a.nome, pin: '', disabled: !!a.sospeso, isHeadChef: !!a.capo_chef,
    }));
  },

  // Esegue un'azione sul server, mostra l'eventuale errore e aggiorna
  // l'elenco. Restituisce true/false (chi chiama si ferma se false).
  async _accessoAzione(azione, dati) {
    const r = await DB.accesso(azione, dati);
    if (!r || r.errore) {
      const msg = (r && r.errore) || 'Operazione non riuscita';
      if (typeof UI !== 'undefined' && UI.toast) UI.toast(msg, 'warning'); else alert(msg);
      return false;
    }
    await this.loadAccessi();
    return true;
  },

  _patchToServer(patch) {
    const out = {};
    if ('name' in patch) out.nome = patch.name;
    if ('pin' in patch) out.pin = patch.pin;
    if ('disabled' in patch) out.sospeso = !!patch.disabled;
    if ('isHeadChef' in patch) out.capo_chef = !!patch.isHeadChef;
    return out;
  },

  getEmployeePins() { return this._pinsByRole('staff'); },

  async addEmployeePin(name, pin) {
    return this._accessoAzione('salva', { nome: String(name || '').trim(), ruolo: 'staff', pin: String(pin || '').trim() });
  },

  async updateEmployeePin(id, patch) {
    return this._accessoAzione('salva', { id, ...this._patchToServer(patch || {}) });
  },

  async removeEmployeePin(id) {
    return this._accessoAzione('rimuovi', { id });
  },

  // ===== PIN cuochi (persistiti dentro zone_tavoli._chefPins) =====
  // Ogni cuoco ha il proprio profilo — nome e PIN, come i dipendenti sopra.
  // Non esiste più una password condivisa dello chef: senza un profilo
  // personale nell'elenco, nessuno può entrare in sola lettura.
  getChefPins() { return this._pinsByRole('chef'); },

  async addChefPin(name, pin) {
    return this._accessoAzione('salva', { nome: String(name || '').trim(), ruolo: 'chef', pin: String(pin || '').trim() });
  },

  async updateChefPin(id, patch) {
    return this._accessoAzione('salva', { id, ...this._patchToServer(patch || {}) });
  },

  async removeChefPin(id) {
    return this._accessoAzione('rimuovi', { id });
  },


  // ===== Ordini / inventario (zone_tavoli._inventoryItems) =====
  // Un elenco di articoli con soglia minima — un dipendente aggiorna la
  // quantità presente una volta a settimana, Luca controlla dal
  // telefono cosa è sotto soglia e fa gli ordini. Non un magazzino vero
  // (niente storico movimenti, solo "quanto c'è adesso"), pensato per
  // essere aggiornato in pochi secondi, non per una contabilità precisa.
  getInventoryItems() {
    const zt = this.getZoneTavoli();
    return zt._inventoryItems || [];
  },

  // Le categorie sono testo libero, decise da chi aggiunge l'articolo —
  // stesso principio delle zone tavoli, niente elenco fisso da mantenere.
  getInventoryCategories() {
    const items = this.getInventoryItems();
    const seen = [];
    items.forEach(i => { if (i.category && !seen.includes(i.category)) seen.push(i.category); });
    return seen;
  },

  async addInventoryItem(name, category, unit, threshold) {
    const zt = this.getZoneTavoli();
    const items = [...(zt._inventoryItems || [])];
    items.push({
      id: Utils.uid('inv'),
      name: (name || '').trim(),
      category: (category || '').trim(),
      unit: (unit || '').trim(),
      threshold: threshold != null && !isNaN(threshold) ? Number(threshold) : 0,
      currentQty: null, // mai ancora contato
      updatedAt: null,
      updatedBy: null,
    });
    const updated = { ...zt, _inventoryItems: items };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addInventoryItem save failed', e); }
    return updated;
  },

  // Per cambiare nome/categoria/unità/soglia — cose che decide solo chi
  // gestisce l'elenco (admin), mai chi fa solo il conteggio settimanale.
  async updateInventoryItem(id, patch) {
    const zt = this.getZoneTavoli();
    const items = (zt._inventoryItems || []).map(i => i.id === id ? { ...i, ...patch } : i);
    const updated = { ...zt, _inventoryItems: items };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('updateInventoryItem save failed', e); }
    return updated;
  },

  // Per il conteggio settimanale vero e proprio — separata da
  // updateInventoryItem apposta: registra anche CHI e QUANDO, per sapere
  // se il dato è ancora fresco o è ormai vecchio di settimane.
  async setInventoryQty(id, qty, operatorName) {
    const zt = this.getZoneTavoli();
    const items = (zt._inventoryItems || []).map(i => i.id === id
      ? { ...i, currentQty: qty, updatedAt: new Date().toISOString(), updatedBy: operatorName || null }
      : i);
    const updated = { ...zt, _inventoryItems: items };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('setInventoryQty save failed', e); }
    return updated;
  },

  async removeInventoryItem(id) {
    const zt = this.getZoneTavoli();
    const items = (zt._inventoryItems || []).filter(i => i.id !== id);
    const updated = { ...zt, _inventoryItems: items };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeInventoryItem save failed', e); }
    return updated;
  },

  // ===== ODS: reparti delle persone (zone_tavoli._odsDepts) =====
  // I profili (admin, dipendenti, cuochi) esistono già in Impostazioni: qui
  // si salva solo a quale reparto appartiene ciascuno (Sala, Cucina, Bar,
  // Cantina), così un compito assegnato a "Bar" lo vedono e lo spuntano
  // tutti quelli del Bar. La chiave è il nome in minuscolo — lo stesso
  // criterio con cui l'app riconosce già gli operatori (espulsioni,
  // promemoria diretti, notifiche).
  getOdsDepts() {
    const zt = this.getZoneTavoli();
    return (zt._odsDepts && typeof zt._odsDepts === 'object') ? zt._odsDepts : {};
  },

  async setOdsDept(key, dept) {
    if (!key) return;
    const zt = this.getZoneTavoli();
    const depts = { ...(zt._odsDepts || {}) };
    if (dept) depts[key] = dept; else delete depts[key];
    const updated = { ...zt, _odsDepts: depts };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('setOdsDept save failed', e); }
    return updated;
  },

  // ===== Sessioni di conteggio (zone_tavoli._inventoryCounts) =====
  // Diverso dal "quando è stato aggiornato l'ultima volta" di ogni
  // singolo articolo — quello può essere ambiguo (aggiornato tre
  // settimane fa? solo alcuni articoli?). Una sessione è una prova
  // esplicita e datata: "il tal giorno, questa persona ha avviato e
  // concluso un conteggio", con dentro la fotografia di tutte le
  // quantità in quel momento — un vero resoconto da poter riguardare.
  getActiveInventoryCount() {
    const zt = this.getZoneTavoli();
    return (zt._inventoryCounts || []).find(c => !c.completedAt) || null;
  },

  getInventoryCountHistory() {
    const zt = this.getZoneTavoli();
    return (zt._inventoryCounts || []).filter(c => c.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  },

  // Se ce n'è già una aperta, la restituisce invece di aprirne una
  // seconda — un solo conteggio alla volta, altrimenti "chi l'ha avviato
  // davvero" diventa ambiguo tra due dispositivi diversi.
  async startInventoryCount(operatorName) {
    const existing = this.getActiveInventoryCount();
    if (existing) return existing;
    const zt = this.getZoneTavoli();
    const counts = [...(zt._inventoryCounts || [])];
    const session = {
      id: Utils.uid('count'),
      startedAt: new Date().toISOString(),
      startedBy: operatorName || null,
      completedAt: null,
      completedBy: null,
      itemSnapshots: null,
    };
    counts.push(session);
    const updated = { ...zt, _inventoryCounts: counts };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('startInventoryCount save failed', e); }
    return session;
  },

  // Fotografa le quantità di TUTTI gli articoli in questo momento — non
  // un riferimento che potrebbe cambiare dopo, un'istantanea fissa per
  // sempre di com'era quel giorno.
  async completeInventoryCount(id, operatorName) {
    const zt = this.getZoneTavoli();
    const items = zt._inventoryItems || [];
    const snapshot = items.map(i => ({ itemId: i.id, name: i.name, category: i.category, unit: i.unit, qty: i.currentQty, threshold: i.threshold }));
    const counts = (zt._inventoryCounts || []).map(c => c.id === id
      ? { ...c, completedAt: new Date().toISOString(), completedBy: operatorName || null, itemSnapshots: snapshot }
      : c);
    const updated = { ...zt, _inventoryCounts: counts };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('completeInventoryCount save failed', e); }
    return updated;
  },

  // ===== "Buttalo fuori" — disconnessione immediata, per nome =====
  // A differenza dell'eliminazione/sospensione di un PIN (che agiscono
  // sulla CREDENZIALE), questo agisce direttamente sulla PERSONA connessa
  // in questo momento, per nome — copre anche i profili creati prima che
  // esistesse questo meccanismo, i cui dispositivi potrebbero non avere
  // mai salvato correttamente il proprio PIN in locale (la verifica per
  // PIN, da sola, non li vedrebbe mai). Non tocca il PIN stesso: chi viene
  // buttato fuori può rientrare subito, se ha ancora un PIN valido — è
  // pensato per "fai uscire questa persona adesso", non per revocarle
  // l'accesso (per quello, elimina o sospendi il PIN).
  getKickList() {
    const zt = this.getZoneTavoli();
    return zt._kickList || [];
  },

  async kickOperator(name) {
    if (!name) return;
    const zt = this.getZoneTavoli();
    const list = (zt._kickList || []).filter(k => k.name !== name);
    list.push({ name, kickedAt: new Date().toISOString() });
    const updated = { ...zt, _kickList: list };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('kickOperator save failed', e); }
    return updated;
  },

  // Chiamata da DB.login() dopo un accesso riuscito — un accesso vero,
  // deliberato, "cancella" qualunque ordine di espulsione pendente per
  // quel nome: la persona è tornata di sua volontà, non ha senso
  // ributtarla fuori subito dopo.
  async clearKick(name) {
    if (!name) return;
    const zt = this.getZoneTavoli();
    if (!(zt._kickList || []).some(k => k.name === name)) return;
    const list = (zt._kickList || []).filter(k => k.name !== name);
    const updated = { ...zt, _kickList: list };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('clearKick save failed', e); }
    return updated;
  },

  // ===== "Butta fuori TUTTI" — reset totale, senza eccezioni =====
  // Diverso da kickOperator: quello agisce per nome, uno per volta, e
  // presuppone di sapere chi buttare fuori. Questo azzera chiunque sia
  // collegato in questo momento, con QUALUNQUE metodo (PIN personale,
  // tablet condiviso, un profilo ormai eliminato del tutto) — pensato
  // per un reset di sicurezza totale, non per la gestione quotidiana di
  // singoli PIN.
  getGlobalKickAt() {
    const zt = this.getZoneTavoli();
    return zt._globalKickAt || null;
  },

  async kickEveryone() {
    const zt = this.getZoneTavoli();
    const updated = { ...zt, _globalKickAt: new Date().toISOString() };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('kickEveryone save failed', e); }
    return updated;
  },

  // ===== Codice di sblocco modifiche per il tablet d'ingresso =====
  // Un unico codice, impostato da Impostazioni (solo Luca/Davy) — chi usa
  // il tablet condiviso lo inserisce per sbloccare temporaneamente la
  // possibilità di modificare proposte del giorno/menu operaio/mezza
  // pensione (normalmente in sola lettura per chi non è admin o chef).
  getTabletEditCode() {
    const zt = this.getZoneTavoli();
    return zt._tabletEditCode || null;
  },

  async setTabletEditCode(code) {
    const zt = this.getZoneTavoli();
    const updated = { ...zt, _tabletEditCode: (code || '').trim() || null };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('setTabletEditCode save failed', e); }
    return updated;
  },

  // A differenza dei PIN dipendenti (accesso staff), questi danno accesso
  // admin pieno — pensati per Luca e Davy, che possono impostarseli da soli
  // qui invece di dover ricordare la password lunga fissa (che comunque
  // resta valida come riserva, non viene tolta).

  getAdminPins() { return this._pinsByRole('admin'); },

  async addAdminPin(name, pin) {
    return this._accessoAzione('salva', { nome: String(name || '').trim(), ruolo: 'admin', pin: String(pin || '').trim() });
  },

  async updateAdminPin(id, patch) {
    return this._accessoAzione('salva', { id, ...this._patchToServer(patch || {}) });
  },

  async removeAdminPin(id) {
    return this._accessoAzione('rimuovi', { id });
  },

  // L'unicità dei PIN la controlla il server (i PIN sono cifrati, qui non
  // si possono confrontare): un PIN già in uso viene rifiutato al salvataggio.
  isPinTaken() { return false; },

  // ===== Eventi del giorno (persistiti dentro zone_tavoli._dayEvents) =====
  // Un evento legato a un giorno intero, non a una prenotazione specifica
  // — es. "Ferragosto: menu fisso 45€" — utile quando non c'è un cliente
  // singolo da associare, solo un piano per la giornata.

  getDayEvents() {
    const zt = this.getZoneTavoli();
    return zt._dayEvents || [];
  },

  getUpcomingDayEvents() {
    const today = Utils.todayISO();
    return this.getDayEvents()
      .filter(e => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  async addDayEvent(data) {
    const zt = this.getZoneTavoli();
    const events = [...(zt._dayEvents || [])];
    events.push({ id: Utils.uid('devt'), ...data });
    const updated = { ...zt, _dayEvents: events };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addDayEvent save failed', e); }
    return events[events.length - 1];
  },

  async updateDayEvent(id, patch) {
    const zt = this.getZoneTavoli();
    const events = (zt._dayEvents || []).map(e => e.id === id ? { ...e, ...patch } : e);
    const updated = { ...zt, _dayEvents: events };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('updateDayEvent save failed', e); }
    return updated;
  },

  async removeDayEvent(id) {
    const zt = this.getZoneTavoli();
    const events = (zt._dayEvents || []).filter(e => e.id !== id);
    const updated = { ...zt, _dayEvents: events };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeDayEvent save failed', e); }
    return updated;
  },

  // ===== Archivio clienti (persistito dentro zone_tavoli._customers) =====
  // Non un riconoscimento automatico (nessun numero è davvero affidabile
  // al 100% — cambia, si condivide in famiglia, si sbaglia una cifra):
  // è lo staff a collegare una prenotazione al cliente giusto, cercandolo
  // per nome o telefono, esattamente come farebbe a voce. Le note restano
  // con lui, non con la singola prenotazione, così si ritrovano ogni volta
  // che torna — allergie ricorrenti, tavolo preferito, quello che serve.

  getCustomers() {
    const zt = this.getZoneTavoli();
    return zt._customers || [];
  },

  getCustomerById(id) {
    return this.getCustomers().find(c => c.id === id) || null;
  },

  /**
   * Ricerca semplice per nome o telefono — non un algoritmo complesso,
   * solo "contiene", case-insensitive: basta per un archivio di dimensioni
   * di un ristorante, e resta facile da capire per chi lo usa.
   */
  searchCustomers(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return this.getCustomers().filter(c =>
      (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q)
    );
  },

  async addCustomer(data) {
    const zt = this.getZoneTavoli();
    const customers = [...(zt._customers || [])];
    const customer = { id: Utils.uid('cust'), name: (data.name || '').trim(), phone: (data.phone || '').trim(), notes: (data.notes || '').trim(), createdAt: new Date().toISOString() };
    customers.push(customer);
    const updated = { ...zt, _customers: customers };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addCustomer save failed', e); }
    return customer;
  },

  async updateCustomer(id, patch) {
    const zt = this.getZoneTavoli();
    const customers = (zt._customers || []).map(c => c.id === id ? { ...c, ...patch } : c);
    const updated = { ...zt, _customers: customers };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('updateCustomer save failed', e); }
    return updated;
  },

  // ===== Password condivisa del tablet d'ingresso (zone_tavoli._sharedPassword) =====
  // Prima era fissa nel codice (STAFF_SHARED_PASSWORD in db.js) e non
  // scadeva mai — chiunque l'avesse saputa una volta, la sapeva per
  // sempre, a differenza dei PIN personali che passano dalla migrazione
  // "una tantum". Ora è modificabile da qui in qualunque momento, senza
  // bisogno di un intervento tecnico esterno.

  // Password del tablet: solo sul server (cifrata), mai letta dall'app.
  getSharedPassword() { return null; },

  async setSharedPassword(password) {
    return this._accessoAzione('password_tablet', { password: String(password || '').trim() });
  },

  // ===== Progetti Gastronomici (zone_tavoli._gastronomicProjects) =====
  // Strumento decisionale per valutare economicamente un evento PRIMA che
  // accada — cene a tema, degustazioni, eventi privati — non un registro
  // di prenotazioni (quello esiste già), uno strumento per capire se i
  // numeri tornano mentre si sta ancora decidendo se accettarlo o come
  // impostarlo. Riservato a Luca e Davy: coinvolge food cost e margini
  // interni, non pensato per essere visibile a tutto lo staff.

  getProjects() {
    const zt = this.getZoneTavoli();
    return zt._gastronomicProjects || [];
  },

  getProjectById(id) {
    return this.getProjects().find(p => p.id === id) || null;
  },

  async addProject(data) {
    const zt = this.getZoneTavoli();
    const projects = [...(zt._gastronomicProjects || [])];
    const now = new Date().toISOString();
    const project = {
      id: Utils.uid('proj'),
      name: (data.name || '').trim(),
      date: data.date || null,
      eventType: data.eventType || 'altro',
      coperti: Number(data.coperti) || 0,
      pricePerPerson: Number(data.pricePerPerson) || 0,
      foodCostPerPerson: Number(data.foodCostPerPerson) || 0,
      // Portate (facoltative) — se presenti, il food cost totale si calcola
      // da queste invece che dal campo semplice sopra (vedi
      // computeCoursesFoodCost). Vuoto di default: chi non le usa continua
      // a scrivere un solo numero, esattamente come prima.
      courses: Array.isArray(data.courses) ? data.courses : [],
      marginTargetPct: Number(data.marginTargetPct) || 0,
      // Costo personale e altri costi: STIME scritte da chi compila, non
      // calcoli automatici — Lou Tchappé non ha un modulo turni/personale
      // con tariffe orarie reali collegato. Totali per l'evento, non a
      // persona (uno staff aggiuntivo non scala linearmente coi coperti).
      staffCostTotal: Number(data.staffCostTotal) || 0,
      otherCostsTotal: Number(data.otherCostsTotal) || 0,
      // Vincolo food cost massimo (%) — diverso dal margine target: qui è
      // un limite che non si dovrebbe superare, non un obiettivo da centrare.
      foodCostMaxPct: data.foodCostMaxPct != null ? Number(data.foodCostMaxPct) : null,
      status: data.status || 'idea',
      notes: (data.notes || '').trim(),

      // Dati cliente più ricchi (Step 1 del percorso guidato)
      clientName: (data.clientName || '').trim(),
      clientCompany: (data.clientCompany || '').trim(),
      clientPhone: (data.clientPhone || '').trim(),
      clientEmail: (data.clientEmail || '').trim(),

      // Cosa chiede il cliente (Step 2) — un elenco di cosa è incluso,
      // pensato come spunte semplici, non venti campi separati da capire.
      // "wineCount" ha senso solo se "vino" è tra gli inclusi.
      includes: Array.isArray(data.includes) ? data.includes : [], // es. ['aperitivo','vino','acqua','caffe','digestivo','torta','open_bar','servizio_tavolo','allestimento']
      wineCount: data.wineCount != null ? Number(data.wineCount) : null,
      budgetMaxPerPerson: data.budgetMaxPerPerson != null ? Number(data.budgetMaxPerPerson) : null,
      budgetTotal: data.budgetTotal != null ? Number(data.budgetTotal) : null,
      eventDuration: (data.eventDuration || '').trim(),
      requestNotes: (data.requestNotes || '').trim(),
      arrivalTime: (data.arrivalTime || '').trim(),
      endTime: (data.endTime || '').trim(),

      // Esigenze alimentari — numeri semplici + un campo libero per il resto
      dietary: {
        vegetarians: Number(data.dietary?.vegetarians) || 0,
        vegans: Number(data.dietary?.vegans) || 0,
        celiac: Number(data.dietary?.celiac) || 0,
        other: (data.dietary?.other || '').trim(),
      },

      // Scheda operativa — checklist/note libere per cucina/sala/personale,
      // compilata quando l'evento passa a Confermato. Non automatica da
      // moduli che non esistono: quello che scrivete voi a mano.
      operationalNotes: (data.operationalNotes || '').trim(),

      createdAt: now,
      updatedAt: now,
    };
    projects.push(project);
    const updated = { ...zt, _gastronomicProjects: projects };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addProject save failed', e); }
    return project;
  },

  async updateProject(id, patch) {
    const zt = this.getZoneTavoli();
    const projects = (zt._gastronomicProjects || []).map(p =>
      p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p
    );
    const updated = { ...zt, _gastronomicProjects: projects };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('updateProject save failed', e); }
    return updated;
  },

  async removeProject(id) {
    const zt = this.getZoneTavoli();
    const projects = (zt._gastronomicProjects || []).filter(p => p.id !== id);
    const updated = { ...zt, _gastronomicProjects: projects };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeProject save failed', e); }
    return updated;
  },

  // ===== Chiusure (zone_tavoli._closures) =====
  // Un giorno, un periodo o un singolo servizio in cui non si può
  // prendere nessuna prenotazione — diverso da "tutto pieno" (che dipende
  // dai tavoli occupati), qui è "non siamo proprio aperti".

  getClosures() {
    const zt = this.getZoneTavoli();
    return zt._closures || [];
  },

  /**
   * La chiusura che copre questo giorno/servizio, o null se non ce n'è
   * nessuna — service:'all' nella chiusura copre sia pranzo che cena.
   */
  getClosureFor(date, service) {
    return this.getClosures().find(c =>
      date >= c.startDate && date <= (c.endDate || c.startDate) &&
      (c.service === 'all' || c.service === service)
    ) || null;
  },

  async addClosure({ startDate, endDate, service, reason }) {
    const zt = this.getZoneTavoli();
    const closures = [...(zt._closures || [])];
    closures.push({
      id: Utils.uid('closure'),
      startDate,
      endDate: endDate || startDate,
      service: service || 'all',
      reason: (reason || '').trim(),
    });
    const updated = { ...zt, _closures: closures };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addClosure save failed', e); }
    return updated;
  },

  async removeClosure(id) {
    const zt = this.getZoneTavoli();
    const closures = (zt._closures || []).filter(c => c.id !== id);
    const updated = { ...zt, _closures: closures };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeClosure save failed', e); }
    return updated;
  },

  // ===== Chiusure per singola zona (zone_tavoli._zoneClosures) =====
  // Stessa identica idea delle chiusure sopra, ma per una zona precisa
  // invece che per tutto il ristorante — utile per i periodi di stagione
  // in cui una zona (es. il giardino) apre solo a pranzo o solo a cena.
  // Tenuta volutamente separata dalle chiusure generali, così le due
  // funzionalità non si toccano e non rischiano di interferire tra loro.

  getZoneClosures() {
    const zt = this.getZoneTavoli();
    return zt._zoneClosures || [];
  },

  /**
   * La chiusura che copre questa zona in questo giorno/servizio, o null
   * se quella zona è aperta normalmente.
   */
  getZoneClosureFor(zone, date, service) {
    return this.getZoneClosures().find(c =>
      c.zone === zone &&
      date >= c.startDate && date <= (c.endDate || c.startDate) &&
      (c.service === 'all' || c.service === service)
    ) || null;
  },

  async addZoneClosure({ zone, startDate, endDate, service, reason }) {
    const zt = this.getZoneTavoli();
    const closures = [...(zt._zoneClosures || [])];
    closures.push({
      id: Utils.uid('zclosure'),
      zone,
      startDate,
      endDate: endDate || startDate,
      service: service || 'all',
      reason: (reason || '').trim(),
    });
    const updated = { ...zt, _zoneClosures: closures };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addZoneClosure save failed', e); }
    return updated;
  },

  async removeZoneClosure(id) {
    const zt = this.getZoneTavoli();
    const closures = (zt._zoneClosures || []).filter(c => c.id !== id);
    const updated = { ...zt, _zoneClosures: closures };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeZoneClosure save failed', e); }
    return updated;
  },

  // ===== Menu operai (zone_tavoli._workerMenus) =====
  // Stessa impostazione del menu di mezza pensione qui sotto — diviso per
  // portata, lo chef aggiunge quanti piatti vuole per ciascuna. Diverso
  // dalla spunta sulla singola prenotazione (quella vive nelle note, vedi
  // Bookings.WORKER_MENU_MARK) — questo è IL CONTENUTO del menu, non "chi
  // ce l'ha".

  getWorkerMenu(date) {
    const zt = this.getZoneTavoli();
    const saved = (zt._workerMenus || {})[date] || {};
    const menu = {};
    this.HALF_BOARD_COURSES.forEach(course => { menu[course] = saved[course] || []; });
    return menu;
  },

  async addWorkerMenuDish(date, course, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return this.getZoneTavoli();
    const zt = this.getZoneTavoli();
    const menus = { ...(zt._workerMenus || {}) };
    const dayMenu = { ...(menus[date] || {}) };
    dayMenu[course] = [...(dayMenu[course] || []), trimmed];
    menus[date] = dayMenu;
    const updated = { ...zt, _workerMenus: menus };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addWorkerMenuDish save failed', e); }
    return updated;
  },

  async removeWorkerMenuDish(date, course, index) {
    const zt = this.getZoneTavoli();
    const menus = { ...(zt._workerMenus || {}) };
    const dayMenu = { ...(menus[date] || {}) };
    dayMenu[course] = (dayMenu[course] || []).filter((_, i) => i !== index);
    menus[date] = dayMenu;
    const updated = { ...zt, _workerMenus: menus };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeWorkerMenuDish save failed', e); }
    return updated;
  },

  // ===== Menu di mezza pensione (zone_tavoli._halfBoardMenus) =====
  // Cosa propone la cucina agli ospiti in mezza pensione OGGI — diviso per
  // portata (antipasti/primi/secondi/dolci), ma senza nessun limite al
  // numero di piatti per portata: lo chef ne mette quanti vuole, un
  // semplice elenco di nomi, niente stato/porzioni come le proposte del
  // giorno — qui basta il nome del piatto.
  HALF_BOARD_COURSES: ['antipasti', 'primi', 'secondi', 'dolci'],
  HALF_BOARD_COURSE_LABELS: { antipasti: 'Antipasti', primi: 'Primi', secondi: 'Secondi', dolci: 'Dolci' },

  getHalfBoardMenu(date) {
    const zt = this.getZoneTavoli();
    const saved = (zt._halfBoardMenus || {})[date] || {};
    const menu = {};
    this.HALF_BOARD_COURSES.forEach(course => { menu[course] = saved[course] || []; });
    return menu;
  },

  async addHalfBoardDish(date, course, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return this.getZoneTavoli();
    const zt = this.getZoneTavoli();
    const menus = { ...(zt._halfBoardMenus || {}) };
    const dayMenu = { ...(menus[date] || {}) };
    dayMenu[course] = [...(dayMenu[course] || []), trimmed];
    menus[date] = dayMenu;
    const updated = { ...zt, _halfBoardMenus: menus };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addHalfBoardDish save failed', e); }
    return updated;
  },

  async removeHalfBoardDish(date, course, index) {
    const zt = this.getZoneTavoli();
    const menus = { ...(zt._halfBoardMenus || {}) };
    const dayMenu = { ...(menus[date] || {}) };
    dayMenu[course] = (dayMenu[course] || []).filter((_, i) => i !== index);
    menus[date] = dayMenu;
    const updated = { ...zt, _halfBoardMenus: menus };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeHalfBoardDish save failed', e); }
    return updated;
  },

  // ===== Vini al calice (zone_tavoli._winesByGlass) =====
  // Una lista fissa (non per data, a differenza dei menu sopra — i vini
  // al calice cambiano molto meno spesso dei piatti del giorno), gestita
  // da sala/admin. È anche quello che finisce, insieme alle proposte
  // confermate, sul sito pubblico con il QR code (vedi syncPublicMenu
  // più sotto).
  WINE_CATEGORIES: ['Bollicine', 'Bianchi', 'Rosati', 'Rossi'],

  getWinesByGlass() {
    const zt = this.getZoneTavoli();
    return zt._winesByGlass || [];
  },

  async addWineByGlass(wine) {
    const zt = this.getZoneTavoli();
    const wines = [...(zt._winesByGlass || [])];
    wines.push({
      id: Utils.uid('wine'),
      categoria: wine.categoria || 'Bianchi',
      produttore: (wine.produttore || '').trim(),
      regione: (wine.regione || '').trim(),
      tipologia: (wine.tipologia || '').trim(),
      nome: (wine.nome || '').trim(),
      vitigno: (wine.vitigno || '').trim(),
      descrizione: (wine.descrizione || '').trim(),
      prezzo: (wine.prezzo === null || wine.prezzo === undefined || isNaN(wine.prezzo)) ? null : Number(wine.prezzo),
    });
    const updated = { ...zt, _winesByGlass: wines };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addWineByGlass save failed', e); }
    this.syncPublicMenu();
    return updated;
  },

  async updateWineByGlass(id, patch) {
    const zt = this.getZoneTavoli();
    const wines = (zt._winesByGlass || []).map(w => w.id === id ? { ...w, ...patch } : w);
    const updated = { ...zt, _winesByGlass: wines };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('updateWineByGlass save failed', e); }
    this.syncPublicMenu();
    return updated;
  },

  async removeWineByGlass(id) {
    const zt = this.getZoneTavoli();
    const wines = (zt._winesByGlass || []).filter(w => w.id !== id);
    const updated = { ...zt, _winesByGlass: wines };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeWineByGlass save failed', e); }
    this.syncPublicMenu();
    return updated;
  },

  // ===== Collegamento col sito pubblico (QR code in sala) =====
  // Il sito che i clienti vedono dal QR code legge i suoi dati da un
  // servizio esterno (JSONBin) — questa funzione traduce le proposte
  // CONFERMATE di oggi e i vini al calice nella forma esatta che quel
  // sito si aspetta, e la manda là. Chiamata da sola ogni volta che
  // qualcosa di rilevante cambia (vedi le chiamate a questa funzione più
  // sopra e dentro le funzioni delle proposte del giorno).
  // (storico) Il vecchio menu pubblico usava JSONBin: non più usato.
  // Le proposte usano nomi di categoria diversi da quelli attesi dal
  // sito pubblico — questa tabella traduce dall'uno all'altro. "altro"
  // diventa "Speciale", l'unica coppia che non si intuisce da sola.
  PUBLIC_MENU_CATEGORY_MAP: {
    antipasti: 'Antipasto', primi: 'Primo', secondi: 'Secondo',
    contorni: 'Contorno', dolci: 'Dessert', altro: 'Speciale',
  },
  // Le categorie sono un elenco fisso di sei voci, uguale per tutti i
  // piatti — a differenza di nome/descrizione, non serve che qualcuno le
  // traduca piatto per piatto: la traduzione è sempre la stessa, fissa
  // qui una volta per tutte.
  PUBLIC_MENU_CATEGORY_TRANSLATIONS: {
    Antipasto: { en: 'Starter', fr: 'Entrée' },
    Primo: { en: 'First Course', fr: 'Premier plat' },
    Secondo: { en: 'Main Course', fr: 'Plat principal' },
    Contorno: { en: 'Side Dish', fr: 'Accompagnement' },
    Dessert: { en: 'Dessert', fr: 'Dessert' },
    Speciale: { en: 'Special', fr: 'Spécial' },
  },

  // Il menu pubblico (QR) ora legge da solo i piatti confermati dalla
  // funzione "menu-pubblico" su Supabase: qui non c'è più niente da
  // inviare. La funzione resta (vuota) perché è chiamata in vari punti.
  async syncPublicMenu() { /* niente da fare */ },

  // ===== Proposte del giorno (zone_tavoli._dailySpecials) =====
  // Diverse dal menu fisso — piatti proposti per UN giorno specifico.
  // Sala scrive nome/descrizione; lo chef (eccezione al suo sola-lettura,
  // vedi DB.canManageDailySpecials) aggiorna disponibilità/porzioni, e può
  // anche proporne di nuove — entrambi lavorano sulla stessa lista.

  getDailySpecials(date) {
    const zt = this.getZoneTavoli();
    return (zt._dailySpecials || {})[date] || [];
  },

  /**
   * cascade=true propaga il piatto appena aggiunto anche a tutti i giorni
   * successivi che esistono già — non solo quello di oggi. Ogni copia ha
   * un id suo proprio (non lo stesso id ripetuto): sono piatti distinti,
   * indipendenti da lì in poi, non collegati per riferimento — così
   * cambiare stato/porzioni su uno non tocca per sbaglio gli altri.
   * Di default false: usato SOLO dal pulsante "Aggiungi proposta" vero e
   * proprio — la ripresa automatica dai giorni precedenti
   * (ensureDailySpecialsForDate) e "Programma"/riproponi su un giorno
   * preciso non devono propagare a loro volta, o si intreccerebbero con
   * la stessa logica creando doppioni.
   */
  async addDailySpecial(date, { name, description, createdBy, category, price, nameEn, nameFr, descriptionEn, descriptionFr }, cascade) {
    const zt = this.getZoneTavoli();
    const all = { ...(zt._dailySpecials || {}) };
    const dayList = [...(all[date] || [])];
    const special = {
      id: Utils.uid('special'),
      name: (name || '').trim(),
      description: (description || '').trim(),
      category: category || 'altro', // 'antipasti' | 'primi' | 'secondi' | 'contorni' | 'dolci' | 'altro'
      price: (price === null || price === undefined || isNaN(price)) ? null : Number(price),
      // Traduzioni — facoltative, vuote finché qualcuno non le scrive. Il
      // sito pubblico col QR code (vedi syncPublicMenu) usa l'italiano
      // come riserva se mancano, non va mai in bianco.
      nameEn: (nameEn || '').trim(),
      nameFr: (nameFr || '').trim(),
      descriptionEn: (descriptionEn || '').trim(),
      descriptionFr: (descriptionFr || '').trim(),
      // Un unico stato al posto dei due separati di prima (conferma +
      // disponibilità, che si sovrapponevano) — decide solo lo chef,
      // riparte sempre da "pending" su un giorno nuovo, riproposto a mano
      // o in automatico: è una decisione presa giorno per giorno.
      status: 'pending', // 'pending' | 'confermato' | 'non_disponibile' | 'modificato'
      portionsLeft: null, // null = non tracciato, un numero se lo chef lo imposta
      chefNote: '', // usato quando status è 'modificato', per dire cosa è cambiato
      createdBy: createdBy || '',
      updatedAt: new Date().toISOString(),
    };
    dayList.push(special);
    all[date] = dayList;
    if (cascade) {
      Object.keys(all).forEach(d => {
        if (d > date) {
          all[d] = [...all[d], { ...special, id: Utils.uid('special') }];
        }
      });
    }
    const updated = { ...zt, _dailySpecials: all };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addDailySpecial save failed', e); }
    // Lo ricorda per sempre, a prescindere dal salvataggio sopra — un
    // piatto già proposto in passato deve poter essere ritrovato digitando
    // il nome, senza doverlo riscrivere daccapo ogni volta. Le traduzioni
    // comprese: scritte una volta, da lì in poi si riprendono da sole.
    this.addToDishLibrary(special.name, special.description, special.category, special.nameEn, special.nameFr, special.descriptionEn, special.descriptionFr).catch(() => {});
    this.syncPublicMenu();
    return special;
  },

  // ===== Libreria piatti (zone_tavoli._dishLibrary) =====
  // Un elenco permanente di tutti i piatti mai proposti — non è legato a
  // nessun giorno, resta lì per sempre (a differenza delle proposte del
  // giorno, che sono per forza legate a una data). Serve solo a suggerire
  // nome/descrizione/categoria mentre si scrive, così non si riscrive da
  // capo un piatto già fatto altre volte.

  getDishLibrary() {
    const zt = this.getZoneTavoli();
    return zt._dishLibrary || [];
  },

  /**
   * Cerca nella libreria i piatti il cui nome contiene il testo digitato
   * — case-insensitive, "contiene" non "inizia per", così si trova anche
   * scrivendo solo una parte del nome.
   */
  searchDishLibrary(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return this.getDishLibrary().filter(d => d.name.toLowerCase().includes(q)).slice(0, 6);
  },

  /**
   * Le traduzioni sono facoltative (ultimi quattro parametri) — se non
   * passate (o vuote) e il piatto esiste già in libreria, NON cancellano
   * una traduzione scritta in precedenza: si aggiornano solo quando
   * arriva qualcosa di nuovo da scrivere sopra, altrimenti un
   * aggiornamento di stato/porzioni (che richiama questa funzione
   * indirettamente tramite altri percorsi) potrebbe svuotarle per
   * errore.
   */
  async addToDishLibrary(name, description, category, nameEn, nameFr, descriptionEn, descriptionFr) {
    if (!name || !name.trim()) return;
    const zt = this.getZoneTavoli();
    const lib = [...(zt._dishLibrary || [])];
    const existingIdx = lib.findIndex(d => d.name.toLowerCase() === name.trim().toLowerCase());
    if (existingIdx !== -1) {
      const prev = lib[existingIdx];
      lib[existingIdx] = {
        ...prev,
        description: description || '',
        category: category || 'altro',
        nameEn: nameEn || prev.nameEn || '',
        nameFr: nameFr || prev.nameFr || '',
        descriptionEn: descriptionEn || prev.descriptionEn || '',
        descriptionFr: descriptionFr || prev.descriptionFr || '',
      };
    } else {
      lib.push({
        id: Utils.uid('dish'), name: name.trim(), description: description || '', category: category || 'altro',
        nameEn: nameEn || '', nameFr: nameFr || '', descriptionEn: descriptionEn || '', descriptionFr: descriptionFr || '',
      });
    }
    const updated = { ...zt, _dishLibrary: lib };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addToDishLibrary save failed', e); }
    return updated;
  },

  /**
   * cascade=true propaga la modifica anche ai giorni successivi che
   * hanno già lo stesso piatto (stesso nome PRIMA della modifica) — solo
   * per le modifiche al piatto in sé (nome/descrizione/categoria, quello
   * che fa il pulsante "Modifica"). Stato, porzioni e nota dello chef
   * restano sempre per singolo giorno: sono cose operative del giorno
   * preciso, non dell'identità del piatto — non hanno senso propagate.
   */
  async updateDailySpecial(date, id, patch, cascade) {
    const zt = this.getZoneTavoli();
    const all = { ...(zt._dailySpecials || {}) };
    const original = (all[date] || []).find(s => s.id === id);
    const dayList = (all[date] || []).map(s => s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s);
    all[date] = dayList;
    if (cascade && original && patch.name) {
      const oldNormalized = (original.name || '').trim().toLowerCase();
      Object.keys(all).forEach(d => {
        if (d > date && oldNormalized) {
          all[d] = all[d].map(s => (s.name || '').trim().toLowerCase() === oldNormalized
            ? { ...s, ...patch, updatedAt: new Date().toISOString() }
            : s);
        }
      });
    }
    const updated = { ...zt, _dailySpecials: all };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('updateDailySpecial save failed', e); }
    this.syncPublicMenu();
    return updated;
  },

  /**
   * Toglie una proposta — e con lei, tutte le copie che ha già ricevuto
   * nei giorni successivi (stesso nome), non solo quella di oggi.
   * Altrimenti un piatto tolto oggi ricompariva domani: era già stato
   * portato avanti prima di essere tolto, e quella copia futura restava
   * lì per conto suo, indipendente da questa. I giorni ANCORA da
   * generare non hanno bisogno di questo — copiano da oggi quando
   * arrivano, quindi ereditano già l'assenza di questo piatto.
   *
   * Un giorno futuro svuotato del tutto da questa cascata torna a essere
   * "non ancora personalizzato" (la sua chiave sparisce, non resta un
   * elenco vuoto) — altrimenti quel giorno veniva scambiato per "svuotato
   * apposta da chi lo guardava quel giorno", e da lì in poi la ripresa
   * automatica dai giorni precedenti si fermava per sempre: era proprio
   * questo a far sembrare che le proposte avessero smesso di ripetersi.
   * Il giorno che stai modificando TU direttamente resta invece con un
   * elenco vuoto vero e proprio se lo svuoti — quella è una scelta tua,
   * fatta apposta su quel giorno preciso, va rispettata.
   */
  async removeDailySpecial(date, id) {
    const zt = this.getZoneTavoli();
    const all = { ...(zt._dailySpecials || {}) };
    const removedItem = (all[date] || []).find(s => s.id === id);
    all[date] = (all[date] || []).filter(s => s.id !== id);
    if (removedItem) {
      const normalizedName = (removedItem.name || '').trim().toLowerCase();
      Object.keys(all).forEach(d => {
        if (d > date && normalizedName) {
          const filtered = all[d].filter(s => (s.name || '').trim().toLowerCase() !== normalizedName);
          if (filtered.length > 0) all[d] = filtered;
          else delete all[d];
        }
      });
    }
    const updated = { ...zt, _dailySpecials: all };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeDailySpecial save failed', e); }
    this.syncPublicMenu();
    return updated;
  },

  /**
   * Riproponi un piatto su un altro giorno senza riscriverlo — copia
   * nome e descrizione, ma riparte sempre da zero su stato e porzioni:
   * "disponibile" e non tracciate, perché quelle sono cose del giorno
   * nuovo, non ha senso ereditarle dal giorno prima.
   */
  async duplicateDailySpecialToDate(fromDate, id, toDate) {
    const original = this.getDailySpecials(fromDate).find(s => s.id === id);
    if (!original) return null;
    return this.addDailySpecial(toDate, {
      name: original.name,
      description: original.description,
      category: original.category,
      price: original.price,
      nameEn: original.nameEn, nameFr: original.nameFr,
      descriptionEn: original.descriptionEn, descriptionFr: original.descriptionFr,
      createdBy: original.createdBy,
    });
  },

  /**
   * Se questo giorno non ha ancora nessuna proposta, le riprende in
   * automatico dal giorno più recente che ne aveva (fino a 7 giorni
   * indietro) — così un piatto resta proposto di default finché qualcuno
   * non lo cambia o lo toglie, invece di dover ogni volta ripartire da
   * zero. Non fa nulla se il giorno ha già qualcosa (anche vuoto per
   * scelta, es. tutto rimosso apposta) — scrive una volta sola, non ad
   * ogni chiamata.
   */
  async ensureDailySpecialsForDate(date) {
    const zt = this.getZoneTavoli();
    const all = zt._dailySpecials || {};
    if (all[date] && all[date].length > 0) return all[date]; // già presente, non tocco nulla
    if (Object.prototype.hasOwnProperty.call(all, date)) return []; // giorno esplicitamente svuotato, non lo riempio da solo

    let sourceDate = null;
    const d = Utils.isoToDate(date);
    for (let i = 1; i <= 7; i++) {
      const check = new Date(d); check.setDate(check.getDate() - i);
      const checkISO = Utils.dateToISO(check);
      if (all[checkISO] && all[checkISO].length > 0) { sourceDate = checkISO; break; }
    }
    if (!sourceDate) return [];

    const source = all[sourceDate];
    for (const s of source) {
      // Traduzioni e prezzo vengono portati avanti (prima si perdevano e
      // andavano riscritti ogni giorno).
      await this.addDailySpecial(date, {
        name: s.name, description: s.description, category: s.category, createdBy: s.createdBy,
        price: s.price, nameEn: s.nameEn, nameFr: s.nameFr, descriptionEn: s.descriptionEn, descriptionFr: s.descriptionFr,
      });
    }
    return this.getDailySpecials(date);
  },

  // ===== Notifiche push (zone_tavoli._pushSubscriptions) =====
  // Una sottoscrizione per dispositivo (non per persona — se la stessa
  // persona usa telefono e tablet, sono due sottoscrizioni distinte). Il
  // ruolo salvato insieme dice a chi va indirizzata una notifica: "read"
  // per lo chef, "staff"/"admin" per sala. La Edge Function su Supabase
  // legge questa stessa lista per decidere a chi mandare cosa.

  getPushSubscriptions() {
    const zt = this.getZoneTavoli();
    return zt._pushSubscriptions || [];
  },

  /**
   * Salva o aggiorna la sottoscrizione di QUESTO dispositivo — se lo
   * stesso endpoint (identifica il dispositivo/browser in modo univoco)
   * esisteva già, lo rimpiazza invece di duplicarlo.
   */
  /**
   * Salva o aggiorna la sottoscrizione di QUESTO dispositivo — toglie
   * prima qualunque altra voce con lo STESSO deviceId (non solo lo
   * stesso endpoint): un telefono che si ri-sottoscrive dopo aver perso
   * il permesso, o dopo aver reinstallato l'app, ottiene un endpoint
   * nuovo, ma resta lo stesso dispositivo fisico — non deve restarne
   * anche una copia vecchia e morta, altrimenti rischia di ricevere due
   * volte la stessa notifica (o continuare a "tentare" un invio che non
   * arriverà mai più a nessuno).
   */
  async addPushSubscription(sub) {
    const zt = this.getZoneTavoli();
    const subs = (zt._pushSubscriptions || [])
      .filter(s => s.endpoint !== sub.endpoint && s.deviceId !== sub.deviceId);
    subs.push({ ...sub, updatedAt: new Date().toISOString() });
    const updated = { ...zt, _pushSubscriptions: subs };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('addPushSubscription save failed', e); }
    return updated;
  },

  /**
   * Aggiorna solo le preferenze (quali tipi di notifica vuole) di una
   * sottoscrizione già esistente, senza toccare il resto (endpoint,
   * chiavi) — quello che usa la scheda in Impostazioni con le spunte.
   */
  async updatePushSubscriptionPrefs(endpoint, notificationPrefs) {
    const zt = this.getZoneTavoli();
    const subs = (zt._pushSubscriptions || []).map(s =>
      s.endpoint === endpoint ? { ...s, notificationPrefs, updatedAt: new Date().toISOString() } : s
    );
    const updated = { ...zt, _pushSubscriptions: subs };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('updatePushSubscriptionPrefs save failed', e); }
    return updated;
  },

  async removePushSubscription(endpoint) {
    const zt = this.getZoneTavoli();
    const subs = (zt._pushSubscriptions || []).filter(s => s.endpoint !== endpoint);
    const updated = { ...zt, _pushSubscriptions: subs };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removePushSubscription save failed', e); }
    return updated;
  },

  /**
   * Duplica un progetto salvato — utile per un evento ricorrente (es. la
   * stessa cena a tema riproposta) senza dover reinserire tutti i numeri
   * da capo. Riparte da "Idea", non eredita lo stato di avanzamento del
   * progetto originale.
   */
  async duplicateProject(id) {
    const original = this.getProjectById(id);
    if (!original) return null;
    return this.addProject({
      name: original.name + ' (copia)',
      date: null,
      eventType: original.eventType,
      coperti: original.coperti,
      pricePerPerson: original.pricePerPerson,
      foodCostPerPerson: original.foodCostPerPerson,
      // Le portate si duplicano con nuovi id — così modificarle nella copia
      // non tocca mai per sbaglio l'originale, sono oggetti separati. Per
      // ciascuna, si ricostruisce quale opzione era quella scelta,
      // seguendo la corrispondenza tra il vecchio id e il nuovo.
      courses: (original.courses || []).map(c => {
        const options = (c.options || []).map(o => ({ newId: Utils.uid('opt'), oldId: o.id, name: o.name, foodCost: o.foodCost }));
        const chosenMatch = options.find(o => o.oldId === c.chosenId);
        return {
          id: Utils.uid('course'),
          name: c.name,
          options: options.map(o => ({ id: o.newId, name: o.name, foodCost: o.foodCost })),
          chosenId: chosenMatch ? chosenMatch.newId : (options[0] ? options[0].newId : null),
        };
      }),
      marginTargetPct: original.marginTargetPct,
      staffCostTotal: original.staffCostTotal,
      otherCostsTotal: original.otherCostsTotal,
      foodCostMaxPct: original.foodCostMaxPct,
      status: 'idea',
      notes: original.notes,
      // Dati del cliente NON si duplicano — quasi certamente è un cliente
      // diverso, o lo stesso ma per un'occasione diversa da ridiscutere.
      clientName: '', clientCompany: '', clientPhone: '', clientEmail: '',
      includes: original.includes ? [...original.includes] : [],
      wineCount: original.wineCount,
      budgetMaxPerPerson: original.budgetMaxPerPerson,
      budgetTotal: original.budgetTotal,
      eventDuration: original.eventDuration,
      requestNotes: '', // è la richiesta del cliente originale, non ha senso ripeterla su un evento diverso
      dietary: { vegetarians: 0, vegans: 0, celiac: 0, other: '' }, // idem: esigenze legate a QUESTO cliente
      operationalNotes: '',
    });
  },

  /**
   * Il food cost totale a persona calcolato dalle portate — la scelta
   * (chosenId) di ciascuna, sommate. Restituisce null se non ci sono
   * portate: significa "usa il campo semplice", non "food cost zero" —
   * una differenza importante per non azzerare per sbaglio un evento che
   * non usa affatto le portate.
   */
  computeCoursesFoodCost(courses) {
    if (!Array.isArray(courses) || courses.length === 0) return null;
    return courses.reduce((sum, c) => {
      const chosen = (c.options || []).find(o => o.id === c.chosenId) || (c.options || [])[0];
      return sum + (chosen ? (Number(chosen.foodCost) || 0) : 0);
    }, 0);
  },

  /**
   * Il calcolo economico — il cuore dello strumento. Il budget vino non è
   * un campo che si digita: è quello che resta del ricavo dopo aver
   * coperto food cost, costo personale, altri costi e il margine target —
   * quindi il margine REALIZZATO coincide sempre esattamente col margine
   * target per costruzione (il vino assorbe quello che avanza). Se i costi
   * fissi più il margine target superano il ricavo, non resta nulla per
   * il vino — segnalato con feasible:false, invece di un numero che non
   * torna senza spiegazione.
   *
   * Costo personale e altri costi sono STIME CHE SCRIVI TU, non calcoli
   * automatici — Lou Tchappé non ha un modulo turni/personale con tariffe
   * orarie reali, quindi non fingo di saperlo da solo: sono importi
   * totali per l'evento (non per persona, uno staff aggiuntivo non scala
   * linearmente con i coperti).
   */
  computeProjectEconomics({ pricePerPerson, foodCostPerPerson, marginTargetPct, coperti, staffCostTotal, otherCostsTotal }) {
    const price = Number(pricePerPerson) || 0;
    const foodCost = Number(foodCostPerPerson) || 0;
    const marginPct = Number(marginTargetPct) || 0;
    const n = Number(coperti) || 0;
    const staffTotal = Number(staffCostTotal) || 0;
    const otherTotal = Number(otherCostsTotal) || 0;

    const ricavoTotale = price * n;
    const foodCostTotale = foodCost * n;
    const margineTargetTotale = ricavoTotale * (marginPct / 100);
    // Quello che resta per il vino, in totale — può essere negativo: è
    // proprio il segnale che i costi fissi da soli (senza nemmeno il
    // vino) già superano quello che il margine target lascerebbe libero.
    const budgetVinoTotale = ricavoTotale - foodCostTotale - staffTotal - otherTotal - margineTargetTotale;
    const feasible = budgetVinoTotale >= 0;
    const wineBudgetPerPerson = (feasible && n > 0) ? budgetVinoTotale / n : 0;
    const foodCostPct = ricavoTotale > 0 ? (foodCostTotale / ricavoTotale) * 100 : 0;
    const wineBudgetPct = ricavoTotale > 0 ? (budgetVinoTotale / ricavoTotale) * 100 : 0;
    const margineTotale = ricavoTotale - foodCostTotale - staffTotal - otherTotal - Math.max(0, budgetVinoTotale);

    // Prezzo di pareggio: il prezzo a persona sotto al quale l'evento va
    // in perdita — margine zero, budget vino zero, solo i costi fissi
    // coperti esattamente. Non è "quanto vendere", è "sotto questo perdi
    // soldi".
    const prezzoDiPareggio = n > 0 ? foodCost + (staffTotal + otherTotal) / n : null;

    // Prezzo minimo sostenibile: il prezzo che centra il margine target
    // anche con budget vino a zero (il caso peggiore) — sotto, il target
    // non è raggiungibile in nessun modo con questi coperti/costi.
    const denomMinimo = 1 - marginPct / 100;
    const prezzoMinimoSostenibile = (n > 0 && denomMinimo > 0)
      ? foodCost / denomMinimo + (staffTotal + otherTotal) / (n * denomMinimo)
      : null;

    // Prezzo consigliato: non "ottimale" (nessun algoritmo lo giustifica,
    // sarebbe disonesto chiamarlo così) — semplicemente il prezzo minimo
    // sostenibile con un margine di manovra sul vino del 15%, la stessa
    // soglia "verde" del semaforo, invece del minimo indispensabile.
    const CUSCINETTO_VINO_PCT = 15;
    const denomConsigliato = 1 - (marginPct + CUSCINETTO_VINO_PCT) / 100;
    const prezzoConsigliato = (n > 0 && denomConsigliato > 0)
      ? foodCost / denomConsigliato + (staffTotal + otherTotal) / (n * denomConsigliato)
      : null;

    // Semaforo: non ha senso confrontare margine reale vs target (sono
    // sempre uguali per costruzione, tranne quando non è raggiungibile) —
    // segnala invece quanto è sano il budget vino residuo.
    let semaforo = 'verde';
    if (!feasible) semaforo = 'rosso';
    else if (wineBudgetPct < 15) semaforo = 'giallo';

    return {
      foodCostPct, wineBudgetPct, wineBudgetPerPerson, feasible,
      ricavoTotale, foodCostTotale, staffCostTotale: staffTotal, otherCostsTotale: otherTotal,
      budgetVinoTotale: Math.max(0, budgetVinoTotale), margineTotale, semaforo,
      prezzoDiPareggio, prezzoMinimoSostenibile, prezzoConsigliato,
    };
  },

  // ===== Un solo dispositivo alla volta per PIN personale (zone_tavoli._activeSessions) =====
  // Se qualcuno conosce il PIN di un'altra persona (es. un ex dipendente
  // che l'aveva sentito dire) non basta più: se il titolare è già dentro
  // da un altro telefono, l'accesso viene rifiutato. Chiave: il PIN
  // stesso → chi/quando/da quale dispositivo. Una voce più vecchia di 16
  // ore si considera scaduta (un turno intero, con ampio margine), così
  // un logout mancato non blocca nessuno per sempre.

  getActiveSession(pin) {
    const zt = this.getZoneTavoli();
    return (zt._activeSessions || {})[pin] || null;
  },

  async registerActiveSession(pin, deviceId, operatorName) {
    const zt = this.getZoneTavoli();
    const all = { ...(zt._activeSessions || {}) };
    all[pin] = { deviceId, operatorName, loginAt: new Date().toISOString() };
    const updated = { ...zt, _activeSessions: all };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('registerActiveSession save failed', e); }
    return updated;
  },

  async clearActiveSession(pin) {
    const zt = this.getZoneTavoli();
    const all = { ...(zt._activeSessions || {}) };
    delete all[pin];
    const updated = { ...zt, _activeSessions: all };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('clearActiveSession save failed', e); }
    return updated;
  },

  async removeCustomer(id) {
    const zt = this.getZoneTavoli();
    const customers = (zt._customers || []).filter(c => c.id !== id);
    const updated = { ...zt, _customers: customers };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeCustomer save failed', e); }
    return updated;
  },

  // ===== Capienza tavoli per data/servizio (zone_tavoli._tableCapacity) =====
  // Non una capienza fissa del tavolo (quella è già coperta dal numero di
  // sedie configurato per l'editor piantina) — questa è un'eccezione per
  // UN giorno e UN servizio specifico: "oggi a cena questo tavolo lo tengo
  // solo fino a 3", utile per un tavolo che di norma ne terrebbe 4 ma quel
  // giorno manca una sedia, o va tenuto più piccolo per un altro motivo.
  // Chiave: "data|servizio|tavolo". Nessuna riga per quella combinazione
  // → nessuna capienza speciale, il tavolo si comporta normalmente.

  _capacityKey(date, service, table) {
    return date + '|' + service + '|' + table;
  },

  getTableCapacityOverride(date, service, table) {
    const zt = this.getZoneTavoli();
    const all = zt._tableCapacity || {};
    return all[this._capacityKey(date, service, table)] || null;
  },

  async setTableCapacityOverride(date, service, table, { max, min }) {
    const zt = this.getZoneTavoli();
    const all = { ...(zt._tableCapacity || {}) };
    all[this._capacityKey(date, service, table)] = { max: max || null, min: min || null };
    const updated = { ...zt, _tableCapacity: all };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('setTableCapacityOverride save failed', e); }
    return updated;
  },

  async removeTableCapacityOverride(date, service, table) {
    const zt = this.getZoneTavoli();
    const all = { ...(zt._tableCapacity || {}) };
    delete all[this._capacityKey(date, service, table)];
    const updated = { ...zt, _tableCapacity: all };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeTableCapacityOverride save failed', e); }
    return updated;
  },

  // ===== Tavoli fisicamente uniti per data/servizio (zone_tavoli._tableJoins) =====
  // Diverso dai tavoli uniti di UNA prenotazione (quello è "questa
  // prenotazione occupa più tavoli insieme") — questo è "questi tavoli
  // SONO accostati fisicamente in sala in questo momento", indipendente da
  // chi li prenota: serve a non vendere per sbaglio due tavoli come fossero
  // separati quando in realtà, spostando i mobili, sono un unico tavolo più
  // grande. Chiave: "data|servizio" → array di gruppi, ogni gruppo è un
  // array di id tavolo. Un tavolo può stare in un solo gruppo alla volta.

  _joinKey(date, service) {
    return date + '|' + service;
  },

  getTableJoinGroups(date, service) {
    const zt = this.getZoneTavoli();
    const all = zt._tableJoins || {};
    return all[this._joinKey(date, service)] || [];
  },

  /**
   * Il gruppo (array di tavoli) a cui appartiene un tavolo specifico, o
   * null se non è unito a nessuno in questo momento.
   */
  getTableJoinGroupFor(date, service, table) {
    const groups = this.getTableJoinGroups(date, service);
    return groups.find(g => g.includes(table)) || null;
  },

  /**
   * Segna un gruppo di tavoli come fisicamente uniti per questo
   * giorno/servizio — li toglie prima da qualunque altro gruppo a cui
   * appartenessero già, un tavolo sta in un solo gruppo alla volta.
   */
  async setTableJoinGroup(date, service, tables) {
    const zt = this.getZoneTavoli();
    const all = { ...(zt._tableJoins || {}) };
    const key = this._joinKey(date, service);
    const existingGroups = (all[key] || []).filter(g => !g.some(t => tables.includes(t)));
    all[key] = [...existingGroups, tables];
    const updated = { ...zt, _tableJoins: all };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('setTableJoinGroup save failed', e); }
    return updated;
  },

  /**
   * Toglie un tavolo dal suo gruppo (es. sono stati staccati di nuovo) —
   * se il gruppo scende sotto i due tavoli, si scioglie del tutto (un
   * "gruppo" di un solo tavolo non significa niente).
   */
  async removeTableFromJoinGroup(date, service, table) {
    const zt = this.getZoneTavoli();
    const all = { ...(zt._tableJoins || {}) };
    const key = this._joinKey(date, service);
    const groups = (all[key] || [])
      .map(g => g.filter(t => t !== table))
      .filter(g => g.length >= 2);
    all[key] = groups;
    const updated = { ...zt, _tableJoins: all };
    this._zoneTavoli = updated;
    Storage.set('sharedZoneTavoli', updated);
    try {
      await DB.saveSharedConfig(null, null, null, updated);
    } catch (e) { console.warn('removeTableFromJoinGroup save failed', e); }
    return updated;
  },

  /**
   * Una tantum: porta le vecchie password fisse scritte nel codice dentro il sistema di PIN modificabile,
   * così diventano davvero cambiabili da Impostazioni invece di restare
   * bloccate nel codice sorgente per sempre. Dopo questo, login() smette
   * di accettare le versioni fisse — solo queste (inizialmente identiche,
   * ma da qui in poi modificabili) contano.
   */
  // Non serve più: le password storiche sono state portate sul server
  // (cifrate) con la migrazione della Fase 1.
  async migrateFixedCredentials() { /* niente da fare */ },
};

window.SharedTables = SharedTables;
