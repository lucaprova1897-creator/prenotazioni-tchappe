/**
 * db.js
 * Comunicazione con Supabase. Login a password, tre livelli di fiducia:
 * - "read": solo lettura
 * - "staff": lavoro operativo (prenotazioni, tavoli, walk-in) ma niente
 *   Impostazioni/Statistiche/Buoni e niente cancellazione permanente
 * - "admin": accesso completo (solo Luca e Davy)
 * La tabella "prenotazioni" è pubblica (RLS disabilitato).
 */

const SUPABASE_URL = 'https://shdzchwhymajnqhocirp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mGeU1ZJTZytOTxuXln9wKQ_KK_zOjKG';
const API_URL = `${SUPABASE_URL}/rest/v1/prenotazioni`;

// Login e gestione accessi passano TUTTI dalla Edge Function "accesso":
// PIN e password non sono più scritti né nel codice né nella
// configurazione condivisa — stanno cifrati sul server. Vedi
// supabase/functions/accesso e supabase/fase1_accessi_privati.sql.
const ACCESSO_URL = `${SUPABASE_URL}/functions/v1/accesso`;

const SESSION_VERSION = 'v5'; // v5 = login lato server (tutti rientrano una volta)

const DB = {
  _role: 'none', // 'none' | 'read' | 'staff' | 'admin'
  _operator: null, // nome operatore attuale (null finché non scelto, per l'accesso condiviso)
  _loginMethod: 'personal', // 'shared' | 'personal' — solo per sapere quando chiedere l'etichetta dispositivo
  // "Sblocco" temporaneo con PIN di Luca/Davy: non cambia chi sei (resti
  // te stesso per la tracciabilità), ma per il resto di questa sessione
  // sblocchi le sezioni riservate — si azzera al logout o ricaricando
  // l'app, non resta sbloccato per sempre su un dispositivo condiviso.
  _elevated: false,

  getRole() { return this._role; },
  isLoggedIn() { return this._role !== 'none'; },
  // Lavoro operativo (prenotazioni, tavoli, walk-in): admin e staff
  canEdit() { return this._role === 'admin' || this._role === 'staff' || this._isHeadChef === true; },
  // Chef "principale" — resta in sola lettura per lo SCHERMO (role
  // 'read', stessa vista di sempre), ma con i poteri di canEdit() dentro
  // quella vista: aggiungere prenotazioni, modificare eventi, gestire
  // tutti i PIN. Diverso da isFullAdmin(): non dà accesso a Impostazioni/
  // Statistiche, solo alle azioni specifiche sbloccate dentro la vista
  // chef.
  isHeadChef() { return this._role === 'read' && this._isHeadChef === true; },
  // Un "cuoco": profilo della lista chef SENZA la stella di chef principale.
  // Vede tutto ma non modifica nulla di quello che decide lo chef.
  isCook() { return this._role === 'read' && this._isHeadChef !== true; },
  /**
   * Proposte del giorno, menu operai, mezza pensione — solo admin o chef
   * PRINCIPALE. Un cuoco (profilo chef senza stella) è sola lettura, come
   * un dipendente di sala con PIN personale. Il tablet condiviso in sala è
   * ANCH'ESSO sola lettura di default — a meno che non abbia appena
   * sbloccato la modifica col codice apposito (vedi DB.unlockTabletEdit),
   * che vale solo per questa sessione, si richiede di nuovo dopo un ricarica.
   */
  canManageDailySpecials() {
    if (this._role === 'admin' || this.isHeadChef()) return true;
    if (this._role === 'staff' && this._loginMethod === 'shared' && this._tabletEditUnlocked === true) return true;
    return false;
  },

  // Vero solo per il tablet condiviso (mai per un PIN personale, non ha
  // senso lì) — indica se ha appena sbloccato la modifica ai tre menu col
  // codice giusto. Mai persistito: un ricarica della pagina lo richiede
  // di nuovo, apposta, per sicurezza.
  isTabletEditUnlocked() { return this._tabletEditUnlocked === true; },

  unlockTabletEdit(code) {
    if (this._role !== 'staff' || this._loginMethod !== 'shared') return false;
    if (typeof SharedTables === 'undefined') return false;
    const real = SharedTables.getTabletEditCode ? SharedTables.getTabletEditCode() : null;
    if (!real || code !== real) return false;
    this._tabletEditUnlocked = true;
    return true;
  },

  // Impostazioni strutturali, Statistiche, PIN dipendenti: admin, oppure
  // chiunque abbia sbloccato temporaneamente col PIN di Luca/Davy.
  isFullAdmin() { return this._role === 'admin' || this._elevated; },
  // True solo per un vero accesso admin (Luca/Davy loggati come tali) —
  // usato dove serve distinguere "è davvero admin" da "ha solo sbloccato".
  isRealAdmin() { return this._role === 'admin'; },
  /**
   * Prova a sbloccare le sezioni riservate con un PIN amministratore,
   * senza cambiare la sessione attuale (chi ha fatto cosa resta tracciato
   * come la persona vera, non come "Luca" o "Davy"). Solo i PIN gestiti
   * da Impostazioni — nessuna password fissa scritta nel codice.
   */
  async elevate(password) {
    const r = await this.accesso('eleva', { pin: String(password || '') });
    if (r && r.ok) {
      this._elevated = true;
      return true;
    }
    return false;
  },
  getOperator() { return this._operator || ''; },
  // True se è un accesso staff condiviso che deve ancora scegliere "chi sei"
  needsOperatorPick() { return this._role === 'staff' && !this._operator; },

  // Etichetta del dispositivo fisico (es. "Tablet Ingresso"), salvata nel
  // browser di quel dispositivo — indipendente da chi si logga, così un
  // comando risulta "dal tablet" anche se un giorno ci si logga con una
  // password personale invece di quella condivisa.
  getDeviceLabel() { return Storage.get('deviceLabel', null); },
  setDeviceLabel(label) { Storage.set('deviceLabel', label ? label.trim() : null); },
  // Chiede l'etichetta solo la prima volta che si usa la password condivisa
  // su un dispositivo che non ne ha ancora una — non infastidisce i
  // cellulari personali di Luca/Davy/Andrea con login proprio.
  needsDeviceLabel() {
    return this._role === 'staff' && this._loginMethod === 'shared' && !this.getDeviceLabel();
  },
  // Nome operatore + etichetta dispositivo insieme, per la tracciabilità
  // (es. "Marco (Tablet Ingresso)"). Usare questo ovunque si registra
  // "chi ha fatto cosa", invece del solo getOperator().
  getOperatorWithDevice() {
    const op = this.getOperator();
    const device = this.getDeviceLabel();
    if (!op) return device || '';
    return device ? op + ' (' + device + ')' : op;
  },

  _persistSession() {
    Storage.set('role', this._role);
    Storage.set('loginMethod', this._loginMethod);
    if (this._operator) Storage.set('operator', this._operator); else Storage.remove('operator');
    // Solo per i PIN personali (admin/dipendenti) — serve a poter
    // verificare più avanti che quel PIN esista ancora, per buttare fuori
    // chi si vede eliminare il proprio profilo da Impostazioni. La
    // password condivisa del tablet e quella dello chef non hanno un
    // "profilo" da eliminare, quindi non c'è nulla da salvare per loro.
    // Il PIN NON si salva più sul dispositivo (prima sì, in chiaro): al
    // suo posto c'è la sessione rilasciata dal server.
    Storage.remove('loginPin');
    if (this._sess) Storage.set('authSession', this._sess); else Storage.remove('authSession');
    if (this._accessoId) Storage.set('accessoId', this._accessoId); else Storage.remove('accessoId');
    if (this._isHeadChef) Storage.set('isHeadChef', '1'); else Storage.remove('isHeadChef');
    // Orario di QUESTO login vero — usato solo per "Butta fuori tutti"
    // (vedi checkStillAuthorized/restoreSession): un reset totale confronta
    // questo orario con quello dell'ultimo "butta fuori tutti" fatto da un
    // admin, indipendentemente da chi si è collegato o con quale metodo.
    Storage.set('sessionStartedAt', new Date().toISOString());
    Storage.set('sessionVersion', SESSION_VERSION);
  },

  /**
   * Identificativo stabile di QUESTO dispositivo (non della persona) —
   * generato una volta sola e salvato nel browser, serve a distinguere
   * "sto rientrando io da qui" da "qualcun altro sta usando lo stesso PIN
   * da un altro telefono".
   */
  _getDeviceId() {
    let id = Storage.get('deviceId', null);
    if (!id) {
      id = 'device_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      Storage.set('deviceId', id);
    }
    return id;
  },

  // Ultimo errore di login da mostrare (password errata, troppi
  // tentativi, profilo sospeso, niente connessione...)
  _lastLoginError: null,

  async login(password) {
    this._lastLoginError = null;
    // La configurazione condivisa serve ancora per "butta fuori" ecc.
    if (typeof SharedTables !== 'undefined' && SharedTables.load) {
      try { await SharedTables.load(); } catch (e) { /* offline */ }
    }
    let res, data;
    try {
      res = await DB._rawFetch(ACCESSO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ azione: 'login', segreto: String(password || ''), dispositivo: this._getDeviceId() }),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      this._lastLoginError = 'Serve la connessione a internet per entrare.';
      return null;
    }
    if (!res.ok || !data || !data.sessione || !data.profilo) {
      this._lastLoginError = (data && data.errore) || 'Password non corretta.';
      return null;
    }
    const p = data.profilo;
    this._sess = data.sessione;
    this._authOk = true;
    this._accessoId = p.id;
    this._role = p.ruolo; // 'admin' | 'staff' | 'read'
    this._operator = p.nome || null; // null = tablet condiviso: si sceglie "chi sei"
    this._loginMethod = p.metodo; // 'personal' | 'shared'
    this._isHeadChef = !!p.capo_chef;
    this._elevated = false;
    this._persistSession();
    this._onSessionChanged();
    if (this._operator && typeof SharedTables !== 'undefined' && SharedTables.clearKick) SharedTables.clearKick(this._operator);
    if (typeof SharedTables !== 'undefined' && SharedTables.loadAccessi) SharedTables.loadAccessi().catch(() => {});
    return this._role;
  },

  /**
   * Imposta/cambia "chi sono adesso" senza richiedere una nuova password —
   * pensato per il tablet condiviso che passa di mano più volte a servizio.
   */
  setOperator(name) {
    this._operator = name || null;
    if (this._operator) {
      Storage.set('operator', this._operator);
      // Scegliere "chi sei" dal tablet condiviso è comunque un rientro
      // deliberato — cancella un'eventuale espulsione pendente per quel
      // nome, stesso principio del login vero.
      if (typeof SharedTables !== 'undefined' && SharedTables.clearKick) SharedTables.clearKick(this._operator);
    } else {
      Storage.remove('operator');
    }
  },

  async logout() {
    const sess = this._sess;
    this._sess = null;
    this._authOk = null;
    this._accessoId = null;
    this._role = 'none';
    this._operator = null;
    this._elevated = false;
    this._loginPin = null;
    this._isHeadChef = false;
    Storage.remove('authSession');
    Storage.remove('accessoId');
    if (sess && sess.access_token) {
      // chiude la sessione anche sul server (se c'è rete; altrimenti scade da sola)
      DB._rawFetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + sess.access_token },
      }).catch(() => {});
    }
    Storage.remove('role');
    Storage.remove('operator');
    Storage.remove('loginPin');
    Storage.remove('isHeadChef');
  },

  restoreSession() {
    const savedVersion = Storage.get('sessionVersion', null);
    if (savedVersion !== SESSION_VERSION) {
      // Versione sessione non valida — forza logout
      Storage.remove('role');
      Storage.remove('operator');
      Storage.set('sessionVersion', SESSION_VERSION);
      return false;
    }
    const saved = Storage.get('role', 'none');
    const savedSess = Storage.get('authSession', null);
    if (!savedSess || !savedSess.refresh_token) return false;
    if (saved === 'admin' || saved === 'read' || saved === 'staff') {
      const savedOperator = Storage.get('operator', null);
      // Stesso controllo di checkStillAuthorized, ma qui PRIMA ancora di
      // mostrare qualcosa — "butta fuori tutti" non deve mai lasciar
      // rientrare in automatico nessuno, qualunque sia il suo ruolo o
      // profilo (anche uno ormai eliminato del tutto).
      const globalKickAt = typeof SharedTables !== 'undefined' && SharedTables.getGlobalKickAt ? SharedTables.getGlobalKickAt() : null;
      if (globalKickAt) {
        const sessionStartedAt = Storage.get('sessionStartedAt', null);
        if (!sessionStartedAt || sessionStartedAt < globalKickAt) {
          Storage.remove('role');
          Storage.remove('operator');
          Storage.remove('loginPin');
          return false;
        }
      }
      // Anche il ripristino silenzioso della sessione (senza reinserire
      // credenziali) controlla l'espulsione — altrimenti chi è stato
      // buttato fuori rientrerebbe da solo al prossimo avvio dell'app,
      // vanificando l'espulsione. Usa la copia già in cache (potrebbe non
      // essere freschissima), il controllo periodico che segue copre
      // comunque qualunque espulsione più recente.
      if (savedOperator && typeof SharedTables !== 'undefined' && SharedTables.getKickList) {
        const kicked = SharedTables.getKickList().some(k => k.name === savedOperator);
        if (kicked) {
          Storage.remove('role');
          Storage.remove('operator');
          Storage.remove('loginPin');
          return false;
        }
      }
      this._role = saved;
      this._operator = savedOperator;
      this._loginMethod = Storage.get('loginMethod', 'personal');
      this._loginPin = null;
      Storage.remove('loginPin');
      this._sess = savedSess;
      this._accessoId = Storage.get('accessoId', null);
      this._isHeadChef = Storage.get('isHeadChef', null) === '1';
      // Il profilo può essere cambiato mentre l'app era chiusa (stella
      // tolta o data, sospeso...): lo verifica il server subito dopo
      // (refreshAuthState), e se serve fa rientrare.
      this._onSessionChanged();
      return true;
    }
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
  /**
   * Scarica TUTTE le prenotazioni, non fidandosi del limite di righe che
   * Supabase applica di default a ogni singola richiesta (spesso 1000) —
   * con l'ordinamento per data crescente, superato quel limite le
   * prenotazioni più lontane nel tempo (spesso quelle future, es. un
   * evento prenotato con mesi di anticipo) sparirebbero silenziosamente
   * dall'app pur restando regolarmente presenti nel database. Continua a
   * chiedere pagine da 1000 finché non arriva una pagina più corta piena,
   * segno che non ce n'è più.
   */
  async fetchAll() {
    try {
      const pageSize = 1000;
      let allData = [];
      let offset = 0;
      let guard = 0; // rete di sicurezza: mai più di 50 pagine (50.000 righe)
      while (guard < 50) {
        guard++;
        const url = `${API_URL}?order=date.asc,time.asc&apikey=${SUPABASE_ANON_KEY}&limit=${pageSize}&offset=${offset}`;
        const res = await fetch(url, {
          headers: this._headers(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const page = await res.json();
        if (!Array.isArray(page)) break;
        allData = allData.concat(page);
        if (page.length < pageSize) break; // ultima pagina raggiunta
        offset += pageSize;
      }
      return allData;
    } catch (err) {
      console.warn('fetchAll fallito:', err.message);
      return null;
    }
  },

  /**
   * Crea una nuova prenotazione — stampa da sola quale dispositivo l'ha
   * fatta, così la Edge Function può escludere QUELLO stesso dispositivo
   * dalla notifica: chi ha appena fatto l'azione non ha bisogno che
   * qualcuno gliela segnali di nuovo.
   */
  async create(booking) {
    const res = await fetch(`${API_URL}?apikey=${SUPABASE_ANON_KEY}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ ...booking, last_device_id: this._getDeviceId() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  },

  /**
   * Aggiorna una prenotazione esistente per ID — stessa logica di create:
   * marca da sola chi ha fatto la modifica.
   */
  async update(id, patch) {
    const res = await fetch(`${API_URL}?id=eq.${id}`, {
      method: 'PATCH',
      headers: this._headers(),
      body: JSON.stringify({ ...patch, last_device_id: this._getDeviceId() }),
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

// URL configurazione condivisa
const CONFIG_SHARED_URL = `${SUPABASE_URL}/rest/v1/configurazione`;

DB.fetchSharedConfig = async function() {
  try {
    const url = `${CONFIG_SHARED_URL}?id=eq.main&apikey=${SUPABASE_ANON_KEY}`;
    const res = await fetch(url, { headers: this._headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch (err) {
    console.warn('fetchSharedConfig fallito:', err.message);
    return null;
  }
};

// Contatore di salvataggi condivisi ancora in corso (in rete, non ancora
// arrivati a destinazione) — SharedTables.load() lo controlla prima di
// sovrascrivere i dati locali con quello che trova sul server: se c'è un
// salvataggio ancora in volo, quello che arriva dal server potrebbe non
// includerlo ancora, e sovrascrivere cancellerebbe per errore qualcosa
// appena scritto (è esattamente quello che succedeva scrivendo più
// piatti di fila: l'aggiornamento automatico ogni 30 secondi arrivava a
// metà di un salvataggio e lo faceva sparire).
DB._pendingSharedSaves = 0;

// L'orario dell'ultimo salvataggio fatto DA NOI — serve al tempo reale
// per riconoscere l'eco del nostro stesso salvataggio quando torna
// indietro: un avviso può arrivare dopo che il salvataggio è già
// concluso (il contatore sopra è già tornato a zero), ma essere comunque
// più vecchio o coincidente con quello che abbiamo appena scritto noi —
// applicarlo rischierebbe di sovrascrivere con una versione che, per
// tempistiche del server, non include ancora l'ultima modifica. Solo un
// avviso più NUOVO di questo viene accettato.
DB._lastSavedUpdatedAt = null;

// ===== Salvataggio "a fusione" della configurazione condivisa =====
// PRIMA: ogni salvataggio riscriveva l'intero blocco zone_tavoli (PIN,
// menu, vini, inventario, posizioni...) con la copia che QUESTO
// dispositivo aveva in memoria. Se la copia era vecchia (un altro
// dispositivo aveva appena salvato) o vuota (configurazione non scaricata
// per un problema di rete), il salvataggio cancellava il lavoro altrui.
//
// ORA: si ricorda l'ultima copia vista dal server ("base"), si calcola
// cosa è cambiato davvero rispetto a quella (fino al secondo livello:
// es. solo il giorno toccato dentro _dailySpecials, solo la zona toccata
// dentro _positions), si rilegge la riga fresca dal server, si applicano
// SOLO quelle modifiche sopra, e si salva solo se nel frattempo nessuno
// ha scritto (controllo su updated_at). Se qualcuno ha scritto, si
// rilegge e si riprova.
DB._sharedBase = { zone_tavoli: null, tavoli_bloccati: null };

DB._clone = function(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
};

// Da chiamare ogni volta che si riceve una copia "ufficiale" dal server
// (o, in mancanza di rete, la copia locale da cui si parte).
DB.noteSharedBase = function(zoneTavoli, tavoliBloccati) {
  if (zoneTavoli !== undefined) this._sharedBase.zone_tavoli = this._clone(zoneTavoli || {});
  if (tavoliBloccati !== undefined) this._sharedBase.tavoli_bloccati = this._clone(tavoliBloccati || {});
};

DB._isPlainObject = function(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
};

DB._isEmptyValue = function(v) {
  if (v === null || v === undefined || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (this._isPlainObject(v)) return Object.keys(v).length === 0;
  return false;
};

/**
 * Cosa è cambiato tra `base` e `next`. Restituisce una lista di
 * operazioni { path: [chiave] | [chiave, sottochiave], value | del }.
 * Una chiave che prima NON esisteva affatto e ora è "vuota" ([] {} null)
 * NON conta come modifica: sono i valori di riempimento che il codice
 * mette quando una cosa manca — trattarli come modifiche cancellerebbe
 * dal server dati veri che questo dispositivo semplicemente non aveva.
 */
DB._diffShared = function(base, next) {
  base = base || {};
  next = next || {};
  const ops = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  Object.keys(next).forEach(k => {
    const a = base[k], b = next[k];
    if (same(a, b)) return;
    if (!(k in base) && this._isEmptyValue(b)) return;
    if (this._isPlainObject(a) && this._isPlainObject(b)) {
      Object.keys(b).forEach(sk => {
        if (same(a[sk], b[sk])) return;
        if (!(sk in a) && this._isEmptyValue(b[sk])) return;
        ops.push({ path: [k, sk], value: b[sk] });
      });
      Object.keys(a).forEach(sk => { if (!(sk in b)) ops.push({ path: [k, sk], del: true }); });
    } else {
      ops.push({ path: [k], value: b });
    }
  });
  Object.keys(base).forEach(k => { if (!(k in next)) ops.push({ path: [k], del: true }); });
  return ops;
};

DB._applyShared = function(target, ops) {
  const out = this._isPlainObject(target) ? this._clone(target) : {};
  ops.forEach(op => {
    if (op.path.length === 1) {
      if (op.del) delete out[op.path[0]];
      else out[op.path[0]] = this._clone(op.value);
    } else {
      const [k, sk] = op.path;
      if (!this._isPlainObject(out[k])) {
        if (op.del) return;
        out[k] = {};
      }
      if (op.del) delete out[k][sk];
      else out[k][sk] = this._clone(op.value);
    }
  });
  return out;
};

DB._parseJsonCol = function(v) {
  if (this._isPlainObject(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return this._isPlainObject(p) ? p : {}; } catch (e) { return {}; } }
  return {};
};

DB.saveSharedConfig = async function(tavoli_interni, tavoli_esterni, zone, zone_tavoli, tavoli_bloccati) {
  DB._pendingSharedSaves++;
  const nowIso = new Date().toISOString();
  DB._lastSavedUpdatedAt = nowIso;
  try {
    const hasZT = zone_tavoli !== null && zone_tavoli !== undefined;
    const hasTB = tavoli_bloccati !== null && tavoli_bloccati !== undefined;
    // Le modifiche si calcolano SUBITO, rispetto alla base attuale — non
    // dopo l'attesa di rete, quando la base potrebbe essere già cambiata.
    const ztOps = hasZT ? DB._diffShared(DB._sharedBase.zone_tavoli, zone_tavoli) : [];
    const tbOps = hasTB ? DB._diffShared(DB._sharedBase.tavoli_bloccati, tavoli_bloccati) : [];

    const simple = {};
    if (tavoli_interni !== null) simple.tavoli_interni = tavoli_interni;
    if (tavoli_esterni !== null) simple.tavoli_esterni = tavoli_esterni;
    if (zone !== null) simple.zone = zone;

    // Niente da cambiare davvero: nessuna scrittura (e nessun rischio).
    if (!ztOps.length && !tbOps.length && !Object.keys(simple).length) return true;

    const MAX_TRIES = 4;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      // 1. Copia fresca dal server — se non arriva, NON si scrive alla
      //    cieca: meglio un salvataggio fallito (che si vede) che una
      //    sovrascrittura con dati vecchi (che non si vede).
      const fresh = await DB.fetchSharedConfig();
      if (!fresh) throw new Error('configurazione non raggiungibile, salvataggio annullato');

      const serverZT = DB._parseJsonCol(fresh.zone_tavoli);
      const serverTB = DB._parseJsonCol(fresh.tavoli_bloccati);
      const body = { ...simple, updated_at: nowIso };
      let mergedZT = null, mergedTB = null;
      if (hasZT) { mergedZT = DB._applyShared(serverZT, ztOps); body.zone_tavoli = mergedZT; }
      if (hasTB) {
        mergedTB = DB._applyShared(serverTB, tbOps);
        // tavoli bloccati: una data/servizio senza più tavoli si toglie del tutto
        Object.keys(mergedTB).forEach(k => { if (Array.isArray(mergedTB[k]) && !mergedTB[k].length) delete mergedTB[k]; });
        body.tavoli_bloccati = mergedTB;
      }

      // 2. Si scrive SOLO se la riga è ancora quella appena letta.
      //    All'ultimo tentativo si scrive comunque (sempre la versione
      //    fusa con la copia più fresca, mai quella vecchia locale).
      let url = `${CONFIG_SHARED_URL}?id=eq.main&apikey=${SUPABASE_ANON_KEY}`;
      const guarded = attempt < MAX_TRIES;
      if (guarded) {
        url += fresh.updated_at
          ? `&updated_at=eq.${encodeURIComponent(fresh.updated_at)}`
          : '&updated_at=is.null';
      }
      const res = await fetch(url, {
        method: 'PATCH',
        headers: this._headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let rows = null;
      try { rows = await res.json(); } catch (e) { rows = null; }
      if (guarded && Array.isArray(rows) && rows.length === 0) {
        // Qualcun altro ha salvato nel frattempo: si riprova sulla sua versione.
        await new Promise(r => setTimeout(r, 120 * attempt));
        continue;
      }

      // 3. Salvato. La nuova base è quello che ora c'è sul server; e se
      //    non ci sono altri salvataggi in volo, anche la copia locale si
      //    allinea (così si vedono subito pure le modifiche degli altri).
      DB.noteSharedBase(hasZT ? mergedZT : undefined, hasTB ? mergedTB : undefined);
      if (DB._pendingSharedSaves === 1 && typeof SharedTables !== 'undefined') {
        if (hasZT) {
          SharedTables._zoneTavoli = DB._clone(mergedZT);
          Storage.set('sharedZoneTavoli', SharedTables._zoneTavoli);
        }
        if (hasTB && SharedTables._setBlockedFromObject) SharedTables._setBlockedFromObject(mergedTB);
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn('saveSharedConfig fallito:', err.message);
    return false;
  } finally {
    DB._pendingSharedSaves--;
  }
};

// ===== Tempo reale =====
// Resta in ascolto dei cambiamenti invece di richiedere ogni tot secondi
// "è cambiato qualcosa?" — un avviso arriva già con dentro il dato nuovo,
// non serve nemmeno richiederlo. Se la libreria non è arrivata (davvero
// offline al primo avvio, o il CDN irraggiungibile), non succede nulla di
// rotto: restituisce null, e chi la chiama sa di dover contare solo sul
// controllo periodico di riserva.
// ===== "Buttare fuori" un profilo eliminato =====
// Quando un PIN personale (admin o dipendente) viene tolto da
// Impostazioni, chi era già entrato con quel PIN resta comunque connesso
// finché non esce da solo — la sessione non ricontrolla il PIN a ogni
// azione. Questa funzione lo fa: controlla se il PIN con cui SIAMO
// entrati esiste ancora tra quelli validi. Chi chiama questa funzione
// (il controllo periodico, o un avviso del tempo reale) decide cosa fare
// se risulta false — di solito, buttarlo fuori subito.
DB.checkStillAuthorized = function() {
  if (typeof SharedTables === 'undefined') return true;
  // "Butta fuori tutti" — reset totale, prima di ogni altro controllo:
  // se questa sessione è iniziata PRIMA dell'ultimo reset globale (o non
  // ha affatto un orario di inizio salvato, i profili più antichi in
  // assoluto), esce, punto — qualunque ruolo, qualunque metodo di
  // accesso, profilo ancora esistente o no.
  const globalKickAt = SharedTables.getGlobalKickAt ? SharedTables.getGlobalKickAt() : null;
  if (globalKickAt) {
    const sessionStartedAt = Storage.get('sessionStartedAt', null);
    if (!sessionStartedAt || sessionStartedAt < globalKickAt) return false;
  }
  // "Buttalo fuori" — copre chiunque sia collegato in questo momento, per
  // nome, indipendentemente da come si è collegato o da quanto è vecchio
  // il suo profilo: anche un dispositivo che non ha mai salvato
  // correttamente il proprio PIN in locale (i profili più vecchi, creati
  // prima che esistesse il controllo per PIN) viene comunque intercettato
  // qui, perché il nome dell'operatore è sempre presente.
  if (this._operator && SharedTables.getKickList) {
    const kicked = SharedTables.getKickList().some(k => k.name === this._operator);
    if (kicked) return false;
  }
  // Il resto lo decide il server (profilo eliminato, sospeso, stella di
  // chef principale tolta...): vedi DB.refreshAuthState, che aggiorna
  // _authOk in sottofondo. Qui si legge solo l'ultimo esito noto.
  if (this._authOk === false) return false;
  return true;
};

DB.subscribeRealtime = function(handlers) {
  if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
    console.warn('Libreria del tempo reale non disponibile — resta solo il controllo periodico di riserva.');
    return null;
  }
  try {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    DB._rtClient = client;
    if (DB._sess && DB._sess.access_token && client.realtime && client.realtime.setAuth) {
      client.realtime.setAuth(DB._sess.access_token);
    }
    const channel = client.channel('lou-tchappe-live');
    if (handlers.onConfigChange) {
      channel.on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'configurazione', filter: 'id=eq.main' },
        (payload) => handlers.onConfigChange(payload.new));
    }
    if (handlers.onBookingChange) {
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'prenotazioni' },
        (payload) => handlers.onBookingChange(payload));
    }
    // Ordini di servizio (ODS): una riga per evento, ogni modifica arriva
    // già con dentro la riga nuova — vedi ods.js (onRemote).
    if (handlers.onOdsChange) {
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'ordini_servizio' },
        (payload) => handlers.onOdsChange(payload));
    }
    channel.subscribe((status) => {
      if (handlers.onStatusChange) handlers.onStatusChange(status);
    });
    return channel;
  } catch (err) {
    console.warn('Avvio tempo reale fallito:', err.message);
    return null;
  }
};

// ===== Sessione rilasciata dal server: uso, rinnovo, verifica =====
DB._sess = null;      // { access_token, refresh_token, expires_at }
DB._authOk = null;    // null = non ancora verificato, true/false = esito del server
DB._accessoId = null;
DB._rawFetch = window.fetch.bind(window);
DB._refreshing = null;

DB._onSessionChanged = function() {
  if (DB._rtClient && DB._sess && DB._rtClient.realtime && DB._rtClient.realtime.setAuth) {
    try { DB._rtClient.realtime.setAuth(DB._sess.access_token); } catch (e) { /* ignora */ }
  }
  DB._startAuthWatch();
};

// Rinnova il "pass" (dura un'ora) usando il refresh token. Una sola
// richiesta alla volta anche se la chiedono in tanti insieme.
DB._refreshToken = function() {
  if (!DB._sess || !DB._sess.refresh_token) return Promise.resolve(false);
  if (DB._refreshing) return DB._refreshing;
  DB._refreshing = (async () => {
    try {
      const res = await DB._rawFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: DB._sess.refresh_token }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.access_token) {
        DB._sess = {
          access_token: d.access_token,
          refresh_token: d.refresh_token || DB._sess.refresh_token,
          expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
        };
        Storage.set('authSession', DB._sess);
        DB._onSessionChanged();
        return true;
      }
      // 400/401/403: sessione revocata (profilo sospeso o eliminato) → fuori
      if (res.status >= 400 && res.status < 500) DB._authOk = false;
      return false;
    } catch (e) {
      return false; // offline: si riprova più tardi
    } finally {
      DB._refreshing = null;
    }
  })();
  return DB._refreshing;
};

DB._ensureFreshToken = async function() {
  if (!DB._sess) return;
  const now = Math.floor(Date.now() / 1000);
  if (!DB._sess.expires_at || DB._sess.expires_at - now < 120) await DB._refreshToken();
};

// Chiamata alla funzione "accesso" con la propria sessione.
DB.accesso = async function(azione, dati) {
  await DB._ensureFreshToken();
  try {
    const res = await DB._rawFetch(ACCESSO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + (DB._sess ? DB._sess.access_token : SUPABASE_ANON_KEY),
      },
      body: JSON.stringify({ azione, ...(dati || {}) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { errore: d.errore || ('Errore ' + res.status), status: res.status };
    return d;
  } catch (e) {
    return { errore: 'Nessuna connessione: riprova tra poco.', offline: true };
  }
};

// Chiede al server se questo profilo è ancora valido (non sospeso, non
// eliminato, stessa "stella" di chef principale). checkStillAuthorized
// legge l'esito; i controlli periodici dell'app fanno il resto.
DB.refreshAuthState = async function() {
  if (!DB._sess) return;
  const r = await DB.accesso('stato');
  if (r.offline) return; // senza rete non si butta fuori nessuno
  if (r.status === 401 || r.status === 403 || r.valido === false) { DB._authOk = false; return; }
  if (r.profilo) {
    if (DB._role === 'read' && !!r.profilo.capo_chef !== !!DB._isHeadChef) { DB._authOk = false; return; }
    DB._authOk = true;
  }
};

DB._authWatchTimer = null;
DB._startAuthWatch = function() {
  if (DB._authWatchTimer) return;
  DB.refreshAuthState();
  DB._authWatchTimer = setInterval(() => {
    if (!DB._sess) return;
    DB._ensureFreshToken();
    DB.refreshAuthState();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && DB._sess) { DB._ensureFreshToken(); DB.refreshAuthState(); }
  });
};

// Ogni chiamata al database parte con il "pass" della sessione al posto
// della chiave pubblica: un solo punto per tutti i moduli (prenotazioni,
// configurazione, ODS, buoni, notifiche). Se il pass è scaduto si
// rinnova e si riprova una volta.
window.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.startsWith(SUPABASE_URL) || url.indexOf('/auth/v1/') !== -1 || url.indexOf('/functions/v1/accesso') !== -1 || !DB._sess) {
    return DB._rawFetch(input, init);
  }
  await DB._ensureFreshToken();
  const withAuth = () => {
    const h = new Headers((init && init.headers) || {});
    h.set('Authorization', 'Bearer ' + DB._sess.access_token);
    if (!h.has('apikey')) h.set('apikey', SUPABASE_ANON_KEY);
    return Object.assign({}, init || {}, { headers: h });
  };
  let res = await DB._rawFetch(input, withAuth());
  if (res.status === 401 && DB._sess) {
    const ok = await DB._refreshToken();
    if (ok) res = await DB._rawFetch(input, withAuth());
  }
  return res;
};

window.DB = DB;
