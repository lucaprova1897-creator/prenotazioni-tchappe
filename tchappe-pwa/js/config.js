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
  // Giorni con doppio turno alla cena: 0 = domenica ... 6 = sabato (standard JS Date.getDay())
  doubleShiftDays: [5, 6], // venerdì, sabato
  doubleShiftDurationMinutes: 75, // tempo di occupazione tavolo nel turno doppio
  // Quale servizio applica il doppio turno (per ora solo cena, ma resta configurabile)
  doubleShiftService: 'dinner',
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

  /**
   * Verifica se una data ha il doppio turno attivo per il servizio configurato.
   * @param {Date} date
   */
  isDoubleShiftDay(date) {
    const c = this.load();
    return c.doubleShiftDays.includes(date.getDay());
  },
};

window.Config = Config;
