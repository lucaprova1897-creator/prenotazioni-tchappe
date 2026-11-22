const STATUS = {
  CONFIRMED: 'confirmed',
  ARRIVED:   'arrived',
  SEATED:    'seated',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NOSHOW:    'noshow',
  ARCHIVED:  'archived', // rimossa dalle viste normali ma mai cancellata per davvero
  // Cliente che ha chiesto di essere richiamato se si libera un tavolo —
  // non un impegno vero, niente tavolo assegnato, ma il numero di
  // telefono è obbligatorio (è l'unico modo per poterli ricontattare).
  WAITLIST:  'waitlist',
  // Un ordine da ritirare, non da tavolo — niente tavolo assegnato (come
  // la lista d'attesa), ma è un impegno vero, non un'attesa. Porta con sé
  // cosa portare via, letto dallo chef in cucina.
  TAKEAWAY:  'asporto',
};

const STATUS_LABELS = {
  confirmed: 'Confermata',
  arrived:   'Arrivati',
  seated:    'Seduti',
  completed: 'Terminata',
  cancelled: 'Cancellata',
  noshow:    'No Show',
  archived:  'Archiviata',
  waitlist:  'Lista d\'attesa',
  asporto:   'Asporto',
};

// Avviso per la sala quando c'è un'allergia/intolleranza. Il testo vero lo
// scrive il database (trigger trg_avviso_alimentare → avviso_alimentare),
// così vale per qualunque prenotazione, chiunque l'abbia fatta; l'app lo
// ricava anche da sola dal campo allergie, per sicurezza.
const DIETARY_ALERT_TEXT = 'Richiesta alimentare da verificare al tavolo';

// Frase da leggere al cliente prima di annotare un allergene (pop-up).
const ALLERGY_CONSENT_QUESTION = 'Possiamo annotare gli allergeni segnalati per organizzare il servizio in sicurezza, senza indicare il nome delle persone interessate?';

const ZONE_LABELS = {
  indoor:  'Interno',
  outdoor: 'Esterno',
  any:     'Indifferente',
};

const EVENTO_PAYMENT_LABELS = {
  fine_cena: 'Paga a fine cena',
  acconto_richiesto: 'Acconto richiesto, non ancora pagato',
  acconto_pagato: 'Acconto pagato',
  saldato: 'Pagamento completo già ricevuto',
};

const Bookings = {
  _cache: [],

  getCached() { return this._cache; },

  getById(id) { return this._cache.find(b => b.id === id) || null; },

  PAYMENT_MARK: '💶',
  PAYMENT_RE: /^💶\s*([\d]+(?:[.,]\d{1,2})?)€\s*(\w+)/,
  EVENTO_MARK: '🎉',
  // "🎉 Evento" da solo (il segnalibro semplice), oppure "🎉 Evento::{json}"
  // quando ci sono anche menu/richieste — il formato vecchio senza dettagli
  // resta valido, non serve migrare nulla.
  EVENTO_RE: /^🎉 Evento(?:::(.+))?$/,
  // Turno provvisorio: un secondo turno "probabile" su un tavolo, senza un
  // orario di rilascio certo — non passa dal calcolo del doppio turno
  // (che richiede un orario esatto), è un giudizio dello staff da
  // segnalare in piantina, non da verificare matematicamente.
  PROVISIONAL_MARK: '🔄?',
  // Tavolo fisso per questa prenotazione — non va cambiato al cliente una
  // volta arrivato (es. tavolo storico, o preparato apposta per lui).
  NO_MOVE_MARK: '🔒 Non spostare',
  // Il tavolo ha il menu operai — una sola spunta, come "Non spostare
  // questo tavolo". Il contenuto vero del menu (cosa c'è oggi) vive
  // altrove, per data (vedi getWorkerMenu in config.js) — qui è solo
  // il collegamento "questa prenotazione ce l'ha".
  WORKER_MENU_MARK: '👷 Menu operaio',
  // Collegamento al cliente in archivio (SharedTables._customers) — un id,
  // non i dati del cliente: le note restano sul suo profilo, non sulla
  // singola prenotazione, così si ritrovano ogni volta che torna.
  CUSTOMER_RE: /^👤cliente:(.+)$/,
  // Cliente dell'hotel (stessa proprietà, a pochi metri) — numero camera
  // e se mangia in mezza pensione o alla carta. Diverso da un cliente
  // "normale" dell'archivio: qui non è una persona da ritrovare nel
  // tempo, è un dato di QUESTO soggiorno specifico.
  HOTEL_RE: /^🏨camera:([^:]*):(mezza_pensione|carta)(?::([0-9]{4}-[0-9]{2}-[0-9]{2}))?$/,

  // Cosa portare via, per un ordine da asporto — un prefisso semplice
  // invece di una regex, il testo dopo può essere qualunque cosa scriva
  // chi prende l'ordine al telefono.
  TAKEAWAY_MARK_PREFIX: '🥡asporto:',

  /**
   * Il campo notes accumula nel tempo sia le note vere scritte dallo staff
   * sia le tracce automatiche del sistema (walk-in, spostamenti tavolo,
   * archiviazioni, pagamenti registrati, evento, turno provvisorio),
   * separate da " · ". Questo le separa: le note vere si mostrano sempre,
   * le tracce vanno dietro un menu a tendina "Modifiche" (vedi
   * buildBookingRow), pagamento/evento/provvisorio sono informazioni a
   * parte perché servono anche altrove (statistiche, piantina, Home).
   */
  splitNotes(notesStr) {
    if (!notesStr) return { userNotes: '', traces: [], payment: null, isEvento: false, eventoDetails: null, isProvisional: false, isFixedTable: false, isWorkerMenu: false, customerId: null, hotelInfo: null, takeawayItems: null };
    const isTrace = (s) =>
      s.startsWith('🚶') ||       // walk-in
      s.startsWith('🗑️') ||       // archiviazione
      /^Tavol[oi] .+ → .+\(/.test(s) ||   // spostamento tavolo/tavoli dalla piantina (singolare o plurale)
      /^Scambiato tavoli/.test(s) ||   // scambio tavoli dalla piantina
      /^Spostato da tavolo/.test(s) ||  // riassegnazione da form occupato
      /^Segnata secondo turno/.test(s); // collegata a un tavolo occupato

    let payment = null;
    let isEvento = false;
    let eventoDetails = null;
    let isProvisional = false;
    let isFixedTable = false;
    let isWorkerMenu = false;
    let customerId = null;
    let hotelInfo = null;
    let takeawayItems = null;
    const traces = [];
    const userParts = [];
    notesStr.split(' · ').forEach(raw => {
      const s = raw.trim();
      if (!s) return;
      const paymentMatch = s.match(this.PAYMENT_RE);
      const eventoMatch = s.match(this.EVENTO_RE);
      const customerMatch = s.match(this.CUSTOMER_RE);
      const hotelMatch = s.match(this.HOTEL_RE);
      if (paymentMatch) {
        payment = { amount: Number(paymentMatch[1].replace(',', '.')), method: paymentMatch[2].toLowerCase() };
      } else if (eventoMatch) {
        isEvento = true;
        if (eventoMatch[1]) {
          try { eventoDetails = JSON.parse(eventoMatch[1]); } catch (e) { eventoDetails = null; }
        }
      } else if (s === this.PROVISIONAL_MARK) {
        isProvisional = true;
      } else if (s === this.NO_MOVE_MARK) {
        isFixedTable = true;
      } else if (s === this.WORKER_MENU_MARK) {
        isWorkerMenu = true;
      } else if (customerMatch) {
        customerId = customerMatch[1];
      } else if (hotelMatch) {
        hotelInfo = { roomNumber: hotelMatch[1], mealPlan: hotelMatch[2], departureDate: hotelMatch[3] || null };
      } else if (s.startsWith(this.TAKEAWAY_MARK_PREFIX)) {
        takeawayItems = s.slice(this.TAKEAWAY_MARK_PREFIX.length);
      } else if (isTrace(s)) {
        traces.push(s);
      } else {
        userParts.push(s);
      }
    });
    return { userNotes: userParts.join(' · '), traces, payment, isEvento, eventoDetails, isProvisional, isFixedTable, isWorkerMenu, customerId, hotelInfo, takeawayItems };
  },

  /**
   * L'ospite è dell'hotel? Numero camera e mezza pensione/alla carta —
   * non un cliente dell'archivio, un dato di questo soggiorno specifico.
   */
  getHotelInfo(booking) {
    return this.splitNotes(booking && booking.notes).hotelInfo;
  },

  /**
   * Cosa portare via, per un ordine da asporto (STATUS.TAKEAWAY) — testo
   * libero, quello che scrive chi prende l'ordine al telefono. null se
   * non è un asporto o non è stato ancora scritto nulla.
   */
  getTakeawayItems(booking) {
    return this.splitNotes(booking && booking.notes).takeawayItems;
  },

  /**
   * Tutte le prenotazioni (non cancellate/archiviate) che appartengono allo
   * STESSO soggiorno — stessa camera, stessa data di partenza dichiarata.
   * Ordinate per data e ora, così la posizione dice "quale volta" è
   * ciascuna. Il collegamento è volutamente su camera+partenza insieme,
   * non sul nome — più affidabile di un confronto testuale, ed è quello
   * che permette di sapere in automatico se un ospite in mezza pensione è
   * già venuto in questo soggiorno, senza doverlo segnare a mano.
   */
  getStayBookings(roomNumber, departureDate) {
    if (!roomNumber || !departureDate) return [];
    return this.getCached()
      .filter(b => {
        if (b.status === STATUS.CANCELLED || b.status === STATUS.ARCHIVED) return false;
        const info = this.getHotelInfo(b);
        return info && info.roomNumber === roomNumber && info.departureDate === departureDate;
      })
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },

  /**
   * In che posizione sta questa prenotazione dentro il suo soggiorno — 1 =
   * prima volta, 2 = seconda, ecc. null se non è (o non è ancora, manca la
   * partenza) un ospite in mezza pensione collegato a un soggiorno.
   *
   * Solo mezza pensione — alla carta mangia come qualunque altro cliente,
   * "prima volta" non ha alcun senso lì (non c'è nulla da non ripetere).
   */
  getStayVisitNumber(booking) {
    const info = this.getHotelInfo(booking);
    if (!info || !info.departureDate || info.mealPlan !== 'mezza_pensione') return null;
    const stay = this.getStayBookings(info.roomNumber, info.departureDate);
    const idx = stay.findIndex(b => b.id === booking.id);
    return idx === -1 ? null : idx + 1;
  },

  /**
   * Cerca un soggiorno ANCORA APERTO (partenza dichiarata oggi o più
   * avanti) già registrato per questo nome, ma in una camera DIVERSA da
   * quella che si sta inserendo ora — usato per il controllo "ha cambiato
   * camera, o è una persona diversa?" quando si segna un nuovo ospite
   * hotel. Confronto sul nome volutamente semplice (senza maiuscole/spazi
   * in più, corrispondenza esatta) — un confronto troppo "furbo"
   * rischierebbe di collegare per sbaglio due persone diverse; con questo
   * al massimo si fa una domanda in più quando non serve, mai un
   * collegamento sbagliato in automatico.
   */
  findOpenStayByNameInOtherRoom(guestName, excludeRoomNumber, todayISO) {
    const normalized = (guestName || '').trim().toLowerCase();
    if (!normalized) return null;
    const seen = new Map();
    this.getCached().forEach(b => {
      if (b.status === STATUS.CANCELLED || b.status === STATUS.ARCHIVED) return;
      const info = this.getHotelInfo(b);
      if (!info || !info.departureDate) return;
      if (info.roomNumber === excludeRoomNumber) return;
      if (info.departureDate < todayISO) return; // soggiorno già concluso, non più "aperto"
      if ((b.name || '').trim().toLowerCase() !== normalized) return;
      const key = info.roomNumber + '|' + info.departureDate;
      if (!seen.has(key)) seen.set(key, { roomNumber: info.roomNumber, departureDate: info.departureDate });
    });
    const results = Array.from(seen.values());
    return results.length > 0 ? results[0] : null;
  },

  /**
   * La partenza già nota per una camera, se ha un soggiorno ancora
   * aperto (partenza oggi o più avanti) — usata per precompilare da sola
   * il campo quando si prenota di nuovo la stessa camera nello stesso
   * soggiorno, così non va riscritta ogni volta.
   */
  findOpenDepartureForRoom(roomNumber, todayISO) {
    if (!roomNumber) return null;
    let found = null;
    this.getCached().forEach(b => {
      if (b.status === STATUS.CANCELLED || b.status === STATUS.ARCHIVED) return;
      const info = this.getHotelInfo(b);
      if (!info || info.roomNumber !== roomNumber || !info.departureDate) return;
      if (info.departureDate < todayISO) return;
      if (!found || info.departureDate > found) found = info.departureDate;
    });
    return found;
  },

  _hotelMarker(roomNumber, mealPlan, departureDate) {
    return '🏨camera:' + (roomNumber || '') + ':' + mealPlan + (departureDate ? ':' + departureDate : '');
  },

  /**
   * Imposta/aggiorna/toglie il collegamento hotel — passare mealPlan
   * null lo toglie del tutto (non è più un cliente dell'hotel).
   * departureDate (partenza dichiarata) è quello che permette di
   * riconoscere automaticamente lo stesso soggiorno su prenotazioni
   * diverse della stessa camera — vedi getStayBookings più sotto.
   */
  async setHotelInfo(id, roomNumber, mealPlan, departureDate) {
    const b = this.getById(id);
    const { userNotes, traces, payment, isEvento, eventoDetails, isProvisional, isFixedTable, isWorkerMenu, customerId, takeawayItems } = this.splitNotes(b ? b.notes : '');
    const parts = [userNotes, ...traces];
    if (payment) parts.push(this.PAYMENT_MARK + ' ' + payment.amount.toFixed(2) + '€ ' + payment.method);
    if (isEvento) parts.push(this._eventoMarker(eventoDetails));
    if (isProvisional) parts.push(this.PROVISIONAL_MARK);
    if (isFixedTable) parts.push(this.NO_MOVE_MARK);
    if (isWorkerMenu) parts.push(this.WORKER_MENU_MARK);
    if (customerId) parts.push('👤cliente:' + customerId);
    if (takeawayItems) parts.push(this.TAKEAWAY_MARK_PREFIX + takeawayItems);
    if (mealPlan) parts.push(this._hotelMarker(roomNumber, mealPlan, departureDate));
    const notes = parts.filter(Boolean).join(' · ');
    const updated = await DB.update(id, { notes });
    if (updated) {
      const idx = this._cache.findIndex(x => x.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Aggiorna cosa portare via su un ordine da asporto già esistente —
   * stesso schema di setHotelInfo. items vuoto/null lo toglie del tutto.
   * Il testo dell'utente non deve mai contenere " · " (il separatore tra
   * segmenti delle note) — se capita, lo sostituisce con una virgola,
   * altrimenti spezzerebbe la lettura delle note in punti sbagliati.
   */
  async setTakeawayItems(id, items) {
    const b = this.getById(id);
    const { userNotes, traces, payment, isEvento, eventoDetails, isProvisional, isFixedTable, isWorkerMenu, customerId, hotelInfo } = this.splitNotes(b ? b.notes : '');
    const parts = [userNotes, ...traces];
    if (payment) parts.push(this.PAYMENT_MARK + ' ' + payment.amount.toFixed(2) + '€ ' + payment.method);
    if (isEvento) parts.push(this._eventoMarker(eventoDetails));
    if (isProvisional) parts.push(this.PROVISIONAL_MARK);
    if (isFixedTable) parts.push(this.NO_MOVE_MARK);
    if (isWorkerMenu) parts.push(this.WORKER_MENU_MARK);
    if (customerId) parts.push('👤cliente:' + customerId);
    if (hotelInfo) parts.push(this._hotelMarker(hotelInfo.roomNumber, hotelInfo.mealPlan, hotelInfo.departureDate));
    const cleanItems = (items || '').trim().replace(/ · /g, ', ');
    if (cleanItems) parts.push(this.TAKEAWAY_MARK_PREFIX + cleanItems);
    const notes = parts.filter(Boolean).join(' · ');
    const updated = await DB.update(id, { notes });
    if (updated) {
      const idx = this._cache.findIndex(x => x.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },


  isProvisional(booking) {
    return this.splitNotes(booking && booking.notes).isProvisional;
  },

  isFixedTable(booking) {
    return this.splitNotes(booking && booking.notes).isFixedTable;
  },

  isWorkerMenu(booking) {
    return this.splitNotes(booking && booking.notes).isWorkerMenu;
  },

  getCustomerId(booking) {
    return this.splitNotes(booking && booking.notes).customerId;
  },

  /**
   * Collega o scollega una prenotazione a una scheda cliente — preserva
   * tutto il resto (pagamento, evento, provvisorio, tavolo fisso, tracce)
   * esattamente come le altre funzioni che toccano le note.
   */
  async linkCustomer(id, customerId) {
    const b = this.getById(id);
    const { userNotes, traces, payment, isEvento, eventoDetails, isProvisional, isFixedTable, isWorkerMenu, hotelInfo, takeawayItems } = this.splitNotes(b ? b.notes : '');
    const parts = [userNotes, ...traces];
    if (payment) parts.push(this.PAYMENT_MARK + ' ' + payment.amount.toFixed(2) + '€ ' + payment.method);
    if (isEvento) parts.push(this._eventoMarker(eventoDetails));
    if (isProvisional) parts.push(this.PROVISIONAL_MARK);
    if (isFixedTable) parts.push(this.NO_MOVE_MARK);
    if (isWorkerMenu) parts.push(this.WORKER_MENU_MARK);
    if (customerId) parts.push('👤cliente:' + customerId);
    if (hotelInfo) parts.push(this._hotelMarker(hotelInfo.roomNumber, hotelInfo.mealPlan, hotelInfo.departureDate));
    if (takeawayItems) parts.push(this.TAKEAWAY_MARK_PREFIX + takeawayItems);
    const notes = parts.filter(Boolean).join(' · ');
    const updated = await DB.update(id, { notes });
    if (updated) {
      const idx = this._cache.findIndex(x => x.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Accende/spegne il segnalibro "turno provvisorio" — usato quando si
   * prende una seconda prenotazione su un tavolo già occupato senza sapere
   * con certezza l'orario preciso di rilascio, solo una stima ragionevole.
   */
  async toggleProvisional(id) {
    const b = this.getById(id);
    const { userNotes, traces, payment, isEvento, eventoDetails, isProvisional, isFixedTable, isWorkerMenu, customerId, hotelInfo, takeawayItems } = this.splitNotes(b ? b.notes : '');
    const parts = [userNotes, ...traces];
    if (payment) parts.push(this.PAYMENT_MARK + ' ' + payment.amount.toFixed(2) + '€ ' + payment.method);
    if (isEvento) parts.push(this._eventoMarker(eventoDetails));
    if (!isProvisional) parts.push(this.PROVISIONAL_MARK);
    if (isFixedTable) parts.push(this.NO_MOVE_MARK);
    if (isWorkerMenu) parts.push(this.WORKER_MENU_MARK);
    if (customerId) parts.push('👤cliente:' + customerId);
    if (hotelInfo) parts.push(this._hotelMarker(hotelInfo.roomNumber, hotelInfo.mealPlan, hotelInfo.departureDate));
    if (takeawayItems) parts.push(this.TAKEAWAY_MARK_PREFIX + takeawayItems);
    const notes = parts.filter(Boolean).join(' · ');
    const updated = await DB.update(id, { notes });
    if (updated) {
      const idx = this._cache.findIndex(x => x.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },



  isEvento(booking) {
    return this.splitNotes(booking && booking.notes).isEvento;
  },

  /**
   * Ricostruisce il segmento evento da salvare nelle note: il segnalibro
   * semplice se non ci sono dettagli, altrimenti col JSON di menu/richieste
   * appeso dopo "::". Usata sia per accendere/spegnere sia per salvare i
   * dettagli, cosi la logica di serializzazione sta in un punto solo.
   */
  _eventoMarker(details) {
    const hasDetails = details && (details.menu || details.vino || details.richieste || details.costo || details.statoPagamento);
    return this.EVENTO_MARK + ' Evento' + (hasDetails ? '::' + JSON.stringify(details) : '');
  },

  /**
   * Accende/spegne il segnalibro "Evento" su una prenotazione — compare
   * poi nella sezione Eventi in Home come promemoria di qualcosa da
   * organizzare, senza bisogno di una colonna dedicata sul database.
   */
  async toggleEvento(id) {
    const b = this.getById(id);
    const { userNotes, traces, payment, isEvento, eventoDetails, isProvisional, isFixedTable, isWorkerMenu, customerId, hotelInfo, takeawayItems } = this.splitNotes(b ? b.notes : '');
    const parts = [userNotes, ...traces];
    if (payment) parts.push(this.PAYMENT_MARK + ' ' + payment.amount.toFixed(2) + '€ ' + payment.method);
    if (!isEvento) parts.push(this._eventoMarker(eventoDetails));
    if (isProvisional) parts.push(this.PROVISIONAL_MARK);
    if (isFixedTable) parts.push(this.NO_MOVE_MARK);
    if (isWorkerMenu) parts.push(this.WORKER_MENU_MARK);
    if (customerId) parts.push('👤cliente:' + customerId);
    if (hotelInfo) parts.push(this._hotelMarker(hotelInfo.roomNumber, hotelInfo.mealPlan, hotelInfo.departureDate));
    if (takeawayItems) parts.push(this.TAKEAWAY_MARK_PREFIX + takeawayItems);
    const notes = parts.filter(Boolean).join(' · ');
    const updated = await DB.update(id, { notes });
    if (updated) {
      const idx = this._cache.findIndex(x => x.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Salva/aggiorna il briefing di un evento (menu, richieste speciali) —
   * accende anche il segnalibro se non era già acceso. Le allergie e i
   * coperti non si duplicano qui: restano i campi Intolleranze/Persone
   * già presenti sulla prenotazione, un solo posto dove trovarli.
   */
  async setEventoDetails(id, details) {
    const b = this.getById(id);
    const { userNotes, traces, payment, isProvisional, isFixedTable, isWorkerMenu, customerId, hotelInfo, takeawayItems } = this.splitNotes(b ? b.notes : '');
    const parts = [userNotes, ...traces];
    if (payment) parts.push(this.PAYMENT_MARK + ' ' + payment.amount.toFixed(2) + '€ ' + payment.method);
    parts.push(this._eventoMarker(details));
    if (isProvisional) parts.push(this.PROVISIONAL_MARK);
    if (isFixedTable) parts.push(this.NO_MOVE_MARK);
    if (isWorkerMenu) parts.push(this.WORKER_MENU_MARK);
    if (customerId) parts.push('👤cliente:' + customerId);
    if (hotelInfo) parts.push(this._hotelMarker(hotelInfo.roomNumber, hotelInfo.mealPlan, hotelInfo.departureDate));
    if (takeawayItems) parts.push(this.TAKEAWAY_MARK_PREFIX + takeawayItems);
    const notes = parts.filter(Boolean).join(' · ');
    const updated = await DB.update(id, { notes });
    if (updated) {
      const idx = this._cache.findIndex(x => x.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Prossimi eventi (oggi in poi), ordinati per data — per la sezione
   * Eventi in Home. Esclude cancellate e archiviate.
   */
  getUpcomingEventi() {
    const today = Utils.todayISO();
    return this._cache
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED)
      .filter(b => b.date >= today && this.isEvento(b))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  },

  /**
   * Registra un pagamento (es. un tavolo "amico" pagato in contanti a fine
   * cena) — resta scritto nelle note con un marcatore riconoscibile, così
   * conta anche nelle statistiche senza bisogno di una colonna dedicata.
   */
  async recordPayment(id, amount, method, operatorLabel) {
    const b = this.getById(id);
    const existingNotes = b ? b.notes || '' : '';
    // Se c'era già un pagamento registrato, lo sostituisce (non lo somma) —
    // corregge un importo sbagliato invece di duplicarlo.
    const { userNotes, traces, isEvento, eventoDetails, isProvisional, isFixedTable, isWorkerMenu, customerId, hotelInfo, takeawayItems } = this.splitNotes(existingNotes);
    const marker = this.PAYMENT_MARK + ' ' + amount.toFixed(2) + '€ ' + method +
      (operatorLabel ? ' (' + operatorLabel + ')' : '');
    const parts = [userNotes, ...traces, marker];
    if (isEvento) parts.push(this._eventoMarker(eventoDetails));
    if (isProvisional) parts.push(this.PROVISIONAL_MARK);
    if (isFixedTable) parts.push(this.NO_MOVE_MARK);
    if (isWorkerMenu) parts.push(this.WORKER_MENU_MARK);
    if (customerId) parts.push('👤cliente:' + customerId);
    if (hotelInfo) parts.push(this._hotelMarker(hotelInfo.roomNumber, hotelInfo.mealPlan, hotelInfo.departureDate));
    if (takeawayItems) parts.push(this.TAKEAWAY_MARK_PREFIX + takeawayItems);
    const patch = { notes: parts.filter(Boolean).join(' · ') };
    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(x => x.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Toglie del tutto un pagamento registrato per sbaglio — preserva tutto
   * il resto (nota vera, evento, provvisorio, tracce) esattamente come le
   * altre funzioni che toccano le note.
   */
  async removePayment(id) {
    const b = this.getById(id);
    const { userNotes, traces, isEvento, eventoDetails, isProvisional, isFixedTable, isWorkerMenu, customerId, hotelInfo, takeawayItems } = this.splitNotes(b ? b.notes : '');
    const parts = [userNotes, ...traces];
    if (isEvento) parts.push(this._eventoMarker(eventoDetails));
    if (isProvisional) parts.push(this.PROVISIONAL_MARK);
    if (isFixedTable) parts.push(this.NO_MOVE_MARK);
    if (isWorkerMenu) parts.push(this.WORKER_MENU_MARK);
    if (customerId) parts.push('👤cliente:' + customerId);
    if (hotelInfo) parts.push(this._hotelMarker(hotelInfo.roomNumber, hotelInfo.mealPlan, hotelInfo.departureDate));
    if (takeawayItems) parts.push(this.TAKEAWAY_MARK_PREFIX + takeawayItems);
    const patch = { notes: parts.filter(Boolean).join(' · ') };
    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(x => x.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  getByDateAndService(dateISO, serviceKey) {
    return this._cache
      .filter(b => b.date === dateISO && b.service === serviceKey && b.status !== STATUS.ARCHIVED)
      .sort((a, b) => a.time.localeCompare(b.time));
  },

  search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this._cache
      .filter(b =>
        b.status !== STATUS.ARCHIVED && (
          b.name.toLowerCase().includes(q) ||
          (b.phone || '').toLowerCase().includes(q) ||
          b.date.includes(q)
        )
      )
      .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  },

  getStatsForDateAndService(dateISO, serviceKey) {
    const list = this.getByDateAndService(dateISO, serviceKey)
      .filter(b => b.status !== STATUS.CANCELLED);
    return {
      totalGuests: list.reduce((s, b) => s + b.people, 0),
      totalTablesBooked: list.length,
      totalBookings: list.length,
    };
  },

  /**
   * Stesso identico calcolo usato dalla Edge Function per il resoconto
   * fine servizio — numeri coerenti tra quello che arriva come notifica
   * e quello che si vede aprendo la pagina dal tocco su di essa.
   */
  getServiceReport(dateISO, serviceKey) {
    const list = this.getByDateAndService(dateISO, serviceKey)
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED && b.status !== STATUS.NOSHOW);
    const totalPeople = list.reduce((s, b) => s + b.people, 0);
    const tablesSet = new Set();
    list.forEach(b => {
      if (b.tablesAssigned) String(b.tablesAssigned).split(',').forEach(t => tablesSet.add(t.trim()));
    });
    const walkIns = list.filter(b => (b.notes || '').trim().startsWith('🚶'));
    return {
      totalPeople,
      totalTables: tablesSet.size,
      walkInsCount: walkIns.length,
      bookings: list,
    };
  },

  /**
   * Prenotati vs fatti per un giorno/servizio — "fatti" è lo stesso numero
   * letto in due momenti: durante il servizio cresce man mano che la gente
   * si siede, a servizio finito è il totale servito. Include chi è
   * arrivato, seduto o terminato; esclude no-show, cancellate e archiviate.
   */
  getServedStats(dateISO, serviceKey) {
    // Chi è in lista d'attesa non ha un tavolo garantito, non è un
    // coperto prenotato vero e proprio finché non se ne trova uno.
    const list = this.getByDateAndService(dateISO, serviceKey)
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.WAITLIST);
    let prenotati = 0;
    let fatti = 0;
    list.forEach(b => {
      // I seggiolini contano come persone: un bambino occupa un posto a
      // sedere tanto quanto un adulto, ai fini del conteggio coperti.
      const covers = (b.people || 0) + (b.highchairs || 0);
      const isArrived = !!b.arrivedAt || b.status === STATUS.SEATED || b.status === STATUS.COMPLETED;
      // Un walk-in non era prenotato — è arrivato e basta — quindi non
      // conta tra i "prenotati", ma conta regolarmente tra i "fatti" (è
      // stato comunque servito).
      if (typeof Piantina === 'undefined' || !Piantina.isWalkIn(b)) prenotati += covers;
      if (isArrived && b.status !== STATUS.NOSHOW) fatti += covers;
    });
    return { prenotati, fatti };
  },

  /**
   * Carica tutte le prenotazioni da Supabase e aggiorna la cache.
   */
  async loadAll() {
    const data = await DB.fetchAll();
    if (data !== null) {
      // Normalizza i campi snake_case di Supabase in camelCase per la UI
      this._cache = data.map(b => this._normalize(b));
      Storage.set('bookingsCache', this._cache);
    } else {
      // Errore di rete: usa cache locale
      this._cache = Storage.get('bookingsCache', []);
    }
    return this._cache;
  },

  /**
   * Crea una nuova prenotazione su Supabase.
   */
  async create(data) {
    const booking = {
      name:         data.name?.trim() || '',
      phone:        data.phone?.trim() || '',
      people:       Number(data.people) || 1,
      date:         data.date,
      time:         data.time,
      service:      data.service,
      zone:         data.zone || 'any',
      dogs:         Number(data.dogs) || 0,
      highchairs:   Number(data.highchairs) || 0,
      intolerances: data.intolerances?.trim() || '',
      special_needs: data.specialNeeds?.trim() || '',
      notes:        data.notes?.trim() || '',
      status:       data.status || STATUS.CONFIRMED,
      double_shift_release: data.doubleShiftRelease || null,
      tables_assigned: data.tablesAssigned || null,
      arrived_at:   null,
      is_new:       true,
      created_by:   DB.getOperatorWithDevice() || null,
    };
    this._applyAllergyConsent(booking, data);

    const created = await DB.create(booking);
    if (created) {
      this._cache.push(this._normalize(created));
      Storage.set('bookingsCache', this._cache);
    }
    return created;
  },

  /**
   * Aggiorna una prenotazione esistente.
   */
  async update(id, data) {
    const patch = {
      name:         data.name?.trim() || '',
      phone:        data.phone?.trim() || '',
      people:       Number(data.people) || 1,
      date:         data.date,
      time:         data.time,
      service:      data.service,
      zone:         data.zone || 'any',
      dogs:         Number(data.dogs) || 0,
      highchairs:   Number(data.highchairs) || 0,
      intolerances: data.intolerances?.trim() || '',
      special_needs: data.specialNeeds?.trim() || '',
      notes:        data.notes?.trim() || '',
      status:       data.status || STATUS.CONFIRMED,
      double_shift_release: data.doubleShiftRelease || null,
      tables_assigned: data.tablesAssigned || null,
    };
    this._applyAllergyConsent(patch, data);

    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * "Cancellazione" per lo staff: non è mai un DELETE reale, solo un
   * cambio di stato — la prenotazione sparisce dalle viste normali ma
   * resta per sempre consultabile dall'archivio (controllo interno).
   * Il nome di chi archivia e quando restano scritti nelle note.
   */
  async archive(id, operatorName) {
    const b = this.getById(id);
    const trace = '🗑️ Archiviata da ' + (operatorName || 'sconosciuto') + ' il ' +
      new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const notes = b && b.notes ? b.notes + ' · ' + trace : trace;
    const patch = { status: STATUS.ARCHIVED, notes };
    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(x => x.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Prenotazioni archiviate in un intervallo di date — per la revisione
   * interna (Statistiche → Archivio). Include chi le ha create e la nota
   * con chi le ha archiviate e quando.
   */
  getArchived(fromISO, toISO) {
    return this._cache
      .filter(b => b.status === STATUS.ARCHIVED && b.date >= fromISO && b.date <= toISO)
      .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  },

  async markAsTranscribed(id) {
    const updated = await DB.update(id, { is_new: false });
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Normalizza i nomi dei campi Supabase (snake_case) verso
   * quelli usati nell'app (camelCase) per compatibilità con la UI.
   */
  /**
   * Consenso agli allergeni (pop-up): si scrive solo quando c'è davvero
   * un'allergia e il personale l'ha appena confermato — mai per le
   * prenotazioni senza allergie, e non si sovrascrive quello già salvato.
   */
  _applyAllergyConsent(row, data) {
    const c = data && data.allergyConsent;
    if (!c || !row.intolerances) return;
    row.consenso_allergie_il = c.at;
    row.consenso_allergie_da = c.by || null;
  },

  /**
   * Avviso "Richiesta alimentare da verificare al tavolo" — quello scritto
   * dal database, oppure ricavato dal campo allergie se il database non
   * l'ha ancora impostato. Stringa vuota se non c'è nessuna allergia.
   */
  dietaryAlert(b) {
    if (!b) return '';
    if (b.avviso_alimentare) return b.avviso_alimentare;
    return (b.intolerances && String(b.intolerances).trim()) ? DIETARY_ALERT_TEXT : '';
  },

  /** Il consenso agli allergeni è già registrato (o c'erano già allergie)? */
  hasAllergyConsent(b) {
    return !!(b && (b.consenso_allergie_il || (b.intolerances && String(b.intolerances).trim())));
  },

  _normalize(b) {
    return {
      ...b,
      specialNeeds:    b.special_needs || '',
      doubleShift:     b.double_shift_release ? { releaseTime: b.double_shift_release } : null,
      doubleShiftRelease: b.double_shift_release || null,
      isNew:           b.is_new,
      tablesAssigned:  b.tables_assigned || null,
      highchairs:      Number(b.highchairs) || 0,
      arrivedAt:       b.arrived_at || null,
      createdBy:       b.created_by || null,
    };
  },

  /**
   * Segna un tavolo come arrivato (timestamp attuale) o non arrivato (null).
   */
  async markArrived(id, arrived) {
    const patch = { arrived_at: arrived ? new Date().toISOString() : null };
    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Segna/rimuove il no-show con un solo tocco (senza aprire il form).
   * Toglierlo riporta la prenotazione a "Confermata".
   */
  async markNoShow(id, isNoShow) {
    const patch = { status: isNoShow ? STATUS.NOSHOW : STATUS.CONFIRMED };
    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Segna/rimuove "Terminata" con un solo tocco — es. il tavolo si libera e
   * lo si rivende a un walk-in. Il record resta (conta nelle statistiche,
   * inclusi i ricambi tavolo), semplicemente non blocca più il tavolo.
   * Toglierlo riporta la prenotazione a "Confermata".
   */
  async markCompleted(id, isCompleted) {
    const patch = { status: isCompleted ? STATUS.COMPLETED : STATUS.CONFIRMED };
    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Segna una prenotazione come cancellata — aggiornamento mirato a un
   * solo campo, non passa da update() che invece ricostruisce l'intera
   * prenotazione con valori di default per tutto il resto (cancellerebbe
   * nome, telefono, tavolo...). Pensata per farlo al volo, senza dover
   * aprire la modifica e scorrere fino al selettore di stato in fondo.
   */
  async markCancelled(id) {
    const patch = { status: STATUS.CANCELLED };
    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Imposta (o rimuove, con null) l'orario di rilascio per il doppio
   * turno — aggiornamento mirato a un solo campo, non passa da update()
   * che invece ricostruisce l'intera prenotazione con valori di default
   * per tutto il resto (cancellerebbe nome, tavolo, stato...).
   */
  async setDoubleShiftRelease(id, value) {
    const patch = { double_shift_release: value || null };
    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Assegna i tavoli a una prenotazione (stringa es. "1,2" o "G1,Tenda").
   * traceNote, se passato, si aggiunge alle note (es. "Spostato da... a...
   * da [operatore] il [data]") — per sapere chi ha modificato cosa e quando.
   */
  async assignTables(id, tablesString, traceNote) {
    const patch = { tables_assigned: tablesString || null };
    if (traceNote) {
      const b = this.getById(id);
      patch.notes = (b && b.notes) ? b.notes + ' · ' + traceNote : traceNote;
    }
    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  /**
   * Quando una prenotazione con un doppio turno legato cambia tavolo, chi
   * la seguiva (in attesa di ereditare IL SUO tavolo, non un tavolo
   * specifico in astratto) deve seguirla sul tavolo nuovo — altrimenti
   * resta ad aspettare su un tavolo che nessuno lascerà mai. Va chiamata
   * DOPO aver spostato la prenotazione principale, passando i tavoli che
   * aveva PRIMA dello spostamento.
   */
  async dragPairedBookingAlong(movedBookingId, oldTablesStr, newTablesStr, dateISO, serviceKey) {
    if (!oldTablesStr || !newTablesStr || oldTablesStr === newTablesStr) return;
    const movedBooking = this.getById(movedBookingId);
    if (!movedBooking) return;
    const oldTablesSet = oldTablesStr.split(',').map(t => t.trim()).filter(Boolean);
    if (oldTablesSet.length === 0) return;
    const paired = this._cache.filter(b =>
      b.id !== movedBookingId && b.date === dateISO && b.service === serviceKey &&
      b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW &&
      b.tablesAssigned && b.tablesAssigned.split(',').map(t => t.trim()).some(t => oldTablesSet.includes(t)) &&
      typeof Piantina !== 'undefined' && Piantina._bookingsAreSeparated(movedBooking, b)
    );
    for (const p of paired) {
      // Stesso formato di traccia già usato per gli spostamenti dalla
      // piantina, così resta nascosta come le altre invece di comparire
      // come nota vera.
      const trace = 'Tavolo ' + oldTablesStr + ' → ' + newTablesStr + ' (segue il doppio turno)';
      await this.assignTables(p.id, newTablesStr, trace);
    }
  },

  /**
   * Applica la decisione presa nella scheda unica "tavolo condiviso": un
   * orario dato diventa il rilascio di chi arriva prima (verificabile);
   * lasciato vuoto, chi arriva dopo viene segnato "provvisorio" (una stima,
   * non un calcolo). Stesso meccanismo qualunque sia l'ordine in cui le
   * due prenotazioni sono state prese — non conta chi delle due esisteva
   * già, conta solo chi arriva prima nel tempo. Da chiamare DOPO aver
   * salvato la prenotazione corrente (serve il suo id).
   */
  async applySharedTableDecision(myBookingId, otherBookingId, releaseTime, iAmEarlier) {
    const earlierId = iAmEarlier ? myBookingId : otherBookingId;
    const laterId = iAmEarlier ? otherBookingId : myBookingId;
    if (releaseTime) {
      await this.setDoubleShiftRelease(earlierId, releaseTime);
    } else {
      const laterBooking = this.getById(laterId);
      if (laterBooking && !this.isProvisional(laterBooking)) {
        await this.toggleProvisional(laterId);
      }
    }
  },
};

window.STATUS       = STATUS;
window.STATUS_LABELS = STATUS_LABELS;
window.ZONE_LABELS  = ZONE_LABELS;
window.EVENTO_PAYMENT_LABELS = EVENTO_PAYMENT_LABELS;
window.Bookings     = Bookings;
