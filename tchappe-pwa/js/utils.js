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
