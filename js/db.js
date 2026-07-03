/**
 * db.js
 * Comunicazione con Supabase. Niente setup utente — solo due password
 * hardcoded: una per leggere, una per modificare.
 * La tabella "prenotazioni" è pubblica (RLS disabilitato).
 */

const SUPABASE_URL = 'https://shdzchwhymajnqhocirp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoZHpjaHdoeW1ham5xaG9jaXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMTkyNDAsImV4cCI6MjA5ODU5NTI0MH0.CuzNfi7epkK70zHgN4qxp1BmTsZhow_xVFLmtN04Ydxo';
const API_URL = `${SUPABASE_URL}/rest/v1/prenotazioni`;

const PASSWORD_READ  = 'Ristorante2026';
const PASSWORD_ADMIN = 'RistoranteTchappe26';

const DB = {
  // 'none' | 'read' | 'admin'
  _role: 'none',

  getRole() { return this._role; },
  isLoggedIn() { return this._role !== 'none'; },
  canEdit() { return this._role === 'admin'; },

  login(password) {
    if (password === PASSWORD_ADMIN) { this._role = 'admin'; Storage.set('role', 'admin'); return 'admin'; }
    if (password === PASSWORD_READ)  { this._role = 'read';  Storage.set('role', 'read');  return 'read'; }
    return null;
  },

  logout() {
    this._role = 'none';
    Storage.remove('role');
  },

  restoreSession() {
    const saved = Storage.get('role', 'none');
    if (saved === 'admin' || saved === 'read') { this._role = saved; return true; }
    return false;
  },

  _headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=representation',
    };
  },

  /**
   * Legge tutte le prenotazioni ordinate per data e ora.
   */
  async fetchAll() {
    try {
      const res = await fetch(`${API_URL}?order=date.asc,time.asc`, {
        headers: this._headers(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('fetchAll fallito:', err.message);
      return Storage.get('bookingsCache', []);
    }
  },

  /**
   * Crea una nuova prenotazione.
   */
  async create(booking) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(booking),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  },

  /**
   * Aggiorna una prenotazione esistente per ID.
   */
  async update(id, patch) {
    const res = await fetch(`${API_URL}?id=eq.${id}`, {
      method: 'PATCH',
      headers: this._headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  },

  /**
   * Cancella una prenotazione per ID.
   */
  async remove(id) {
    const res = await fetch(`${API_URL}?id=eq.${id}`, {
      method: 'DELETE',
      headers: this._headers(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  },
};

window.DB = DB;
