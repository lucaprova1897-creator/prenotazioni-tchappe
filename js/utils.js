/**
 * utils.js
 * Funzioni di utilità condivise, principalmente per date e formattazione.
 */

const Utils = {
  /**
   * Ritorna la data odierna come "YYYY-MM-DD" in fuso locale (no shift UTC).
   */
  todayISO() {
    const d = new Date();
    return this.dateToISO(d);
  },

  dateToISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  isoToDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  /**
   * Determina il servizio "corrente" in base all'orario di sistema,
   * usato come default quando si apre l'app o una nuova prenotazione.
   */
  currentService() {
    const cfg = Config.load();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    for (const [key, service] of Object.entries(cfg.services)) {
      const start = Slots.toMinutes(service.start);
      const end = Slots.toMinutes(service.end);
      if (nowMinutes >= start - 120 && nowMinutes < end) {
        // Considera "corrente" un servizio anche 2h prima dell'apertura
        // (tipico orario in cui si ricevono telefonate per il servizio del giorno)
        return key;
      }
    }
    // Fuori da entrambe le fasce: default su pranzo
    return 'lunch';
  },

  /**
   * Come currentService(), ma passa in automatico al servizio successivo
   * (e al giorno dopo, dopo cena) con un margine dopo la chiusura — così
   * chi apre l'app alle 14:45 (15 min dopo la fine del pranzo delle 14:30)
   * si trova già sulla cena, non deve navigare a mano. Usata solo quando si
   * apre l'app: non tocca la scelta di data/servizio già fatta a mano.
   */
  currentServiceAndDate(bufferMinutes) {
    const buffer = bufferMinutes || 15;
    const cfg = Config.load();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const today = Utils.todayISO();

    const lunchEnd = Slots.toMinutes(cfg.services.lunch.end);
    const dinnerEnd = Slots.toMinutes(cfg.services.dinner.end);

    if (nowMinutes < lunchEnd + buffer) {
      return { service: 'lunch', date: today };
    }
    if (nowMinutes < dinnerEnd + buffer) {
      return { service: 'dinner', date: today };
    }
    // Dopo la cena (+ margine): si passa al pranzo di domani
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { service: 'lunch', date: Utils.dateToISO(tomorrow) };
  },

  /**
   * Formatta una data ISO in italiano leggibile, es. "Giovedì 26 giugno".
   */
  formatDateLong(iso) {
    const d = this.isoToDate(iso);
    const formatted = d.toLocaleDateString('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  },

  formatDateShort(iso) {
    const d = this.isoToDate(iso);
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },

  /**
   * Quanti giorni mancano da oggi a una data — usato per "tra N giorni"
   * nella sezione Eventi. Positivo se nel futuro, 0 se oggi, negativo se passata.
   */
  daysUntil(iso) {
    const today = this.isoToDate(this.todayISO());
    const target = this.isoToDate(iso);
    return Math.round((target - today) / 86400000);
  },

  /**
   * Etichetta leggibile "Oggi" / "Domani" / "tra N giorni" per una data
   * futura — usata nella sezione Eventi della Home.
   */
  relativeDayLabel(iso) {
    const n = this.daysUntil(iso);
    if (n === 0) return 'Oggi';
    if (n === 1) return 'Domani';
    if (n > 1) return 'Tra ' + n + ' giorni';
    if (n === -1) return 'Ieri';
    return this.formatDateShort(iso);
  },

  /**
   * Genera id univoco generico (usato anche fuori da bookings.js se serve).
   */
  uid(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  },

  /**
   * Debounce semplice per la ricerca istantanea.
   */
  debounce(fn, delay = 150) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  /**
   * Normalizza un numero di telefono per il link tel: (rimuove spazi).
   */
  telLink(phone) {
    return `tel:${phone.replace(/\s+/g, '')}`;
  },
};

window.Utils = Utils;
