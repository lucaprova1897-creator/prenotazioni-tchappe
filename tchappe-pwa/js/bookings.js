const STATUS = {
  CONFIRMED: 'confirmed',
  ARRIVED:   'arrived',
  SEATED:    'seated',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NOSHOW:    'noshow',
};

const STATUS_LABELS = {
  confirmed: 'Confermata',
  arrived:   'Arrivati',
  seated:    'Seduti',
  completed: 'Terminata',
  cancelled: 'Cancellata',
  noshow:    'No Show',
};

const ZONE_LABELS = {
  indoor:  'Interno',
  outdoor: 'Esterno',
  any:     'Indifferente',
};

const Bookings = {
  _cache: [],

  getCached() { return this._cache; },

  getById(id) { return this._cache.find(b => b.id === id) || null; },

  getByDateAndService(dateISO, serviceKey) {
    return this._cache
      .filter(b => b.date === dateISO && b.service === serviceKey)
      .sort((a, b) => a.time.localeCompare(b.time));
  },

  search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this._cache
      .filter(b =>
        b.name.toLowerCase().includes(q) ||
        (b.phone || '').toLowerCase().includes(q) ||
        b.date.includes(q)
      )
      .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  },

  getStatsForDateAndService(dateISO, serviceKey) {
    const list = this.getByDateAndService(dateISO, serviceKey)
      .filter(b => b.status !== STATUS.CANCELLED);
    return {
      totalGuests: list.reduce((s, b) => s + b.people, 0),
      totalTablesBooked: list.length,
    };
  },

  /**
   * Carica tutte le prenotazioni da Supabase e aggiorna la cache.
   */
  async loadAll() {
    const data = await DB.fetchAll();
    this._cache = data;
    Storage.set('bookingsCache', data);
    return data;
  },

  /**
   * Crea una nuova prenotazione su Supabase.
   */
  async create(data) {
    const doubleShift = Slots.getDoubleShiftInfo(data.service, data.date, data.time);
    const booking = {
      name:         data.name?.trim() || '',
      phone:        data.phone?.trim() || '',
      people:       Number(data.people) || 1,
      date:         data.date,
      time:         data.time,
      service:      data.service,
      zone:         data.zone || 'any',
      dogs:         Number(data.dogs) || 0,
      intolerances: data.intolerances?.trim() || '',
      special_needs: data.specialNeeds?.trim() || '',
      notes:        data.notes?.trim() || '',
      status:       data.status || STATUS.CONFIRMED,
      double_shift_release: doubleShift?.releaseTime || null,
      is_new:       true,
    };

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
    const doubleShift = Slots.getDoubleShiftInfo(data.service, data.date, data.time);
    const patch = {
      name:         data.name?.trim() || '',
      phone:        data.phone?.trim() || '',
      people:       Number(data.people) || 1,
      date:         data.date,
      time:         data.time,
      service:      data.service,
      zone:         data.zone || 'any',
      dogs:         Number(data.dogs) || 0,
      intolerances: data.intolerances?.trim() || '',
      special_needs: data.specialNeeds?.trim() || '',
      notes:        data.notes?.trim() || '',
      status:       data.status || STATUS.CONFIRMED,
      double_shift_release: doubleShift?.releaseTime || null,
    };

    const updated = await DB.update(id, patch);
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = this._normalize(updated);
      Storage.set('bookingsCache', this._cache);
    }
    return updated;
  },

  async remove(id) {
    await DB.remove(id);
    this._cache = this._cache.filter(b => b.id !== id);
    Storage.set('bookingsCache', this._cache);
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
  _normalize(b) {
    return {
      ...b,
      specialNeeds: b.special_needs || '',
      doubleShift:  b.double_shift_release ? { releaseTime: b.double_shift_release } : null,
      isNew:        b.is_new,
    };
  },
};

window.STATUS       = STATUS;
window.STATUS_LABELS = STATUS_LABELS;
window.ZONE_LABELS  = ZONE_LABELS;
window.Bookings     = Bookings;
