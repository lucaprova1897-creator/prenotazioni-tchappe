/**
 * buoni.js
 * Gestione buoni regalo — tabella buoni_regalo su Supabase.
 */

const BUONI_URL = `${SUPABASE_URL}/rest/v1/buoni_regalo`;

const Buoni = {
  _cache: [],

  /**
   * Testi del buono nelle tre lingue — italiano di base, più inglese e
   * francese (quest'ultimo era il riferimento di stile che avevi mandato).
   */
  I18N: {
    it: {
      restaurant: 'Lou Tchappé', place: 'Ristorante · Cogne',
      title: 'Buono Regalo', freeValue: 'Valore libero',
      people: (n) => 'Per ' + n + (n === 1 ? ' persona' : ' persone'),
      recipient: 'Intestato a', validUntil: 'Valido fino al',
      voucherNo: 'Buono n.', issued: 'Emesso il',
    },
    en: {
      restaurant: 'Lou Tchappé', place: 'Restaurant · Cogne',
      title: 'Gift Voucher', freeValue: 'Open value',
      people: (n) => 'For ' + n + (n === 1 ? ' person' : ' people'),
      recipient: 'Issued to', validUntil: 'Valid until',
      voucherNo: 'Voucher no.', issued: 'Issued on',
    },
    fr: {
      restaurant: 'Lou Tchappé', place: 'Restaurant · Cogne',
      title: 'Bon Cadeau', freeValue: 'Valeur libre',
      people: (n) => 'Pour ' + n + (n === 1 ? ' personne' : ' personnes'),
      recipient: 'Offert à', validUntil: 'Valable jusqu\'au',
      voucherNo: 'Bon n.', issued: 'Émis le',
    },
  },

  getCached() { return this._cache; },

  /**
   * Prossimo codice disponibile in automatico, formato BC-ANNO-NNN (es.
   * BC-2026-003) — trova il numero più alto già usato per l'anno corrente
   * e propone il successivo. Resta comunque modificabile a mano nel form,
   * per i casi in cui serva un formato diverso.
   */
  nextCode() {
    const year = new Date().getFullYear();
    const prefix = 'BC-' + year + '-';
    let maxN = 0;
    this._cache.forEach(b => {
      if (b.codice && b.codice.startsWith(prefix)) {
        const n = parseInt(b.codice.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    });
    return prefix + String(maxN + 1).padStart(3, '0');
  },

  async loadAll() {
    try {
      const url = `${BUONI_URL}?order=created_at.desc&apikey=${SUPABASE_ANON_KEY}`;
      const res = await fetch(url, { headers: DB._headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._cache = Array.isArray(data) ? data : [];
      return this._cache;
    } catch (err) {
      console.warn('Buoni.loadAll fallito:', err.message);
      return this._cache;
    }
  },

  async create(data) {
    const buono = {
      codice:    data.codice.trim().toUpperCase(),
      contenuto: data.contenuto?.trim() || '',
      persone:   data.persone || null,
      valore:    data.valore ? Number(data.valore) : null,
      nome:      data.nome?.trim() || '',
      telefono:  data.telefono?.trim() || '',
      scadenza:  data.scadenza || null,
      note:      data.note?.trim() || '',
      usato:     false,
      usato_il:  null,
    };
    const url = `${BUONI_URL}?apikey=${SUPABASE_ANON_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: DB._headers(),
      body: JSON.stringify(buono),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 409 || (err.code === '23505')) throw new Error('DUPLICATE');
      throw new Error(`HTTP ${res.status}`);
    }
    const result = await res.json();
    const created = Array.isArray(result) ? result[0] : result;
    if (created) this._cache.unshift(created);
    return created;
  },

  async markUsed(id, used) {
    const patch = {
      usato:    used,
      usato_il: used ? new Date().toISOString() : null,
    };
    const url = `${BUONI_URL}?id=eq.${id}&apikey=${SUPABASE_ANON_KEY}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: DB._headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    const updated = Array.isArray(result) ? result[0] : result;
    if (updated) {
      const idx = this._cache.findIndex(b => b.id === id);
      if (idx !== -1) this._cache[idx] = updated;
    }
    return updated;
  },

  async remove(id) {
    const url = `${BUONI_URL}?id=eq.${id}&apikey=${SUPABASE_ANON_KEY}`;
    const res = await fetch(url, { method: 'DELETE', headers: DB._headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this._cache = this._cache.filter(b => b.id !== id);
    return true;
  },

  search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return this._cache;
    return this._cache.filter(b =>
      b.codice.toLowerCase().includes(q) ||
      b.nome.toLowerCase().includes(q) ||
      (b.telefono || '').toLowerCase().includes(q)
    );
  },

  // Codice non viene più generato automaticamente - campo libero
};

window.Buoni = Buoni;
