/**
 * stats.js
 * Statistiche F&B calcolate sulle prenotazioni già in cache (Bookings),
 * su un intervallo di date. Nessun accesso a Supabase qui: solo
 * aggregazione pura, così non serve toccare lo schema del database —
 * tutto si ricava dai campi che già salviamo.
 */

const Stats = {
  /**
   * Prenotazioni nell'intervallo [fromISO, toISO] incluso.
   */
  filterRange(bookings, fromISO, toISO) {
    return bookings.filter(b => b.date >= fromISO && b.date <= toISO);
  },

  /**
   * Numeri di sintesi per il periodo: coperti, prenotazioni, persone medie,
   * no-show, cancellazioni, walk-in, richieste speciali.
   * Le archiviate sono escluse ovunque qui (rientrano solo nella sezione
   * Archivio dedicata) — "active" = non cancellate, tra le non archiviate.
   */
  summary(bookings) {
    const notArchived = bookings.filter(b => b.status !== STATUS.ARCHIVED);
    const total = notArchived.length;
    const active = notArchived.filter(b => b.status !== STATUS.CANCELLED);
    const noShows = notArchived.filter(b => b.status === STATUS.NOSHOW);
    const cancelled = notArchived.filter(b => b.status === STATUS.CANCELLED);
    const walkins = active.filter(b => Piantina.isWalkIn(b));
    const regularBookings = active.filter(b => !Piantina.isWalkIn(b));
    const walkinCovers = walkins.reduce((s, b) => s + (b.people || 0), 0);
    const regularCovers = regularBookings.reduce((s, b) => s + (b.people || 0), 0);
    const totalCovers = active.reduce((s, b) => s + (b.people || 0), 0);

    // Ritardi: arrivato più di 5 minuti dopo l'orario prenotato (stessa
    // soglia usata altrove in app per il badge "in ritardo")
    const arrivedBookings = active.filter(b => b.arrivedAt);
    const lateBookings = arrivedBookings.filter(b => {
      const arrivedMin = new Date(b.arrivedAt).getHours() * 60 + new Date(b.arrivedAt).getMinutes();
      return arrivedMin > Slots.toMinutes(b.time) + 5;
    });

    return {
      totalBookings: total,
      activeBookings: active.length,
      totalCovers,
      avgPartySize: active.length ? totalCovers / active.length : 0,
      noShowCount: noShows.length,
      noShowRate: total ? noShows.length / total : 0,
      cancelledCount: cancelled.length,
      cancelRate: total ? cancelled.length / total : 0,
      walkinCount: walkins.length,
      walkinRate: active.length ? walkins.length / active.length : 0,
      walkinCovers,
      regularCount: regularBookings.length,
      regularCovers,
      dogsCount: active.reduce((s, b) => s + (Number(b.dogs) || 0), 0),
      highchairsCount: active.reduce((s, b) => s + (Number(b.highchairs) || 0), 0),
      intolerancesCount: active.filter(b => b.intolerances).length,
      lateCount: lateBookings.length,
      lateRate: arrivedBookings.length ? lateBookings.length / arrivedBookings.length : 0,
    };
  },

  /**
   * Coperti per servizio (pranzo/cena).
   */
  byService(bookings) {
    const active = bookings.filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED);
    const result = { lunch: 0, dinner: 0 };
    active.forEach(b => { result[b.service] = (result[b.service] || 0) + (b.people || 0); });
    return result;
  },

  /**
   * Coperti per fascia oraria (orario esatto dello slot), ordinato per
   * orario — utile per capire quali slot si riempiono per primi.
   */
  byTimeSlot(bookings) {
    const active = bookings.filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED);
    // Raggruppa per fascia da 15 minuti (stessa unità degli slot di
    // prenotazione), non per orario esatto — altrimenti 19:07, 19:23, 19:44
    // finiscono ognuno per conto suo invece che raggrupparsi in modo leggibile.
    const step = (typeof Config !== 'undefined' && Config.load) ? (Config.load().slotDurationMinutes || 15) : 15;
    const map = new Map();
    active.forEach(b => {
      const bucketMinutes = Math.floor(Slots.toMinutes(b.time) / step) * step;
      const bucketLabel = Slots.toHHMM(bucketMinutes);
      const entry = map.get(bucketLabel) || { time: bucketLabel, covers: 0, count: 0 };
      entry.covers += (b.people || 0);
      entry.count += 1;
      map.set(bucketLabel, entry);
    });
    return Array.from(map.values()).sort((a, b) => a.time.localeCompare(b.time));
  },

  /**
   * Coperti per giorno della settimana (0=domenica...6=sabato).
   */
  byWeekday(bookings) {
    const active = bookings.filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED);
    const labels = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const result = labels.map(label => ({ label, covers: 0, count: 0 }));
    active.forEach(b => {
      const day = Utils.isoToDate(b.date).getDay();
      result[day].covers += (b.people || 0);
      result[day].count += 1;
    });
    return result;
  },

  /**
   * Clienti abituali: raggruppa per telefono (se presente), ordina per
   * numero di visite. Utile per riconoscere chi torna spesso.
   */
  topCustomers(bookings, limit) {
    limit = limit || 10;
    const active = bookings.filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED && b.phone && b.phone.trim());
    const map = new Map();
    active.forEach(b => {
      const key = b.phone.trim();
      const entry = map.get(key) || { phone: key, name: b.name, visits: 0, covers: 0 };
      entry.visits += 1;
      entry.covers += (b.people || 0);
      // Tieni il nome più recente (utile se è cambiato/corretto nel tempo)
      entry.name = b.name || entry.name;
      map.set(key, entry);
    });
    return Array.from(map.values())
      .filter(c => c.visits > 1)
      .sort((a, b) => b.visits - a.visits)
      .slice(0, limit);
  },

  /**
   * Frequenza d'uso di ogni singolo tavolo (utile per capire quali tavoli
   * sono i più richiesti/sfruttati).
   */
  tableUsage(bookings) {
    const active = bookings.filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED);
    const map = new Map();
    active.forEach(b => {
      if (!b.tablesAssigned) return;
      b.tablesAssigned.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
        map.set(t, (map.get(t) || 0) + 1);
      });
    });
    return Array.from(map.entries())
      .map(([table, count]) => ({ table, count }))
      .sort((a, b) => b.count - a.count);
  },

  /**
   * Ricambi tavolo: quante volte, nella STESSA data+servizio, un tavolo è
   * stato riassegnato a una seconda (o terza...) prenotazione distinta —
   * es. un tavolo si libera e viene rivenduto a un nuovo walk-in.
   * Non serve nessun marcatore dedicato: due prenotazioni diverse (non
   * cancellate/archiviate) sullo stesso tavolo, stesso giorno e servizio,
   * SONO per definizione un ricambio — lo si ricava dai dati già salvati.
   */
  tableTurnovers(bookings) {
    const active = bookings.filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED);
    // Chiave: data|servizio|tavolo → Set di id prenotazione distinti
    const map = new Map();
    active.forEach(b => {
      if (!b.tablesAssigned) return;
      b.tablesAssigned.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
        const key = b.date + '|' + b.service + '|' + t;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(b.id);
      });
    });

    let totalTurnovers = 0;
    const perTable = new Map(); // tavolo → numero di ricambi (sommati su tutto il periodo)
    map.forEach((idSet, key) => {
      const extra = idSet.size - 1; // la prima prenotazione è uso normale, dalla seconda in poi è un ricambio
      if (extra <= 0) return;
      totalTurnovers += extra;
      const table = key.split('|')[2];
      perTable.set(table, (perTable.get(table) || 0) + extra);
    });

    return {
      total: totalTurnovers,
      byTable: Array.from(perTable.entries())
        .map(([table, count]) => ({ table, count }))
        .sort((a, b) => b.count - a.count),
    };
  },

  /**
   * Pagamenti registrati manualmente nel periodo (es. tavoli "amico" pagati
   * in contanti). Non sostituisce la cassa reale — è un promemoria/riscontro
   * di quanto lo staff ha dichiarato di aver incassato per quei tavoli.
   */
  paymentsSummary(bookings) {
    const active = bookings.filter(b => b.status !== STATUS.CANCELLED && b.status !== STATUS.ARCHIVED);
    let total = 0;
    const byMethod = {};
    const entries = [];
    active.forEach(b => {
      const { payment } = Bookings.splitNotes(b.notes);
      if (!payment) return;
      total += payment.amount;
      byMethod[payment.method] = (byMethod[payment.method] || 0) + payment.amount;
      entries.push({ name: b.name, date: b.date, time: b.time, amount: payment.amount, method: payment.method });
    });
    entries.sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
    return { total, byMethod, entries };
  },
};

window.Stats = Stats;
