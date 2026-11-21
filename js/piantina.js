/**
 * piantina.js
 * Logica pura per la piantina sala: stato/colore di ogni tavolo e
 * layout di default quando un tavolo non ha ancora una posizione salvata.
 * Nessun accesso allo storage: riceve dati (bookings, posizioni) e ritorna
 * strutture pronte per il rendering in ui.js.
 */

const Piantina = {
  // Schema semplificato a 4 stati, come richiesto: il colore risponde alla
  // domanda "posso farci sedere qualcuno ORA?", non al dettaglio della
  // prenotazione (prenotato/arrivato/seduto contano tutti come "occupato").
  STATUS: {
    FREE:     'free',     // verde  — disponibile
    OCCUPIED: 'occupied', // blu    — occupato (prenotazione normale)
    WALKIN:   'walkin',   // giallo — occupato da un walk-in
    BLOCKED:  'blocked',  // rosso  — non disponibile (bloccato manualmente)
  },

  STATUS_COLOR_VAR: {
    free:     '--color-success',
    occupied: '--color-info',
    walkin:   '--color-warning',
    blocked:  '--color-danger',
  },

  STATUS_LABELS: {
    free:     'Disponibile',
    occupied: 'Occupato',
    walkin:   'Walk-in',
    blocked:  'Non disponibile',
  },

  // Marcatore salvato in testa alle note per riconoscere un walk-in senza
  // bisogno di una colonna dedicata sul database (che non c'è).
  WALKIN_MARK: '🚶',

  isWalkIn(booking) {
    return !!(booking && booking.notes && booking.notes.trim().startsWith(this.WALKIN_MARK));
  },

  SHAPES: {
    SQUARE: 'square',
    RECT:   'rect',
    ROUND:  'round',
  },

  SHAPE_LABELS: {
    square: 'Quadrato',
    rect:   'Rettangolare',
    round:  'Rotondo',
  },

  // Orientamento del tavolo: orizzontale/verticale hanno senso soprattutto
  // per i tavoli rettangolari, obliquo per un posizionamento ad angolo.
  ROTATIONS: {
    HORIZONTAL: 0,
    OBLIQUE:    45,
    VERTICAL:   90,
  },

  ROTATION_LABELS: {
    0:  'Orizzontale',
    45: 'Obliquo',
    90: 'Verticale',
  },

  DEFAULT_SHAPE: 'square',
  DEFAULT_ROTATION: 0,

  /**
   * Calcola lo stato di un singolo tavolo per una data/servizio, date le
   * prenotazioni già filtrate su quella data+servizio (non cancellate).
   */
  statusForTable(table, dateISO, serviceKey, bookings) {
    if (SharedTables.isBlocked(table, dateISO, serviceKey)) {
      return this.STATUS.BLOCKED;
    }
    const booking = bookings.find(b => {
      if (!b.tablesAssigned) return false;
      return b.tablesAssigned.split(',').map(t => t.trim()).includes(table);
    });
    if (!booking) return this.STATUS.FREE;
    if (this.isWalkIn(booking)) return this.STATUS.WALKIN;
    return this.STATUS.OCCUPIED;
  },

  /**
   * Accorcia un testo per farlo stare dentro la forma del tavolo (l'SVG non
   * va a capo da solo). Il rotondo ha meno spazio utile a parità di lato.
   */
  MAX_CHARS: { square: 18, rect: 27, round: 14 },

  truncateForShape(text, shape) {
    if (!text) return '';
    const max = this.MAX_CHARS[shape] || this.MAX_CHARS.square;
    const clean = String(text).trim();
    if (clean.length <= max) return clean;
    return clean.slice(0, Math.max(1, max - 1)) + '…';
  },

  /**
   * Ritorna { table, zone, status, booking, pos } per ogni tavolo di ogni
   * zona, pronto per il rendering. pos include sempre x/y/shape/rotation
   * (con i default applicati se il tavolo non è ancora stato posizionato).
   */
  buildLayoutData(dateISO, serviceKey) {
    const zones = SharedTables.getZones();
    const zt = SharedTables.getZoneTavoli();
    // Una prenotazione "Terminata" ha liberato il tavolo: non va considerata
    // occupante, così il tavolo torna disponibile per un nuovo walk-in.
    const bookings = Bookings.getByDateAndService(dateISO, serviceKey)
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW);

    return zones.map(zone => {
      const tables = (zt[zone] || []).map((table, i) => {
        const status = this.statusForTable(table, dateISO, serviceKey, bookings);
        // Tutte le prenotazioni su questo tavolo, non solo la prima — un
        // tavolo con doppio turno (confermato o provvisorio) ne ha più di
        // una. Si mostra sempre la più vicina nel tempo, le altre servono
        // solo per il segnale "va preparato per un secondo turno".
        const allOnTable = bookings.filter(b =>
          b.tablesAssigned && b.tablesAssigned.split(',').map(t => t.trim()).includes(table)
        ).sort((a, b) => a.time.localeCompare(b.time));
        const booking = allOnTable[0] || null;
        // Secondo turno: c'è un'altra prenotazione sullo stesso tavolo, e
        // non è un doppione/conflitto vero (altrimenti lo segnala già
        // l'allarme "tavolo doppio" — qui interessano solo quelli voluti).
        let secondTurn = null;
        if (allOnTable.length > 1) {
          const other = allOnTable[1];
          const confirmed = this._isTimeSeparated(booking, other);
          const provisional = Bookings.isProvisional(booking) || Bookings.isProvisional(other);
          if (confirmed || provisional) {
            secondTurn = { id: other.id, time: other.time, name: other.name, confirmed, people: (other.people || 0) + (other.highchairs || 0) };
          }
        }
        const saved = SharedTables.getPosition(zone, table);
        // Il salvataggio può contenere solo alcuni campi (es. solo "shape"
        // se il tavolo non è mai stato trascinato): riempi sempre i default
        // mancanti partendo dalla posizione a griglia, poi sovrascrivi con
        // quanto effettivamente salvato.
        const base = { ...this.defaultPosition(i), ...(saved || {}) };
        const pos = {
          x: base.x,
          y: base.y,
          shape: base.shape || this.DEFAULT_SHAPE,
          rotation: base.rotation || this.DEFAULT_ROTATION,
        };
        return { table, status, booking, secondTurn, pos };
      });
      return { zone, tables };
    });
  },

  /**
   * Posizione di default a griglia SOLO per il primo posizionamento
   * automatico di un tavolo mai spostato (così la piantina è subito
   * utilizzabile). Da lì in poi il tavolo si trascina liberamente,
   * senza vincoli: questa spaziatura non è più applicata dopo il primo
   * spostamento.
   */
  DEFAULT_SPACING: 208,
  COLS: 4,

  // Dimensione fissa del riquadro tavolo (lato per quadrato/rotondo) —
  // abbastanza grande da contenere nome tavolo + nome prenotazione + orario.
  TABLE_SIZE: 178,

  // Puntini di riferimento visivo nell'editor: solo una guida per l'occhio,
  // il trascinamento NON scatta su questa griglia.
  VISUAL_GRID: 24,

  defaultPosition(indexInZone) {
    const col = indexInZone % this.COLS;
    const row = Math.floor(indexInZone / this.COLS);
    return {
      x: col * this.DEFAULT_SPACING + this.DEFAULT_SPACING / 2 + 24,
      y: row * this.DEFAULT_SPACING + this.DEFAULT_SPACING / 2 + 24,
      shape: this.DEFAULT_SHAPE,
      rotation: this.DEFAULT_ROTATION,
    };
  },

  // Margine minimo tra l'uscita di un tavolo e l'ingresso del successivo,
  // usato anche per capire se un doppio turno è genuino o solo una scusa
  // — stesso valore usato nel form (populateFormTablePicker).
  TURNAROUND_MINUTES: 15,

  /**
   * Due prenotazioni sullo stesso tavolo sono "separate" (va bene, doppio
   * turno voluto) solo se una delle due dichiara un rilascio che libera in
   * tempo per l'altra, in un verso o nell'altro.
   */
  /**
   * Vero solo se il rilascio dichiarato (orario preciso) separa davvero le
   * due prenotazioni con margine — il calcolo matematico puro, che NON
   * conta il provvisorio (quello è un giudizio dello staff, non un
   * calcolo verificabile, e va tenuto visivamente distinto: anello pieno
   * per il primo, tratteggiato per il secondo).
   */
  _isTimeSeparated(a, b) {
    if (a.doubleShiftRelease && Slots.toMinutes(b.time) >= Slots.toMinutes(a.doubleShiftRelease) + this.TURNAROUND_MINUTES) return true;
    if (b.doubleShiftRelease && Slots.toMinutes(a.time) >= Slots.toMinutes(b.doubleShiftRelease) + this.TURNAROUND_MINUTES) return true;
    return false;
  },

  _bookingsAreSeparated(a, b) {
    if (this._isTimeSeparated(a, b)) return true;
    // Un doppio turno "provvisorio" (stima senza orario certo, vedi
    // "Aggiungi un turno dopo questo") è comunque voluto, non un conflitto
    // vero — non lo si può verificare matematicamente, ma lo staff lo ha
    // segnato apposta sapendo cosa fa.
    if (Bookings.isProvisional(a) || Bookings.isProvisional(b)) return true;
    return false;
  },

  /**
   * Trova doppie assegnazioni VERE sullo stesso tavolo per una data+servizio
   * — due prenotazioni distinte, stesso tavolo, senza nessun doppio turno
   * dichiarato che le separi. Tipico caso: due operatori diversi hanno
   * assegnato lo stesso tavolo nello stesso momento senza saperlo.
   */
  findConflicts(dateISO, serviceKey) {
    const bookings = Bookings.getByDateAndService(dateISO, serviceKey)
      .filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED && b.status !== STATUS.NOSHOW);

    const byTable = new Map();
    bookings.forEach(b => {
      if (!b.tablesAssigned) return;
      b.tablesAssigned.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
        if (!byTable.has(t)) byTable.set(t, []);
        byTable.get(t).push(b);
      });
    });

    const conflicts = [];
    byTable.forEach((list, table) => {
      if (list.length < 2) return;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (!this._bookingsAreSeparated(list[i], list[j])) {
            conflicts.push({ table, a: list[i], b: list[j] });
          }
        }
      }
    });
    return conflicts;
  },
};

window.Piantina = Piantina;
