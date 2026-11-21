/**
 * slots.js
 * Motore di calcolo degli slot orari: genera gli slot di un servizio,
 * calcola quanti sono occupati, suggerisce il prossimo slot libero,
 * e gestisce la logica del doppio turno.
 *
 * Tutte le funzioni sono pure (non toccano lo storage) per restare
 * facilmente testabili ed espandibili (es. in futuro: occupazione tavoli
 * reale invece di un semplice contatore).
 */

const Slots = {
  /**
   * Converte "HH:MM" in minuti dalla mezzanotte.
   */
  toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  },

  /**
   * Converte minuti dalla mezzanotte in "HH:MM".
   */
  toHHMM(totalMinutes) {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  /**
   * Arrotonda un orario allo slot più vicino (default: durata slot da
   * configurazione, es. 15 minuti) — usato per i walk-in: chi arriva alle
   * 19:02 viene registrato come 19:00, chi arriva alle 14:10 come 14:15.
   * Senza, le statistiche di affluenza avrebbero un orario diverso per
   * ogni singolo arrivo invece di raggrupparsi per fascia.
   */
  roundToNearestSlot(time, stepMinutes) {
    const step = stepMinutes || Config.load().slotDurationMinutes || 15;
    const minutes = this.toMinutes(time);
    const rounded = Math.round(minutes / step) * step;
    return this.toHHMM(rounded);
  },

  /**
   * Genera la lista di tutti gli slot orari ("HH:MM") di un servizio,
   * dato lo step in minuti. L'ultimo slot generato è tale che lo slot
   * stesso inizi prima della chiusura (non genera uno slot esattamente = end).
   */
  generateSlotsForService(serviceKey) {
    const cfg = Config.load();
    const service = cfg.services[serviceKey];
    if (!service) return [];

    const start = this.toMinutes(service.start);
    const end = this.toMinutes(service.end);
    const step = cfg.slotDurationMinutes;

    const slots = [];
    for (let t = start; t < end; t += step) {
      slots.push(this.toHHMM(t));
    }
    return slots;
  },

  /**
   * Calcola, per ogni slot di un servizio in una data, quante prenotazioni
   * attive (non cancellate) occupano quello slot.
   * Ritorna una mappa { "19:00": 2, "19:15": 3, ... }
   */
  countBookingsPerSlot(serviceKey, dateISO, bookings) {
    const counts = {};
    for (const slot of this.generateSlotsForService(serviceKey)) {
      counts[slot] = 0;
    }
    for (const b of bookings) {
      if (b.date !== dateISO) continue;
      if (b.service !== serviceKey) continue;
      if (b.status === 'cancelled' || b.status === 'archived' || b.status === 'completed') continue;
      if (counts[b.time] !== undefined) {
        counts[b.time] += 1;
      }
    }
    return counts;
  },

  /**
   * Ritorna true se lo slot indicato ha ancora posto libero.
   */
  isSlotAvailable(serviceKey, dateISO, time, bookings) {
    const cfg = Config.load();
    const counts = this.countBookingsPerSlot(serviceKey, dateISO, bookings);
    return (counts[time] ?? 0) < cfg.maxBookingsPerSlot;
  },

  /**
   * Dato uno slot pieno, trova il prossimo slot libero dello stesso servizio,
   * cercando in avanti nel tempo. Ritorna null se non ce ne sono (servizio finito).
   */
  findNextAvailableSlot(serviceKey, dateISO, fromTime, bookings) {
    const allSlots = this.generateSlotsForService(serviceKey);
    const counts = this.countBookingsPerSlot(serviceKey, dateISO, bookings);
    const cfg = Config.load();
    const fromMinutes = this.toMinutes(fromTime);

    for (const slot of allSlots) {
      if (this.toMinutes(slot) < fromMinutes) continue;
      if ((counts[slot] ?? 0) < cfg.maxBookingsPerSlot) {
        return slot;
      }
    }
    return null;
  },

  /**
   * Ritorna la lista di slot liberi a partire da un certo orario (incluso),
   * utile per mostrare alternative multiple all'utente.
   */
  findAvailableSlotsFrom(serviceKey, dateISO, fromTime, bookings, limit = 5) {
    const allSlots = this.generateSlotsForService(serviceKey);
    const counts = this.countBookingsPerSlot(serviceKey, dateISO, bookings);
    const cfg = Config.load();
    const fromMinutes = this.toMinutes(fromTime);
    const result = [];

    for (const slot of allSlots) {
      if (this.toMinutes(slot) < fromMinutes) continue;
      if ((counts[slot] ?? 0) < cfg.maxBookingsPerSlot) {
        result.push(slot);
        if (result.length >= limit) break;
      }
    }
    return result;
  },
};

window.Slots = Slots;
