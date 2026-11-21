/**
 * ods.js
 * Ordini di servizio (ODS): una scheda per ogni evento con servizi, vini,
 * allergie, tariffe, sale e tavoli, compiti per reparto/persona, scaletta,
 * personale e fornitori. Si può stampare, condividere su WhatsApp, e chi ci
 * lavora deve confermare di averlo letto.
 *
 * Come si aggancia al resto del gestionale:
 *
 * - PERSONE: non c'è un elenco a parte. Le persone sono i profili che già
 *   esistono in Impostazioni (admin, dipendenti, cuochi) più i nomi del
 *   tablet. La chiave di una persona è il suo nome in minuscolo — lo stesso
 *   criterio con cui l'app riconosce già gli operatori (espulsioni,
 *   promemoria diretti, notifiche). Qui si salva solo il REPARTO di ognuno
 *   (SharedTables.getOdsDepts).
 *
 * - CHI PUÒ FARE COSA: gli "organizzatori" (admin, chef principale, o chi ha
 *   sbloccato con il PIN admin) creano e modificano. Tutti gli altri
 *   leggono tutto e spuntano SOLO i compiti assegnati a loro o al loro
 *   reparto.
 *
 * - DATI: tabella "ordini_servizio", una riga per evento (vedi
 *   supabase/ordini_servizio.sql). NON dentro la configurazione condivisa:
 *   là più dispositivi che scrivono insieme si sovrascrivono (è già
 *   successo). Qui ogni salvataggio è "aggiorna SOLO se la versione (rev) è
 *   ancora quella che ho letto"; se nel frattempo qualcun altro ha
 *   salvato, si rilegge la riga, si RIAPPLICA la propria modifica sopra e si
 *   riprova. Per questo ogni modifica è una funzione che lavora per id
 *   (mai per posizione) e si può ripetere senza effetti collaterali.
 *
 * - NOTIFICHE: dopo una modifica o una cosa fatta, il sito sa chi deve
 *   saperlo e chiama la Edge Function send-push (azione "ods_notice") con
 *   l'elenco dei nomi. Le modifiche ravvicinate si raggruppano in un solo
 *   avviso, per non riempire il telefono mentre qualcuno scrive.
 *
 * L'interfaccia vive in uno Shadow DOM: i nomi delle classi sono comodi e
 * brevi senza poter litigare con quelli del resto dell'app (e viceversa).
 */
const ODS = (function () {
'use strict';

const TABLE = SUPABASE_URL + '/rest/v1/ordini_servizio';
const EDGE_URL = SUPABASE_URL + '/functions/v1/send-push';
const KEEP_DAYS = 45;            // gli eventi più vecchi non si scaricano più
// ODS_TUNING esiste solo nelle prove automatiche (per non aspettare 15 secondi veri)
const TUNE = (typeof ODS_TUNING !== 'undefined' && ODS_TUNING) || {};
const SAVE_DELAY = TUNE.save != null ? TUNE.save : 700;    // attesa dopo l'ultimo tasto prima di salvare
const NOTICE_DELAY = { notdone: TUNE.done != null ? TUNE.done : 2000, updated: TUNE.updated != null ? TUNE.updated : 15000, assigned: TUNE.assigned != null ? TUNE.assigned : 8000, done: TUNE.done != null ? TUNE.done : 6000 };
const NOTICE_MAX = TUNE.max != null ? TUNE.max : 60000;
const RETRY_DELAY = TUNE.retry != null ? TUNE.retry : 5000; // se il salvataggio non parte (rete assente), si riprova    // anche scrivendo di continuo, un avviso al minuto

/* ============================================================
   Utilità
   ============================================================ */
function $(s) { return root ? root.querySelector(s) : null; }
function $$(s) { return root ? Array.prototype.slice.call(root.querySelectorAll(s)) : []; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function uid(p) { return p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
function pad(n) { return String(n).padStart(2, '0'); }
function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayISO() { return isoOf(new Date()); }
function parseISO(iso) { var a = iso.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); }
function addDays(iso, n) { var d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); }
function diffDays(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
function fmtLong(iso) { return parseISO(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }); }
function fmtFull(iso) { return parseISO(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function fmtShort(iso) { return parseISO(iso).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }); }
function addMin(t, m) { if (!t) return ''; var a = t.split(':').map(Number); var x = (((a[0] * 60 + a[1] + m) % 1440) + 1440) % 1440; return pad(Math.floor(x / 60)) + ':' + pad(x % 60); }
function setPath(o, path, v) { var k = path.split('.'); var t = o; for (var i = 0; i < k.length - 1; i++) { if (t[k[i]] == null) t[k[i]] = {}; t = t[k[i]]; } t[k[k.length - 1]] = v; }
function whenLabel(iso) { var d = diffDays(todayISO(), iso); if (d === 0) return 'Oggi'; if (d === 1) return 'Domani'; if (d > 1) return 'Tra ' + d + ' giorni'; if (d === -1) return 'Ieri'; return Math.abs(d) + ' giorni fa'; }
function listIt(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1]; }
function money(n) { return Number(n).toLocaleString('it-IT'); }
function stamp(iso) { var d = new Date(iso); return d.toLocaleDateString('it-IT') + ' alle ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function norm(s) { return String(s || '').trim().toLowerCase(); }
function cap(s) { return String(s).replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }); }

/* ============================================================
   Modelli: fasi, reparti, tipi di evento, compiti, scalette
   ============================================================ */
var PHASES = [
  { k: 'sett', label: 'Una settimana prima', off: -7 },
  { k: 'h72', label: '72 ore prima', off: -3 },
  { k: 'prima', label: 'Il giorno prima', off: -1 },
  { k: 'allest', label: 'Allestimento', off: 0 },
  { k: 'brief', label: 'Briefing e ultimi controlli', off: 0 },
  { k: 'servizio', label: 'Durante il servizio', off: 0 },
  { k: 'dopo', label: "Dopo l'evento", off: 1 }
];
// Un compito può non avere nessuna scadenza: è il caso normale, non un'eccezione
var NOPHASE = { k: '', label: 'Senza scadenza', off: null };
var DATED = { k: '@date', label: 'Con una data scelta', off: null };
function PH(k) { return PHASES.filter(function (p) { return p.k === k; })[0] || NOPHASE; }

var DEPTS = [['sala', 'Sala', 215], ['cucina', 'Cucina', 25], ['bar', 'Bar', 340], ['cantina', 'Cantina', 280]];

var TYPES = {
  serata: { label: 'Serata evento (aperitivo e cena)', dur: 270, client: false },
  matrimonio: { label: 'Matrimonio', dur: 330, client: true },
  aziendale: { label: 'Cena o evento aziendale', dur: 240, client: true },
  cerimonia: { label: 'Comunione, battesimo o cresima', dur: 270, client: true },
  festa: { label: 'Compleanno o festa privata', dur: 240, client: true },
  gruppo: { label: 'Pranzo o cena di gruppo', dur: 165, client: true },
  altro: { label: 'Altro evento', dur: 180, client: true }
};

var BASE_TASKS = [
  ['sett', 'Confermare con il cliente data, orari e numero di pax'],
  ['sett', 'Far firmare preventivo e menù, registrare l\'acconto'],
  ['sett', 'Raccogliere per iscritto allergie, intolleranze e diete speciali'],
  ['sett', 'Definire il menù con lo chef e verificare i prodotti'],
  ['sett', 'Scegliere vini e bevande, controllare le scorte in cantina'],
  ['sett', 'Ordinare ai fornitori (carne, pesce, verdure, pane) con data di consegna'],
  ['sett', 'Pianificare il personale e chiedere gli extra necessari'],
  ['sett', 'Definire disposizione della sala e numero di tavoli'],
  ['sett', 'Comunicare orari e accessi ai fornitori esterni (fiori, musica, noleggi)'],
  ['h72', 'Bloccare i pax garantiti con il cliente'],
  ['h72', 'Inviare allo chef il menù definitivo con pax, allergie e diete'],
  ['h72', 'Riconfermare tutti i fornitori esterni: orario, accesso, contatto'],
  ['h72', 'Stampare menù, segnaposto e piano dei tavoli'],
  ['h72', 'Controllare che cristalleria, posateria e tovagliato bastino per tutti'],
  ['h72', 'Distribuire al personale l\'ordine di servizio e gli orari'],
  ['prima', 'Controllare che le consegne siano arrivate e complete'],
  ['prima', 'Preparare la mise en place dove possibile'],
  ['prima', 'Mettere in fresco spumante e vini bianchi, preparare il ghiaccio'],
  ['prima', 'Rileggere le allergie con lo chef, ad alta voce'],
  ['prima', 'Riconfermare al cliente numero finale e orario di arrivo'],
  ['prima', 'Controllare pulizia di sala, bagni e ingresso'],
  ['allest', 'Montare i tavoli secondo il piano (misure e distanze)'],
  ['allest', 'Completare la mise en place: piatti, posate, bicchieri, tovaglioli'],
  ['allest', 'Posizionare segnaposto e indicazioni per allergie e diete'],
  ['allest', 'Accogliere i fornitori esterni e indicare dove posizionarsi'],
  ['allest', 'Controllare luci, temperatura, musica e impianto audio'],
  ['allest', 'Ispezione finale della sala con il responsabile'],
  ['brief', 'Briefing con tutto il team: orari, menù, tavoli, ruoli'],
  ['brief', 'Leggere ad alta voce allergie e diete, sala e cucina insieme'],
  ['brief', 'Assegnare a ogni cameriere sezioni e tavoli'],
  ['brief', 'Controllare divise e presentazione del personale'],
  ['brief', 'Confermare con lo chef i tempi di uscita dei piatti'],
  ['servizio', 'Accogliere gli ospiti e accompagnarli ai posti'],
  ['servizio', 'Servire l\'aperitivo all\'orario previsto'],
  ['servizio', 'Servire le allergie con piatto dedicato, controllando il tavolo'],
  ['servizio', 'Dare il via a ogni portata d\'accordo con la cucina'],
  ['servizio', 'Controllare che nessun tavolo resti senza vino o acqua'],
  ['servizio', 'Coordinare discorsi, brindisi e dolci secondo la scaletta'],
  ['dopo', 'Controllare danni o oggetti dimenticati dagli ospiti'],
  ['dopo', 'Riordinare sala e attrezzature'],
  ['dopo', 'Registrare pax finali, extra e consumi per il conto'],
  ['dopo', 'Emettere conto o fattura e incassare il saldo'],
  ['dopo', 'Ringraziare il cliente e chiedere un parere'],
  ['dopo', 'Debriefing con il team: cosa ha funzionato, cosa migliorare']
];

var TYPE_TASKS = {
  serata: [
    ['sett', 'Definire le postazioni (ostriche, salumi e formaggi, canapé) e chi le presidia'],
    ['sett', 'Decidere con la cucina quali piatti escono a postazione e quali in giro'],
    ['prima', 'Preparare ghiaccio, teli e attrezzatura per le postazioni'],
    ['allest', 'Allestire le postazioni dell\'aperitivo con tovagliato e segnaletica'],
    ['allest', 'Stabilire il percorso degli ospiti tra terrazza e sala'],
    ['servizio', 'Passare dall\'aperitivo alla cena all\'orario previsto, accompagnando gli ospiti'],
    ['servizio', 'Controllare le postazioni: ricambio piatti, ghiaccio e pulizia']
  ],
  matrimonio: [
    ['sett', 'Concordare con gli sposi tavolo d\'onore, tableau e piano dei tavoli'],
    ['sett', 'Confermare la torta nuziale: consegna, taglio e servizio'],
    ['sett', 'Definire menù bambini e, se serve, animazione'],
    ['sett', 'Coordinare fotografo e musicisti: orari, accessi e pasti'],
    ['h72', 'Preparare bomboniere, libro firme e tavolo accoglienza'],
    ['h72', 'Verificare spumante e flûte per il brindisi'],
    ['allest', 'Allestire il tavolo degli sposi e posizionare il tableau'],
    ['allest', 'Sistemare fiori e candele, controllando sicurezza e distanze'],
    ['servizio', 'Taglio della torta: coordinare cucina, fotografo e musica'],
    ['servizio', 'Servire il pasto a fotografo e musicisti']
  ],
  aziendale: [
    ['sett', 'Concordare con il referente programma, relatori e durata'],
    ['sett', 'Chiedere intestazione e dati per la fattura'],
    ['sett', 'Definire menù fisso o scelta, e come raccogliere le preferenze'],
    ['sett', 'Verificare proiettore, microfono, schermo e prese'],
    ['h72', 'Preparare cartellini con i nomi degli ospiti'],
    ['allest', 'Prova audio e video in sala'],
    ['brief', 'Concordare con il referente i tempi di discorsi e pause'],
    ['servizio', 'Rispettare gli orari del programma aziendale']
  ],
  cerimonia: [
    ['sett', 'Definire menù bambini e porzioni ridotte'],
    ['sett', 'Prevedere seggioloni e rialzi'],
    ['sett', 'Concordare torta, candeline e momento delle foto'],
    ['allest', 'Preparare seggioloni, rialzi e kit per i bambini'],
    ['allest', 'Allestire il tavolo delle bomboniere'],
    ['servizio', 'Servire per primi i bambini'],
    ['servizio', 'Coordinare il taglio della torta con la famiglia']
  ],
  festa: [
    ['sett', 'Concordare torta, candeline e momento a sorpresa'],
    ['sett', 'Chiedere quali decorazioni sono consentite'],
    ['sett', 'Definire musica e orario di fine serata'],
    ['allest', 'Preparare decorazioni e angolo torta'],
    ['servizio', 'Momento torta: luci, candeline e foto']
  ],
  gruppo: [
    ['sett', 'Confermare orario di arrivo del pullman e punto di sosta'],
    ['sett', 'Definire menù a prezzo fisso e bevande incluse'],
    ['sett', 'Farsi mandare dal capogruppo allergie e diete'],
    ['sett', 'Concordare come si paga: conto unico o separato'],
    ['allest', 'Predisporre guardaroba e accoglienza all\'ingresso'],
    ['servizio', 'Servire il pasto a autista e guida'],
    ['servizio', 'Rispettare l\'orario di partenza del pullman']
  ],
  altro: []
};

var TIMELINES = {
  serata: [[-240, 'Arrivo del personale, allestimento sala e postazioni'], [-120, 'Postazioni pronte: ispezione del responsabile'], [-30, 'Briefing con tutto il team'], [0, 'Aperitivo'], [75, 'Passaggio dall\'aperitivo alla cena'], [90, 'Benvenuto dello chef e prima portata'], [130, 'Portata successiva'], [175, 'Secondo'], [215, 'Dessert'], [245, 'Caffè e piccola pasticceria'], [270, 'Fine del servizio e riordino']],
  matrimonio: [[-240, 'Arrivo del personale, inizio allestimento'], [-120, 'Sala pronta: ispezione del responsabile'], [-90, 'Arrivo fornitori (fiori, torta, musica) e prove audio'], [-30, 'Briefing con tutto il team'], [0, 'Arrivo degli ospiti e aperitivo'], [75, 'Ospiti ai tavoli, ingresso degli sposi'], [90, 'Antipasti'], [135, 'Primi'], [175, 'Secondi'], [225, 'Taglio della torta e brindisi'], [250, 'Dessert, caffè e amari'], [330, 'Fine del servizio e riordino']],
  aziendale: [[-180, 'Arrivo del personale, inizio allestimento'], [-90, 'Prova audio e video, sala pronta'], [-30, 'Briefing con tutto il team'], [0, 'Accoglienza e aperitivo'], [45, 'Ospiti ai tavoli'], [60, 'Antipasto'], [100, 'Primo'], [140, 'Secondo'], [185, 'Dessert'], [210, 'Caffè e chiusura del programma'], [240, 'Fine del servizio e riordino']],
  cerimonia: [[-180, 'Arrivo del personale, inizio allestimento'], [-90, 'Sala pronta: ispezione del responsabile'], [-30, 'Briefing con tutto il team'], [0, 'Arrivo degli ospiti e aperitivo'], [45, 'Ospiti ai tavoli, bambini serviti per primi'], [60, 'Antipasti'], [100, 'Primi'], [140, 'Secondi'], [190, 'Torta e dolci'], [220, 'Caffè'], [270, 'Fine del servizio e riordino']],
  festa: [[-150, 'Arrivo del personale, inizio allestimento'], [-60, 'Sala pronta: ispezione del responsabile'], [-30, 'Briefing con tutto il team'], [0, 'Arrivo degli ospiti e aperitivo'], [40, 'Ospiti ai tavoli'], [55, 'Antipasti'], [95, 'Primi'], [135, 'Secondi'], [180, 'Momento della torta'], [210, 'Caffè e amari'], [240, 'Fine del servizio e riordino']],
  gruppo: [[-120, 'Arrivo del personale, allestimento'], [-30, 'Briefing con tutto il team'], [-15, 'Arrivo previsto del pullman'], [0, 'Accoglienza e ospiti ai posti'], [20, 'Antipasti'], [50, 'Primi'], [85, 'Secondi'], [120, 'Dessert'], [140, 'Caffè e conto'], [165, 'Partenza del pullman']],
  altro: [[-120, 'Arrivo del personale, allestimento'], [-30, 'Briefing con tutto il team'], [0, 'Arrivo degli ospiti'], [60, 'Servizio delle portate'], [180, 'Fine del servizio e riordino']]
};

var SERVICE_TPL = {
  serata: [['Aperitivo', 0], ['Cena', 90]], matrimonio: [['Aperitivo', 0], ['Cena', 90]], aziendale: [['Aperitivo', 0], ['Cena', 45]],
  cerimonia: [['Aperitivo', 0], ['Pranzo o cena', 45]], festa: [['Cena', 40]], gruppo: [['Pranzo o cena', 0]], altro: [['Servizio', 0]]
};
var TARIFF_SERATA = [['Ospiti in BB o passanti, adulti', 'aperitivo e cena, bevande a tavola escluse'], ['Bambini', 'aperitivo e cena, bevande a tavola escluse'], ['Ospiti in HB, adulti (supplemento)', ''], ['Ospiti in HB, bambini', 'nessun supplemento'], ['Solo aperitivo', '']];
var TARIFF_TPL = { serata: TARIFF_SERATA, matrimonio: [['Adulti', ''], ['Bambini', '']], aziendale: [['Adulti', '']], cerimonia: [['Adulti', ''], ['Bambini', '']], festa: [['Adulti', ''], ['Bambini', '']], gruppo: [['Adulti', '']], altro: [['Adulti', '']] };

var KINDS = [['allergia', 'Allergia'], ['intolleranza', 'Intolleranza'], ['celiachia', 'Celiachia'], ['preferenza', 'Non mangia o non gradisce'], ['dieta', 'Dieta (vegetariano, vegano…)']];
var KIND_LABEL = { allergia: 'Allergia', intolleranza: 'Intolleranza', celiachia: 'Celiachia', preferenza: 'Preferenza', dieta: 'Dieta' };
var KIND_TEXT = { allergia: 'allergia', intolleranza: 'intolleranza', celiachia: 'celiachia', preferenza: '', dieta: 'dieta' };
var HARD = { allergia: 1, intolleranza: 1, celiachia: 1 };
var ALLERGENS = ['Glutine', 'Crostacei', 'Uova', 'Pesce', 'Arachidi', 'Soia', 'Latte', 'Frutta a guscio', 'Sedano', 'Senape', 'Sesamo', 'Solfiti', 'Lupini', 'Molluschi'];
var LAYOUTS = ['Tavoli rotondi', 'Tavolo imperiale', 'Tavoli rettangolari', 'In piedi (cocktail)', 'Misto'];
var STATUS_LABEL = { bozza: 'Bozza', confermato: 'Confermato', concluso: 'Concluso' };
var SERVICE_PRESETS = [['Colazione', '08:00'], ['Brunch', '11:00'], ['Coffee break', '10:30'], ['Pranzo', '12:30'], ['Merenda', '16:00'], ['Aperitivo', '19:00'], ['Cena', '20:30'], ['Dopo cena', '22:30'], ['Altro', '']];
var ROOM_PRESETS = ['Interno', 'Giardino', 'Gazebo', 'Terrazza', 'Soggiorno', 'Altra sala'];
var DIET_PRESETS = ['Vegetariani', 'Vegani', 'Senza glutine', 'Senza lattosio', 'Altro'];
var EXTRA_AVOID = ['Carne', 'Maiale', 'Funghi', 'Alcol', 'Piccante'];
var HUES = [155, 25, 215, 280, 340, 60, 190];
var TABS = [['riepilogo', 'Riepilogo'], ['servizi', 'Servizi, vini e tariffe'], ['allergie', 'Allergie'], ['menu', 'Menu e piatti'], ['compiti', 'Compiti'], ['scaletta', 'Scaletta'], ['sala', 'Sale e personale']];

/* ============================================================
   Persone: i profili che esistono già, non un elenco a parte
   ============================================================ */
var peopleCache = null;
function hueOf(key) { var h = 0; for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0; return HUES[h % HUES.length]; }
function buildPeople() {
  var map = {}, order = [];
  var rank = { admin: 0, chef: 1, employee: 2, tablet: 3 };
  function add(name, kind, head) {
    var k = norm(name); if (!k) return;
    if (map[k]) { if (rank[kind] < rank[map[k].kind]) map[k].kind = kind; if (head) map[k].head = true; return; }
    map[k] = { key: k, name: String(name).trim(), kind: kind, head: !!head }; order.push(k);
  }
  (SharedTables.getAdminPins() || []).forEach(function (p) { if (!p.disabled) add(p.name, 'admin'); });
  (SharedTables.getChefPins() || []).forEach(function (p) { if (!p.disabled) add(p.name, 'chef', p.isHeadChef); });
  (SharedTables.getEmployeePins() || []).forEach(function (p) { if (!p.disabled) add(p.name, 'employee'); });
  (SharedTables.getStaffNames() || []).forEach(function (n) { add(typeof n === 'string' ? n : (n && n.name), 'tablet'); });
  var depts = SharedTables.getOdsDepts ? SharedTables.getOdsDepts() : {};
  return order.map(function (k) {
    var p = map[k];
    return { key: k, name: p.name, kind: p.kind, organizer: p.kind === 'admin' || p.head, dept: depts[k] || (p.kind === 'chef' ? 'cucina' : 'sala'), hue: hueOf(k) };
  });
}
function P() { return peopleCache || (peopleCache = buildPeople()); }
function personBy(key) {
  if (!key) return null;
  if (key.indexOf('d:') === 0) {
    var d = DEPTS.filter(function (x) { return 'd:' + x[0] === key; })[0];
    return d ? { key: key, name: d[1], isDept: true, hue: d[2] } : null;
  }
  var p = P().filter(function (x) { return x.key === key; })[0];
  // Un profilo eliminato o sospeso resta leggibile nei vecchi ordini di servizio
  return p || { key: key, name: cap(key), gone: true, organizer: false, dept: 'sala', hue: hueOf(key) };
}
function meKey() { return norm(DB.getOperator()); }
function meObj() {
  var k = meKey(); if (!k) return null;
  return P().filter(function (x) { return x.key === k; })[0] || { key: k, name: DB.getOperator(), organizer: false, dept: DB.getRole() === 'read' ? 'cucina' : 'sala', hue: hueOf(k) };
}
function isOrg() { return !!(DB.isFullAdmin() || (DB.isHeadChef && DB.isHeadChef())); }
function isMine(a) { var m = meObj(); return !!(a && m && (a === m.key || a === 'd:' + m.dept)); }
function avatar(p) { return p && !p.noav ? '<span class="av' + (p.isDept ? ' dept' : '') + '" style="--h:' + p.hue + '" aria-hidden="true">' + esc(p.name.trim().charAt(0).toUpperCase()) + '</span>' : ''; }
// Chi riceve un compito assegnato a una persona o a un reparto
function membersOf(a) {
  if (!a) return [];
  if (a.indexOf('d:') === 0) return P().filter(function (p) { return 'd:' + p.dept === a; }).map(function (p) { return p.key; });
  return [a];
}

/* ============================================================
   Dati condivisi: archivio locale, salvataggio con versione, tempo reale
   ============================================================ */
var store = {};              // id -> { id, data, rev, updated_at, queue, inflight, timer, failed }
var loaded = false, tableMissing = false, lastFetch = 0;

// Cosa ha risposto davvero il database, in parole comprensibili
var lastError = '';
async function explain(res) {
  var txt = ''; try { txt = await res.text(); } catch (e) { /* ignora */ }
  var j = {}; try { j = JSON.parse(txt); } catch (e) { /* non è JSON */ }
  var raw = (j.message || txt || '').toString().slice(0, 160);
  var hint;
  if (res.status === 401 || res.status === 403 || j.code === '42501') hint = 'il database non permette di scrivere in questa tabella (serve disattivare la sicurezza a livello di riga e dare i permessi: vedi lo script SQL)';
  else if (res.status === 404 || j.code === 'PGRST205' || j.code === '42P01') hint = 'la tabella non esiste ancora o Supabase non l\'ha ancora vista';
  else if (res.status === 409) hint = 'esiste già un ordine con lo stesso codice, riprova';
  else if (j.code === 'PGRST204' || /column/i.test(raw)) hint = 'la tabella ha colonne diverse da quelle previste: va ricreata con lo script SQL';
  else hint = raw;
  return 'errore ' + res.status + (j.code ? ' (' + j.code + ')' : '') + ': ' + hint;
}
function newItem(row) { var d = row.data || {}; normalize(d); return { id: row.id, data: d, rev: row.rev || 1, updated_at: row.updated_at, queue: [], inflight: false, timer: null, failed: false }; }
function allEvents() { return Object.keys(store).map(function (k) { return store[k].data; }); }

function rebase(it, row) {
  // L'ultima versione del server, con sopra le mie modifiche non ancora salvate
  var d = clone(row.data || {}); normalize(d);
  it.queue.forEach(function (e) { e.fn(d); });
  it.data = d; it.rev = row.rev; it.updated_at = row.updated_at;
}
function applyRow(row) {
  var it = store[row.id];
  if (!it) { store[row.id] = newItem(row); return true; }
  if (row.rev <= it.rev) return false;     // eco del mio stesso salvataggio, o dato vecchio
  rebase(it, row); return true;
}

async function fetchAll() {
  try {
    var since = addDays(todayISO(), -KEEP_DAYS), base = TABLE + '?event_date=gte.' + since;
    var rows;
    if (!loaded) {
      // Primo caricamento: tutto
      var res = await fetch(base + '&select=*&order=event_date.asc', { headers: DB._headers() });
      if (!res.ok) {
        var txt = ''; try { txt = await res.text(); } catch (e) { /* ignora */ }
        if (res.status === 404 || /PGRST205|42P01|does not exist/i.test(txt)) tableMissing = true;
        throw new Error('HTTP ' + res.status);
      }
      rows = await res.json();
    } else {
      // Controlli successivi (la rete di riserva se il tempo reale tace): si chiede solo
      // "che versioni ci sono?" e si scarica per intero SOLO quello che è cambiato
      var r1 = await fetch(base + '&select=id,rev', { headers: DB._headers() });
      if (!r1.ok) throw new Error('HTTP ' + r1.status);
      var idx = await r1.json();
      var stale = idx.filter(function (x) { return !store[x.id] || x.rev > store[x.id].rev; }).map(function (x) { return x.id; });
      rows = [];
      if (stale.length) {
        var r2 = await fetch(TABLE + '?select=*&id=in.(' + stale.map(encodeURIComponent).join(',') + ')', { headers: DB._headers() });
        if (!r2.ok) throw new Error('HTTP ' + r2.status);
        rows = await r2.json();
      }
      rows.__index = idx;
    }
    tableMissing = false;
    var seen = {};
    (rows.__index || rows).forEach(function (r) { seen[r.id] = 1; });
    rows.forEach(function (r) { applyRow(r); });
    Object.keys(store).forEach(function (id) {   // sparito dal server (eliminato da un altro dispositivo)
      var it = store[id];
      if (!seen[id] && it.rev > 0 && !it.queue.length && !it.inflight) delete store[id];
    });
    loaded = true; lastFetch = Date.now();
    return true;
  } catch (e) { console.warn('ODS.fetchAll fallito:', e.message); return false; }
}
async function getRow(id) {
  var res = await fetch(TABLE + '?id=eq.' + encodeURIComponent(id), { headers: DB._headers() });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var rows = await res.json();
  return rows[0] || null;
}

function edit(id, fn, o) {
  o = o || {};
  var it = store[id]; if (!it) return;
  fn(it.data);
  if (o.key) it.queue = it.queue.filter(function (e) { return !(e.key === o.key && !e.sent); });
  it.queue.push({ key: o.key || null, fn: fn, sent: false });
  schedule(id, o.now ? 0 : SAVE_DELAY);
  renderSync();
}
function schedule(id, ms) {
  var it = store[id]; if (!it) return;
  clearTimeout(it.timer);
  it.timer = setTimeout(function () { flush(id); }, ms);
}
async function flush(id, keepalive) {
  var it = store[id];
  if (!it || it.inflight || !it.queue.length || it.rev === 0) return;
  it.inflight = true; it.failed = false; renderSync();
  try {
    var guard = 0;
    while (it.queue.length && guard++ < 8) {
      var batch = it.queue.slice(); batch.forEach(function (e) { e.sent = true; });
      var body = JSON.stringify({ data: it.data, event_date: it.data.date || null, rev: it.rev + 1, last_editor: DB.getOperator() || null, last_device_id: DB._getDeviceId ? DB._getDeviceId() : null, updated_at: new Date().toISOString() });
      var res = await fetch(TABLE + '?id=eq.' + encodeURIComponent(id) + '&rev=eq.' + it.rev, { method: 'PATCH', headers: DB._headers(), body: body, keepalive: !!keepalive && body.length < 60000 });
      if (!res.ok) { lastError = await explain(res); throw new Error(lastError); }
      lastError = '';
      var rows = await res.json();
      if (rows && rows.length) {                                  // salvato
        it.rev = rows[0].rev; it.updated_at = rows[0].updated_at;
        it.queue = it.queue.filter(function (e) { return batch.indexOf(e) < 0; });
      } else {                                                     // qualcuno ha salvato prima di me
        var fresh = await getRow(id);
        if (!fresh) { delete store[id]; toast('Questo ordine di servizio è stato eliminato da un altro dispositivo'); if (ui.id === id) { ui.view = 'list'; ui.id = null; } break; }
        batch.forEach(function (e) { e.sent = false; });
        rebase(it, fresh);
        if (visible()) { if (typing()) pendingDraw = true; else draw(true); }
      }
    }
  } catch (e) {
    console.warn('ODS salvataggio fallito:', e.message);
    (it.queue || []).forEach(function (en) { en.sent = false; });
    it.failed = true;
    clearTimeout(it.timer); it.timer = setTimeout(function () { flush(id); }, RETRY_DELAY);
  } finally {
    it.inflight = false; renderSync();
    if (store[id] && !it.failed && it.queue.length) schedule(id, 0);
  }
}
function flushAll(keepalive) { Object.keys(store).forEach(function (id) { clearTimeout(store[id].timer); flush(id, keepalive); }); }

async function createEvent(ev) {
  var it = { id: ev.id, data: ev, rev: 0, updated_at: null, queue: [], inflight: false, timer: null, failed: false };
  store[ev.id] = it;
  try {
    var res = await fetch(TABLE, { method: 'POST', headers: DB._headers(), body: JSON.stringify({ id: ev.id, event_date: ev.date, data: ev, rev: 1, last_editor: DB.getOperator() || null, last_device_id: DB._getDeviceId ? DB._getDeviceId() : null }) });
    if (!res.ok) { lastError = await explain(res); throw new Error(lastError); }
    lastError = '';
    var rows = await res.json();
    it.rev = (rows[0] && rows[0].rev) || 1;
    if (it.queue.length) schedule(ev.id, 0);
    return true;
  } catch (e) {
    console.warn('ODS creazione fallita:', e.message);
    if (!lastError) lastError = 'senza connessione: ' + e.message;
    delete store[ev.id];
    return false;
  }
}
async function deleteEvent(id) {
  try {
    var res = await fetch(TABLE + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: DB._headers() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    delete store[id]; return true;
  } catch (e) { console.warn('ODS eliminazione fallita:', e.message); return false; }
}

// Avviso dal tempo reale: { eventType, new, old }
function onRemote(payload) {
  try {
    var t = payload && payload.eventType;
    if (t === 'DELETE') {
      var oid = payload.old && payload.old.id;
      if (oid && store[oid] && !store[oid].queue.length) {
        delete store[oid];
        if (ui.id === oid) { ui.view = 'list'; ui.id = null; toast('Questo ordine di servizio è stato eliminato'); }
      }
    } else if (payload && payload.new && payload.new.id) {
      var row = payload.new;
      if (new Date(row.event_date || '2100-01-01') < new Date(addDays(todayISO(), -KEEP_DAYS))) return;
      if (!applyRow(row)) return;
    } else return;
    changed();
  } catch (e) { console.warn('ODS.onRemote:', e.message); }
}
function changed() {
  updateTrigger();
  if (!visible()) return;
  if (typing()) { pendingDraw = true; return; }
  draw(true);
}
function normalize(d) {
  ['services', 'wines', 'allergies', 'diets', 'dishes', 'tariffs', 'timeline', 'tasks', 'rooms', 'staff', 'suppliers'].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
  d.times = d.times || {}; d.client = d.client || { name: '', phone: '' }; d.billing = d.billing || { deposit: '', depositIn: false, invoiceTo: '' };
  d.covers = d.covers || { adults: 0, kids: '', highchairs: '', expected: 0, guaranteed: '', locked: false };
  // Ordini scritti prima: «previsti» era il totale. Adulti = totale meno i bambini
  if (d.covers.adults == null) d.covers.adults = Math.max(0, (Number(d.covers.expected) || 0) - (Number(d.covers.kids) || 0));
  d.reads = d.reads || {}; d.winePolicy = d.winePolicy || 'elenco'; d.status = d.status || 'bozza';
  if (!d.updatedAt) d.updatedAt = new Date().toISOString();
  d.rooms.forEach(function (r) { if (!Array.isArray(r.tables)) r.tables = []; });
  d.allergies.forEach(function (a) { if (!Array.isArray(a.allergens)) a.allergens = []; if (a.other == null) a.other = ''; });
  // Compiti: «assignees» (più persone/reparti) al posto del vecchio «assignee» singolo, che resta uguale al primo per compatibilità
  d.tasks.forEach(function (t) {
    if (!Array.isArray(t.assignees)) t.assignees = t.assignee ? [t.assignee] : [];
    t.assignee = t.assignees[0] || ''; if (t.dueDate == null) t.dueDate = '';
    if (t.notDone == null) { t.notDone = false; t.reason = ''; }
  });
  d.dishes.forEach(function (x) { if (!x.items || typeof x.items !== 'object') x.items = {}; if (!x.alts || typeof x.alts !== 'object') x.alts = {}; if (x.service == null) x.service = ''; });
}
function findItem(d, list, id, parent) {
  var arr = d[list];
  if (parent) { var r = d.rooms.filter(function (x) { return x.id === parent; })[0]; arr = r && r[list]; }
  return (arr || []).filter(function (x) { return x.id === id; })[0] || null;
}
function touch(d) { d.updatedAt = new Date().toISOString(); }

/* ============================================================
   Notifiche: chi deve saperlo, raggruppate per non intasare il telefono
   ============================================================ */
var buf = { updated: {}, assigned: {}, done: {}, notdone: {} };
function evTitle(id) { return store[id] ? (store[id].data.title || 'Evento') : 'Evento'; }
function namesOf(keys) { var seen = {}, out = []; keys.forEach(function (k) { if (seen[k]) return; seen[k] = 1; var p = personBy(k); if (p && !p.gone) out.push(p.name); }); return out; }
function without(keys) { var m = meKey(); return keys.filter(function (k) { return k && k !== m; }); }
function organizers() { return P().filter(function (p) { return p.organizer; }).map(function (p) { return p.key; }); }

async function pushNotice(prefKey, title, body, recipientKeys, id) {
  var names = namesOf(without(recipientKeys));
  if (!names.length) return;
  var jwt = (typeof EDGE_FUNCTION_ANON_JWT !== 'undefined') ? EDGE_FUNCTION_ANON_JWT : SUPABASE_ANON_KEY;
  try {
    await fetch(EDGE_URL, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
      body: JSON.stringify({ type: 'MANUAL', action: 'ods_notice', prefKey: prefKey, title: title, body: body, recipients: names, url: '/?open=ods&id=' + encodeURIComponent(id), deviceId: DB._getDeviceId ? DB._getDeviceId() : null, operatorName: DB.getOperator() })
    });
  } catch (e) { console.warn('ODS avviso non inviato:', e.message); }
}
function arm(kind, id, flushFn) {
  var b = buf[kind][id]; if (!b) return;
  var now = Date.now(); if (!b.first) b.first = now;
  clearTimeout(b.timer);
  var wait = Math.max(0, Math.min(NOTICE_DELAY[kind], NOTICE_MAX - (now - b.first)));
  b.timer = setTimeout(function () { flushFn(id); }, wait);
}
// Una modifica al contenuto: chi ci lavora deve rileggerlo
function markUpdate(id, section) {
  if (!section) return;
  var b = buf.updated[id] || (buf.updated[id] = { secs: [], first: 0, timer: null });
  if (b.secs.indexOf(section) < 0) b.secs.push(section);
  arm('updated', id, sendUpdated);
}
function sendUpdated(id) {
  var b = buf.updated[id]; if (!b) return; delete buf.updated[id]; clearTimeout(b.timer);
  var it = store[id]; if (!it) return;
  // Chi ci lavora deve rileggerlo; gli altri organizzatori devono saperlo
  var keys = involvedKeys(it.data).concat(organizers());
  pushNotice('ods_updated', '📋 Ordine di servizio aggiornato', it.data.title + ': modificati ' + listIt(b.secs) + '. Rileggilo.', keys, id);
}
// Un compito assegnato a una persona o a un reparto
// Chi ha uno o più compiti: «assignees» è l'elenco (persone e reparti)
function assOf(t) { return (t.assignees && t.assignees.length) ? t.assignees : (t.assignee ? [t.assignee] : []); }
function isMineT(t) { return assOf(t).some(isMine); }
// Spuntare (fatto / non fatto) spetta SOLO a chi ha il compito (o al suo reparto). Un compito
// senza nessuno assegnato non ha un proprietario: lo gestiscono gli organizzatori.
function canTick(t) { return isMineT(t) || (!hasAss(t) && isOrg()); }
function hasAss(t) { return assOf(t).length > 0; }
function setAss(x, arr) { x.assignees = arr.slice(); x.assignee = arr[0] || ''; }
function markAssigned(id, text, assignees) {
  var arr = Array.isArray(assignees) ? assignees : (assignees ? [assignees] : []), seen = {}, all = [];
  arr.forEach(function (a) { membersOf(a).forEach(function (k) { if (!seen[k]) { seen[k] = 1; all.push(k); } }); });
  var members = without(all); if (!members.length) return;
  var b = buf.assigned[id] || (buf.assigned[id] = { map: {}, first: 0, timer: null });
  members.forEach(function (k) { (b.map[k] = b.map[k] || []).push(text); });
  arm('assigned', id, sendAssigned);
}
function sendAssigned(id) {
  var b = buf.assigned[id]; if (!b) return; delete buf.assigned[id]; clearTimeout(b.timer);
  var t = evTitle(id);
  Object.keys(b.map).forEach(function (k) {
    var texts = b.map[k];
    pushNotice('ods_assigned', '📌 Nuovo compito per te', texts.length === 1 ? '«' + texts[0] + '» — ' + t : texts.length + ' nuovi compiti — ' + t + ': «' + texts.slice(0, 2).join('», «') + '»' + (texts.length > 2 ? '…' : ''), [k], id);
  });
}
// Una cosa fatta: gli organizzatori lo sanno subito
function markDone(id, text) {
  var b = buf.done[id] || (buf.done[id] = { items: [], first: 0, timer: null });
  b.items.push(text);
  arm('done', id, sendDone);
}
function sendDone(id) {
  var b = buf.done[id]; if (!b) return; delete buf.done[id]; clearTimeout(b.timer);
  var who = (meObj() || {}).name || 'Qualcuno', t = evTitle(id), n = b.items.length;
  pushNotice('ods_done', n === 1 ? '✅ ' + who + ': fatto' : '✅ ' + who + ': ' + n + ' cose fatte', n === 1 ? b.items[0] + ' — ' + t : t + ': ' + b.items.slice(0, 3).join('; ') + (n > 3 ? '…' : ''), organizers(), id);
}
// Un compito che chi ce l'ha non farà: gli organizzatori devono saperlo subito, col motivo
function markNotDone(id, text, reason) {
  var b = buf.notdone[id] || (buf.notdone[id] = { items: [], first: 0, timer: null });
  b.items.push(text + (reason ? ' (' + reason + ')' : ''));
  arm('notdone', id, sendNotDone);
}
function sendNotDone(id) {
  var b = buf.notdone[id]; if (!b) return; delete buf.notdone[id]; clearTimeout(b.timer);
  var who = (meObj() || {}).name || 'Qualcuno', t = evTitle(id), n = b.items.length;
  pushNotice('ods_done', n === 1 ? '⚠️ ' + who + ': non fatto' : '⚠️ ' + who + ': ' + n + ' compiti non fatti', n === 1 ? b.items[0] + ' — ' + t : t + ': ' + b.items.slice(0, 3).join('; ') + (n > 3 ? '…' : ''), organizers(), id);
}
function flushNotices() {
  Object.keys(buf.notdone).forEach(sendNotDone);
  Object.keys(buf.updated).forEach(sendUpdated);
  Object.keys(buf.assigned).forEach(sendAssigned);
  Object.keys(buf.done).forEach(sendDone);
}

/* ============================================================
   Stato dell'interfaccia
   ============================================================ */
var host = null, root = null;
var ui = { openGrp: {}, nd: null, dishFilter: 'all', openDish: {}, newWho: [], pick: null, view: 'list', id: null, tab: 'riepilogo', taskFilter: null, taskGroup: 'chi', open: {}, openInit: null, sheet: null, allMine: false, custom: {}, editAl: {}, alForm: false, lastSaved: null };
var pendingDraw = false;
function curEv() { return ui.id && store[ui.id] ? store[ui.id].data : null; }
function visible() { var s = host && host.closest ? host.closest('.screen') : null; return !!(s && s.classList.contains('active')); }
function typing() { var a = root && root.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')); }

function taskStats(ev) { var total = ev.tasks.length, done = ev.tasks.filter(function (t) { return t.done; }).length; return { total: total, done: done, pct: total ? Math.round(done / total * 100) : 0 }; }
function dueISO(ev, t) { if (t.dueDate) return t.dueDate; var o = PH(t.phase).off; return o == null ? null : addDays(ev.date, o); }
function isLate(ev, t) { var d = dueISO(ev, t); return !t.done && !!d && d < todayISO(); }
function dueLabel(ev, t) {
  if (t.done) return '';
  var iso = dueISO(ev, t); if (!iso) return '';
  var d = diffDays(todayISO(), iso);
  if (d < 0) return 'In ritardo di ' + (-d) + (d === -1 ? ' giorno' : ' giorni');
  if (PH(t.phase).off === 0) return "Il giorno dell'evento";
  if (d === 0) return 'Entro oggi';
  if (d === 1) return 'Entro domani';
  return 'Entro ' + fmtShort(iso);
}
function whenDone(t) {
  if (!t.done || !t.doneAt) return '';
  var d = new Date(t.doneAt), p = personBy(t.doneBy), hh = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return 'Fatto da ' + (p ? p.name : '?') + ' ' + (isoOf(d) === todayISO() ? 'alle ' + hh : fmtShort(isoOf(d)) + ', ' + hh);
}
function sortedLines(ev) {
  // Le voci senza orario vanno in fondo, nell'ordine in cui sono state scritte
  return ev.timeline.map(function (l, i) { return { l: l, i: i }; }).sort(function (a, b) {
    var ta = a.l.time || '99:99', tb = b.l.time || '99:99';
    return ta === tb ? a.i - b.i : (ta < tb ? -1 : 1);
  }).map(function (x) { return x.l; });
}
function coversTotal(ev) { var c = ev.covers; return (Number(c.adults) || 0) + (Number(c.kids) || 0); }
// «97 adulti, 3 bambini (di cui 2 seggioloni)»
function coversText(ev) {
  var c = ev.covers, a = Number(c.adults) || 0, k = Number(c.kids) || 0, h = Number(c.highchairs) || 0, p = [];
  if (a || !k) p.push(a + (a === 1 ? ' adulto' : ' adulti'));
  if (k) p.push(k + (k === 1 ? ' bambino' : ' bambini') + (h ? ' (di cui ' + h + (h === 1 ? ' seggiolone' : ' seggioloni') + ')' : ''));
  return p.join(', ');
}
function hcAssigned(ev) { var n = 0; ev.rooms.forEach(function (r) { r.tables.forEach(function (t) { n += Number(t.highchairs) || 0; }); }); return n; }
function guestsOf(ev) { return Number(ev.covers.guaranteed) || Number(ev.covers.expected) || 0; }
function roomSeats(r) { return r.tables.reduce(function (a, t) { return a + (Number(t.seats) || 0); }, 0); }
function seatsOf(ev) { return ev.rooms.reduce(function (a, r) { return a + roomSeats(r); }, 0); }
function svcDate(ev, s) { return s.date || ev.date; }
function sortedServices(ev) {
  return ev.services.map(function (s, i) { return { s: s, i: i }; }).sort(function (a, b) {
    var da = svcDate(ev, a.s), db = svcDate(ev, b.s); if (da !== db) return da < db ? -1 : 1;
    var ta = a.s.time || '99:99', tb = b.s.time || '99:99'; if (ta !== tb) return ta < tb ? -1 : 1;
    return a.i - b.i;
  }).map(function (x) { return x.s; });
}
function serviceName(ev, id) { var s = ev.services.filter(function (x) { return x.id === id; })[0]; return s ? (s.name || 'Servizio') : ''; }
function tariffTotal(ev) { var t = 0, q = 0; ev.tariffs.forEach(function (r) { var n = Number(r.qty) || 0; q += n; t += n * (Number(r.price) || 0); }); return { total: t, qty: q }; }
function winesIncluded(ev) { return ev.winePolicy === 'tutti' ? 0 : ev.wines.filter(function (w) { return !w.paid; }).reduce(function (a, w) { return a + (Number(w.bottles) || 0); }, 0); }
function wineLine(ev, w) {
  var sv = w.service ? serviceName(ev, w.service) : '', tail = sv ? ' (' + sv + ')' : '';
  var pr = String(w.price) !== '' ? '€ ' + w.price + ' a bottiglia' : '';
  if (ev.winePolicy === 'tutti' || w.paid) return w.name + ' – a pagamento' + (pr ? ', ' + pr : '') + tail;
  var n = Number(w.bottles) || 0;
  return w.name + ' – ' + (n > 0 ? n + (n === 1 ? ' bottiglia inclusa' : ' bottiglie incluse') : 'incluso') + (pr ? ', in più ' + pr : '') + tail;
}
function winePolicyText(ev) {
  if (ev.winePolicy === 'tutti') return 'Tutti i vini sono a pagamento.';
  var n = winesIncluded(ev);
  return n > 0 ? 'Bottiglie incluse: ' + n + '. Le bottiglie in più e gli altri vini sono a pagamento.' : '';
}
// Cosa non può mangiare un ospite: le voci scelte e quelle scritte a mano (es. mango)
function itemsOf(a) {
  var out = [], seen = {}, diet = a.kind === 'dieta';
  (a.allergens || []).forEach(function (x) { x = String(x).trim(); var k = norm(x); if (k && !seen[k]) { seen[k] = 1; out.push({ k: k, label: x, diet: false }); } });
  String(a.other || '').split(/[,;\n]+/).forEach(function (x) { x = String(x).trim(); var k = norm(x); if (k && !seen[k]) { seen[k] = 1; out.push({ k: k, label: x, diet: diet }); } });
  return out;
}
function allItems(ev) {
  var out = [], idx = {};
  ev.allergies.forEach(function (a) { itemsOf(a).forEach(function (i) { if (idx[i.k] == null) { idx[i.k] = out.length; out.push({ k: i.k, label: i.label, diet: i.diet }); } else if (!i.diet) out[idx[i.k]].diet = false; }); });
  return out;
}
function allergyText(a) {
  var k = KIND_TEXT[a.kind] || '', ch = itemsOf(a).map(function (x) { return x.label.toLowerCase(); }).join(', '), parts = [];
  if (a.kind === 'dieta' && ch) parts.push('dieta: ' + ch); else if (k && ch) parts.push(k + ' a ' + ch); else if (k) parts.push(k); else if (ch) parts.push(ch);
  if (a.note) parts.push(a.note);
  return parts.join(' – ');
}
// I piatti: ogni piatto "risponde" Sì/No per ogni voce che qualcuno non può mangiare
function dishesOf(ev, svcId) { return ev.dishes.filter(function (x) { return (x.service || '') === (svcId || ''); }); }
function orderedDishes(ev) {
  var out = []; sortedServices(ev).forEach(function (s) { out = out.concat(dishesOf(ev, s.id)); });
  return out.concat(ev.dishes.filter(function (x) { return out.indexOf(x) < 0; }));
}
function looseDishes(ev) { return ev.dishes.filter(function (x) { return !ev.services.some(function (s) { return s.id === x.service; }); }); }
function answerOf(dish, k) { return dish.items && typeof dish.items[k] === 'boolean' ? dish.items[k] : null; }
function openQuestions(ev, dish) { return allItems(ev).filter(function (i) { return answerOf(dish, i.k) === null; }); }
// Chi non può mangiare questo piatto, raggruppato per le stesse voci: un'alternativa per gruppo
function conflictGroups(ev, dish) {
  var yes = {}; allItems(ev).forEach(function (i) { if (answerOf(dish, i.k) === true) yes[i.k] = i; });
  var by = {}, order = [];
  ev.allergies.forEach(function (a) {
    var hit = itemsOf(a).filter(function (i) { return yes[i.k]; }); if (!hit.length) return;
    var sig = hit.map(function (i) { return i.k; }).sort().join('|');
    if (!by[sig]) {
      var nd = hit.filter(function (i) { return !yes[i.k].diet; }).map(function (i) { return i.label; }), dt = hit.filter(function (i) { return yes[i.k].diet; }).map(function (i) { return i.label; }), parts = [];
      if (nd.length) parts.push('non può mangiare ' + nd.join(', ').toLowerCase());
      if (dt.length) parts.push('segue la dieta ' + dt.join(', ').toLowerCase());
      by[sig] = { sig: sig, items: hit.map(function (i) { return i.label; }), reason: parts.join(' e '), entries: [], ids: [], pax: 0, alt: '' }; order.push(sig);
    }
    var g = by[sig]; g.entries.push(a); g.ids.push(a.id); g.pax += Number(a.pax) || 1;
    var alt = String((dish.alts || {})[a.id] || '').trim(); if (alt && !g.alt) g.alt = alt;
  });
  return order.map(function (k) { return by[k]; });
}
function groupWho(g) { return g.entries.map(function (a) { return (a.who || 'Ospite') + ((Number(a.pax) || 1) > 1 ? ', ' + a.pax + ' pax' : ''); }).join('; '); }
function altRows(ev) {
  var rows = [], names = {}; ev.services.forEach(function (s) { names[s.id] = s.name || 'Servizio'; });
  orderedDishes(ev).forEach(function (dsh) { conflictGroups(ev, dsh).forEach(function (g) { rows.push({ dish: dsh, svc: names[dsh.service] || '', g: g }); }); });
  return rows;
}
function altLine(r) { return 'Per ' + groupWho(r.g) + ' (' + r.g.reason + ') c\'è: ' + (r.g.alt || 'alternativa da definire'); }
function dishLines(txt) { return String(txt || '').split('\n').map(function (l) { return l.replace(/^[\s\-\u2022*\u00b7]+/, '').trim(); }).filter(function (l) { return l && l !== '***'; }); }
// Il menu di un servizio come testo (piatti inseriti uno a uno, più l'eventuale testo scritto in passato)
function foodText(ev, s) {
  var a = dishesOf(ev, s.id).map(function (x) { return x.name; }).filter(Boolean).join('\n'), b = String(s.food || '').trim();
  return [a, b].filter(Boolean).join('\n');
}
// Rispondere ai piatti e scrivere le alternative: solo admin e chef principale. Un cuoco legge e basta.
function canChef() { return isOrg(); }
function stationsOf(ev) {
  var out = [];
  ev.services.forEach(function (s) { String(s.food).split('\n').forEach(function (l) { if (/\(postazione\)/i.test(l)) out.push(l.replace(/\(postazione\)/i, '').trim()); }); });
  ev.dishes.forEach(function (x) { if (/\(postazione\)/i.test(x.name)) out.push(x.name.replace(/\(postazione\)/i, '').trim()); });
  return out;
}
function odsNotes(ev) {
  var g = {}, order = [];
  ev.tasks.forEach(function (t) { if (t.tpl || t.done) return; (assOf(t).length ? assOf(t) : ['']).forEach(function (k) { if (!g[k]) { g[k] = []; order.push(k); } g[k].push(t.text); }); });
  var keys = P().map(function (p) { return p.key; });
  function rank(k) { if (!k) return 1000; if (k.indexOf('d:') === 0) return DEPTS.map(function (d) { return 'd:' + d[0]; }).indexOf(k); var i = keys.indexOf(k); return 100 + (i < 0 ? 500 : i); }
  order.sort(function (a, b) { return rank(a) - rank(b); });
  return order.map(function (k) { var p = k ? personBy(k) : null; return { label: k ? (p ? p.name : '?') : 'Da assegnare', items: g[k] }; });
}
function dietLine(ev) {
  var c = ev.covers, p = [];
  ev.diets.forEach(function (g) { if (Number(g.qty) > 0 && String(g.label).trim()) p.push(String(g.label).trim() + ' ' + g.qty); });
  return p.join(', ');
}
// Chi deve leggere l'ordine di servizio: chi ha un ruolo nell'evento (non gli organizzatori)
function involvedKeys(ev) {
  var ids = {};
  function add(a) { membersOf(a).forEach(function (k) { ids[k] = 1; }); }
  add(ev.lead); ev.staff.forEach(function (s) { add(s.personId); });
  ev.tasks.forEach(function (t) { if (!t.done) assOf(t).forEach(add); });
  ev.timeline.forEach(function (l) { add(l.who); });
  ev.rooms.forEach(function (r) { r.tables.forEach(function (t) { add(t.who); }); });
  var org = {}; P().forEach(function (p) { if (p.organizer) org[p.key] = 1; });
  return Object.keys(ids).filter(function (k) { return !org[k]; });
}
function readOK(ev, key) { var r = ev.reads && ev.reads[key]; return !!r && r >= ev.updatedAt; }
function isClosed(ev) { return ev.status === 'concluso' || diffDays(todayISO(), ev.date) < 0; }
function activeEvents() { return allEvents().filter(function (e) { return e.status !== 'concluso' && diffDays(todayISO(), e.date) >= -14; }); }
function boardRows() {
  var out = [];
  activeEvents().forEach(function (ev) { ev.tasks.forEach(function (t) { out.push({ ev: ev, t: t }); }); });
  return out;
}
// In ritardo prima, poi per scadenza, poi quelli senza scadenza
function cmpTasks(a, b) {
  var la = isLate(a.ev, a.t) ? 0 : 1, lb = isLate(b.ev, b.t) ? 0 : 1; if (la !== lb) return la - lb;
  var da = dueISO(a.ev, a.t) || '9999-12-31', db = dueISO(b.ev, b.t) || '9999-12-31'; if (da !== db) return da < db ? -1 : 1;
  if (a.ev.date !== b.ev.date) return a.ev.date < b.ev.date ? -1 : 1;
  return String(a.t.text).localeCompare(String(b.t.text));
}
function myTasks() {
  return boardRows().filter(function (x) { return isMineT(x.t) && !x.t.done; }).sort(cmpTasks);
}

/* ============================================================
   "Cosa manca": i promemoria calcolati dai dati
   ============================================================ */
function computeMissing(ev) {
  var out = [], today = todayISO(), c = ev.covers, d = diffDays(today, ev.date), T = TYPES[ev.type] || TYPES.altro, guests = guestsOf(ev);
  function add(sev, text, tab, anchor) { out.push({ sev: sev, text: text, tab: tab, anchor: anchor || '' }); }
  if (T.client && (!String(ev.client.name).trim() || !String(ev.client.phone).trim())) add('red', 'Manca il referente del cliente (nome e telefono)', 'riepilogo', 'details');
  if (!ev.lead) add('amber', "Nessun responsabile dell'evento assegnato", 'riepilogo', 'details');
  var kidsN = Number(c.kids) || 0, hcN = Number(c.highchairs) || 0;
  if (kidsN > 0 && c.highchairs === '') add('amber', 'Hai indicato ' + kidsN + (kidsN === 1 ? ' bambino' : ' bambini') + ': segna quanti seggioloni servono', 'riepilogo', 'covers');
  if (hcN > kidsN) add('amber', 'Seggioloni (' + hcN + ') più dei bambini (' + kidsN + ')', 'riepilogo', 'covers');
  if (hcN > 0 && hcAssigned(ev) !== hcN) add(d <= 7 ? 'red' : 'amber', hcAssigned(ev) < hcN ? 'Assegna i seggioloni ai tavoli (ne mancano ' + (hcN - hcAssigned(ev)) + ')' : 'Hai assegnato più seggioloni (' + hcAssigned(ev) + ') di quelli previsti (' + hcN + ')', 'sala', 'sala');
  if (!Number(c.guaranteed)) { add(d <= 7 ? 'red' : 'amber', 'Pax garantiti non ancora indicati', 'riepilogo', 'covers'); }
  else if (!c.locked) {
    var lockBy = addDays(ev.date, -3), left = diffDays(today, lockBy);
    if (left < 0) add('red', 'I pax garantiti andavano bloccati entro ' + fmtShort(lockBy), 'riepilogo', 'covers');
    else if (left <= 3) add('amber', 'Blocca i pax garantiti entro ' + fmtShort(lockBy) + (left === 0 ? ' (oggi)' : ''), 'riepilogo', 'covers');
  }
  if (!ev.services.length) add('amber', 'Nessun servizio definito (aperitivo, cena…)', 'servizi', 'servizi');
  else {
    var nf = ev.services.filter(function (s) { return !foodText(ev, s); });
    if (nf.length) add('amber', 'Nessun piatto indicato per: ' + nf.map(function (s) { return s.name || 'servizio'; }).join(', '), 'menu', 'menu');
  }
  var priced = ev.tariffs.filter(function (r) { return String(r.price) !== ''; });
  if (!priced.length) add('amber', 'Tariffe non ancora indicate', 'servizi', 'tariffe');
  else { var tt = tariffTotal(ev); if (tt.qty > 0 && guests && tt.qty !== guests) add('amber', 'Le tariffe sommano ' + tt.qty + ' pax, ma i pax sono ' + guests, 'servizi', 'tariffe'); }
  if (!ev.allergies.length && !ev.noAllergies) add('red', 'Allergie e intolleranze: chiedile, oppure conferma che non ce ne sono', 'allergie', 'allergie');
  var ni = ev.allergies.filter(function (a) { return !a.informed; }).length;
  if (ni) add('red', ni + (ni === 1 ? ' segnalazione da comunicare' : ' segnalazioni da comunicare') + ' alla cucina', 'allergie', 'allergie');
  if (allItems(ev).length) {
    var dq = ev.dishes.filter(function (x) { return openQuestions(ev, x).length; }).length;
    if (dq) add('amber', dq + (dq === 1 ? ' piatto ha' : ' piatti hanno') + ' domande sulle allergie senza risposta', 'menu', 'menu');
    var na = 0; ev.dishes.forEach(function (x) { conflictGroups(ev, x).forEach(function (g) { if (!g.alt) na++; }); });
    if (na) add(d <= 7 ? 'red' : 'amber', 'Manca il piatto alternativo per ' + na + (na === 1 ? ' caso' : ' casi') + ' di allergia o intolleranza', 'menu', 'menu');
    if (!ev.dishes.length && ev.services.length) add('amber', 'Hai indicato allergie ma nessun piatto: inserisci il menu per segnare le alternative', 'menu', 'menu');
  }
  var nds = ev.tasks.filter(function (t) { return t.notDone && !t.done; });
  if (nds.length) add('red', nds.length + (nds.length === 1 ? ' compito segnato come «non fatto»' : ' compiti segnati come «non fatti»') + ': leggi i motivi e riassegnali', 'compiti', 'compiti');
  var open = ev.tasks.filter(function (t) { return !t.done; });
  var late = open.filter(function (t) { return isLate(ev, t); }).length;
  if (late) add('red', late + (late === 1 ? ' compito in ritardo' : ' compiti in ritardo'), 'compiti', '');
  var un = open.filter(function (t) { return !hasAss(t); }).length;
  if (un) add('amber', un + (un === 1 ? ' compito senza responsabile' : ' compiti senza responsabile'), 'compiti', '');
  if (!ev.staff.length) add('amber', "Personale dell'evento non ancora indicato", 'sala', 'personale');
  var seats = seatsOf(ev);
  if (seats && guests && seats < guests) add('red', 'I posti a sedere (' + seats + ') sono meno dei pax (' + guests + ')', 'sala', 'sala');
  var nw = 0; ev.rooms.forEach(function (r) { r.tables.forEach(function (t) { if (!t.who) nw++; }); });
  if (nw) add('amber', nw + (nw === 1 ? ' tavolo senza cameriere' : ' tavoli senza cameriere'), 'sala', 'sala');
  var wb = ev.winePolicy !== 'tutti' ? ev.wines.filter(function (w) { return !w.paid && String(w.name).trim() && !(Number(w.bottles) > 0); }).length : 0;
  if (wb) add('amber', 'Vini: indica le bottiglie incluse per ' + wb + (wb === 1 ? ' vino' : ' vini'), 'servizi', 'vini');
  var uc = ev.suppliers.filter(function (s) { return !s.confirmed; }).length;
  if (uc) add('amber', uc + (uc === 1 ? ' fornitore da confermare' : ' fornitori da confermare'), 'sala', 'fornitori');
  if (Number(ev.billing.deposit) > 0 && !ev.billing.depositIn) add('amber', 'Acconto non ancora ricevuto', 'riepilogo', 'details');
  var unread = involvedKeys(ev).filter(function (k) { return !readOK(ev, k); });
  if (unread.length && d <= 3) add(d <= 1 ? 'red' : 'amber', unread.length + (unread.length === 1 ? ' persona non ha' : ' persone non hanno') + ' ancora letto l\'ordine di servizio (' + unread.map(function (k) { return personBy(k).name; }).join(', ') + ')', 'riepilogo', 'lettura');
  out.sort(function (a, b) { return (a.sev === 'red' ? 0 : 1) - (b.sev === 'red' ? 0 : 1); });
  return out;
}

/* ============================================================
   Componenti di campo
   ============================================================ */
function ro(val, fmt) { var s = (val === '' || val == null) ? '' : String(fmt ? fmt(val) : val); return s !== '' ? '<div class="ro">' + esc(s) + '</div>' : '<div class="ro empty">Non indicato</div>'; }
function fa(path, o) { return 'data-f="' + path + '"' + (o && o.list ? ' data-list="' + o.list + '" data-id="' + o.id + '"' : '') + (o && o.parent ? ' data-parent="' + o.parent + '"' : '') + (o && o.rr ? ' data-rr="1"' : ''); }
function field(label, path, val, o) {
  o = o || {};
  var cls = 'fld' + (o.span === 2 ? ' span2' : '');
  if (!isOrg()) return '<div class="' + cls + '"><span class="fl">' + label + '</span>' + ro(val, o.show) + '</div>';
  var type = o.type || 'text', ph = esc(o.ph || ''), c;
  // Il \n iniziale serve: HTML ignora la PRIMA riga a capo dentro una textarea, quindi senza
  // questo un testo che comincia con una riga vuota la perderebbe ad ogni ridisegno
  if (type === 'textarea') c = '<textarea class="in" rows="' + (o.rows || 3) + '" ' + fa(path, o) + ' placeholder="' + ph + '">\n' + esc(val) + '</textarea>';
  else {
    var extra = type === 'number' ? ' inputmode="numeric" min="0"' : (type === 'tel' ? ' inputmode="tel"' : '');
    if (o.dl) extra += ' list="' + o.dl + '"';
    c = '<input class="in" type="' + type + '" ' + fa(path, o) + ' value="' + esc(val) + '" placeholder="' + ph + '"' + extra + '>';
  }
  return '<label class="' + cls + '"><span class="fl">' + label + '</span>' + c + '</label>';
}
var SERVICE_NAMES = ['Colazione', 'Brunch', 'Coffee break', 'Pranzo', 'Merenda', 'Aperitivo', 'Cena', 'Dopo cena', 'Cena a buffet'];
var PLACE_NAMES = ['Interno', 'Giardino', 'Gazebo', 'Terrazza', 'Soggiorno', 'Ristorante', 'Sala privata'];
// Una scelta da un elenco (tendina vera: mostra SEMPRE tutte le voci) con «Altro» per scrivere a mano.
// Un valore scritto a mano resta visibile come voce dell'elenco finché non lo si cambia.
function combo(label, path, val, presets, o) {
  o = o || {};
  var cls = 'fld' + (o.span === 2 ? ' span2' : '');
  if (!isOrg()) return '<div class="' + cls + '"><span class="fl">' + label + '</span>' + ro(val) + '</div>';
  var key = path + ':' + (o.id || ''), inner;
  if (ui.custom[key]) {
    inner = '<span class="combo-custom"><input class="in" type="text" ' + fa(path, o) + ' value="' + esc(val) + '" placeholder="' + esc(o.ph || '') + '" aria-label="' + esc(label) + '"><button type="button" class="link" data-act="combo-back" data-key="' + esc(key) + '">Scegli dall\'elenco</button></span>';
  } else {
    var extra = (val && presets.indexOf(val) < 0) ? '<option value="' + esc(val) + '" selected>' + esc(val) + '</option>' : '';
    inner = '<select class="in" data-combo="' + esc(key) + '" ' + fa(path, o) + ' aria-label="' + esc(label) + '"><option value=""' + (val ? '' : ' selected') + '>Scegli…</option>' + presets.map(function (p) { return '<option value="' + esc(p) + '"' + (p === val ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + extra + '<option value="__altro">Altro (scrivo io)…</option></select>';
  }
  return '<div class="' + cls + '"><span class="fl">' + label + '</span>' + inner + '</div>';
}
function opts(list, val) {
  return list.map(function (o) {
    if (o && o.g) return '<optgroup label="' + esc(o.g) + '">' + opts(o.items, val) + '</optgroup>';
    var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
    return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(l) + '</option>';
  }).join('');
}
function flat(list) { var r = []; list.forEach(function (o) { if (o && o.g) r = r.concat(flat(o.items)); else r.push(o); }); return r; }
function peopleList(blank, noDept) {
  var l = [['', blank || 'Da assegnare']];
  if (!noDept) l.push({ g: 'Reparti', items: DEPTS.map(function (d) { return ['d:' + d[0], d[1]]; }) });
  l.push({ g: 'Persone', items: P().map(function (p) { return [p.key, p.name]; }) });
  return l;
}
function select(label, path, val, list, o) {
  o = o || {};
  var cls = 'fld' + (o.span === 2 ? ' span2' : '');
  if (!isOrg()) {
    var hit = flat(list).filter(function (x) { return (Array.isArray(x) ? x[0] : x) === val; })[0];
    var txt = hit ? (Array.isArray(hit) ? hit[1] : hit) : (val ? (personBy(val) || {}).name : '');
    return '<div class="' + cls + '"><span class="fl">' + label + '</span>' + ro(val ? txt : '') + '</div>';
  }
  // Se il valore salvato non è più in elenco (profilo eliminato), lo si mostra comunque
  var known = flat(list).some(function (x) { return (Array.isArray(x) ? x[0] : x) === val; });
  var extra = (!known && val) ? '<option value="' + esc(val) + '" selected>' + esc((personBy(val) || { name: val }).name) + ' (non più in squadra)</option>' : '';
  return '<label class="' + cls + '"><span class="fl">' + label + '</span><select class="in" ' + fa(path, o) + '>' + extra + opts(list, val) + '</select></label>';
}
function toggle(path, val, label, o) {
  if (!isOrg()) return '<div class="fld"><span class="fl">' + label + '</span>' + ro(val ? 'Sì' : 'No') + '</div>';
  return '<label class="toggle"><input type="checkbox" ' + fa(path, o) + (val ? ' checked' : '') + '><span class="sw"></span><span>' + label + '</span></label>';
}
function checkbox(act, attrs, checked, disabled, label) {
  return '<label class="check"><input type="checkbox" data-act="' + act + '" ' + attrs + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span class="box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span><span class="sr">' + label + '</span></label>';
}
function whoPill(list, id, field, val, quiet, evId) {
  var p = personBy(val);
  if (!isOrg()) {
    if (val && p) return '<span class="who">' + avatar(p) + esc(p.name) + '</span>';
    return quiet ? '' : '<span class="who is-empty">Da assegnare</span>';
  }
  var known = !val || flat(peopleList()).some(function (x) { return x[0] === val; });
  var extra = !known ? '<option value="' + esc(val) + '" selected>' + esc(p.name) + ' (non più in squadra)</option>' : '';
  return '<span class="who edit' + (val ? '' : ' is-empty') + '">' + (val ? avatar(p) : '') + '<select data-list="' + list + '" data-id="' + id + '"' + (evId ? ' data-ev="' + evId + '"' : '') + ' data-f="' + field + '" data-rr="1" aria-label="Assegnato a">' + extra + opts(peopleList(), val) + '</select></span>';
}

/* ============================================================
   Disegno: elenco degli ordini di servizio
   ============================================================ */
function evRow(e) {
  var st = taskStats(e), d = parseISO(e.date), upcoming = !isClosed(e), flag = '';
  if (upcoming) {
    if (isOrg()) {
      var m = computeMissing(e), reds = m.filter(function (x) { return x.sev === 'red'; }).length;
      flag = m.length ? '<span class="flag ' + (reds ? 'red' : 'amber') + '">' + m.length + ' da sistemare</span>' : '<span class="flag ok">In ordine</span>';
    } else {
      var n = e.tasks.filter(function (t) { return isMineT(t) && !t.done; }).length;
      var mk = meKey(), toRead = involvedKeys(e).indexOf(mk) >= 0 && !readOK(e, mk);
      flag = toRead ? '<span class="flag red">Da leggere</span>' : '<span class="flag ' + (n ? 'amber' : 'ok') + '">' + (n ? n + (n === 1 ? ' tuo compito' : ' tuoi compiti') : 'Nessun compito per te') + '</span>';
    }
  } else flag = '<span class="flag">' + STATUS_LABEL[e.status] + '</span>';
  return '<button class="ev-row" data-act="open-event" data-id="' + e.id + '">' +
    '<span class="leaf"><b>' + d.getDate() + '</b><span>' + esc(d.toLocaleDateString('it-IT', { month: 'short' })) + '</span></span>' +
    '<span class="ev-main"><span class="ev-title">' + esc(e.title || 'Senza nome') + '</span>' +
    '<span class="ev-sub">' + esc(d.toLocaleDateString('it-IT', { weekday: 'long' })) + (e.times.arrival ? ' alle ' + esc(e.times.arrival) : '') + ', ' + guestsOf(e) + ' pax</span>' +
    '<span class="ev-tags"><span class="when">' + esc(whenLabel(e.date)) + '</span>' + flag + '</span>' +
    '<span class="progress sm" aria-hidden="true"><i style="width:' + st.pct + '%"></i></span></span></button>';
}
function boardRow(x, o) {
  o = o || {};
  var t = x.t, ev = x.ev, late = isLate(ev, t), due = dueLabel(ev, t), can = canTick(t);
  var via = assOf(t).filter(function (a) { return a.indexOf('d:') === 0 && isMine(a); }).map(function (a) { return (personBy(a) || {}).name; }).join(', ');
  return '<li class="task' + (t.done ? ' is-done' : '') + '">' + checkbox('tick-task', 'data-ev="' + ev.id + '" data-id="' + t.id + '"', t.done, !can, 'Segna come fatto') +
    '<div class="task-main"><span class="task-text">' + esc(t.text) + '</span><div class="task-meta">' +
    '<button class="link" data-act="open-event" data-id="' + ev.id + '" data-tab="compiti">' + esc(ev.title) + '</button>' +
    (due ? '<span class="due' + (late ? ' late' : '') + '">' + esc(due) + '</span>' : '') +
    (via ? '<span class="viadept">Reparto ' + esc(via) + '</span>' : '') +
    (o.assign ? assignBtn(t, ev.id) : '') + '</div>' + taskStateHTML(ev, t) + '</div></li>';
}
// I MIEI compiti: la prima cosa che si vede
function mineBoard(mine) {
  if (!meKey()) return '<section class="board mine-board"><h2>I tuoi compiti</h2><p class="board-sub">Scegli prima chi sei (dal tablet) per vedere i tuoi compiti.</p></section>';
  var late = mine.filter(function (x) { return isLate(x.ev, x.t); }).length, nd = mine.filter(function (x) { return x.t.notDone; }).length;
  var LIMIT = 12, shown = ui.allMine ? mine : mine.slice(0, LIMIT), open = grpOpen('sum:@mine', true);
  var head = '<button type="button" class="board-head mine-sum" data-act="grp-toggle" data-k="sum:@mine" aria-expanded="' + open + '"><h2>I tuoi compiti</h2>' + (mine.length ? '<span class="bigcount' + (late ? ' late' : '') + '">' + mine.length + '</span>' : '') + '<span class="chev" aria-hidden="true"></span></button>';
  var body = mine.length
    ? '<p class="board-sub' + (late || nd ? ' late' : '') + '">' + (nd ? nd + (nd === 1 ? ' segnato come non fatto. ' : ' segnati come non fatti. ') : '') + (late ? late + ' in ritardo, in cima alla lista. Poi gli altri, in ordine di scadenza.' : 'In ordine di scadenza.') + '</p><ul class="tasks">' + shown.map(function (x) { return boardRow(x); }).join('') + '</ul>' +
      (mine.length > LIMIT ? '<button class="link" data-act="all-mine">' + (ui.allMine ? 'Mostra meno' : 'Mostra tutti e ' + mine.length) + '</button>' : '')
    : '<p class="board-sub ok">Nessun compito aperto per te. Quando te ne assegnano uno lo trovi qui.</p>';
  return '<section class="board mine-board">' + head + (open ? body : '') + '</section>';
}
// Compiti che chi li ha NON farà: solo gli organizzatori li vedono qui, col motivo, per riassegnarli
function notDoneBoard(rows) {
  if (!isOrg()) return '';
  var list = rows.filter(function (x) { return x.t.notDone && !x.t.done; }).sort(cmpTasks);
  if (!list.length) return '';
  return '<section class="board"><div class="board-head"><h2>Non fatti</h2><span class="bigcount late">' + list.length + '</span></div><p class="board-sub late">Chi li aveva ha scritto perché non li fa. Riassegnali o sistemali.</p><ul class="tasks">' + list.map(function (x) { return boardRow(x, { assign: true }); }).join('') + '</ul></section>';
}
function personStats(list) {
  var open = list.filter(function (x) { return !x.t.done; }), done = list.filter(function (x) { return x.t.done; });
  return { open: open.sort(cmpTasks), done: done, late: open.filter(function (x) { return isLate(x.ev, x.t); }), nd: open.filter(function (x) { return x.t.notDone; }), pct: list.length ? Math.round(done.length / list.length * 100) : 0 };
}
function grpOpen(key, dflt) { var v = ui.openGrp[key]; return v === undefined ? !!dflt : !!v; }
// Una riga per persona (o reparto): nome e numeri; si apre al tocco. Identica nel riepilogo e nella scheda Compiti.
function groupCard(key, p, list, bodyFn, open) {
  var st = personStats(list);
  var badge = st.nd.length ? '<span class="flag red">' + st.nd.length + (st.nd.length === 1 ? ' non fatto' : ' non fatti') + '</span>' : (st.late.length ? '<span class="flag red">' + st.late.length + ' in ritardo</span>' : (st.open.length ? '' : '<span class="flag ok">Tutto fatto</span>'));
  return '<section class="pcard' + (st.late.length || st.nd.length ? ' has-late' : '') + (open ? ' is-open' : '') + '"><button type="button" class="pc-sum" data-act="grp-toggle" data-k="' + esc(key) + '" aria-expanded="' + open + '">' + avatar(p) +
    '<span class="pc-main"><b>' + esc(p.name) + '</b>' + (p.isDept ? '<span class="pc-kind">reparto</span>' : '') + '<span class="pc-stats">' + st.open.length + ' da fare, ' + st.done.length + ' fatti</span></span>' + badge + '<span class="chev" aria-hidden="true"></span>' +
    '<span class="progress sm pc-bar" aria-hidden="true"><i style="width:' + st.pct + '%"></i></span></button>' + (open ? '<div class="pc-body">' + bodyFn(st) + '</div>' : '') + '</section>';
}
function personCard(key, list) {
  var p = personBy(key), k = 'sum:' + key;
  return groupCard(k, p, list, function (st) {
    return (st.open.length ? '<ul class="tasks">' + st.open.map(function (x) { return boardRow(x); }).join('') + '</ul>' : '') +
      (st.done.length ? '<details class="donebox"><summary>' + st.done.length + (st.done.length === 1 ? ' fatto' : ' fatti') + '</summary><ul class="tasks">' + st.done.map(function (x) { return boardRow(x); }).join('') + '</ul></details>' : '');
  }, grpOpen(k, false));
}
// Compiti di tutti gli altri, persona per persona (e per reparto)
function peopleBoard(rows) {
  var mk = meKey(), by = {};
  rows.forEach(function (x) { assOf(x.t).forEach(function (k) { if (!k || k === mk) return; (by[k] = by[k] || []).push(x); }); });
  var keys = Object.keys(by).sort(function (a, b) {
    var sa = personStats(by[a]), sb = personStats(by[b]);
    if (sa.late.length !== sb.late.length) return sb.late.length - sa.late.length;
    if (sa.open.length !== sb.open.length) return sb.open.length - sa.open.length;
    return personBy(a).name.localeCompare(personBy(b).name);
  });
  var idle = isOrg() ? P().filter(function (p) { return p.key !== mk && !by[p.key]; }).map(function (p) { return p.name; }) : [];
  if (!keys.length && !idle.length) return '';
  return '<section class="board"><h2>Compiti per persona</h2><p class="board-sub">Chi ha cosa da fare. Tocca una persona per vedere i suoi compiti.</p>' +
    keys.map(function (k) { return personCard(k, by[k]); }).join('') +
    (idle.length && keys.length ? '<p class="note">Senza compiti in questo momento: ' + esc(idle.join(', ')) + '.</p>' : '') + '</section>';
}
// Compiti che nessuno ha ancora in carico: solo chi organizza può assegnarli
function unassignedBoard(rows) {
  if (!isOrg()) return '';
  var list = rows.filter(function (x) { return !hasAss(x.t) && !x.t.done; }).sort(cmpTasks);
  if (!list.length) return '';
  return '<section class="board"><div class="board-head"><h2>Da assegnare</h2><span class="bigcount amber">' + list.length + '</span></div><p class="board-sub">Compiti senza un responsabile. Scegli chi se ne occupa direttamente da qui.</p><ul class="tasks">' + list.slice(0, 15).map(function (x) { return boardRow(x, { assign: true }); }).join('') + '</ul>' +
    (list.length > 15 ? '<p class="note">E altri ' + (list.length - 15) + ': assegnali dalla scheda Compiti dell\'evento.</p>' : '') + '</section>';
}
function backBtn() { return DB.getRole() === 'read' ? '' : '<button class="link back" data-act="back">‹ Home</button>'; }
function renderList() {
  var org = isOrg();
  var sorted = allEvents().sort(function (a, b) { return a.date.localeCompare(b.date); });
  var up = sorted.filter(function (e) { return !isClosed(e); }), past = sorted.filter(isClosed).reverse();
  var rows = boardRows(), mine = rows.filter(function (x) { return isMineT(x.t) && !x.t.done; }).sort(cmpTasks);
  var setup = tableMissing ? '<div class="readbar"><p><b>Manca ancora la tabella degli ordini di servizio nel database.</b> Va creata una volta sola eseguendo lo script <code>supabase/ordini_servizio.sql</code> nell\'SQL Editor di Supabase.</p></div>' : '';
  var loading = (!loaded && !tableMissing) ? '<p class="empty">Carico gli ordini di servizio…</p>' : '';
  // Prima i tuoi compiti, poi tutto il resto
  $('#view').innerHTML = '<div class="wrap">' + backBtn() + '<h1>Ordini di servizio</h1>' + setup + loading +
    (loaded ? mineBoard(mine) + notDoneBoard(rows) + unassignedBoard(rows) + peopleBoard(rows) : '') +
    (loaded ? '<section class="board"><div class="board-head"><h2>Eventi in programma</h2>' + (org ? '<span class="board-actions"><button class="btn primary small" data-act="new-event">Nuovo</button><button class="btn quiet small" data-act="depts">Reparti</button></span>' : '') + '</div>' +
      (up.length ? up.map(evRow).join('') : '<p class="empty">Nessun evento in programma.' + (org ? ' Creane uno con «Nuovo».' : '') + '</p>') + '</section>' : '') +
    (past.length ? '<section class="board"><h2>Passati</h2>' + past.map(evRow).join('') + '</section>' : '') + '</div>';
}

/* ============================================================
   Disegno: evento
   ============================================================ */
function navHeight() {
  var ids = ['bottomNav', 'roBottomNav'];
  for (var i = 0; i < ids.length; i++) { var n = document.getElementById(ids[i]); if (n && n.style.display !== 'none' && n.offsetHeight) return n.offsetHeight; }
  return 0;
}
function tabDot(ev, key) {
  if (!isOrg() || isClosed(ev)) return '';
  var its = computeMissing(ev).filter(function (i) { return i.tab === key; });
  return its.length ? '<span class="tdot' + (its.some(function (i) { return i.sev === 'red'; }) ? ' red' : '') + '" role="img" aria-label="Da completare"></span>' : '';
}
function tabsHTML(ev) {
  var st = taskStats(ev);
  return TABS.map(function (t) { return '<button class="tab" role="tab" aria-selected="' + (ui.tab === t[0]) + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + (t[0] === 'compiti' ? '<span class="tcount">' + st.done + '/' + st.total + '</span>' : '') + tabDot(ev, t[0]) + '</button>'; }).join('');
}
function updateTabDots() {
  var ev = curEv(); if (!ev) return;
  $$('#evTabs .tab').forEach(function (b) { var o = b.querySelector('.tdot'); if (o) o.remove(); var h = tabDot(ev, b.dataset.tab); if (h) b.insertAdjacentHTML('beforeend', h); });
}
function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function barStateText() { return syncLabel() || (ui.lastSaved ? 'Salvato alle ' + hhmm(ui.lastSaved) : 'Tutto salvato'); }
function renderBar() {
  var b = $('#evBar'), ev = curEv(); if (!b || !ev) return;
  b.innerHTML = isOrg()
    ? '<span id="barState" class="bar-state">' + esc(barStateText()) + '</span><button class="btn quiet" data-act="ods">Anteprima ODS</button><button class="btn primary" data-act="save-ods">Salva ODS</button>'
    : '<button class="btn primary wide" data-act="ods">Leggi l\'ordine di servizio</button>';
}
function renderEventView() {
  var ev = curEv();
  if (!ev) { ui.view = 'list'; renderList(); return; }
  try { host.style.setProperty('--navh', navHeight() + 'px'); } catch (e) { /* ignora */ }
  $('#view').innerHTML = '<div class="wrap"><div id="evHeader" class="evh"></div><nav class="tabs" id="evTabs" role="tablist" aria-label="Sezioni"></nav><div id="evBody" class="sheet"></div><div id="evBar" class="evbar"></div></div>';
  $('#evTabs').innerHTML = tabsHTML(ev);
  renderHeader(); renderTabBody(); renderBar();
}
function markTabs() { $$('#evTabs .tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)); }); }
function updateTabCount() { var ev = curEv(); if (!ev) return; var s = taskStats(ev), n = $('.tcount'); if (n) n.textContent = s.done + '/' + s.total; }

function amInvolved(ev) { var k = meKey(); return !!k && involvedKeys(ev).indexOf(k) >= 0; }
function readBar(ev) {
  if (isOrg() || isClosed(ev) || !amInvolved(ev)) return '';
  var k = meKey(), r = ev.reads && ev.reads[k];
  if (r && r >= ev.updatedAt) return '<div class="readbar ok"><p>Hai letto l\'ordine di servizio (aggiornato il ' + esc(stamp(ev.updatedAt)) + ').</p></div>';
  var msg = r ? 'L\'ordine di servizio è stato aggiornato il ' + esc(stamp(ev.updatedAt)) + ', dopo la tua ultima lettura.' : 'Leggi l\'ordine di servizio e conferma di averlo letto.';
  return '<div class="readbar"><p>' + msg + '</p><div class="acts"><button class="btn quiet small" data-act="ods">Apri</button><button class="btn primary small" data-act="read-ack">Ho letto</button></div></div>';
}
function syncLabel() {
  var it = ui.id && store[ui.id]; if (!it) return '';
  if (it.failed) return 'Non sincronizzato' + (lastError ? ' (' + lastError + ')' : ': riprovo appena torna la connessione');
  if (it.inflight || it.queue.length) return 'Salvataggio…';
  return '';
}
function renderSync() {
  var t = syncLabel(), s = $('#syncState'); if (s) { s.textContent = t; s.className = 'sync' + (t.indexOf('Non') === 0 ? ' bad' : ''); }
  var b = $('#barState'); if (b) { b.textContent = barStateText(); b.className = 'bar-state' + (t.indexOf('Non') === 0 ? ' bad' : ''); }
}
function renderHeader() {
  var ev = curEv(), h = $('#evHeader'); if (!ev || !h) return;
  var st = taskStats(ev), org = isOrg();
  var status = org ? '<select class="in status" data-f="status" aria-label="Stato">' + opts([['bozza', 'Bozza'], ['confermato', 'Confermato'], ['concluso', 'Concluso']], ev.status) + '</select>' : '<span class="pill">' + STATUS_LABEL[ev.status] + '</span>';
  h.innerHTML = '<button class="link back" data-act="list">‹ Tutti gli eventi</button>' +
    '<h1>' + esc(ev.title || 'Senza nome') + '</h1>' +
    '<div class="when"><span>' + esc(fmtLong(ev.date)) + (ev.times.arrival ? ', ospiti dalle ' + esc(ev.times.arrival) : '') + '</span><span class="countdown">' + esc(whenLabel(ev.date)) + '</span></div>' +
    '<p class="upd">Aggiornato il ' + esc(stamp(ev.updatedAt)) + ' <span id="syncState" class="sync"></span></p>' +
    '<div class="evh-actions">' + status + '</div>' +
    readBar(ev) +
    '<div class="prog"><div class="progress" role="progressbar" aria-label="Compiti fatti" aria-valuemin="0" aria-valuemax="' + st.total + '" aria-valuenow="' + st.done + '"><i style="width:' + st.pct + '%"></i></div><span>' + st.done + ' di ' + st.total + ' compiti fatti</span></div>';
  renderSync();
}
function flowInner(ev) {
  var idx = TABS.map(function (t) { return t[0]; }).indexOf(ui.tab), next = TABS[idx + 1];
  var iss = isClosed(ev) ? [] : computeMissing(ev).filter(function (x) { return x.tab === ui.tab; });
  var state = iss.length
    ? '<div class="flow-state todo"><b>' + (iss.length === 1 ? 'Manca 1 cosa in questa sezione' : 'Mancano ' + iss.length + ' cose in questa sezione') + '</b><ul>' + iss.slice(0, 4).map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ul><p class="note">Puoi andare avanti lo stesso: le ritrovi in «Cosa manca», nel Riepilogo.</p></div>'
    : '<div class="flow-state ok">✓ Sezione a posto</div>';
  return state + '<button class="btn primary big" data-act="next-tab">' + (next ? 'Conferma e vai a «' + esc(next[1]) + '» ›' : 'Conferma e salva l\'ODS ›') + '</button>';
}
function renderTabBody() {
  var ev = curEv(), b = $('#evBody'); if (!ev || !b) return;
  var fn = { riepilogo: tabRiepilogo, servizi: tabServizi, allergie: tabAllergie, menu: tabMenu, compiti: tabCompiti, scaletta: tabScaletta, sala: tabSala }[ui.tab] || tabRiepilogo;
  b.innerHTML = fn(ev) + (isOrg() ? '<div id="flowFoot" class="flow">' + flowInner(ev) + '</div>' : '');
}
function refreshLive() {
  if (ui.view !== 'event') return;
  renderHeader(); updateTabCount(); updateTabDots();
  var ev = curEv();
  var ff = $('#flowFoot'); if (ff && ev) ff.innerHTML = flowInner(ev);
  if (ui.tab === 'riepilogo') { var b = $('#missingBox'); if (b) b.innerHTML = missingHTML(ev); }
  if (ui.tab === 'servizi') {
    var a = $('#winesTotals'); if (a) a.innerHTML = winesTotalsHTML(ev);
    var t = $('#tariffTotals'); if (t) t.innerHTML = tariffTotalsHTML(ev);
  }
  if (ui.tab === 'sala') {
    ev.rooms.forEach(function (r) { var n = $('#rc-' + r.id); if (n) n.textContent = roomCountText(r); });
    var st = $('#seatsTotals'); if (st) st.innerHTML = seatsTotalsHTML(ev);
  }
}

/* ---- Riepilogo ---- */
function missingHTML(ev) {
  if (isClosed(ev)) return '<div class="missing ok"><h2>Evento concluso</h2><p class="lead">La scheda resta consultabile. Per riaprirla cambia lo stato in alto.</p></div>';
  if (!isOrg()) {
    var mine = ev.tasks.filter(function (t) { return isMineT(t) && !t.done; });
    if (!mine.length) return '<div class="missing ok"><h2>Hai finito</h2><p class="lead">Nessun compito aperto per te in questo evento.</p></div>';
    return '<div class="missing"><h2>Hai ' + mine.length + (mine.length === 1 ? ' compito' : ' compiti') + ' da fare</h2><p class="lead">Aprili dalla scheda Compiti e spuntali quando sono fatti.</p>' +
      mine.slice(0, 4).map(function (t) { return '<button class="mi' + (isLate(ev, t) ? '' : ' amber') + '" data-act="goto" data-tab="compiti"><span class="dot"></span><span class="t">' + esc(t.text) + '</span><span class="go">Vai</span></button>'; }).join('') + '</div>';
  }
  var items = computeMissing(ev);
  if (!items.length) return '<div class="missing ok"><h2>Tutto in ordine</h2><p class="lead">Non manca niente. Rileggi l\'ordine di servizio con la squadra prima del servizio.</p><button class="btn primary" data-act="ods">Apri l\'ordine di servizio</button></div>';
  var reds = items.filter(function (i) { return i.sev === 'red'; }).length;
  return '<div class="missing"><h2>' + (items.length === 1 ? 'Manca 1 cosa' : 'Mancano ' + items.length + ' cose') + '</h2><p class="lead">' + (reds ? (reds === 1 ? '1 è urgente.' : reds + ' sono urgenti.') : 'Niente di urgente, ma meglio sistemarle.') + '</p>' +
    items.map(function (i) { return '<button class="mi ' + i.sev + '" data-act="goto" data-tab="' + i.tab + '" data-anchor="' + i.anchor + '"><span class="dot"></span><span class="t">' + esc(i.text) + '</span><span class="go">Vai</span></button>'; }).join('') + '</div>';
}
function readHTML(ev) {
  var inv = involvedKeys(ev);
  if (!inv.length) return '<p class="note" style="margin-top:0">Appena assegni compiti, scaletta o personale, qui vedi chi ha letto l\'ordine di servizio.</p>';
  var n = inv.filter(function (k) { return readOK(ev, k); }).length;
  return '<p class="note" style="margin:0 0 6px">Letto da ' + n + ' su ' + inv.length + '. Se modifichi servizi, allergie, tariffe, scaletta o note, chi l\'aveva già letto deve rileggerlo.</p>' +
    inv.map(function (k) {
      var p = personBy(k), r = ev.reads && ev.reads[k], st;
      if (readOK(ev, k)) st = '<span class="flag ok">Letto il ' + esc(stamp(r)) + '</span>';
      else if (r) st = '<span class="flag amber">Da rileggere</span>';
      else st = '<span class="flag red">Non ancora letto</span>';
      return '<div class="rl">' + avatar(p) + '<b>' + esc(p.name) + '</b>' + st + '</div>';
    }).join('');
}
// Solo per gli ordini creati prima: ora diete, allergie e intolleranze si indicano in un posto solo (scheda Allergie)
function dietsHTML(ev) {
  if (!ev.diets.length) return '';
  var adm = isOrg();
  var rows = ev.diets.map(function (g) {
    return '<li class="dietrow"><span>' + esc(g.label) + '</span><b>' + (Number(g.qty) || 0) + ' pax</b>' + (adm ? '<button class="link danger" data-act="del-item" data-list="diets" data-id="' + g.id + '">Togli</button>' : '') + '</li>';
  }).join('');
  return '<div class="legacy"><h3 class="sub">Diete indicate in precedenza</h3><p class="note" style="margin:0 0 6px">Erano nel Riepilogo. Ora si indicano qui sopra, come ospiti con esigenze: togli queste quando le hai riportate.</p><ul class="list">' + rows + '</ul></div>';
}
function coversTotalHTML(ev) { var t = coversTotal(ev); return '<b>' + t + (t === 1 ? ' coperto' : ' coperti') + '</b>' + (t ? ': ' + esc(coversText(ev)) : ''); }
// «Servono seggioloni?»: scelte rapide finché non è indicato
function hcAskHTML(ev) {
  var k = Number(ev.covers.kids) || 0; if (!isOrg() || k <= 0 || ev.covers.highchairs !== '') return '';
  var n = Math.min(k, 6), b = '<button type="button" class="chip" data-act="set-hc" data-v="0">Nessuno</button>';
  for (var i = 1; i <= n; i++) b += '<button type="button" class="chip" data-act="set-hc" data-v="' + i + '">' + i + '</button>';
  return '<p class="note" style="margin:6px 0 4px">Servono seggioloni? Quanti dei ' + k + (k === 1 ? ' bambino' : ' bambini') + ':</p><div class="chips">' + b + '</div>';
}
function updateCoversLive(ev) {
  var t = $('#coversTotal'); if (t) t.innerHTML = coversTotalHTML(ev);
  var w = $('#hcWrap'); if (w) w.hidden = !(Number(ev.covers.kids) > 0);
  var a = $('#hcAsk'); if (a) a.innerHTML = hcAskHTML(ev);
}
function tabRiepilogo(ev) {
  var c = ev.covers, lockBy = addDays(ev.date, -3), adm = isOrg();
  return '<div class="sec first" id="missingBox">' + missingHTML(ev) + '</div>' +
    '<section class="sec" id="sec-covers"><h2>Coperti</h2><p class="lead">Il numero degli ospiti si indica qui, una volta sola: adulti e bambini. Se ci sono bambini, ti chiedo quanti hanno bisogno del seggiolone.</p>' +
    '<div class="grid nums">' + field('Adulti', 'covers.adults', c.adults, { type: 'number' }) + field('Bambini', 'covers.kids', c.kids, { type: 'number' }) +
    '<div class="fld span2" id="hcWrap"' + (Number(c.kids) > 0 ? '' : ' hidden') + '>' + field('Di cui con seggiolone', 'covers.highchairs', c.highchairs, { type: 'number' }) + '<div id="hcAsk">' + hcAskHTML(ev) + '</div></div></div>' +
    '<p class="covers-total" id="coversTotal">' + coversTotalHTML(ev) + '</p>' +
    '<div class="grid nums" style="margin-top:10px">' + field('Pax garantiti (facoltativo)', 'covers.guaranteed', c.guaranteed, { type: 'number' }) + '</div>' +
    '<div style="margin-top:10px">' + (adm ? toggle('covers.locked', c.locked, 'Pax garantiti bloccati') : '<p class="note">' + (c.locked ? 'Pax garantiti bloccati.' : 'Pax garantiti non ancora bloccati.') + '</p>') + '</div>' +
    '<p class="note">Il numero garantito di solito si blocca 48-72 ore prima dell\'evento. Il promemoria scatta ' + esc(fmtShort(lockBy)) + ' (72 ore prima).</p>' +
    '</section>' +
    (adm ? '<section class="sec" id="sec-lettura"><h2>Presa visione</h2>' + readHTML(ev) + '</section>' : '') +
    '<section class="sec" id="sec-details"><h2>Dettagli</h2><div class="grid">' +
    field("Nome dell'evento", 'title', ev.title, { span: 2 }) +
    field('Data', 'date', ev.date, { type: 'date', show: fmtLong }) +
    select("Responsabile dell'evento", 'lead', ev.lead, peopleList('Non assegnato', true)) +
    field('Allestimento da', 'times.setup', ev.times.setup, { type: 'time' }) +
    field('Arrivo ospiti', 'times.arrival', ev.times.arrival, { type: 'time' }) +
    field('Fine prevista', 'times.end', ev.times.end, { type: 'time' }) +
    field('Referente del cliente', 'client.name', ev.client.name, { ph: 'Nome e cognome' }) +
    field('Telefono', 'client.phone', ev.client.phone, { type: 'tel' }) +
    field('Acconto (€)', 'billing.deposit', ev.billing.deposit, { type: 'number' }) +
    '<div class="fld">' + toggle('billing.depositIn', ev.billing.depositIn, 'Acconto ricevuto') + '</div>' +
    field('Intestazione fattura', 'billing.invoiceTo', ev.billing.invoiceTo, { span: 2 }) +
    '</div>' + (adm ? '<p style="margin-top:22px"><button class="link danger" data-act="del-event">Elimina questo ordine di servizio</button></p>' : '') + '</section>';
}

/* ---- Servizi, vini, tariffe ---- */
function winesTotalsHTML(ev) {
  var guests = guestsOf(ev), inc = winesIncluded(ev);
  var ratio = (inc > 0 && guests) ? ' (una ogni ' + String((guests / inc).toFixed(1)).replace('.', ',') + ' pax)' : '';
  return (inc > 0 ? '<p class="total">Bottiglie incluse: ' + inc + ratio + '</p>' : '') + (ev.winePolicy === 'tutti' && ev.wines.length ? '<p class="note">Tutti a pagamento: le bottiglie incluse non vengono contate.</p>' : '');
}
function tariffTotalsHTML(ev) { var tt = tariffTotal(ev); return tt.qty > 0 ? '<p class="total">Incasso previsto € ' + esc(money(tt.total)) + ' per ' + tt.qty + ' pax</p>' : ''; }
function winesHTML(ev) {
  var adm = isOrg();
  var svOpts = [['', "Tutto l'evento"]].concat(ev.services.map(function (s) { return [s.id, s.name || 'Servizio']; }));
  var rows = ev.wines.map(function (w) {
    var o = { list: 'wines', id: w.id };
    return '<li class="rowform">' + field('Vino', 'name', w.name, { list: 'wines', id: w.id, span: 2, ph: 'Es. Fumin, Blanc de Morgex' }) +
      field('Bottiglie incluse', 'bottles', w.bottles, { type: 'number', list: 'wines', id: w.id }) +
      field('Prezzo a bottiglia (€)', 'price', w.price, { type: 'number', list: 'wines', id: w.id }) +
      select('Servizio', 'service', w.service, svOpts, o) +
      '<div class="fld">' + toggle('paid', w.paid, 'A pagamento', o) + '</div>' +
      (adm ? '<div class="full"><button class="link danger" data-act="del-item" data-list="wines" data-id="' + w.id + '">Rimuovi</button></div>' : '') + '</li>';
  }).join('');
  return '<section class="sec" id="sec-vini"><h2>Vini</h2><p class="lead">I vini inclusi, con le bottiglie comprese nel prezzo. Un vino segnato «a pagamento» si paga a parte: scrivi il prezzo se vuoi che compaia.</p>' +
    '<div class="grid">' + select('Come si pagano i vini', 'winePolicy', ev.winePolicy, [['elenco', 'Inclusi quelli in elenco, il resto a pagamento'], ['tutti', 'Tutti i vini a pagamento']], { span: 2 }) + '</div>' +
    (rows ? '<ul class="list" style="margin-top:8px">' + rows + '</ul>' : '<p class="empty">Nessun vino indicato.</p>') +
    '<div id="winesTotals">' + winesTotalsHTML(ev) + '</div>' +
    (adm ? '<div style="margin-top:12px"><button class="btn quiet small" data-act="add-wine">Aggiungi vino</button></div>' : '') + '</section>';
}
function tabServizi(ev) {
  var adm = isOrg();
  var sv = ev.services.map(function (s) {
    return '<li class="svc"><div class="grid">' +
      combo('Servizio', 'name', s.name, SERVICE_NAMES, { list: 'services', id: s.id, ph: 'Es. Aperitivo di benvenuto' }) +
      field('Ora', 'time', s.time, { type: 'time', list: 'services', id: s.id }) +
      field("Giorno (vuoto = giorno dell'evento)", 'date', s.date, { type: 'date', list: 'services', id: s.id, show: fmtLong }) +
      combo('Luogo', 'place', s.place, PLACE_NAMES, { list: 'services', id: s.id, ph: 'Es. terrazza e soggiorno' }) +
      field('Beverage', 'beverage', s.beverage, { type: 'textarea', rows: 3, list: 'services', id: s.id, ph: 'Acqua, analcolico… un\'altra bevanda per riga. I vini li inserisci nella sezione Vini', span: 2 }) +
      '</div>' + (adm ? '<button class="link danger" data-act="del-item" data-list="services" data-id="' + s.id + '">Rimuovi questo servizio</button>' : '') + '</li>';
  }).join('');
  var tr = ev.tariffs.map(function (r) {
    return '<li class="rowform">' + field('Tariffa', 'label', r.label, { list: 'tariffs', id: r.id, span: 2 }) +
      field('Prezzo a persona (€)', 'price', r.price, { type: 'number', list: 'tariffs', id: r.id }) + field('Pax', 'qty', r.qty, { type: 'number', list: 'tariffs', id: r.id }) +
      field('Nota', 'note', r.note, { list: 'tariffs', id: r.id, span: 2, ph: 'Es. bevande a tavola escluse' }) +
      (adm ? '<div class="full"><button class="link danger" data-act="del-item" data-list="tariffs" data-id="' + r.id + '">Rimuovi</button></div>' : '') + '</li>';
  }).join('');
  return '<section class="sec first" id="sec-servizi"><h2>Servizi</h2><p class="lead">Un blocco per ogni momento: colazione, pranzo, merenda, aperitivo, cena. Se l\'evento dura più giorni, scegli il giorno di ciascun servizio. I piatti si inseriscono dopo le allergie, nella scheda «Menu e piatti».</p>' +
    (sv ? '<ul class="list">' + sv + '</ul>' : '<p class="empty">Nessun servizio.</p>') +
    (adm ? '<div class="addchips"><span class="fl">Aggiungi servizio</span><div class="chips">' + SERVICE_PRESETS.map(function (p) { return '<button class="chip" data-act="add-service" data-name="' + (p[0] === 'Altro' ? '' : esc(p[0])) + '" data-time="' + p[1] + '">' + esc(p[0]) + '</button>'; }).join('') + '</div></div>' : '') + '</section>' +
    winesHTML(ev) +
    '<section class="sec" id="sec-tariffe"><h2>Tariffe</h2><p class="lead">Una riga per tipo di ospite. I pax per tariffa servono a controllare il conto: devono sommare ai pax dell\'evento.</p>' +
    (tr ? '<ul class="list">' + tr + '</ul>' : '<p class="empty">Nessuna tariffa.</p>') +
    '<div id="tariffTotals">' + tariffTotalsHTML(ev) + '</div>' +
    (adm ? '<div style="margin-top:12px"><button class="btn quiet small" data-act="add-tariff">Aggiungi tariffa</button></div>' : '') + '</section>';
}

/* ---- Allergie ---- */
function alChipsHTML(selected, attrs) {
  var sel = (selected || []).map(norm), all = ALLERGENS.concat(EXTRA_AVOID);
  return all.map(function (a) { return '<button type="button" class="chip' + (sel.indexOf(norm(a)) >= 0 ? ' on' : '') + '" ' + attrs + ' data-v="' + esc(a) + '">' + esc(a) + '</button>'; }).join('');
}
function alCard(a, adm) {
  var its = itemsOf(a);
  return '<li class="al' + (a.informed ? ' is-informed' : '') + '"><div class="al-main"><div><b>' + (Number(a.pax) || 1) + ' pax, ' + esc(a.who || 'Ospite') + '</b><span class="kind' + (HARD[a.kind] ? ' hard' : '') + '">' + esc(KIND_LABEL[a.kind] || '') + '</span></div>' +
    (its.length ? '<div class="chips">' + its.map(function (x) { return '<span class="chip static on">' + esc(x.label) + '</span>'; }).join('') + '</div>' : '<p class="note" style="margin:0;color:var(--amber)">Non hai indicato cosa non può mangiare: senza, nel menu non posso chiedertelo per i piatti.</p>') +
    (a.note ? '<p class="note" style="margin:0">' + esc(a.note) + '</p>' : '') + '</div>' +
    '<div class="al-side"><label class="toggle"><input type="checkbox" data-act="tick-allergy" data-id="' + a.id + '"' + (a.informed ? ' checked' : '') + '><span class="sw"></span><span>Cucina avvisata</span></label>' +
    (adm ? '<button class="link" data-act="al-edit" data-id="' + a.id + '">Modifica</button><button class="link danger" data-act="del-item" data-list="allergies" data-id="' + a.id + '">Rimuovi</button>' : '') + '</div></li>';
}
function alEditCard(a) {
  var o = { list: 'allergies', id: a.id };
  return '<li class="al editing"><div class="al-main"><div class="grid">' + field('Ospite o tavolo', 'who', a.who, { list: 'allergies', id: a.id, span: 2 }) + field('Pax', 'pax', a.pax, { type: 'number', list: 'allergies', id: a.id }) + select('Tipo', 'kind', a.kind, KINDS, o) + '</div>' +
    '<div><span class="fl">Cosa non può mangiare</span><div class="chips">' + alChipsHTML(a.allergens, 'data-act="al-toggle" data-id="' + a.id + '"') + '</div></div>' +
    '<div class="grid">' + field('Altro (es. mango, funghi)', 'other', a.other, { list: 'allergies', id: a.id, span: 2, ph: 'Separa con la virgola' }) + field('Dettagli (facoltativo)', 'note', a.note, { list: 'allergies', id: a.id, span: 2 }) + '</div></div>' +
    '<div class="al-side"><button class="btn primary small" data-act="al-edit" data-id="' + a.id + '">Fatto</button></div></li>';
}
function tabAllergie(ev) {
  var adm = isOrg(), items = allItems(ev);
  var list = ev.allergies.map(function (a) { return adm && ui.editAl[a.id] ? alEditCard(a) : alCard(a, adm); }).join('');
  var none = '';
  if (!ev.allergies.length) none = adm ? '<label class="toggle"><input type="checkbox" data-f="noAllergies"' + (ev.noAllergies ? ' checked' : '') + '><span class="sw"></span><span>Confermato: nessuna allergia o intolleranza</span></label>' : '<p class="note">' + (ev.noAllergies ? 'Confermato: nessuna allergia.' : 'Allergie ancora da raccogliere.') + '</p>';
  var formOpen = adm && (!ev.allergies.length || ui.alForm);
  var form = !adm ? '' : (formOpen
    ? '<div class="allergy-form"><div><h3 class="step"><span class="n">1</span>Chi</h3><div class="grid"><label class="fld span2"><span class="fl">Ospite o tavolo</span><input class="in" id="alWho" placeholder="Es. Sig.ra Rossi, tavolo 4"></label>' +
      '<label class="fld"><span class="fl">Pax</span><input class="in" type="number" inputmode="numeric" min="1" id="alPax" value="1"></label></div></div>' +
      '<div><h3 class="step"><span class="n">2</span>Cosa non può mangiare</h3><div class="chips" id="alChips">' + alChipsHTML([], 'data-act="al-chip"') + '</div>' +
      '<label class="fld" style="margin-top:10px"><span class="fl">Altro (es. mango, funghi): separa con la virgola</span><input class="in" id="alOther" placeholder="Es. mango"></label></div>' +
      '<div><h3 class="step"><span class="n">3</span>Dettagli <small>(facoltativo)</small></h3><div class="grid"><label class="fld"><span class="fl">Tipo</span><select class="in" id="alKind">' + opts(KINDS, 'allergia') + '</select></label>' +
      '<label class="fld"><span class="fl">Nota</span><input class="in" id="alNote" placeholder="Es. allergia forte"></label></div></div>' +
      '<div class="addrow-2"><button class="btn primary small" data-act="add-allergy">Aggiungi</button>' + (ev.allergies.length ? '<button class="btn quiet small" data-act="al-new-close">Annulla</button>' : '') + '</div></div>'
    : '<p style="margin:14px 0 0"><button class="btn quiet" data-act="al-new">+ Aggiungi un altro ospite</button></p>');
  var next = items.length ? '<p class="note callout-note">Nella scheda <b>Menu e piatti</b> ti chiederò, per ogni piatto, se prevede: ' + esc(items.map(function (i) { return i.label.toLowerCase(); }).join(', ')) + '. Lì potrai scrivere anche il piatto alternativo.</p>' : '';
  return '<section class="sec first" id="sec-allergie"><h2>Allergie e intolleranze</h2><p class="lead">Le indichi qui, una volta sola. Poi, per ogni piatto del menu, ti chiedo se contiene quello che non possono mangiare. Anche «non mangia pesce» va comunicato: segna quando la cucina è stata avvisata.</p>' +
    (list ? '<ul class="list">' + list + '</ul>' : '') + none + form + next + dietsHTML(ev) + '</section>';
}

/* ---- Compiti ---- */

function dishFlag(ev, dish) {
  if (!canChef()) {                                   // chi legge: conta solo cosa serve fare in cucina
    var gs = conflictGroups(ev, dish); if (!gs.length) return '';
    var miss = gs.some(function (g) { return !g.alt; });
    return '<span class="flag ' + (miss ? 'red' : 'amber') + '">' + (miss ? 'alternativa da definire' : gs.length + (gs.length === 1 ? ' alternativa' : ' alternative')) + '</span>';
  }
  var q = openQuestions(ev, dish).length;
  if (q) return '<span class="flag amber">' + q + (q === 1 ? ' domanda' : ' domande') + '</span>';
  if (conflictGroups(ev, dish).some(function (g) { return !g.alt; })) return '<span class="flag red">manca l\'alternativa</span>';
  return allItems(ev).length ? '<span class="flag ok">a posto</span>' : '';
}
function dishYN(dish, i, ca) {
  var a = answerOf(dish, i.k), lab = esc(i.label.toLowerCase()), isYes = i.diet ? a === false : a === true, isNo = i.diet ? a === true : a === false;
  if (!ca) return '<b>' + (a === null ? 'Da rispondere' : ((i.diet ? !a : a) ? 'Sì' : 'No')) + '</b>';
  var at = 'data-act="dish-ans" data-id="' + dish.id + '" data-k="' + esc(i.k) + '"' + (i.diet ? ' data-diet="1"' : '');
  return '<span class="yn" role="group" aria-label="' + (i.diet ? 'Il piatto è adatto a ' : 'Il piatto contiene ') + lab + '?"><button type="button" class="yn-b yes' + (isYes ? ' on' : '') + (i.diet ? ' diet' : '') + '" aria-pressed="' + isYes + '" ' + at + ' data-v="1">Sì</button><button type="button" class="yn-b no' + (isNo ? ' on' : '') + (i.diet ? ' diet' : '') + '" aria-pressed="' + isNo + '" ' + at + ' data-v="0">No</button></span>';
}
function dishCard(ev, dish) {
  var org = isOrg(), ca = canChef(), items = allItems(ev), open = !!ui.openDish[dish.id], id = dish.id;
  var head = '<button type="button" class="dish-sum" data-act="dish-toggle" data-id="' + id + '" aria-expanded="' + open + '"><span class="dish-name">' + esc(dish.name || 'Piatto senza nome') + '</span><span id="dflag-' + id + '">' + dishFlag(ev, dish) + '</span><span class="chev" aria-hidden="true"></span></button>';
  if (!open) return '<li class="dish" id="dish-' + id + '">' + head + '</li>';
  var tools = org ? '<div class="dish-tools"><label class="fld"><span class="fl">Nome del piatto</span><input class="in" data-list="dishes" data-id="' + id + '" data-f="name" value="' + esc(dish.name) + '"></label><button class="link danger" data-act="del-item" data-list="dishes" data-id="' + id + '">Rimuovi il piatto</button></div>' : '';
  var todo = openQuestions(ev, dish).length;
  var bulk = (ca && todo > 1) ? '<button type="button" class="btn quiet small dish-allno" data-act="dish-allno" data-id="' + id + '">Va bene per tutti: segna «nessuna» alle ' + todo + ' domande</button>' : '';
  if (!ca) {                                          // formato di lettura (cuoco, sala): contenuto e alternative, niente domande
    var cont = items.filter(function (i) { return answerOf(dish, i.k) === true; }).map(function (i) { return i.label.toLowerCase(); });
    var line = cont.length ? '<p class="dish-cont"><b>Contiene o non adatto a:</b> ' + esc(cont.join(', ')) + '</p>' : (openQuestions(ev, dish).length ? '<p class="note">Allergie di questo piatto ancora da verificare.</p>' : '<p class="note">Nessuna allergia segnalata per questo piatto.</p>');
    var alts2 = conflictGroups(ev, dish).map(function (g) { return '<div class="alt' + (g.alt ? '' : ' todo') + '"><span class="fl">Per ' + esc(groupWho(g)) + ' (' + esc(g.reason) + ')</span><span class="ro' + (g.alt ? '' : ' empty') + '">' + (g.alt ? esc(g.alt) : 'Alternativa da definire') + '</span></div>'; }).join('');
    return '<li class="dish is-open" id="dish-' + id + '">' + head + '<div class="dish-body">' + line + alts2 + '</div></li>';
  }
  var qs = items.map(function (i) {
    var a = answerOf(dish, i.k), lab = esc(i.label.toLowerCase());
    return '<li class="q' + (a === null ? ' todo' : '') + '"><span class="qt">' + (i.diet ? 'Questo piatto è adatto a <b>' + lab + '</b>?' : 'Questo piatto prevede l\'utilizzo di <b>' + lab + '</b>?') + '</span>' + dishYN(dish, i, ca) + '</li>';
  }).join('');
  var alts = conflictGroups(ev, dish).map(function (g) {
    return '<div class="alt' + (g.alt ? '' : ' todo') + '"><span class="fl">Per ' + esc(groupWho(g)) + ' (' + esc(g.reason) + '): piatto alternativo</span>' +
      (ca ? '<input class="in" data-alt="1" data-dish="' + id + '" data-ids="' + esc(g.ids.join(',')) + '" value="' + esc(g.alt) + '" placeholder="Es. risotto ai funghi" aria-label="Piatto alternativo">' : '<span class="ro' + (g.alt ? '' : ' empty') + '">' + (g.alt ? esc(g.alt) : 'Da definire') + '</span>') + '</div>';
  }).join('');
  return '<li class="dish is-open" id="dish-' + id + '">' + head + '<div class="dish-body">' + tools + bulk + (qs ? '<ul class="qs">' + qs + '</ul>' : (isOrg() ? '<p class="note">Nessuna allergia indicata: niente domande per questo piatto.</p>' : '')) + alts + '</div></li>';
}
function redrawDish(did) {
  var ev = curEv(), dd = ev && findItem(ev, 'dishes', did), li = $('#dish-' + did); if (!ev || !dd) return;
  if (li) { var tmp = document.createElement('div'); tmp.innerHTML = dishCard(ev, dd); li.replaceWith(tmp.firstChild); }
  refreshLive();
}
function menuServiceHTML(ev, s) {
  var org = isOrg(), ds = dishesOf(ev, s.id), legacy = String(s.food || '').trim(), id = s.id;
  if (ui.dishFilter === 'allergie') { ds = ds.filter(function (x) { return conflictGroups(ev, x).length; }); if (!ds.length) return ''; }
  var cl = (org && legacy && !ds.length) ? '<div class="callout"><p>Hai già scritto il menu come testo. Trasformalo in piatti per poter segnare le allergie piatto per piatto.</p><pre>' + esc(legacy) + '</pre><button class="btn quiet small" data-act="food-to-dishes" data-svc="' + id + '">Trasforma in piatti</button></div>' : '';
  var add = org ? '<div class="dish-add"><input class="in" data-dishname="1" data-svc="' + id + '" data-enter="add-dish" placeholder="Nome del piatto, poi Invio" aria-label="Nuovo piatto"><button class="btn primary small" data-act="add-dish" data-svc="' + id + '">Aggiungi piatto</button></div>' +
    '<details class="menu-paste"><summary>Incolla un menu intero (un piatto per riga)</summary><textarea class="in" rows="5" data-paste="' + id + '" aria-label="Menu da incollare"></textarea><button class="btn quiet small" data-act="paste-dishes" data-svc="' + id + '">Crea i piatti</button></details>' : '';
  return '<section class="sec menu-svc" id="msv-' + id + '"><h3>' + (id ? svcTitle(s) : esc(s.name)) + '</h3>' + cl +
    (ds.length ? '<ul class="dishes">' + ds.map(function (x) { return dishCard(ev, x); }).join('') + '</ul>' : (cl ? '' : '<p class="empty" style="padding:6px 0">Nessun piatto ancora.</p>')) + add + '</section>';
}
function tabMenu(ev) {
  var items = allItems(ev), sorted = sortedServices(ev);
  var banner = items.length
    ? '<details class="menu-allergy"><summary><b>' + items.length + (items.length === 1 ? ' voce' : ' voci') + (canChef() ? ' da controllare su ogni piatto' : ' controllate su ogni piatto') + '</b> <span class="soft">(tocca per vederle)</span></summary><div class="chips">' + items.map(function (i) { return '<span class="chip static on">' + esc(i.label) + '</span>'; }).join('') + '</div></details>'
    : '<p class="note" style="margin:0 0 6px">' + (ev.noAllergies ? 'Nessuna allergia: confermato.' : 'Non hai ancora indicato allergie (scheda Allergie). Se le aggiungi, qui compariranno le domande per ogni piatto.') + '</p>';
  var withAl = ev.dishes.filter(function (x) { return conflictGroups(ev, x).length; }).length;
  if (ui.dishFilter === 'allergie' && !withAl) ui.dishFilter = 'all';
  if (withAl) banner += '<div class="chips filters"><button class="chip' + (ui.dishFilter !== 'allergie' ? ' sel' : '') + '" data-act="dish-filter" data-v="all">Tutti i piatti<span class="n">' + ev.dishes.length + '</span></button><button class="chip' + (ui.dishFilter === 'allergie' ? ' sel' : '') + '" data-act="dish-filter" data-v="allergie">Solo con allergie<span class="n">' + withAl + '</span></button></div>';
  var secs = sorted.map(function (s) { return menuServiceHTML(ev, s); }).join('');
  var allOpen = ev.dishes.length && ev.dishes.every(function (x) { return ui.openDish[x.id]; });
  banner += ev.dishes.length > 1 ? '<p class="dishes-ctl"><button class="link" data-act="' + (allOpen ? 'dishes-close-all' : 'dishes-open-all') + '">' + (allOpen ? 'Chiudi tutti i piatti' : 'Apri tutti i piatti') + '</button></p>' : '';
  var loose = looseDishes(ev);
  if (loose.length || !ev.services.length) secs += menuServiceHTML(ev, { id: '', name: "Tutto l'evento", food: '' });
  return '<section class="sec first" id="sec-menu"><h2>Menu e piatti</h2><p class="lead">' + (isOrg() ? 'Un servizio alla volta: aggiungi i piatti uno per uno. ' : 'Il menu dell\'evento, un servizio alla volta. ') + (isOrg() ? 'Poi rispondi alle domande sulle allergie e, se serve, scrivi l\'alternativa. Lo chef principale può correggerla.' : 'Tocca un piatto per vedere cosa contiene e quali alternative sono previste.') + '</p>' + banner + '</section>' + secs;
}
// «Non fatto» (con il perché) e i comandi del proprietario
function taskStateHTML(ev, t) {
  var at = 'data-id="' + t.id + '" data-ev="' + ev.id + '"';
  if (t.done) return '';
  if (t.notDone) {
    var who = t.notDoneBy ? (personBy(t.notDoneBy) || {}).name : '';
    return '<div class="nd-box"><b>Non fatto</b>' + (who ? ' da ' + esc(who) : '') + (t.reason ? ': ' + esc(t.reason) : '') + (canTick(t) && hasAss(t) ? ' <button type="button" class="link" data-act="task-reopen" ' + at + '>Rimetti da fare</button>' : '') + '</div>';
  }
  return (canTick(t) && hasAss(t)) ? '<button type="button" class="link nd-link" data-act="task-no" ' + at + '>Non lo faccio…</button>' : '';
}
// «Assegnato a»: una o più persone/reparti. Gli organizzatori toccano per cambiare.
function assignBtn(t, evId) {
  var ks = assOf(t);
  var chips = ks.length ? ks.map(function (k) { var p = personBy(k); return '<span class="who-chip">' + avatar(p) + esc(p ? p.name : '?') + '</span>'; }).join('') : '<span class="who-chip empty">Da assegnare</span>';
  if (!isOrg()) return '<span class="who-multi">' + chips + '</span>';
  return '<button type="button" class="who-btn' + (ks.length ? '' : ' is-empty') + '" data-act="pick-assign" data-id="' + t.id + '"' + (evId ? ' data-ev="' + evId + '"' : '') + ' aria-label="Scegli a chi assegnarlo (anche più persone)">' + chips + '<span class="who-edit" aria-hidden="true">Cambia</span></button>';
}
function dueEditor(t) {
  var cur = t.dueDate ? '@date' : (t.phase || '');
  var o = '<option value=""' + (cur === '' ? ' selected' : '') + '>Senza scadenza</option>' + PHASES.map(function (p) { return '<option value="' + p.k + '"' + (cur === p.k ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') + '<option value="@date"' + (cur === '@date' ? ' selected' : '') + '>Una data precisa…</option>';
  return '<span class="due-edit"><select class="in tiny" data-due="1" data-id="' + t.id + '" aria-label="Scadenza">' + o + '</select>' + (cur === '@date' ? '<input class="in tiny" type="date" data-list="tasks" data-id="' + t.id + '" data-f="dueDate" value="' + esc(t.dueDate) + '" aria-label="Data di scadenza">' : '') + '</span>';
}
function setDue(el) {
  var ev = curEv(); if (!ev || !isOrg()) return;
  var id = el.dataset.id, v = el.value, t0 = findItem(ev, 'tasks', id); if (!t0) return;
  edit(ev.id, function (d) {
    var x = findItem(d, 'tasks', id); if (!x) return;
    if (v === '@date') { if (!x.dueDate) x.dueDate = d.date; x.phase = ''; } else { x.phase = v; x.dueDate = ''; }
    if (!x.tpl) touch(d);
  }, { now: true });
  if (!t0.tpl) markUpdate(ev.id, 'note per reparto');
  afterListChange();
}
// Finestra per scegliere più persone/reparti insieme
function pickerHTML(sel) {
  function row(k, name) { var p = personBy(k); return '<label class="pk-row"><input type="checkbox" data-pk="' + esc(k) + '"' + (sel.indexOf(k) >= 0 ? ' checked' : '') + '><span class="pk-name">' + avatar(p) + esc(name) + '</span></label>'; }
  var known = {}; DEPTS.forEach(function (d) { known['d:' + d[0]] = 1; }); P().forEach(function (p) { known[p.key] = 1; });
  var gone = sel.filter(function (k) { return !known[k]; });
  return '<h2>Assegna a</h2><p class="note">Scegli una o più persone, anche insieme a un reparto. Chi è in un reparto scelto riceve comunque il compito.</p>' +
    '<h3 class="sub">Reparti</h3><div class="pk-list">' + DEPTS.map(function (d) { return row('d:' + d[0], d[1]); }).join('') + '</div>' +
    '<h3 class="sub">Persone</h3><div class="pk-list">' + P().map(function (p) { return row(p.key, p.name); }).join('') + gone.map(function (k) { return row(k, personBy(k).name + ' (non più in squadra)'); }).join('') + '</div>' +
    '<div class="sheet-foot"><button class="btn quiet" data-act="close">Annulla</button><button class="btn primary" data-act="pick-done">Fatto</button></div>';
}
function newWhoLabel() {
  var ks = ui.newWho || []; if (!ks.length) return 'Assegna a…';
  var nm = ks.map(function (k) { return (personBy(k) || {}).name || '?'; });
  return esc(nm.length > 2 ? nm.slice(0, 2).join(', ') + ' +' + (nm.length - 2) : nm.join(', '));
}
function taskRow(ev, t, showPhase) {
  var adm = isOrg(), can = canTick(t), late = isLate(ev, t), due = dueLabel(ev, t), dn = whenDone(t);
  return '<li class="task' + (t.done ? ' is-done' : '') + '">' + checkbox('tick-task', 'data-id="' + t.id + '"', t.done, !can, 'Segna come fatto') +
    '<div class="task-main">' + (adm ? '<input class="in plain" data-list="tasks" data-id="' + t.id + '" data-f="text" value="' + esc(t.text) + '" aria-label="Compito">' : '<span class="task-text">' + esc(t.text) + '</span>') +
    '<div class="task-meta">' + assignBtn(t) +
    (adm ? dueEditor(t) : (showPhase && t.phase ? '<span>' + esc(PH(t.phase).label) + '</span>' : '')) +
    (due ? '<span class="due' + (late ? ' late' : '') + '">' + esc(due) + '</span>' : '') + (dn ? '<span>' + esc(dn) + '</span>' : '') +
    (adm ? '<button class="link danger" data-act="del-item" data-list="tasks" data-id="' + t.id + '">Rimuovi</button>' : '') + '</div>' + taskStateHTML(ev, t) + '</div></li>';
}
function phasesHTML(ev, match, f) {
  var all = ev.tasks, ALL = [NOPHASE, DATED].concat(PHASES), pk = function (t) { return t.dueDate ? '@date' : (t.phase || ''); };
  var firstOpen = ALL.filter(function (p) { return all.some(function (t) { return pk(t) === p.k && !t.done; }); })[0];
  if (ui.openInit !== ev.id) { ALL.forEach(function (p) { ui.open[p.k] = !!(firstOpen && firstOpen.k === p.k); }); ui.openInit = ev.id; }
  return ALL.map(function (ph) {
    var list = all.filter(function (t) { return pk(t) === ph.k && match(t); });
    if (ph.k === '@date') list.sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    if (!list.length) return '';
    var tot = all.filter(function (t) { return pk(t) === ph.k; }), dn = tot.filter(function (t) { return t.done; }).length;
    var open = f !== 'tutti' ? true : !!ui.open[ph.k];
    var sub = ph.k === '@date' ? 'In ordine di data' : ph.off == null ? 'Nessuna data da rispettare' : (ph.off === 0 ? "Il giorno dell'evento" : (ph.off === 1 ? 'Il giorno dopo' : 'Entro ' + fmtShort(addDays(ev.date, ph.off))));
    return '<details class="phase' + (dn === tot.length ? ' is-complete' : '') + '" data-phase="' + ph.k + '"' + (open ? ' open' : '') + '><summary><div class="ph-t"><h3>' + ph.label + '</h3><span class="ph-sub">' + esc(sub) + '</span></div><span class="count">' + dn + '/' + tot.length + '</span></summary><ul class="tasks">' + list.map(function (t) { return taskRow(ev, t, false); }).join('') + '</ul></details>';
  }).join('');
}
function groupsHTML(ev, match) {
  var keys = DEPTS.map(function (d) { return 'd:' + d[0]; }).concat(P().map(function (p) { return p.key; }));
  ev.tasks.forEach(function (t) { assOf(t).forEach(function (a) { if (a && keys.indexOf(a) < 0) keys.push(a); }); });   // anche chi non è più in squadra
  keys.push('');
  var mk = meKey(), groups = keys.map(function (k) {
    var all = ev.tasks.filter(function (t) { return k ? assOf(t).indexOf(k) >= 0 : !hasAss(t); }), shown = all.filter(match);
    return shown.length ? { k: k, all: all, shown: shown } : null;
  }).filter(Boolean);
  return groups.map(function (g) {
    var p = g.k ? personBy(g.k) : { key: '', name: 'Da assegnare', noav: true };
    var sk = 'ev:' + ev.id + ':' + g.k;
    var dflt = g.k === mk || (g.k === '' && isOrg()) || groups.length === 1 || (ui.taskFilter || (isOrg() ? 'tutti' : 'miei')) !== 'tutti' || (g.k.indexOf('d:') === 0 && isMine(g.k));   // restano aperti: i miei, quelli da assegnare, quelli del mio reparto
    return groupCard(sk, p, g.all.map(function (t) { return { ev: ev, t: t }; }), function () {
      return '<ul class="tasks">' + g.shown.map(function (t) { return taskRow(ev, t, true); }).join('') + '</ul>';
    }, grpOpen(sk, dflt));
  }).join('');
}
function stdTasks(type) { return BASE_TASKS.concat(TYPE_TASKS[type] || []).map(function (r) { return mkTask(r, true); }); }
function mkTask(r, tpl) { return { id: uid('t'), phase: r[0], dueDate: '', text: r[1], assignee: '', assignees: [], done: false, doneBy: '', doneAt: '', notDone: false, reason: '', tpl: !!tpl }; }
function tabCompiti(ev) {
  var adm = isOrg(), f = ui.taskFilter || (adm ? 'tutti' : 'miei'), all = ev.tasks, grp = ui.taskGroup || 'chi';
  var C = { tutti: all.length, miei: all.filter(function (t) { return isMineT(t); }).length, senza: all.filter(function (t) { return !hasAss(t) && !t.done; }).length, fatti: all.filter(function (t) { return t.done; }).length };
  function match(t) { return f === 'tutti' || (f === 'miei' && isMineT(t)) || (f === 'senza' && !hasAss(t) && !t.done) || (f === 'fatti' && t.done); }
  var chips = [['tutti', 'Tutti'], ['miei', 'I miei'], ['senza', 'Da assegnare'], ['fatti', 'Fatti']].map(function (x) { return '<button class="chip' + (f === x[0] ? ' sel' : '') + '" data-act="filter" data-v="' + x[0] + '">' + x[1] + '<span class="n">' + C[x[0]] + '</span></button>'; }).join('');
  var seg = '<div class="chips seg"><button class="chip' + (grp === 'chi' ? ' sel' : '') + '" data-act="group" data-v="chi">Per persona</button><button class="chip' + (grp === 'fase' ? ' sel' : '') + '" data-act="group" data-v="fase">Per scadenza</button></div>';
  var body = grp === 'chi' ? groupsHTML(ev, match) : phasesHTML(ev, match, f);
  var whenOpts = [['', 'Senza scadenza']].concat(PHASES.map(function (p) { return [p.k, p.label]; })).concat([['@date', 'Una data precisa…']]);
  var add = adm ? '<div class="addrow"><input class="in" id="ntText" placeholder="Cosa c\'è da fare?" data-enter="add-task" aria-label="Nuovo compito"><div class="addrow-2"><button type="button" class="who-btn is-empty" id="ntWhoBtn" data-act="pick-new" aria-label="Assegna a (anche più persone)">' + newWhoLabel() + '</button><select class="in" id="ntPhase" aria-label="Scadenza (facoltativa)">' + opts(whenOpts, '') + '</select><input class="in" type="date" id="ntDate" value="' + esc(ev.date) + '" aria-label="Data di scadenza" hidden><button class="btn primary small" data-act="add-task">Aggiungi</button></div></div>' : '';
  var std = ev.tasks.filter(function (t) { return t.tpl; }), stdOpen = std.filter(function (t) { return !t.done; }).length;
  var tools = adm ? '<div class="tools">' + (std.length ? (stdOpen ? '<button class="link danger" data-act="remove-checklist">Togli la checklist standard (' + stdOpen + ' non fatti)</button>' : '') : '<button class="link" data-act="add-checklist">Aggiungi la checklist standard</button>') + '</div>' : '';
  var msg = { miei: 'Non hai compiti assegnati in questo evento.', senza: 'Tutti i compiti hanno un responsabile.', fatti: 'Ancora nessun compito fatto.', tutti: adm ? 'Ancora nessun compito. Scrivi il primo qui sopra: la scadenza è facoltativa. Se ti serve un punto di partenza puoi aggiungere la checklist standard.' : 'Ancora nessun compito.' }[f];
  return '<p class="note" style="margin:10px 0 0">Le note per reparto o persona che scrivi qui finiscono nell\'ordine di servizio stampato, sotto «Note». La checklist standard resta solo nell\'app.</p>' +
    '<div class="chips filters">' + chips + '</div>' + seg + add + (body || '<p class="empty">' + msg + '</p>') + tools;
}

/* ---- Scaletta ---- */
function tabScaletta(ev) {
  var adm = isOrg(), lines = sortedLines(ev);
  var rows = lines.map(function (l) {
    var canTick = adm || isMine(l.who);
    return '<li class="tl' + (l.done ? ' is-done' : '') + '">' + checkbox('tick-line', 'data-id="' + l.id + '"', l.done, !canTick, 'Fatto') +
      '<div class="tl-main"><div class="tl-head">' + (adm ? '<input class="in time" type="time" value="' + esc(l.time) + '" data-list="timeline" data-id="' + l.id + '" data-f="time" data-rr="1" aria-label="Orario (facoltativo)">' : (l.time ? '<b class="tl-time">' + esc(l.time) + '</b>' : '')) + whoPill('timeline', l.id, 'who', l.who, true) + '</div>' +
      (adm ? '<input class="in plain" data-list="timeline" data-id="' + l.id + '" data-f="what" value="' + esc(l.what) + '" aria-label="Cosa succede">' : '<span class="task-text">' + esc(l.what) + '</span>') +
      (adm ? '<div><button class="link danger" data-act="del-item" data-list="timeline" data-id="' + l.id + '">Rimuovi</button></div>' : '') + '</div></li>';
  }).join('');
  var add = adm ? '<div class="addrow"><input class="in" id="nlText" placeholder="Cosa succede? (es. Arrivo degli ospiti)" data-enter="add-line" aria-label="Cosa succede"><div class="addrow-2"><input class="in time" type="time" id="nlTime" value="" aria-label="Orario (facoltativo)"><select class="in" id="nlWho" aria-label="Chi">' + opts(peopleList(), '') + '</select><button class="btn primary small" data-act="add-line">Aggiungi</button></div><p class="note" style="margin:0">L\'orario è facoltativo: senza orario la voce va in fondo.</p></div>' : '';
  var tpl = (adm && !lines.length) ? '<p style="margin:12px 0 0"><button class="link" data-act="add-timeline-template">Parti da una scaletta tipo per questo evento</button></p>' : '';
  return '<section class="sec first"><h2>Scaletta</h2><p class="lead">Quello che succede, nell\'ordine che serve. Chi è assegnato a una voce (o il suo reparto) la spunta quando è fatta.</p>' +
    (adm && lines.some(function (l) { return l.time; }) ? '<div class="shift"><span>Sposta tutti gli orari</span><button class="btn quiet small" data-act="shift" data-m="-15">15 minuti prima</button><button class="btn quiet small" data-act="shift" data-m="15">15 minuti dopo</button></div>' : '') +
    (rows ? '<ul class="list">' + rows + '</ul>' : '<p class="empty">' + (adm ? 'Ancora vuota. Aggiungi le voci che servono, anche senza orario.' : 'Ancora vuota.') + '</p>') + add + tpl + '</section>';
}

/* ---- Sale e personale ---- */
function roomCountText(r) { return r.tables.length + (r.tables.length === 1 ? ' tavolo, ' : ' tavoli, ') + roomSeats(r) + ' posti'; }
function seatsTotalsHTML(ev) {
  var seats = seatsOf(ev), guests = guestsOf(ev), need = Number(ev.covers.highchairs) || 0, got = hcAssigned(ev), out = '';
  if (seats) out += '<p class="total">Posti totali: ' + seats + (guests ? ' per ' + guests + ' pax' : '') + '</p>';
  if (need || got) {
    var ok = got === need, left = need - got;
    out += '<p class="total hc-total' + (ok ? ' ok' : ' warn') + '">Seggioloni assegnati ai tavoli: ' + got + ' su ' + need + (ok ? ' ✓' : (left > 0 ? ' (ne mancano ' + left + ')' : ' (ne hai assegnati ' + (-left) + ' in più)')) + '</p>';
  }
  return out;
}
function roomsHTML(ev) {
  var adm = isOrg(), hcOn = (Number(ev.covers.highchairs) || 0) > 0 || hcAssigned(ev) > 0;
  var blocks = ev.rooms.map(function (r) {
    var tb = r.tables.map(function (t) {
      if (!adm) {
        var p = personBy(t.who);
        return '<li class="tbl ro-row"><b>' + esc(t.label || 'Tavolo') + '</b><span>' + (Number(t.seats) || 0) + ' posti</span>' + (Number(t.highchairs) > 0 ? '<span class="hc-tag">' + t.highchairs + (Number(t.highchairs) === 1 ? ' seggiolone' : ' seggioloni') + '</span>' : '') + (p ? '<span class="who">' + avatar(p) + esc(p.name) + '</span>' : '') + (t.note ? '<span class="note" style="margin:0">' + esc(t.note) + '</span>' : '') + '</li>';
      }
      var o = { list: 'tables', parent: r.id, id: t.id };
      return '<li class="tbl">' + field('Tavolo', 'label', t.label, o) + field('Posti', 'seats', t.seats, { type: 'number', list: 'tables', parent: r.id, id: t.id }) +
        (hcOn ? field('Seggioloni', 'highchairs', t.highchairs, { type: 'number', list: 'tables', parent: r.id, id: t.id }) : '') +
        select('Cameriere', 'who', t.who, peopleList('Da assegnare', true), o) + field('Chi siede qui, note', 'note', t.note, o) +
        '<button class="link danger" data-act="del-item" data-list="tables" data-parent="' + r.id + '" data-id="' + t.id + '">Rimuovi il tavolo</button></li>';
    }).join('');
    return '<li class="room"><div class="grid">' +
      field('Nome della sala', 'name', r.name, { list: 'rooms', id: r.id, ph: 'Scrivi il nome che vuoi: Sala del camino, Veranda…', span: 2 }) +
      (adm ? '<div class="fld span2 quickname"><div class="chips">' + ROOM_PRESETS.filter(function (p) { return p !== 'Altra sala'; }).map(function (p) { return '<button type="button" class="chip' + (r.name === p ? ' on' : '') + '" data-act="room-name" data-id="' + r.id + '" data-v="' + esc(p) + '">' + esc(p) + '</button>'; }).join('') + '</div></div>' : '') +
      select('Disposizione', 'style', r.style, LAYOUTS, { list: 'rooms', id: r.id }) +
      field('Note di allestimento', 'notes', r.notes, { type: 'textarea', rows: 2, list: 'rooms', id: r.id, span: 2, ph: "Postazioni, tavolo d'onore, posizione della torta, passaggi…" }) + '</div>' +
      '<p class="note" id="rc-' + r.id + '">' + roomCountText(r) + '</p>' +
      (tb ? '<ul class="list tbls">' + tb + '</ul>' : '') +
      (adm ? '<div class="bulk"><span>Aggiungi</span><input class="in" type="number" inputmode="numeric" min="1" id="bn-' + r.id + '" value="1" aria-label="Quanti tavoli"><span>tavoli da</span><input class="in" type="number" inputmode="numeric" min="1" id="bs-' + r.id + '" value="8" aria-label="Posti per tavolo"><span>posti</span><button class="btn quiet small" data-act="add-tables" data-room="' + r.id + '">Aggiungi</button></div>' +
        '<p style="margin:10px 0 0"><button class="link danger" data-act="del-item" data-list="rooms" data-id="' + r.id + '">Rimuovi questa sala</button></p>' : '') + '</li>';
  }).join('');
  return (blocks ? '<ul class="list">' + blocks + '</ul>' : '<p class="empty">Nessuna sala.</p>') +
    '<div id="seatsTotals">' + seatsTotalsHTML(ev) + '</div>' +
    (adm ? '<div class="addchips"><span class="fl">Aggiungi sala</span><div class="chips">' + ROOM_PRESETS.map(function (p) { return '<button class="chip" data-act="add-room" data-name="' + (p === 'Altra sala' ? '' : esc(p)) + '">' + esc(p) + '</button>'; }).join('') + '</div></div>' : '');
}
function tabSala(ev) {
  var adm = isOrg(), guests = guestsOf(ev), st = stationsOf(ev);
  var staff = ev.staff.map(function (s) {
    var p = personBy(s.personId);
    if (!adm) return '<li class="rowform"><div class="full"><b>' + (p ? avatar(p) + ' ' + esc(p.name) : 'Da indicare') + '</b>' + (s.role ? ', ' + esc(s.role) : '') + '</div><div>' + ro(s.arrival ? 'Arrivo ' + s.arrival : '') + '</div><div>' + ro(s.section) + '</div></li>';
    var known = !s.personId || P().some(function (x) { return x.key === s.personId; });
    var extra = !known ? '<option value="' + esc(s.personId) + '" selected>' + esc(p.name) + ' (non più in squadra)</option>' : '';
    return '<li class="rowform"><label class="fld"><span class="fl">Persona</span><select class="in" data-list="staff" data-id="' + s.id + '" data-f="personId">' + extra + opts(peopleList('Scegli…', true), s.personId) + '</select></label>' +
      field('Ruolo', 'role', s.role, { list: 'staff', id: s.id }) + field('Arrivo', 'arrival', s.arrival, { type: 'time', list: 'staff', id: s.id }) + field('Zona o tavoli', 'section', s.section, { list: 'staff', id: s.id }) +
      '<div class="full"><button class="link danger" data-act="del-item" data-list="staff" data-id="' + s.id + '">Rimuovi</button></div></li>';
  }).join('');
  var sup = ev.suppliers.map(function (s) {
    var conf = '<label class="toggle"><input type="checkbox" data-act="tick-supplier" data-id="' + s.id + '"' + (s.confirmed ? ' checked' : '') + '><span class="sw"></span><span>Confermato</span></label>';
    if (!adm) return '<li class="rowform"><div class="full"><b>' + esc(s.name || 'Fornitore') + '</b>' + (s.what ? ', ' + esc(s.what) : '') + '</div><div>' + ro(s.arrival ? 'Arrivo ' + s.arrival : '') + '</div><div>' + ro(s.contact) + '</div><div class="full">' + conf + '</div></li>';
    return '<li class="rowform">' + field('Fornitore', 'name', s.name, { list: 'suppliers', id: s.id }) + field('Cosa porta', 'what', s.what, { list: 'suppliers', id: s.id }) + field('Contatto', 'contact', s.contact, { type: 'tel', list: 'suppliers', id: s.id }) + field('Orario di arrivo', 'arrival', s.arrival, { type: 'time', list: 'suppliers', id: s.id }) +
      '<div class="full">' + conf + '<button class="link danger" data-act="del-item" data-list="suppliers" data-id="' + s.id + '">Rimuovi</button></div></li>';
  }).join('');
  return '<section class="sec first" id="sec-sala"><h2>Sale e tavoli</h2><p class="lead">Una scheda per ogni sala, con i suoi tavoli: numero, posti, cameriere e chi siede dove.</p>' + roomsHTML(ev) +
    (st.length ? '<p class="note">Postazioni da allestire, dal Food dei servizi: ' + esc(st.join('; ')) + '.</p>' : '') + '</section>' +
    '<section class="sec" id="sec-personale"><h2>Personale</h2>' + (ev.staff.length ? '<p class="note" style="margin:0 0 6px">' + ev.staff.length + (ev.staff.length === 1 ? ' persona' : ' persone') + (guests ? ' per ' + guests + ' pax.' : '.') + '</p>' : '') +
    (staff ? '<ul class="list">' + staff + '</ul>' : '<p class="empty">Nessuno indicato.</p>') + (adm ? '<button class="btn quiet small" data-act="add-staff">Aggiungi persona</button>' : '') + '</section>' +
    '<section class="sec" id="sec-fornitori"><h2>Fornitori esterni</h2>' + (sup ? '<ul class="list">' + sup + '</ul>' : '<p class="empty">Nessun fornitore indicato.</p>') + (adm ? '<button class="btn quiet small" data-act="add-supplier">Aggiungi fornitore</button>' : '') + '</section>' +
    '<section class="sec" id="sec-note"><h2>Note speciali</h2><div class="grid">' + field('Ospiti importanti, richieste, orari da rispettare', 'notes', ev.notes, { type: 'textarea', rows: 3, ph: 'Es. ospite in sedia a rotelle al tavolo 1, brindisi alle 22:00', span: 2 }) + '</div></section>';
}

/* ============================================================
   L'ordine di servizio come documento (stesso ordine del vostro)
   ============================================================ */
function linesHTML(txt) { return String(txt).split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return l.trim() === '***' ? '<p class="sep">***</p>' : '<p>' + esc(l) + '</p>'; }).join(''); }
function svcTitle(s) { return esc(s.name || 'Servizio') + (s.time ? ', ore ' + esc(s.time) : '') + (s.place ? ' – ' + esc(s.place) : ''); }
function tariffLine(r) {
  var p = Number(r.price);
  if (String(r.price) === '') return null;
  if (p === 0) return r.label + ': ' + (r.note || 'nessun supplemento');
  return r.label + ': € ' + r.price + ' a persona' + (r.note ? ' (' + r.note + ')' : '');
}
function roomsDocHTML(ev) {
  return ev.rooms.filter(function (r) { return r.tables.length || String(r.notes).trim(); }).map(function (r) {
    var head = esc(r.name || 'Sala') + (r.style ? ' – ' + esc(r.style) : '') + (r.tables.length ? ' (' + roomCountText(r) + ')' : '');
    var lis = r.tables.map(function (t) { var p = personBy(t.who), hc = Number(t.highchairs) || 0; return '<li>' + esc(t.label || 'Tavolo') + ', ' + (Number(t.seats) || 0) + ' posti' + (hc ? ', ' + hc + (hc === 1 ? ' seggiolone' : ' seggioloni') : '') + (t.note ? ' – ' + esc(t.note) : '') + (p ? ' (' + esc(p.name) + ')' : '') + '</li>'; }).join('');
    return '<p class="who-h">' + head + '</p>' + (String(r.notes).trim() ? '<p>' + esc(r.notes) + '</p>' : '') + (lis ? '<ul>' + lis + '</ul>' : '');
  }).join('');
}
function canEditTab(tab) { return isOrg() || (tab === 'menu' && canChef()); }
function odsDocInner(ev, edit, forPrint) {
  // In anteprima ogni sezione ha un tasto «Modifica» che porta alla scheda giusta; nella stampa non c'è
  function eb(tab, anchor) { return (edit && canEditTab(tab)) ? '<button class="ods-edit no-print" data-act="edit-section" data-tab="' + tab + '" data-anchor="' + (anchor || '') + '">Modifica</button>' : ''; }
  var guests = guestsOf(ev), sorted = sortedServices(ev);
  var names = sorted.map(function (s) { return s.name; }).filter(Boolean);
  var sub = 'Lou Tchappé' + (names.length ? ' – ' + listIt(names.map(function (n, i) { return i === 0 ? n.charAt(0).toUpperCase() + n.slice(1) : n.toLowerCase(); })) : '');
  var dates = []; sorted.forEach(function (s) { var d = svcDate(ev, s); if (dates.indexOf(d) < 0) dates.push(d); });
  var multi = dates.length > 1, lastDate = '';
  var svc = sorted.map(function (s) {
    var dd = svcDate(ev, s), head = '';
    if (multi && dd !== lastDate) { head = '<h2 class="day">' + esc(fmtFull(dd)) + '</h2>'; lastDate = dd; }
    var bev = String(s.beverage).trim(), food = foodText(ev, s);
    return head + '<section><h2 class="under svc">' + svcTitle(s) + eb('servizi', 'servizi') + '</h2>' + (bev ? '<h3>Beverage:</h3><div class="lines">' + linesHTML(bev) + '</div>' : '') + (food || edit ? '<h3>Food:' + (edit && canEditTab('menu') ? ' ' + eb('menu', 'menu') : '') + '</h3>' + (food ? '<div class="lines">' + linesHTML(food) + '</div>' : '<p class="soft">Nessun piatto indicato.</p>') : '') + '</section>';
  }).join('');
  var loose = looseDishes(ev);
  if (loose.length) svc += '<section><h2 class="under">Piatti' + eb('menu', 'menu') + '</h2><div class="lines">' + linesHTML(loose.map(function (x) { return x.name; }).join('\n')) + '</div></section>';
  var wl = ev.wines.filter(function (w) { return String(w.name).trim(); }).map(function (w) { return '<li>' + esc(wineLine(ev, w)) + '</li>'; }).join('');
  var wsec = wl ? '<section><h2 class="under">Vini' + eb('servizi', 'vini') + '</h2><ul>' + wl + '</ul>' + (winePolicyText(ev) ? '<p>' + esc(winePolicyText(ev)) + '</p>' : '') + '</section>' : '';
  var notes = odsNotes(ev).map(function (g) { return '<p class="who-h">' + esc(g.label) + '</p><ul>' + g.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'; }).join('');
  var al = ev.allergies.map(function (a) { return '<p class="od-al">' + (Number(a.pax) || 1) + ' pax (' + esc(a.who || 'Ospite') + '): ' + esc(allergyText(a)) + (a.informed ? '' : ' <span class="flag-inline">(cucina da avvisare)</span>') + '</p>'; }).join('');
  if (!al) al = '<p>' + (ev.noAllergies ? 'Nessuna allergia o intolleranza segnalata (confermato).' : 'Nessuna segnalata, ma non ancora confermato.') + '</p>';
  var diet = dietLine(ev);
  // Un piatto per volta, a espansione (nella stampa sempre aperti)
  var byDish = []; altRows(ev).forEach(function (r) { var l = byDish[byDish.length - 1]; if (l && l.dish === r.dish) l.rows.push(r); else byDish.push({ dish: r.dish, svc: r.svc, rows: [r] }); });
  var alts = byDish.map(function (g) {
    var miss = g.rows.some(function (r) { return !r.g.alt; }), n = g.rows.length;
    return '<details class="od-altd"' + (forPrint ? ' open' : '') + '><summary><b>' + esc(g.dish.name) + '</b>' + (g.svc ? ' <span class="soft">(' + esc(g.svc) + ')</span>' : '') + '<span class="od-cnt' + (miss ? ' miss' : '') + '">' + (miss ? 'alternativa da definire' : n + (n === 1 ? ' alternativa' : ' alternative')) + '</span></summary><ul>' +
      g.rows.map(function (r) { return '<li>Per ' + esc(groupWho(r.g)) + ' (' + esc(r.g.reason) + ') c\'è: ' + (r.g.alt ? '<u>' + esc(r.g.alt) + '</u>' : '<span class="flag-inline">alternativa da definire</span>') + '</li>'; }).join('') + '</ul></details>';
  }).join('');
  var tar = ev.tariffs.map(tariffLine).filter(Boolean).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');
  var rdoc = roomsDocHTML(ev);
  var tl = sortedLines(ev).map(function (l) { var p = personBy(l.who); return '<tr><td class="t">' + esc(l.time || '—') + '</td><td>' + esc(l.what) + (p ? ' <span class="soft">(' + esc(p.name) + ')</span>' : '') + '</td></tr>'; }).join('');
  var stf = ev.staff.map(function (s) { var p = personBy(s.personId); return '<tr><td class="t">' + esc(s.arrival || '—') + '</td><td><b>' + esc(p ? p.name : 'Da indicare') + '</b>' + (s.role ? ', ' + esc(s.role) : '') + (s.section ? ' – ' + esc(s.section) : '') + '</td></tr>'; }).join('');
  var sp = ev.suppliers.map(function (s) { return '<tr><td class="t">' + esc(s.arrival || '—') + '</td><td><b>' + esc(s.name || 'Fornitore') + '</b>' + (s.what ? ', ' + esc(s.what) : '') + (s.contact ? ' (' + esc(s.contact) + ')' : '') + (s.confirmed ? '' : ' <span class="flag-inline">(da confermare)</span>') + '</td></tr>'; }).join('');
  var cv = ev.covers, pills = '<span class="od-pill strong"><span class="pax">' + guests + ' pax</span></span>';
  if (Number(cv.kids) > 0 || Number(cv.highchairs) > 0) pills += '<span class="od-pill">' + esc(coversText(ev)) + '</span>';
  if (Number(cv.guaranteed) && Number(cv.guaranteed) !== coversTotal(ev) && coversTotal(ev)) pills += '<span class="od-pill">garantiti ' + esc(cv.guaranteed) + ' su ' + coversTotal(ev) + ' previsti</span>';
  if (ev.times && ev.times.arrival) pills += '<span class="od-pill">Arrivo ' + esc(ev.times.arrival) + '</span>';
  var lead = ev.lead ? personBy(ev.lead) : null; if (lead) pills += '<span class="od-pill">Responsabile: ' + esc(lead.name) + '</span>';
  return '<header class="od-hero"><div class="ods-top"><span class="ods-brand">Lou Tchappé</span><span class="od-kicker">Ordine di servizio</span>' + (edit && isOrg() ? eb('riepilogo', 'details') : '') + '</div>' +
    '<h1 class="ods-date">' + esc(fmtFull(ev.date)) + '</h1><p class="ods-sub">' + esc(sub) + '</p>' +
    '<p class="ods-event"><u>' + esc(ev.title) + '</u></p><div class="od-pills">' + pills + '</div></header>' +
    svc + wsec +
    (notes ? '<section><h2 class="under">Note' + eb('compiti', '') + '</h2>' + notes + '</section>' : '') +
    '<section><h2 class="under">Intolleranze &amp; allergie' + eb('allergie', 'allergie') + '</h2>' + al + (alts ? '<p class="who-h od-alth">Piatti con alternativa<span>' + (!forPrint ? '<button type="button" class="od-toggle no-print" data-act="doc-alts-toggle">Apri tutti</button>' : '') + (edit && canEditTab('menu') ? eb('menu', 'menu') : '') + '</span></p>' + alts : '') + (diet ? '<p style="margin-top:8px">' + esc(diet) + '</p>' : '') + '</section>' +
    (tar ? '<section><h2 class="under">Tariffe' + eb('servizi', 'tariffe') + '</h2>' + tar + '</section>' : '') +
    (rdoc ? '<section><h2 class="under">Sale e tavoli' + eb('sala', 'sala') + '</h2>' + rdoc + '</section>' : '') +
    (tl ? '<section><h2 class="under">Scaletta' + eb('scaletta', '') + '</h2><table>' + tl + '</table></section>' : '') +
    (stf ? '<section><h2 class="under">Personale' + eb('sala', 'personale') + '</h2><table>' + stf + '</table></section>' : '') +
    (sp ? '<section><h2 class="under">Fornitori' + eb('sala', 'fornitori') + '</h2><table>' + sp + '</table></section>' : '') +
    (String(ev.notes).trim() ? '<section><h2 class="under">Altre note' + eb('sala', 'note') + '</h2><p>' + esc(ev.notes) + '</p></section>' : '') +
    '<p class="od-foot">Lou Tchappé · Aggiornato al ' + esc(new Date(ev.updatedAt).toLocaleDateString('it-IT')) + '</p>';
}
function odsHTML(ev) {
  var org = isOrg();
  var ack = (!org && !isClosed(ev) && amInvolved(ev)) ? '<button class="btn primary small" data-act="read-ack"' + (readOK(ev, meKey()) ? ' disabled' : '') + '>' + (readOK(ev, meKey()) ? 'Già letto' : 'Ho letto') + '</button>' : '';
  var share = (navigator.share ? '<button class="btn quiet small" data-act="share-brief">Condividi</button>' : '');
  var save = org ? '<button class="btn primary small" data-act="save-ods">Salva ODS</button>' : '';
  var hint = canEditTab('menu') && !org ? '' : (org ? '<p class="ods-hint no-print">Così lo vedrà la squadra. Tocca «Modifica» accanto a una sezione per correggerla.</p>' : '');
  return '<div class="ods"><div class="ods-actions no-print">' + save + ack + '<button class="btn quiet small" data-act="print">Stampa</button>' + share + '<button class="btn quiet small" data-act="copy-brief" title="Copia il testo per WhatsApp">WhatsApp</button><button class="btn quiet small" data-act="close">Chiudi</button></div>' + hint + odsDocInner(ev, true) + '</div>';
}
function odsText(ev) {
  var L = [], guests = guestsOf(ev), sorted = sortedServices(ev);
  L.push('*' + fmtFull(ev.date) + '*');
  L.push(ev.title + ' – ' + guests + ' pax');
  L.push('(aggiornato al ' + new Date(ev.updatedAt).toLocaleDateString('it-IT') + ')');
  var multi = false, d0 = sorted.length ? svcDate(ev, sorted[0]) : ''; sorted.forEach(function (s) { if (svcDate(ev, s) !== d0) multi = true; });
  var lastDate = '';
  sorted.forEach(function (s) {
    var dd = svcDate(ev, s);
    if (multi && dd !== lastDate) { L.push(''); L.push('*** ' + fmtFull(dd) + ' ***'); lastDate = dd; }
    L.push(''); L.push('*' + (s.name || 'Servizio') + (s.time ? ', ore ' + s.time : '') + (s.place ? ' – ' + s.place : '') + '*');
    if (String(s.beverage).trim()) { L.push('_Beverage:_'); L.push(String(s.beverage).trim()); }
    var ft = foodText(ev, s); if (ft) { L.push('_Food:_'); L.push(ft); }
  });
  var wl = ev.wines.filter(function (w) { return String(w.name).trim(); });
  if (wl.length) { L.push(''); L.push('*Vini*'); wl.forEach(function (w) { L.push('- ' + wineLine(ev, w)); }); if (winePolicyText(ev)) L.push(winePolicyText(ev)); }
  var notes = odsNotes(ev);
  if (notes.length) { L.push(''); L.push('*Note*'); notes.forEach(function (g) { L.push(g.label.toUpperCase()); g.items.forEach(function (i) { L.push('- ' + i); }); }); }
  L.push(''); L.push('*Intolleranze & allergie*');
  if (ev.allergies.length) ev.allergies.forEach(function (a) { L.push((Number(a.pax) || 1) + ' pax (' + (a.who || 'Ospite') + '): ' + allergyText(a) + (a.informed ? '' : ' [cucina da avvisare]')); });
  else L.push(ev.noAllergies ? 'Nessuna (confermato).' : 'Nessuna segnalata, da confermare.');
  var ar = altRows(ev);
  if (ar.length) { L.push(''); L.push('_Piatti con alternativa:_'); ar.forEach(function (r) { L.push('- ' + r.dish.name + (r.svc ? ' (' + r.svc + ')' : '') + ' – ' + altLine(r)); }); }
  var diet = dietLine(ev); if (diet) L.push(diet);
  var tar = ev.tariffs.map(tariffLine).filter(Boolean);
  if (tar.length) { L.push(''); L.push('*Tariffe*'); tar.forEach(function (t) { L.push(t); }); }
  var rooms = ev.rooms.filter(function (r) { return r.tables.length || String(r.notes).trim(); });
  if (rooms.length) {
    L.push(''); L.push('*Sale e tavoli*');
    rooms.forEach(function (r) {
      L.push((r.name || 'Sala') + (r.style ? ' – ' + r.style : '') + (r.tables.length ? ' (' + roomCountText(r) + ')' : ''));
      if (String(r.notes).trim()) L.push(String(r.notes).trim());
      r.tables.forEach(function (t) { var p = personBy(t.who); L.push('- ' + (t.label || 'Tavolo') + ', ' + (Number(t.seats) || 0) + ' posti' + (t.note ? ' – ' + t.note : '') + (p ? ' (' + p.name + ')' : '')); });
    });
  }
  var lines = sortedLines(ev);
  if (lines.length) { L.push(''); L.push('*Scaletta*'); lines.forEach(function (l) { var p = personBy(l.who); L.push(l.time + ' ' + l.what + (p ? ' (' + p.name + ')' : '')); }); }
  if (ev.staff.length) { L.push(''); L.push('*Personale*'); ev.staff.forEach(function (s) { var p = personBy(s.personId); L.push((s.arrival || '') + ' ' + (p ? p.name : '?') + (s.role ? ', ' + s.role : '') + (s.section ? ' – ' + s.section : '')); }); }
  return L.join('\n');
}
// Il documento si stampa in un riquadro a parte, non dentro l'app: così le
// regole di stampa del resto del gestionale non lo toccano e viceversa.
function printDoc(ev) {
  var f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  var d = f.contentWindow.document;
  d.open();
  d.write('<!doctype html><html lang="it"><head><meta charset="utf-8"><title>' + esc(ev.title) + ' — ordine di servizio</title><style>' + DOC_CSS + '@page{margin:16mm}body{margin:0;background:#fff}.ods{max-width:none}</style></head><body><div class="ods">' + odsDocInner(ev, false, true) + '</div></body></html>');
  d.close();
  setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Per stampare usa Ctrl+P (o Cmd+P)'); } setTimeout(function () { f.remove(); }, 4000); }, 300);
}

/* ============================================================
   Finestre, avvisi, azioni
   ============================================================ */
var lastFocus = null, toastT = null;
function toast(m) { var t = $('#toast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2800); }
function openSheet(html, full, kind) {
  lastFocus = root.activeElement; ui.sheet = kind || null;
  $('#ov').innerHTML = '<div class="overlay' + (full ? ' full' : '') + '" data-act="bg"><div class="panel" role="dialog" aria-modal="true" tabindex="-1">' + html + '</div></div>';
  document.body.style.overflow = 'hidden';
  var p = $('#ov .panel'); if (p) p.focus({ preventScroll: true });
}
function closeSheet() {
  ui.sheet = null; $('#ov').innerHTML = ''; document.body.style.overflow = '';
  if (lastFocus && lastFocus.isConnected) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignora */ } }
}
function confirmTwice(btn, cb) {
  if (btn.dataset.armed === '1') { cb(); return; }
  var old = btn.textContent; btn.dataset.armed = '1'; btn.textContent = 'Sicuro?'; btn.classList.add('armed');
  setTimeout(function () { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = old; btn.classList.remove('armed'); } }, 3000);
}
function copyText(text) {
  function fallback() {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignora */ }
    ta.remove(); toast(ok ? 'Copiato: incollalo su WhatsApp' : 'Copia non riuscita: seleziona il testo e copialo a mano');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Copiato: incollalo su WhatsApp'); }, fallback);
  else fallback();
}

function openNewEvent() {
  var o = Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + esc(TYPES[k].label) + '</option>'; }).join('');
  openSheet('<h2>Nuovo ordine di servizio</h2><p class="lead">Scegli il tipo di evento: servizi e tariffe partono già pronti da compilare. Allergie, menu, compiti e scaletta li aggiungi tu, sezione per sezione.</p>' +
    '<div class="grid"><label class="fld span2"><span class="fl">Nome dell\'evento</span><input class="in" id="nvTitle" placeholder="Es. Ferragosto, Capodanno, Matrimonio Verdi e Neri"></label>' +
    '<label class="fld span2"><span class="fl">Tipo</span><select class="in" id="nvType">' + o + '</select></label>' +
    '<label class="fld"><span class="fl">Data</span><input class="in" type="date" id="nvDate" value="' + addDays(todayISO(), 14) + '"></label>' +
    '<label class="fld"><span class="fl">Arrivo ospiti</span><input class="in" type="time" id="nvTime" value="19:00"></label>' +
    '<label class="fld"><span class="fl">Adulti</span><input class="in" type="number" inputmode="numeric" min="0" id="nvCovers" value="40"></label>' +
    '<label class="fld"><span class="fl">Bambini</span><input class="in" type="number" inputmode="numeric" min="0" id="nvKids" value="0"></label>' +
    '<label class="fld span2" id="nvHcWrap" hidden><span class="fl">Di cui con seggiolone</span><input class="in" type="number" inputmode="numeric" min="0" id="nvHc" value="0"></label>' +
    '<div class="fld span2"><label class="toggle"><input type="checkbox" id="nvChecklist"><span class="sw"></span><span>Parti con la checklist standard (circa 50 compiti)</span></label></div></div>' +
    '<p class="note" id="nvHint"></p><div class="sheet-foot"><button class="btn quiet" data-act="close">Annulla</button><button class="btn primary" data-act="create-event">Crea</button></div>', false, 'new');
  updateNewHint();
  var t = $('#nvTitle'); if (t) t.focus();
}
function updateNewHint() {
  var sel = $('#nvType'), h = $('#nvHint'), cl = $('#nvChecklist'); if (!sel || !h) return;
  var k = sel.value, n = BASE_TASKS.length + (TYPE_TASKS[k] || []).length;
  h.textContent = 'Parte con ' + SERVICE_TPL[k].length + (SERVICE_TPL[k].length === 1 ? ' servizio' : ' servizi') + ' da compilare. Compiti e scaletta partono vuoti: li aggiungi tu, senza orari obbligatori.' + (cl && cl.checked ? ' Con la checklist standard avrai anche ' + n + ' compiti già pronti (si possono togliere).' : '');
}
// Le persone sono quelle di Impostazioni → Squadra e accessi: qui si sceglie solo il reparto
function openDepts() {
  var kindLabel = { admin: 'Amministratore', chef: 'Cuoco', employee: 'Dipendente', tablet: 'Tablet' };
  var rows = P().map(function (p) {
    return '<div class="rowform team">' + avatar(p) + '<b>' + esc(p.name) + '</b><span class="kindtag">' + esc(kindLabel[p.kind] || '') + (p.organizer ? ', organizzatore' : '') + '</span>' +
      '<select class="in" data-person="' + esc(p.key) + '" aria-label="Reparto di ' + esc(p.name) + '">' + opts(DEPTS.map(function (d) { return [d[0], d[1]]; }), p.dept) + '</select></div>';
  }).join('');
  openSheet('<h2>Reparti</h2><p class="lead">Un compito assegnato a un reparto (per esempio Bar) lo vedono e lo spuntano tutti quelli del reparto. Le persone sono quelle di Impostazioni → Squadra e accessi: per aggiungerne o toglierne si fa da lì. Gli organizzatori sono gli amministratori e lo chef principale.</p>' +
    (rows || '<p class="empty">Nessun profilo trovato.</p>') + '<div class="sheet-foot"><button class="btn quiet" data-act="close">Chiudi</button></div>', false, 'depts');
}

function openEvent(id, tab) {
  if (!store[id]) { toast('Ordine di servizio non trovato'); return; }
  ui.view = 'event'; ui.id = id; ui.tab = tab || (isOrg() ? 'riepilogo' : 'compiti'); ui.taskFilter = null; ui.taskGroup = 'chi'; ui.open = {}; ui.openInit = null; ui.editAl = {}; ui.alForm = false; ui.openDish = {};
  draw(); window.scrollTo(0, 0);
}
function goList() { ui.view = 'list'; ui.id = null; draw(); window.scrollTo(0, 0); }
function gotoTab(tab, anchor) {
  ui.tab = tab; markTabs(); renderTabBody();
  var el = anchor ? $('#sec-' + anchor) : null;
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); else { var b = $('#evBody'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'start' }); }
}
function afterListChange() { renderTabBody(); renderHeader(); updateTabCount(); updateTabDots(); updateTrigger(); }

// Le modifiche sono funzioni che lavorano per id e si possono ripetere: vedi l'intestazione del file
function secOf(list, f) {
  var m = { services: 'servizi', wines: 'vini', tariffs: 'tariffe', allergies: 'allergie', diets: 'pax e diete', rooms: 'sale e tavoli', tables: 'sale e tavoli', timeline: 'scaletta', staff: 'personale', suppliers: 'fornitori', tasks: 'note per reparto', dishes: 'menu' };
  if (list) return m[list] || 'ordine di servizio';
  var r = { title: 'titolo e data', date: 'titolo e data', times: 'orari', covers: 'pax', lead: 'responsabile', client: 'cliente', billing: 'conti', notes: 'note', winePolicy: 'vini', noAllergies: 'allergie' };
  return r[f.split('.')[0]] || 'ordine di servizio';
}
function applyField(el) {
  // Dalla pagina riassuntiva non c'è un evento aperto: l'evento arriva dal campo stesso
  var ev = el.dataset.ev ? (store[el.dataset.ev] ? store[el.dataset.ev].data : null) : curEv();
  if (!ev || !isOrg()) return;
  var f = el.dataset.f, v, list = el.dataset.list, id = el.dataset.id, parent = el.dataset.parent;
  if (el.type === 'checkbox') v = el.checked; else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value); else v = el.value;
  if (f === 'date' && !v) return;
  var item = list ? findItem(ev, list, id, parent) : null;
  if (list && !item) return;
  var content, isCustomTask = list === 'tasks' && item && !item.tpl;
  if (list === 'tasks') content = isCustomTask;
  else if (list === 'timeline') content = f !== 'who';
  else if (list) content = true;
  else content = f !== 'status' && f !== 'covers.locked' && f !== 'billing.depositIn';
  var evId = ev.id;
  edit(evId, function (d) {
    var tgt = list ? findItem(d, list, id, parent) : d; if (!tgt) return;
    setPath(tgt, f, v);
    if (!list && (f === 'covers.adults' || f === 'covers.kids')) d.covers.expected = (Number(d.covers.adults) || 0) + (Number(d.covers.kids) || 0);
    if (content) touch(d);
  }, { key: 'f:' + (parent || '') + ':' + (list || '') + ':' + (id || '') + ':' + f });
  if (content) markUpdate(evId, secOf(list, f));
  if (!list && f.indexOf('covers.') === 0) updateCoversLive(curEv() || ev);
  if (list === 'tasks' && f === 'dueDate' && ui.view === 'event') { afterListChange(); return; }   // l'etichetta «in ritardo» si aggiorna subito
  refreshLive();
}
function tick(el) {
  var evId = el.dataset.ev || ui.id, it = store[evId]; if (!it) return;
  var ev = it.data, act = el.dataset.act, id = el.dataset.id, on = el.checked, org = isOrg(), me = meKey();
  if (!me && act !== 'tick-allergy' && act !== 'tick-supplier') { el.checked = !on; toast('Scegli prima chi sei'); return; }
  var text = '', section = null;
  if (act === 'tick-task') {
    var t = findItem(ev, 'tasks', id); if (!t) return;
    if (!canTick(t)) { el.checked = !on; toast('Solo chi ha questo compito può segnarlo'); return; }
    text = '«' + t.text + '»';
    edit(evId, function (d) { var x = findItem(d, 'tasks', id); if (!x) return; x.done = on; x.doneBy = on ? me : ''; x.doneAt = on ? new Date().toISOString() : ''; if (on) { x.notDone = false; x.reason = ''; } }, { key: 'tick:' + id, now: true });
  } else if (act === 'tick-line') {
    var l = findItem(ev, 'timeline', id); if (!l) return;
    if (!(org || isMine(l.who))) { el.checked = !on; return; }
    text = '«' + l.what + '»';
    edit(evId, function (d) { var x = findItem(d, 'timeline', id); if (x) x.done = on; }, { key: 'tick:' + id, now: true });
  } else if (act === 'tick-allergy') {
    var a = findItem(ev, 'allergies', id); if (!a) return;
    text = 'cucina avvisata per ' + (a.who || 'ospite');
    edit(evId, function (d) { var x = findItem(d, 'allergies', id); if (x) x.informed = on; }, { key: 'tick:' + id, now: true });
  } else if (act === 'tick-supplier') {
    var s = findItem(ev, 'suppliers', id); if (!s) return;
    text = (s.name || 'fornitore') + ' confermato';
    edit(evId, function (d) { var x = findItem(d, 'suppliers', id); if (x) x.confirmed = on; }, { key: 'tick:' + id, now: true });
  }
  if (on && text) markDone(evId, text);
  if (ui.view === 'list') { draw(true); return; }
  if (act === 'tick-task' || act === 'tick-line') { renderTabBody(); renderHeader(); updateTabCount(); }
  else refreshLive();
  updateTrigger();
}

// «Salva ODS»: salva subito, aspetta la conferma del database e lo dice chiaramente
function saveNow(btn, thenPreview) {
  var id = ui.id, it = store[id]; if (!it) return;
  var old = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = 'Salvo…'; }
  clearTimeout(it.timer); flush(id);
  var t0 = Date.now();
  function done(ok) {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = old; }
    if (ok) { ui.lastSaved = new Date(); renderSync(); toast('ODS salvato'); if (thenPreview) { var ev = curEv(); if (ev) openSheet(odsHTML(ev), true, 'ods'); } }
    else toast('Non sono riuscito a salvare: ' + (lastError || 'riprovo appena torna la connessione'));
  }
  (function poll() {
    var cur = store[id]; if (!cur) return;
    if (cur.inflight || cur.queue.length) { if (cur.failed || Date.now() - t0 > 10000) { done(false); return; } setTimeout(poll, 60); }
    else done(true);
  })();
}
function applyAlt(el) {
  var ev = curEv(); if (!ev || !canChef()) return;
  var did = el.dataset.dish, ids = String(el.dataset.ids || '').split(','), v = el.value.trim();
  edit(ev.id, function (d) {
    var x = findItem(d, 'dishes', did); if (!x) return; x.alts = x.alts || {};
    ids.forEach(function (i) { if (v) x.alts[i] = v; else delete x.alts[i]; });
    touch(d);
  }, { key: 'alt:' + did + ':' + el.dataset.ids });
  markUpdate(ev.id, 'menu');
  var f = $('#dflag-' + did), dd = findItem(ev, 'dishes', did); if (f && dd) f.innerHTML = dishFlag(ev, dd);
  refreshLive();
}
function doAct(act, el) {
  var ev = curEv(), org = isOrg(), evId = ev && ev.id;
  var orgOnly = { 'pick-assign': 1, 'pick-new': 1, 'pick-done': 1, 'add-dish': 1, 'paste-dishes': 1, 'food-to-dishes': 1, 'al-toggle': 1, 'al-edit': 1, 'al-new': 1, 'al-new-close': 1, 'next-tab': 1, 'save-ods': 1, 'add-timeline-template': 1, 'add-diet': 1, 'add-room': 1, 'add-tables': 1, 'add-wine': 1, 'new-event': 1, 'create-event': 1, 'depts': 1, 'add-task': 1, 'add-line': 1, 'add-allergy': 1, 'add-staff': 1, 'add-supplier': 1, 'add-service': 1, 'add-tariff': 1, 'add-checklist': 1, 'remove-checklist': 1, 'del-item': 1, 'shift': 1, 'del-event': 1 };
  if (orgOnly[act] && !org) return;
  switch (act) {
    case 'back': if (typeof UI !== 'undefined') UI.showScreen('dashboard'); break;
    case 'list': goList(); break;
    case 'bg': closeSheet(); break;
    case 'close': closeSheet(); break;
    case 'open-event': openEvent(el.dataset.id, el.dataset.tab); break;
    case 'tab': gotoTab(el.dataset.tab); break;
    case 'goto': gotoTab(el.dataset.tab, el.dataset.anchor); break;
    case 'filter': ui.taskFilter = el.dataset.v; renderTabBody(); break;
    case 'group': ui.taskGroup = el.dataset.v; renderTabBody(); break;
    case 'combo-back': ui.custom[el.dataset.key] = false; renderTabBody(); break;
    case 'set-hc': {
      var hv = Number(el.dataset.v) || 0;
      edit(evId, function (d) { d.covers.highchairs = hv; touch(d); }, { now: true });
      markUpdate(evId, 'pax'); afterListChange(); break;
    }
    case 'room-name': {
      var rid2 = el.dataset.id, nm2 = el.dataset.v;
      edit(evId, function (d) { var r = findItem(d, 'rooms', rid2); if (!r) return; r.name = nm2; touch(d); }, { now: true });
      markUpdate(evId, 'sale e tavoli'); renderTabBody(); break;
    }
    case 'task-no': {
      var nev = (store[el.dataset.ev || evId] || {}).data, nt0 = nev && findItem(nev, 'tasks', el.dataset.id); if (!nt0 || !canTick(nt0)) return;
      ui.nd = { evId: nev.id, id: nt0.id };
      openSheet('<h2>Perché non lo fai?</h2><p class="lead">«' + esc(nt0.text) + '»</p><label class="fld"><span class="fl">Scrivi il motivo (facoltativo, ma aiuta chi organizza a sistemarlo)</span><textarea class="in" rows="4" id="ndNote" placeholder="Es. manca la merce, ho il turno spezzato, serve una persona in più…"></textarea></label><p class="note">Lo leggono gli organizzatori, che ricevono un avviso.</p><div class="sheet-foot"><button class="btn quiet" data-act="close">Annulla</button><button class="btn primary" data-act="task-no-save">Segna come non fatto</button></div>', false, 'nd');
      var ni = $('#ndNote'); if (ni) ni.focus(); break;
    }
    case 'task-no-save': {
      var nd0 = ui.nd, ndText = ($('#ndNote') || {}).value || ''; ndText = ndText.trim(); closeSheet(); if (!nd0) return; ui.nd = null;
      var nev2 = (store[nd0.evId] || {}).data, nt2 = nev2 && findItem(nev2, 'tasks', nd0.id); if (!nt2 || !canTick(nt2)) return;
      var meK = meKey(), tx2 = nt2.text;
      edit(nd0.evId, function (d) { var x = findItem(d, 'tasks', nd0.id); if (!x) return; x.done = false; x.doneBy = ''; x.doneAt = ''; x.notDone = true; x.reason = ndText; x.notDoneBy = meK; x.notDoneAt = new Date().toISOString(); }, { now: true });
      markNotDone(nd0.evId, '«' + tx2 + '»', ndText);
      if (ui.view === 'event') { renderTabBody(); renderHeader(); updateTabCount(); updateTabDots(); } else draw(true);
      updateTrigger(); toast('Segnato come non fatto'); break;
    }
    case 'task-reopen': {
      var rev = (store[el.dataset.ev || evId] || {}).data, rt = rev && findItem(rev, 'tasks', el.dataset.id); if (!rt || !canTick(rt)) return;
      edit(rev.id, function (d) { var x = findItem(d, 'tasks', rt.id); if (!x) return; x.notDone = false; x.reason = ''; x.notDoneBy = ''; x.notDoneAt = ''; }, { now: true });
      if (ui.view === 'event') { renderTabBody(); renderHeader(); updateTabDots(); } else draw(true);
      updateTrigger(); break;
    }
    case 'grp-toggle': ui.openGrp[el.dataset.k] = el.getAttribute('aria-expanded') !== 'true'; if (ui.view === 'event') renderTabBody(); else draw(true); break;
    case 'pick-assign': {
      var peId = el.dataset.ev || evId, pe = store[peId] && store[peId].data, pt = pe && findItem(pe, 'tasks', el.dataset.id); if (!pt) return;
      ui.pick = { mode: 'task', evId: peId, id: pt.id, before: assOf(pt).slice() };
      openSheet(pickerHTML(assOf(pt)), false, 'pick'); break;
    }
    case 'pick-new': ui.pick = { mode: 'new' }; openSheet(pickerHTML(ui.newWho || []), false, 'pick'); break;
    case 'pick-done': {
      var chosen = $$('#ov [data-pk]').filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.pk; }), pk0 = ui.pick;
      closeSheet(); if (!pk0) return; ui.pick = null;
      if (pk0.mode === 'new') { ui.newWho = chosen; var nb = $('#ntWhoBtn'); if (nb) { nb.innerHTML = newWhoLabel(); nb.classList.toggle('is-empty', !chosen.length); } break; }
      var pe2 = store[pk0.evId] && store[pk0.evId].data, pt2 = pe2 && findItem(pe2, 'tasks', pk0.id); if (!pt2) return;
      var ptext = pt2.text, ptpl = pt2.tpl, added = chosen.filter(function (k) { return pk0.before.indexOf(k) < 0; });
      edit(pk0.evId, function (d) { var x = findItem(d, 'tasks', pk0.id); if (!x) return; setAss(x, chosen); if (added.length) { x.notDone = false; x.reason = ''; } if (!x.tpl) touch(d); }, { now: true });
      if (!ptpl) markUpdate(pk0.evId, 'note per reparto');
      if (added.length) markAssigned(pk0.evId, ptext, added);
      if (ui.view === 'event') afterListChange(); else draw(true);
      break;
    }
    case 'all-mine': ui.allMine = !ui.allMine; draw(true); break;
    case 'new-event': openNewEvent(); break;
    case 'depts': openDepts(); break;
    case 'create-event': {
      var type = $('#nvType').value, date = $('#nvDate').value || addDays(todayISO(), 14), arrival = $('#nvTime').value || '19:00', covers = Number($('#nvCovers').value) || 0, kids = Number($('#nvKids').value) || 0, hc = Math.min(kids, Number($('#nvHc').value) || 0);
      var title = $('#nvTitle').value.trim() || (TYPES[type].label + ', ' + fmtShort(date));
      var ne = buildEvent({ title: title, type: type, date: date, arrival: arrival, covers: covers, kids: kids || '', highchairs: kids ? hc : '', checklist: $('#nvChecklist').checked });
      el.disabled = true; el.textContent = 'Creo…';
      createEvent(ne).then(function (ok) {
        if (!ok) {
          el.disabled = false; el.textContent = 'Crea';
          var h = $('#nvHint'); if (h) { h.innerHTML = '<b style="color:var(--signal)">Non sono riuscito a crearlo — ' + esc(lastError) + '</b>'; }
          toast('Creazione non riuscita: leggi il motivo nella finestra'); return;
        }
        closeSheet(); openEvent(ne.id, 'riepilogo');
        toast('Ordine di servizio creato');
        updateTrigger();
      });
      break;
    }
    case 'del-event': confirmTwice(el, function () { var id = ev.id; deleteEvent(id).then(function (ok) { if (ok) { goList(); toast('Ordine di servizio eliminato'); updateTrigger(); } else toast('Non sono riuscito a eliminarlo: riprova', 'warning'); }); }); break;
    case 'add-task': {
      var tx = $('#ntText').value.trim(); if (!tx) { $('#ntText').focus(); return; }
      var phv = $('#ntPhase').value, nt = mkTask([phv === '@date' ? '' : phv, tx], false), who = (ui.newWho || []).slice();
      if (phv === '@date') nt.dueDate = $('#ntDate').value || ev.date;
      setAss(nt, who);
      edit(evId, function (d) { if (!findItem(d, 'tasks', nt.id)) d.tasks.push(clone(nt)); touch(d); }, { now: true });
      markUpdate(evId, 'note per reparto'); if (who.length) markAssigned(evId, tx, who);
      ui.newWho = []; ui.open[nt.dueDate ? '@date' : nt.phase] = true; if (ui.taskFilter && ui.taskFilter !== 'tutti') ui.taskFilter = null; afterListChange(); toast('Aggiunto'); break;
    }
    case 'add-checklist': edit(evId, function (d) { if (!d.tasks.some(function (t) { return t.tpl; })) d.tasks = d.tasks.concat(stdTasks(d.type)); }, { now: true }); afterListChange(); toast('Checklist standard aggiunta'); break;
    case 'remove-checklist': confirmTwice(el, function () { edit(evId, function (d) { d.tasks = d.tasks.filter(function (t) { return !(t.tpl && !t.done); }); }, { now: true }); afterListChange(); toast('Checklist standard tolta'); }); break;
    case 'add-line': {
      var wh = $('#nlText').value.trim(); if (!wh) { $('#nlText').focus(); return; }
      var nl = { id: uid('l'), time: $('#nlTime').value, what: wh, who: $('#nlWho').value, done: false };
      edit(evId, function (d) { if (!findItem(d, 'timeline', nl.id)) d.timeline.push(clone(nl)); touch(d); }, { now: true }); markUpdate(evId, 'scaletta'); afterListChange(); break;
    }
    case 'add-timeline-template': {
      var arr = TIMELINES[ev.type] || TIMELINES.altro, arrival = (ev.times && ev.times.arrival) || '19:00';
      var items = arr.map(function (r) { return { id: uid('l'), time: addMin(arrival, r[0]), what: r[1], who: '', done: false }; });
      edit(evId, function (d) { if (!d.timeline.length) items.forEach(function (it) { d.timeline.push(clone(it)); }); touch(d); }, { now: true });
      markUpdate(evId, 'scaletta'); afterListChange(); toast('Scaletta tipo aggiunta: adattala come vuoi'); break;
    }
    case 'shift': { var m = Number(el.dataset.m); edit(evId, function (d) { d.timeline.forEach(function (l) { if (l.time) l.time = addMin(l.time, m); }); touch(d); }, { now: true }); markUpdate(evId, 'scaletta'); afterListChange(); break; }
    case 'al-chip': el.classList.toggle('on'); break;
    case 'add-allergy': {
      var chips = $$('#alChips .chip.on').map(function (b) { return b.dataset.v; });
      var other = $('#alOther').value.trim(), note = $('#alNote').value.trim(), kind = $('#alKind').value;
      if (kind === 'celiachia' && chips.indexOf('Glutine') < 0) chips.push('Glutine');
      if (!chips.length && !other) { toast('Indica cosa non può mangiare: scegli una voce o scrivila in «Altro»'); return; }
      var na = { id: uid('a'), who: $('#alWho').value.trim() || 'Ospite', pax: Math.max(1, Number($('#alPax').value) || 1), kind: kind, allergens: chips, other: other, note: note, informed: false };
      edit(evId, function (d) { if (!findItem(d, 'allergies', na.id)) d.allergies.push(clone(na)); d.noAllergies = false; touch(d); }, { now: true }); markUpdate(evId, 'allergie'); ui.alForm = false; afterListChange(); break;
    }
    case 'al-new': ui.alForm = true; renderTabBody(); break;
    case 'al-new-close': ui.alForm = false; renderTabBody(); break;
    case 'al-edit': ui.editAl[el.dataset.id] = !ui.editAl[el.dataset.id]; renderTabBody(); break;
    case 'al-toggle': {
      var aid = el.dataset.id, lab = el.dataset.v, cur = findItem(ev, 'allergies', aid); if (!cur) return;
      var want = !(cur.allergens || []).some(function (z) { return norm(z) === norm(lab); });
      edit(evId, function (d) {
        var x = findItem(d, 'allergies', aid); if (!x) return; x.allergens = x.allergens || [];
        var i = x.allergens.findIndex(function (z) { return norm(z) === norm(lab); });
        if (want && i < 0) x.allergens.push(lab); else if (!want && i > -1) x.allergens.splice(i, 1);
        touch(d);
      }, { now: true });
      markUpdate(evId, 'allergie'); afterListChange(); break;
    }
    case 'add-dish': {
      var box = el.closest('.dish-add'), inp = box && box.querySelector('input[data-dishname]'); if (!inp) return;
      var nm = inp.value.trim(); if (!nm) { inp.focus(); return; }
      var nd = { id: uid('p'), service: inp.dataset.svc || '', name: nm, items: {}, alts: {} };
      edit(evId, function (d) { if (!findItem(d, 'dishes', nd.id)) d.dishes.push(clone(nd)); touch(d); }, { now: true });
      ui.openDish[nd.id] = true; markUpdate(evId, 'menu'); afterListChange();
      var card = $('#dish-' + nd.id); if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center' });
      break;
    }
    case 'paste-dishes': {
      var pb = el.closest('.menu-paste'), ta = pb && pb.querySelector('textarea'); if (!ta) return;
      var names = dishLines(ta.value); if (!names.length) { ta.focus(); return; }
      var svcId = el.dataset.svc || '';
      var many = names.map(function (n) { return { id: uid('p'), service: svcId, name: n, items: {}, alts: {} }; });
      edit(evId, function (d) { many.forEach(function (x) { if (!findItem(d, 'dishes', x.id)) d.dishes.push(clone(x)); }); touch(d); }, { now: true });
      markUpdate(evId, 'menu'); afterListChange(); toast(many.length + (many.length === 1 ? ' piatto creato' : ' piatti creati')); break;
    }
    case 'food-to-dishes': {
      var sv = findItem(ev, 'services', el.dataset.svc); if (!sv) return;
      var fnames = dishLines(sv.food); if (!fnames.length) return;
      var fd = fnames.map(function (n) { return { id: uid('p'), service: sv.id, name: n, items: {}, alts: {} }; });
      edit(evId, function (d) {
        var s2 = findItem(d, 'services', sv.id); if (!s2 || !String(s2.food).trim()) return;
        fd.forEach(function (x) { if (!findItem(d, 'dishes', x.id)) d.dishes.push(clone(x)); });
        s2.food = ''; touch(d);
      }, { now: true });
      markUpdate(evId, 'menu'); afterListChange(); toast(fd.length + (fd.length === 1 ? ' piatto creato' : ' piatti creati')); break;
    }
    case 'dish-ans': {
      if (!canChef()) return;
      var did = el.dataset.id, kk = el.dataset.k, dd = findItem(ev, 'dishes', did); if (!dd) return;
      var vv = el.dataset.diet === '1' ? el.dataset.v !== '1' : el.dataset.v === '1';   // per una dieta «Sì, è adatto» = nessun conflitto
      var nxt = answerOf(dd, kk) === vv ? null : vv;                                   // un secondo tocco toglie la risposta
      edit(evId, function (d) { var x = findItem(d, 'dishes', did); if (!x) return; x.items = x.items || {}; if (nxt === null) delete x.items[kk]; else x.items[kk] = nxt; touch(d); }, { now: true });
      markUpdate(evId, 'menu'); redrawDish(did); break;
    }
    case 'dish-filter': ui.dishFilter = el.dataset.v === 'allergie' ? 'allergie' : 'all'; renderTabBody(); break;
    case 'doc-alts-toggle': { var ds2 = [].slice.call(root.querySelectorAll('.od-altd')), any = ds2.some(function (x) { return !x.open; }); ds2.forEach(function (x) { x.open = any; }); el.textContent = any ? 'Chiudi tutti' : 'Apri tutti'; break; }
    case 'dish-toggle': ui.openDish[el.dataset.id] = !ui.openDish[el.dataset.id]; redrawDish(el.dataset.id); break;
    case 'dishes-open-all': case 'dishes-close-all': ev.dishes.forEach(function (x) { ui.openDish[x.id] = act === 'dishes-open-all'; }); renderTabBody(); break;
    case 'dish-allno': {
      if (!canChef()) return;
      var ad = findItem(ev, 'dishes', el.dataset.id); if (!ad) return;
      var aks = openQuestions(ev, ad).map(function (i) { return i.k; }); if (!aks.length) return;
      edit(evId, function (d) { var x = findItem(d, 'dishes', ad.id); if (!x) return; x.items = x.items || {}; aks.forEach(function (k) { if (typeof x.items[k] !== 'boolean') x.items[k] = false; }); touch(d); }, { now: true });
      markUpdate(evId, 'menu'); redrawDish(ad.id); break;
    }
    case 'next-tab': {
      var order = TABS.map(function (t) { return t[0]; }), nx = TABS[order.indexOf(ui.tab) + 1];
      if (store[evId]) { clearTimeout(store[evId].timer); flush(evId); }
      if (nx) { gotoTab(nx[0]); } else { saveNow(null, true); }
      break;
    }
    case 'save-ods': saveNow(el, false); break;
    case 'edit-section': if (!canEditTab(el.dataset.tab)) return; closeSheet(); gotoTab(el.dataset.tab, el.dataset.anchor || ''); break;
    case 'add-staff': { var ns = { id: uid('s'), personId: '', role: '', arrival: (ev.times && ev.times.setup) || '', section: '' }; edit(evId, function (d) { if (!findItem(d, 'staff', ns.id)) d.staff.push(clone(ns)); touch(d); }, { now: true }); markUpdate(evId, 'personale'); afterListChange(); break; }
    case 'add-supplier': { var nf = { id: uid('f'), name: '', what: '', contact: '', arrival: '', confirmed: false }; edit(evId, function (d) { if (!findItem(d, 'suppliers', nf.id)) d.suppliers.push(clone(nf)); touch(d); }, { now: true }); markUpdate(evId, 'fornitori'); afterListChange(); break; }
    case 'add-service': { var nv = { id: uid('v'), name: el.dataset.name || '', date: '', time: el.dataset.time || '', place: '', beverage: '', food: '' }; edit(evId, function (d) { if (!findItem(d, 'services', nv.id)) d.services.push(clone(nv)); touch(d); }, { now: true }); markUpdate(evId, 'servizi'); afterListChange(); toast((el.dataset.name || 'Servizio') + ' aggiunto'); break; }
    case 'add-tariff': { var nr = { id: uid('r'), label: '', price: '', qty: '', note: '' }; edit(evId, function (d) { if (!findItem(d, 'tariffs', nr.id)) d.tariffs.push(clone(nr)); touch(d); }, { now: true }); markUpdate(evId, 'tariffe'); afterListChange(); break; }
    case 'add-diet': {
      var ng = { id: uid('g'), label: el.dataset.label || '', qty: '' };
      edit(evId, function (d) { if (!findItem(d, 'diets', ng.id)) d.diets.push(clone(ng)); touch(d); }, { now: true }); markUpdate(evId, 'pax e diete'); afterListChange();
      var dl = $$('[data-list="diets"][data-f="' + (el.dataset.label ? 'qty' : 'label') + '"]'); if (dl.length) dl[dl.length - 1].focus();
      break;
    }
    case 'add-wine': { var nw = { id: uid('w'), name: '', bottles: '', paid: false, price: '', service: '' }; edit(evId, function (d) { if (!findItem(d, 'wines', nw.id)) d.wines.push(clone(nw)); touch(d); }, { now: true }); markUpdate(evId, 'vini'); afterListChange(); break; }
    case 'add-room': { var nr2 = { id: uid('o'), name: el.dataset.name || '', style: 'Tavoli rotondi', notes: '', tables: [] }; edit(evId, function (d) { if (!findItem(d, 'rooms', nr2.id)) d.rooms.push(clone(nr2)); touch(d); }, { now: true }); markUpdate(evId, 'sale e tavoli'); afterListChange(); break; }
    case 'add-tables': {
      var rid = el.dataset.room, room = ev.rooms.filter(function (r) { return r.id === rid; })[0]; if (!room) return;
      var cnt = Math.max(1, Math.min(60, Number($('#bn-' + rid).value) || 1)), sx = Math.max(1, Number($('#bs-' + rid).value) || 8), base = room.tables.length;
      var created = []; for (var k = 0; k < cnt; k++) created.push({ id: uid('b'), label: 'Tavolo ' + (base + k + 1), seats: sx, note: '', who: '' });
      edit(evId, function (d) { var r = findItem(d, 'rooms', rid); if (!r) return; created.forEach(function (t) { if (!r.tables.some(function (x) { return x.id === t.id; })) r.tables.push(clone(t)); }); touch(d); }, { now: true });
      markUpdate(evId, 'sale e tavoli'); afterListChange(); toast(cnt + (cnt === 1 ? ' tavolo aggiunto' : ' tavoli aggiunti')); break;
    }
    case 'del-item': confirmTwice(el, function () {
      var list = el.dataset.list, id = el.dataset.id, parent = el.dataset.parent;
      var it = findItem(ev, list, id, parent), custom = !(list === 'tasks' && it && it.tpl);
      edit(evId, function (d) {
        var arr = d[list];
        if (parent) { var r = d.rooms.filter(function (x) { return x.id === parent; })[0]; arr = r && r[list]; }
        if (!arr) return;
        var i = arr.findIndex(function (x) { return x.id === id; });
        if (i > -1) arr.splice(i, 1);
        if (list === 'services') (d.dishes || []).forEach(function (x) { if (x.service === id) x.service = ''; });
        if (custom) touch(d);
      }, { now: true });
      if (custom) markUpdate(evId, secOf(list, ''));
      afterListChange();
    }); break;
    case 'ods': openSheet(odsHTML(ev), true, 'ods'); break;
    case 'read-ack': {
      var me = meKey(); if (!ev || !me) return;
      var when = new Date().toISOString();
      edit(evId, function (d) { d.reads = d.reads || {}; d.reads[me] = when; }, { key: 'read:' + me, now: true });
      markDone(evId, 'ha letto l\'ordine di servizio');
      if (el) { el.textContent = 'Presa visione registrata'; el.disabled = true; }
      renderHeader(); toast('Presa visione registrata'); updateTrigger(); break;
    }
    case 'print': printDoc(ev); break;
    case 'share-brief': try { navigator.share({ title: ev.title, text: odsText(ev) }); } catch (e) { copyText(odsText(ev)); } break;
    case 'copy-brief': copyText(odsText(ev)); break;
  }
}

/* ============================================================
   Eventi del browser (dentro lo Shadow DOM)
   ============================================================ */
function onClick(e) {
  var el = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!el) return;
  var act = el.dataset.act;
  if (act.indexOf('tick-') === 0) return;
  if (act === 'bg' && e.target !== el) return;
  doAct(act, el);
}
function onChange(e) {
  var el = e.target;
  if (el.id === 'nvType' || el.id === 'nvChecklist') { updateNewHint(); return; }
  if (el.dataset.person !== undefined && el.tagName === 'SELECT') {
    var key = el.dataset.person, dept = el.value;
    if (SharedTables.setOdsDept) { SharedTables.setOdsDept(key, dept); peopleCache = null; toast('Reparto aggiornato'); }
    return;
  }
  if (el.dataset.act && el.dataset.act.indexOf('tick-') === 0) { tick(el); return; }
  if (el.dataset.due) { setDue(el); return; }
  if (el.id === 'ntPhase') { var nd = $('#ntDate'); if (nd) nd.hidden = el.value !== '@date'; return; }
  if (el.dataset.combo) {                              // tendina con «Altro»
    if (el.value === '__altro') {
      ui.custom[el.dataset.combo] = true; renderTabBody();
      var ni = root.querySelector('input[data-f="' + el.dataset.f + '"]' + (el.dataset.id ? '[data-id="' + el.dataset.id + '"]' : '')); if (ni) { ni.focus(); try { ni.select(); } catch (x) { /* ignora */ } }
      return;
    }
    ui.custom[el.dataset.combo] = false;
  }
  if (el.dataset.f) { applyField(el); if (el.dataset.rr) { if (ui.view === 'event') renderTabBody(); else draw(true); } }
}
function onInput(e) {
  var el = e.target;
  if (el.id === 'nvKids') { var hw = $('#nvHcWrap'); if (hw) hw.hidden = !(Number(el.value) > 0); return; }
  if (el.dataset.alt) { applyAlt(el); return; }
  if (el.dataset.f && (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'tel' || el.type === 'number')) applyField(el);
}
function onKey(e) {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.enter) { e.preventDefault(); doAct(e.target.dataset.enter, e.target); }
}
function onFocusOut() {
  // Se durante la scrittura è arrivata una modifica di un collega, si ridisegna appena si esce dal campo
  setTimeout(function () { if (pendingDraw && !typing()) { pendingDraw = false; draw(true); } }, 50);
}

/* ============================================================
   Disegno generale e ingresso
   ============================================================ */
function ensureHost() {
  if (root) return;
  host = document.getElementById('odsHost');
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' + STYLE + '</style>' +
    '<div id="view"></div><div id="ov"></div><div id="toast" role="status" aria-live="polite"></div>';
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.matches && d.matches('details.phase') && ui.tab === 'compiti' && ui.taskGroup === 'fase' && (ui.taskFilter || (isOrg() ? 'tutti' : 'miei')) === 'tutti') ui.open[d.dataset.phase] = d.open;
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && $('#ov .overlay')) closeSheet(); });
}
function draw(keepScroll) {
  if (!root) return;
  peopleCache = null;
  if (ui.view === 'event' && !curEv()) ui.view = 'list';
  var y = keepScroll ? window.scrollY : 0;
  if (ui.view === 'event') renderEventView(); else renderList();
  if (keepScroll) window.scrollTo(0, y);
}
function render() {
  ensureHost();
  draw();
  if (!loaded || Date.now() - lastFetch > 20000) refresh();
}
async function refresh(force) {
  if (!force && Date.now() - lastFetch < 5000) return;
  var ok = await fetchAll();
  updateTrigger();
  if (ok && visible() && !typing() && !ui.sheet) draw(true);
  else if (!ok && visible() && root && !loaded) draw(true);
}
async function init() {
  await fetchAll();
  updateTrigger();
}

// Il pulsante in Home: i numeri che contano, a colpo d'occhio
function summary() {
  var up = allEvents().filter(function (e) { return !isClosed(e); });
  var mine = myTasks().length, mk = meKey(), toRead = 0, late = 0;
  up.forEach(function (e) {
    if (!isOrg() && mk && involvedKeys(e).indexOf(mk) >= 0 && !readOK(e, mk)) toRead++;
    e.tasks.forEach(function (t) { if (isMineT(t) && isLate(e, t)) late++; });
  });
  return { upcoming: up.length, mine: mine, toRead: toRead, late: late };
}
function updateTrigger() {
  var c = document.getElementById('odsTriggerCount'), dot = document.getElementById('odsTriggerDot');
  var c2 = document.getElementById('roOdsBadge');
  if (!c && !c2 && !dot) return;
  var s = summary(), txt = '';
  if (s.toRead) txt = s.toRead + (s.toRead === 1 ? ' da leggere' : ' da leggere');
  else if (s.mine) txt = s.mine + (s.mine === 1 ? ' tuo compito' : ' tuoi compiti');
  else if (s.upcoming) txt = s.upcoming + (s.upcoming === 1 ? ' evento' : ' eventi');
  if (c) c.textContent = txt;
  if (dot) dot.classList.toggle('hidden', !(s.toRead || s.late));
  if (c2) { c2.textContent = (s.toRead || s.mine) ? String(s.toRead + s.mine) : ''; c2.classList.toggle('hidden', !(s.toRead || s.mine)); }
}
// Tocco su una notifica: porta dritto all'evento
function openFromLink(id) {
  render();
  var go = function () { if (id && store[id]) openEvent(id, isOrg() ? 'riepilogo' : 'compiti'); };
  if (store[id] || !id) go(); else fetchAll().then(function () { go(); updateTrigger(); });
}

window.addEventListener('pagehide', function () { flushNotices(); flushAll(true); });
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') { flushNotices(); flushAll(true); }
  else if (loaded) refresh();
});

/* ============================================================
   Costruzione di un nuovo evento
   ============================================================ */
function buildEvent(o) {
  var type = TYPES[o.type] ? o.type : 'altro', arrival = o.arrival || '19:30', me = meKey();
  return {
    id: uid('ods'), title: o.title, type: type, date: o.date, status: 'bozza', createdBy: me,
    times: { setup: '', arrival: arrival, end: '' },
    lead: isOrg() ? me : '', client: { name: '', phone: '' },
    covers: { adults: o.covers || 0, kids: o.kids || '', highchairs: o.highchairs || '', expected: (o.covers || 0) + (o.kids || 0), guaranteed: '', locked: false },
    diets: [], dishes: [],
    services: SERVICE_TPL[type].map(function (r) { return { id: uid('v'), name: r[0], date: '', time: addMin(arrival, r[1]), place: '', beverage: '', food: '' }; }),
    wines: [], winePolicy: 'elenco',
    allergies: [], noAllergies: false,
    tariffs: TARIFF_TPL[type].map(function (r) { return { id: uid('r'), label: r[0], price: '', qty: '', note: r[1] || '' }; }),
    // Compiti e scaletta partono VUOTI: si aggiungono a mano, senza orari obbligatori.
    // La checklist standard e la scaletta tipo restano a disposizione, ma solo se si chiedono.
    timeline: [],
    tasks: o.checklist === true ? stdTasks(type) : [],
    rooms: [{ id: uid('o'), name: 'Interno', style: 'Tavoli rotondi', notes: '', tables: [] }],
    staff: [], suppliers: [], notes: '',
    billing: { deposit: '', depositIn: false, invoiceTo: '' },
    updatedAt: new Date().toISOString(), reads: {}
  };
}

/* ============================================================
   Aspetto: i colori e le misure sono quelli del gestionale
   ============================================================ */
// Il documento ha un aspetto fisso da carta (si stampa uguale per tutti)
var DOC_CSS =
  '.ods{--ink:#1d1a1b;--soft:#6e6669;--line:#ece6e7;--accent:#7A2038;--accent2:#5C1729;--wash:#f8f0f2;--signal:#b3261e;--amber:#8a5a10;--amber-wash:#fbf3e2;--ok:#2f7a55;--paper:#faf7f7;max-width:760px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;font-size:15px;line-height:1.5;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  '.ods *{box-sizing:border-box}' +
  /* intestazione */
  '.od-hero{position:relative;background:linear-gradient(145deg,var(--accent) 0%,var(--accent2) 100%);color:#fff;border-radius:20px;padding:20px 22px 22px;margin:0 0 18px;overflow:hidden}' +
  '.od-hero:after{content:"";position:absolute;right:-60px;top:-60px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,.07)}' +
  '.ods-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;position:relative;z-index:1}' +
  '.ods-brand{font:700 13px Georgia,"Times New Roman",serif;letter-spacing:.14em;text-transform:uppercase}' +
  '.od-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.75}' +
  '.od-foot{text-align:center;font-size:12px;color:var(--soft);margin:18px 0 6px}' +
  '.ods-date{font:400 30px/1.1 Georgia,"Times New Roman",serif;margin:18px 0 4px;position:relative;z-index:1}.ods-date:first-letter{text-transform:uppercase}' +
  '.ods-sub{margin:0 0 14px;font-size:14px;opacity:.8;position:relative;z-index:1}' +
  '.ods-event{margin:0 0 14px;font-size:21px;font-weight:700;line-height:1.25;position:relative;z-index:1}.ods-event u{text-decoration:none}' +
  '.od-pills{display:flex;flex-wrap:wrap;gap:8px;position:relative;z-index:1}' +
  '.od-pill{display:inline-flex;align-items:center;min-height:30px;padding:3px 12px;border-radius:99px;background:rgba(255,255,255,.16);font-size:13px;font-weight:500}.od-pill.strong{background:#fff;color:var(--accent);font-weight:800}' +
  '.od-hero .ods-edit{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.35);color:#fff;min-height:28px}.od-hero .ods-edit:hover{background:rgba(255,255,255,.28);color:#fff;border-color:#fff}' +
  /* sezioni a scheda */
  '.ods section{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:0 0 14px;break-inside:avoid}' +
  '.ods h1,.ods h2,.ods h3{margin:0}' +
  '.ods h2{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin:0 0 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;text-decoration:none}' +
  '.ods h2.svc{font-size:18px;letter-spacing:0;text-transform:none;color:var(--ink);font-weight:700;padding-bottom:10px;border-bottom:2px solid var(--wash);margin-bottom:6px}' +
  '.ods h2.day{display:block;text-align:center;font:400 22px Georgia,serif;letter-spacing:0;text-transform:capitalize;color:var(--ink);margin:26px 0 12px;padding:0;border:0}' +
  '.ods h3{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--soft);margin:14px 0 4px;display:flex;align-items:center;justify-content:space-between;gap:8px}' +
  '.ods p{margin:0 0 4px}' +
  '.ods .lines p{margin:0;padding:7px 0;border-top:1px solid var(--line)}.ods .lines p:first-child{border-top:0}' +
  '.ods .lines p.sep{color:var(--soft);font-size:12px;letter-spacing:.1em;text-align:center;border:0;padding:2px 0}' +
  '.ods .who-h{font-weight:700;margin:14px 0 4px;font-size:14px}.ods .who-h:first-child{margin-top:0}' +
  '.ods ul{margin:0 0 6px;padding:0;list-style:none}' +
  '.ods li{margin:0;padding:6px 0 6px 18px;border-top:1px solid var(--line);position:relative}.ods li:first-child{border-top:0}' +
  '.ods li:before{content:"";position:absolute;left:3px;top:14px;width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:.55}' +
  '.ods .flag-inline{color:var(--signal);font-weight:700;font-size:13px}' +
  '.ods .soft{color:var(--soft)}' +
  '.ods .hc-tag{white-space:nowrap}' +
  '.od-alth{display:flex;align-items:center;justify-content:space-between;gap:8px}.od-alth>span{display:inline-flex;gap:6px;align-items:center}' +
  '.od-toggle{font:600 12px -apple-system,"Segoe UI",system-ui,sans-serif;color:var(--accent);background:none;border:0;padding:6px 4px;cursor:pointer}' +
  '.od-altd{border:1px solid var(--line);border-radius:12px;margin:0 0 8px;background:#fff;overflow:hidden}' +
  '.od-altd>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;min-height:46px}.od-altd>summary::-webkit-details-marker{display:none}' +
  '.od-altd>summary:after{content:"";margin-left:auto;width:8px;height:8px;border-right:2px solid var(--soft);border-bottom:2px solid var(--soft);transform:rotate(45deg);margin-top:-3px}.od-altd[open]>summary:after{transform:rotate(-135deg);margin-top:3px}.od-altd[open]>summary{background:var(--paper)}' +
  '.od-cnt{font-size:12px;font-weight:700;background:var(--amber-wash);color:var(--amber);border-radius:99px;padding:2px 10px}.od-cnt.miss{background:#fdecea;color:var(--signal)}' +
  '.od-altd ul{padding:4px 14px 8px;margin:0}' +
  /* allergie: ben visibili */
  '.od-al{border-left:4px solid var(--signal);background:#fdf3f2;border-radius:0 10px 10px 0;padding:8px 12px;margin:0 0 8px!important}' +
  '.ods li u{text-decoration:none;font-weight:700;background:var(--amber-wash);color:var(--amber);padding:1px 7px;border-radius:6px}' +
  /* tabelle: scaletta, personale, fornitori */
  '.ods table{width:100%;border-collapse:collapse}' +
  '.ods td{padding:9px 8px 9px 0;border-top:1px solid var(--line);vertical-align:top}.ods tr:first-child td{border-top:0}' +
  '.ods td.t{width:62px;font-weight:800;white-space:nowrap;color:var(--accent);font-variant-numeric:tabular-nums}' +
  '.ods-edit{margin-left:auto;font:600 12px -apple-system,"Segoe UI",system-ui,sans-serif;letter-spacing:0;text-transform:none;color:var(--soft);background:var(--paper);border:1px solid var(--line);border-radius:99px;padding:0 12px;min-height:30px;cursor:pointer;float:none}' +
  '.ods-edit:hover{color:var(--accent);border-color:var(--accent)}' +
  '@media print{.od-altd>summary:after{display:none}.ods{max-width:none}.od-hero{background:#fff!important;color:#111;border:0;border-bottom:3px solid var(--accent);border-radius:0;padding:0 0 12px}.od-hero:after{display:none}.od-pill{background:#f3eff0!important;color:#111}.od-pill.strong{background:#fff!important;border:1px solid var(--accent)}.ods section{border-color:#ddd;border-radius:10px}.no-print{display:none!important}}';

var STYLE =
':host{display:block;--paper:var(--color-bg,#FAFAFA);--sheet:var(--color-surface,#fff);--ink:var(--color-ink,#191919);--soft:#6B6B6B;--line:var(--color-border,#E5E5E5);--line2:#C9C9C9;' +
'--accent:var(--color-primary,#7A2038);--accent-ink:#fff;--accent-wash:#F7ECEF;--ok:var(--color-success,#4C8C6C);--ok-ink:#2E6B4E;--ok-wash:#E6F2EB;' +
'--signal:var(--color-danger,#C0392B);--signal-wash:#FBE9E6;--amber:#8A5A0C;--amber-wash:#FBF0D9;' +
'font-family:var(--font-body,system-ui,sans-serif);color:var(--ink);font-size:16px;line-height:1.45;-webkit-user-select:text;user-select:text}' +
'*,*::before,*::after{box-sizing:border-box}' +
'h1,h2,h3{margin:0;line-height:1.2;letter-spacing:-.01em}h1{font-size:var(--text-2xl,28px);font-weight:800}h2{font-size:var(--text-xl,22px);font-weight:800}h3{font-size:var(--text-lg,18px);font-weight:700}' +
'button{font-family:inherit;cursor:pointer}' +
':focus-visible{outline:3px solid var(--accent);outline-offset:2px}' +
'.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
'.wrap{max-width:760px;margin:0 auto;padding:calc(var(--space-lg,24px) + var(--safe-top,0px)) var(--space-md,16px) var(--space-lg,24px)}' +
'.lead{color:var(--soft);margin:6px 0 16px;max-width:60ch}' +
'.note{font-size:14px;color:var(--soft);margin:8px 0 0}' +
'.empty{color:var(--soft);padding:14px 0}' +
'.sech{margin:28px 0 12px;font-size:var(--text-lg,18px)}' +
'.upd{font-size:14px;color:var(--soft);margin:2px 0 0}' +
'.sync{margin-left:6px;font-weight:600}.sync.bad{color:var(--signal)}' +
'code{background:var(--line);padding:1px 5px;border-radius:4px;font-size:13px}' +
/* bottoni */
'.btn{font:700 15px/1 inherit;font-family:inherit;min-height:var(--tap-min,48px);padding:0 20px;border-radius:var(--radius-md,12px);border:1px solid transparent;display:inline-flex;align-items:center;justify-content:center;gap:8px}' +
'.btn:disabled{opacity:.6;cursor:default}' +
'.btn.primary{background:var(--accent);color:var(--accent-ink)}' +
'.btn.quiet{background:var(--sheet);color:var(--ink);border-color:var(--line2)}' +
'.btn.small{min-height:42px;padding:0 14px;font-size:14px;border-radius:var(--radius-sm,8px)}' +
'.link{background:none;border:0;padding:8px 2px;font:600 14px inherit;font-family:inherit;color:var(--soft);text-decoration:underline;text-underline-offset:3px}' +
'.link.danger{color:var(--signal)}.link.armed{background:var(--signal);color:#fff;text-decoration:none;border-radius:8px;padding:8px 12px}' +
'.link.back{padding-left:0;margin-bottom:4px}' +
'.pill{display:inline-flex;align-items:center;min-height:28px;padding:0 12px;border-radius:99px;background:var(--accent-wash);color:var(--accent);font:700 13px inherit;font-family:inherit}' +
'.flag{font:700 12px inherit;font-family:inherit;padding:3px 10px;border-radius:99px;background:var(--line);color:var(--soft)}' +
'.flag.red{background:var(--signal-wash);color:var(--signal)}.flag.amber{background:var(--amber-wash);color:var(--amber)}.flag.ok{background:var(--ok-wash);color:var(--ok-ink)}' +
'.kind{font:700 12px inherit;font-family:inherit;padding:2px 10px;border-radius:99px;background:var(--line);color:var(--soft);margin-left:6px;vertical-align:1px}.kind.hard{background:var(--signal-wash);color:var(--signal)}' +
'.kindtag{font-size:13px;color:var(--soft)}' +
/* campi */
'.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 12px}.grid.nums{grid-template-columns:repeat(2,minmax(0,1fr))}' +
'.fld{display:block;min-width:0}.fld.span2{grid-column:1/-1}' +
'.fl{display:block;font:700 13px inherit;font-family:inherit;color:var(--soft);margin-bottom:5px}' +
'.in{width:100%;min-height:var(--tap-min,48px);padding:10px 12px;border:1px solid var(--line2);border-radius:var(--radius-sm,8px);background:var(--sheet);color:var(--ink);font:inherit;font-size:16px}' +
'textarea.in{resize:vertical;line-height:1.4}' +
'.in.plain{min-height:38px;padding:6px 8px;margin-left:-8px;width:calc(100% + 8px);border-color:transparent;background:transparent}.in.plain:hover,.in.plain:focus{border-color:var(--line2);background:var(--sheet)}' +
'.in.status{width:auto;font-weight:700}.in.time{width:auto;min-width:112px}' +
'.ro{white-space:pre-line;min-height:24px}.ro.empty{color:var(--soft)}' +
'.toggle{position:relative;display:flex;align-items:center;gap:12px;min-height:var(--tap-min,48px);cursor:pointer}' +
'.toggle input{position:absolute;opacity:0;width:44px;height:26px;margin:0;cursor:pointer}' +
'.toggle .sw{width:44px;height:26px;border-radius:99px;background:var(--line2);position:relative;flex:0 0 auto;transition:background .15s}' +
'.toggle .sw::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .15s}' +
'.toggle input:checked+.sw{background:var(--accent)}.toggle input:checked+.sw::after{transform:translateX(18px)}' +
'.toggle input:focus-visible+.sw{outline:3px solid var(--accent);outline-offset:2px}' +
/* spunta */
'.check{position:relative;display:inline-flex;flex:0 0 auto;width:30px;height:30px;margin-top:1px}' +
'.check input{position:absolute;top:-7px;left:-7px;width:44px;height:44px;margin:0;opacity:0;cursor:pointer;z-index:1}.check input:disabled{cursor:not-allowed}' +
'.check .box{width:30px;height:30px;border:2px solid var(--line2);border-radius:9px;display:grid;place-items:center;background:var(--sheet);transition:background .12s,border-color .12s}' +
'.check .box svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:24;stroke-dashoffset:24;transition:stroke-dashoffset .2s ease-out .03s}' +
'.check input:checked+.box{background:var(--ok);border-color:var(--ok)}.check input:checked+.box svg{stroke-dashoffset:0}' +
'.check input:focus-visible+.box{outline:3px solid var(--accent);outline-offset:2px}.check input:disabled+.box{opacity:.4}' +
/* persone */
'.av{width:24px;height:24px;border-radius:50%;display:inline-grid;place-items:center;font:700 11px inherit;font-family:inherit;background:hsl(var(--h) 42% 88%);color:hsl(var(--h) 55% 24%);flex:0 0 auto}.av.dept{border-radius:7px}' +
'.who{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);border-radius:99px;padding:2px 12px 2px 3px;min-height:34px;background:var(--sheet);font:700 13px inherit;font-family:inherit;color:var(--ink)}' +
'.who.is-empty{border-style:dashed;border-color:var(--signal);color:var(--signal);padding-left:12px}' +
'.who select{appearance:none;-webkit-appearance:none;border:0;background:transparent;font:inherit;color:inherit;padding:6px 14px 6px 2px;max-width:150px}' +
'.who.edit{position:relative}.who.edit::after{content:"";position:absolute;right:11px;top:50%;width:6px;height:6px;border:solid currentColor;border-width:0 2px 2px 0;transform:translateY(-70%) rotate(45deg);opacity:.55;pointer-events:none}' +
/* elenco */
'.home-actions{display:flex;flex-wrap:wrap;gap:10px;margin:4px 0 6px}' +
'.ev-row{display:flex;gap:14px;align-items:stretch;width:100%;text-align:left;background:var(--sheet);border:1px solid var(--line);border-radius:var(--radius-lg,16px);padding:14px;color:inherit;font:inherit;margin-bottom:10px;box-shadow:var(--shadow-sm,none)}' +
'.leaf{flex:0 0 52px;text-align:center;border-right:1px solid var(--line);padding-right:14px;display:flex;flex-direction:column;justify-content:center}' +
'.leaf b{display:block;font-size:28px;line-height:1;font-weight:800}.leaf span{font-size:13px;color:var(--soft)}' +
'.ev-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}.ev-title{font-size:18px;font-weight:800;line-height:1.2}.ev-sub{font-size:14px;color:var(--soft)}' +
'.ev-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}.ev-tags .when{font-size:13px;font-weight:700}' +
'.mine{background:var(--sheet);border:1px solid var(--line);border-radius:var(--radius-lg,16px);padding:6px 16px 10px;margin:18px 0 0}.mine h2{padding-top:12px;font-size:var(--text-lg,18px)}' +
/* pagina riassuntiva */
'.board{margin:22px 0 0}.board>h2,.board-head h2{font-size:var(--text-lg,18px)}' +
'.board-head{display:flex;align-items:center;gap:12px;justify-content:space-between}.board-head h2{flex:1}' +
'.board-actions{display:flex;gap:8px}' +
'.board-sub{font-size:14px;color:var(--soft);margin:2px 0 10px}.board-sub.late{color:var(--signal);font-weight:700}.board-sub.ok{color:var(--ok-ink)}' +
'.bigcount{min-width:38px;height:38px;padding:0 10px;border-radius:99px;background:var(--accent);color:#fff;font-size:20px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}.bigcount.late{background:var(--signal)}.bigcount.amber{background:var(--amber)}' +
'.mine-board{background:var(--sheet);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:4px var(--radius-lg,16px) var(--radius-lg,16px) 4px;padding:16px 16px 8px;margin-top:16px}.mine-board h2{font-size:var(--text-xl,22px)}' +
'.board .tasks{padding-bottom:4px}.viadept{background:var(--accent-wash);color:var(--accent);border-radius:99px;padding:1px 9px;font-weight:700;font-size:12px}' +
'.pcard{background:var(--sheet);border:1px solid var(--line);border-radius:var(--radius-md,12px);margin:0 0 8px;padding:0 14px}.pcard.has-late{border-left:4px solid var(--signal)}' +
'.pcard>summary{list-style:none;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 0;cursor:pointer;min-height:var(--tap-min,48px)}.pcard>summary::-webkit-details-marker{display:none}' +
'.pc-main{flex:1;min-width:0;display:flex;flex-direction:column}.pc-main b{font-size:16px}.pc-kind{font-size:12px;color:var(--soft)}.pc-stats{font-size:13px;color:var(--soft)}' +
'.pc-bar{flex:0 0 100%}.pcard[open]>summary{border-bottom:1px solid var(--line);margin-bottom:4px}' +
'.donebox{margin:4px 0 8px}.donebox>summary{font-size:13px;font-weight:700;color:var(--soft);padding:8px 0;cursor:pointer}' +
/* intestazione evento */
'.evh{padding-bottom:6px}.evh h1{margin:4px 0 8px}' +
'.evh .when{display:flex;flex-wrap:wrap;gap:2px 14px;color:var(--soft);font-size:15px}.evh .when .countdown{color:var(--ink);font-weight:700}' +
'.evh-actions{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}' +
'.prog{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--soft)}.prog .progress{flex:1}' +
'.progress{height:8px;background:var(--line);border-radius:99px;overflow:hidden}.progress>i{display:block;height:100%;background:var(--ok);border-radius:99px;transition:width .3s}.progress.sm{height:5px}' +
'.readbar{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;justify-content:space-between;background:var(--amber-wash);border-left:5px solid var(--amber);border-radius:4px 12px 12px 4px;padding:12px 14px;margin:0 0 14px}' +
'.readbar.ok{background:var(--ok-wash);border-left-color:var(--ok)}.readbar p{margin:0;flex:1 1 220px;font-size:14px}.readbar .acts{display:flex;gap:8px;flex-wrap:wrap}' +
/* schede */
'.tabs{position:sticky;top:var(--safe-top,0px);z-index:20;display:flex;gap:4px;overflow-x:auto;background:var(--paper);padding:8px 16px;margin:6px -16px 14px;border-bottom:1px solid var(--line);scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}' +
'.tab{flex:0 0 auto;min-height:44px;padding:0 14px;border:0;border-radius:99px;background:transparent;color:var(--soft);font:700 14px inherit;font-family:inherit;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}' +
'.tab[aria-selected="true"]{background:var(--accent-wash);color:var(--accent)}.tcount{font-size:12px;font-weight:700;opacity:.8}' +
'.sheet{background:var(--sheet);border:1px solid var(--line);border-radius:var(--radius-lg,16px);padding:6px 18px 20px;scroll-margin-top:70px}' +
'.sec{padding:22px 0 4px;border-top:1px solid var(--line)}.sec.first{border-top:0;padding-top:16px}.sec>h2{margin-bottom:12px}' +
/* cosa manca */
'.missing{background:var(--signal-wash);border-left:5px solid var(--signal);border-radius:4px 14px 14px 4px;padding:18px 18px 8px}' +
'.missing.ok{background:var(--ok-wash);border-left-color:var(--ok);padding-bottom:18px}.missing h2{font-size:26px;margin-bottom:4px}.missing .lead{margin:0 0 10px;font-size:14px}' +
'.mi{display:flex;align-items:flex-start;gap:12px;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--line2);padding:13px 0;color:var(--ink);font:inherit;min-height:var(--tap-min,48px)}' +
'.mi .dot{width:10px;height:10px;border-radius:50%;margin-top:7px;flex:0 0 auto;background:var(--signal)}.mi.amber .dot{background:var(--amber)}.mi .t{flex:1}' +
'.mi .go{font:700 13px inherit;font-family:inherit;color:var(--soft);text-decoration:underline;text-underline-offset:3px;align-self:center}' +
'.rl{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line)}.rl:first-of-type{border-top:0}.rl b{flex:1}' +
/* compiti */
'.chips{display:flex;flex-wrap:wrap;gap:8px}' +
'.chip{min-height:40px;padding:0 14px;border-radius:99px;border:1px solid var(--line2);background:var(--sheet);color:var(--ink);font:700 13px inherit;font-family:inherit}' +
'.chip .n{opacity:.65;margin-left:4px}.chip.sel{background:var(--accent-wash);border-color:var(--accent);color:var(--accent)}' +
'.chip.on{background:var(--signal-wash);border-color:var(--signal);color:var(--signal)}.chip.static{min-height:28px;font-size:12px;padding:0 10px;cursor:default}' +
'.filters{margin:14px 0 8px}.seg{margin:0 0 6px}' +
'.combo-custom{display:flex;align-items:center;gap:10px}.combo-custom .in{flex:1;min-width:0}.combo-custom .link{white-space:nowrap;font-size:13px}' +
'.addrow{display:flex;flex-direction:column;gap:8px;padding:14px 0;border-bottom:1px solid var(--line)}.addrow-2{display:flex;flex-wrap:wrap;gap:8px}.addrow-2 select,.addrow-2 input{flex:1 1 140px;width:auto}' +
'details.phase{border-top:1px solid var(--line)}details.phase:first-of-type{border-top:0}' +
'.phase>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:14px 0;cursor:pointer;min-height:56px}.phase>summary::-webkit-details-marker{display:none}' +
'.ph-t{flex:1;min-width:0}.ph-sub{display:block;font-size:13px;color:var(--soft);margin-top:2px}.phase .count{font:700 13px inherit;font-family:inherit;color:var(--soft)}' +
'.phase>summary::after{content:"";width:8px;height:8px;border:solid var(--soft);border-width:0 2px 2px 0;transform:rotate(45deg);margin:-4px 4px 0 2px;transition:transform .15s}' +
'.phase[open]>summary::after{transform:rotate(-135deg);margin-top:4px}.phase.is-complete h3{color:var(--soft)}' +
'.grp{padding-top:14px;border-top:1px solid var(--line)}.grp:first-of-type{border-top:0}.grp>h3{display:flex;align-items:center;gap:10px;margin-bottom:2px}.grp>h3 .count{font:700 13px inherit;font-family:inherit;color:var(--soft);margin-left:auto}' +
'.tasks{list-style:none;margin:0;padding:0 0 8px}.task{display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}.task:first-child{border-top:0}' +
'.task-main{flex:1;min-width:0}.task-text{display:block;line-height:1.35}' +
'.task-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:6px;font-size:13px;color:var(--soft)}' +
'.task.is-done .task-text,.task.is-done .in.plain,.tl.is-done .task-text,.tl.is-done .in.plain{color:var(--soft);text-decoration:line-through;text-decoration-thickness:1px}' +
'.due.late{color:var(--signal);font-weight:700}.tools{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:10px}' +
/* scaletta */
'.shift{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 6px;font-size:13px;color:var(--soft)}' +
'.tl{display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-top:1px solid var(--line);list-style:none}.tl:first-child{border-top:0}' +
'.tl-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}.tl-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}.tl-time{font-size:22px;line-height:1;font-weight:800}' +
/* righe */
'.rowform{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;padding:14px 0;border-top:1px solid var(--line);list-style:none;align-items:end}.rowform:first-child{border-top:0}.rowform .full{grid-column:1/-1}' +
'.rowform.team{grid-template-columns:auto minmax(0,1fr) auto minmax(0,.9fr);align-items:center;gap:8px}' +
'.list{list-style:none;margin:0;padding:0}' +
'.svc{padding:16px 0;border-top:1px solid var(--line)}.svc:first-child{border-top:0;padding-top:4px}.svc .link{margin-top:6px}' +
'.total{font-size:18px;font-weight:800;margin:12px 0 0}' +
'.al{display:flex;flex-wrap:wrap;gap:10px 16px;justify-content:space-between;padding:14px 0;border-top:1px solid var(--line)}.al:first-child{border-top:0}' +
'.al-main{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:8px}.al-side{display:flex;flex-direction:column;align-items:flex-start;gap:2px}' +
'.al:not(.is-informed) .al-main b::after{content:" — cucina da avvisare";color:var(--signal);font-weight:700;font-size:13px}' +
'.allergy-form{display:flex;flex-direction:column;gap:12px;padding:16px;margin-top:10px;background:var(--paper);border-radius:var(--radius-md,12px)}' +
'.dietrow{display:flex;align-items:center;gap:8px;padding:6px 0;list-style:none}.dietrow .in{flex:1;min-width:0}.dietrow .in.num{flex:0 0 84px;width:84px;text-align:center}.dietrow>span{flex:1}' +
'.addchips{margin-top:12px}.addchips .fl{margin-bottom:8px}.sub{margin:24px 0 4px;font-size:18px}' +
'.room{padding:18px 0;border-top:1px solid var(--line);list-style:none}.room:first-child{border-top:0;padding-top:4px}.tbls{margin-top:8px}' +
'.tbl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;padding:12px 0;border-top:1px solid var(--line);list-style:none;align-items:end}.tbl:first-child{border-top:0}' +
'.tbl>.link{grid-column:1/-1;justify-self:start}.tbl.ro-row{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}' +
'.bulk{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px;font-size:14px;color:var(--soft)}.bulk .in{width:72px;min-height:44px;text-align:center}' +
/* finestre */
'.pc-sum{all:unset;box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:10px;width:100%;padding:12px 0;cursor:pointer;min-height:var(--tap-min,48px)}.pc-sum:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
'.pcard.is-open .chev{transform:rotate(-135deg);margin-top:4px}.pc-body{border-top:1px solid var(--line);padding-top:4px}' +
'.mine-sum{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;cursor:pointer;min-height:44px}.mine-sum h2{flex:1}.mine-board.is-closed .chev{transform:none}' +
'.nd-box{margin-top:8px;padding:8px 12px;border-radius:10px;background:var(--signal-wash);border-left:4px solid var(--signal);font-size:14px}.nd-box .link{margin-left:6px}' +
'.nd-link{font-size:13px;color:var(--soft);margin-top:4px;align-self:flex-start}' +
'.who-btn{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:40px;padding:4px 10px;border:1px solid var(--line2);border-radius:12px;background:var(--sheet);color:var(--ink);font:inherit;font-size:14px;cursor:pointer;text-align:left}' +
'.who-btn.is-empty{color:var(--soft);border-style:dashed}.who-btn .who-edit{margin-left:auto;font-size:12px;font-weight:700;color:var(--accent)}' +
'.who-chip{display:inline-flex;align-items:center;gap:6px;background:var(--paper);border-radius:99px;padding:2px 10px 2px 3px;font-size:13px;font-weight:600}.who-chip.empty{background:none;padding:0;font-weight:400;color:var(--soft)}' +
'.who-multi{display:inline-flex;flex-wrap:wrap;gap:6px}' +
'.due-edit{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}.in.tiny{min-height:38px;padding:4px 8px;font-size:13px;width:auto;max-width:190px}' +
'.pk-list{display:flex;flex-direction:column;gap:2px;margin:0 0 10px}.pk-row{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 10px;border-radius:10px;cursor:pointer}.pk-row:hover{background:var(--paper)}.pk-row input{width:22px;height:22px;accent-color:var(--accent)}.pk-name{display:flex;align-items:center;gap:8px;font-size:16px}' +
'.evbar{position:sticky;bottom:calc(var(--navh,0px) + 8px);z-index:25;display:flex;align-items:center;gap:8px;padding:10px 12px;margin:14px 0 0;background:var(--sheet);border:1px solid var(--line2);border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.14)}' +
'.evbar .btn{flex:0 0 auto;min-height:46px;padding:0 16px}.evbar .btn.wide{flex:1}.bar-state{flex:1;min-width:0;font-size:13px;color:var(--soft)}.bar-state.bad{color:var(--signal);font-weight:700}' +
'.tdot{width:9px;height:9px;border-radius:50%;background:var(--amber);flex:0 0 auto}.tdot.red{background:var(--signal)}' +
'.flow{margin-top:26px;padding-top:18px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:12px}' +
'.flow-state{border-radius:12px;padding:12px 14px;font-size:14px}.flow-state.ok{background:var(--ok-wash);color:var(--ok-ink);font-weight:700}' +
'.flow-state.todo{background:var(--amber-wash);border-left:5px solid var(--amber)}.flow-state ul{margin:6px 0 0;padding-left:18px}.flow-state .note{margin:6px 0 0}' +
'.btn.big{width:100%;min-height:54px;font-size:16px}' +
'.step{display:flex;align-items:center;gap:10px;font-size:15px;margin:0 0 8px}.step .n{width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;display:inline-grid;place-items:center;font-size:13px}.step small{font-weight:400;color:var(--soft)}' +
'.callout-note{background:var(--accent-wash);border-radius:10px;padding:10px 12px;color:var(--ink)}' +
'.al.editing{background:var(--paper);border-radius:12px;padding:14px;margin:6px 0;border:1px solid var(--line2)}' +
'.menu-allergy{background:var(--accent-wash);border-radius:12px;padding:12px 14px;margin:0 0 4px;display:flex;flex-direction:column;gap:8px;font-size:14px}' +
'.menu-svc{padding-top:20px}.menu-svc>h3{margin-bottom:10px}' +
'.dishes{list-style:none;margin:0;padding:0}.dish{border:1px solid var(--line);border-radius:12px;margin:0 0 8px;background:var(--sheet);overflow:hidden}' +
'.dish-sum{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:8px 14px;cursor:pointer}.dish-sum:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}' +
'.dish-sum .dish-name{flex:1;min-width:0;font-weight:700;font-size:16px;overflow-wrap:anywhere}' +
'.dish-sum .flag{font-size:12px;padding:2px 9px;white-space:nowrap;flex:0 0 auto}' +
'.chev{width:10px;height:10px;border-right:2px solid var(--soft);border-bottom:2px solid var(--soft);transform:rotate(45deg);margin:-4px 4px 0 4px;transition:transform .15s}.dish.is-open .chev{transform:rotate(-135deg);margin-top:4px}' +
'.dish.is-open>.dish-sum{background:var(--paper)}.dish-body{padding:4px 14px 14px}' +
'.dish-tools{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:flex-end;margin:6px 0 4px}.dish-tools .fld{flex:1 1 220px}' +
'.dish-cont{margin:8px 0 4px;font-size:14px}.dish-allno{margin:8px 0 2px;width:100%}.dishes-ctl{margin:8px 0 0;text-align:right}' +
'.menu-allergy>summary{cursor:pointer;list-style:none}.menu-allergy>summary::-webkit-details-marker{display:none}.menu-allergy .chips{margin-top:8px}' +
'.yn-b.diet.yes.on{background:var(--ok);border-color:var(--ok)}.yn-b.diet.no.on{background:var(--signal);border-color:var(--signal)}' +
'.dish-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dish-name{flex:1 1 160px;min-width:0;font-weight:700}.dish-head .in.plain.dish-name{font-weight:700}' +
'.qs{list-style:none;margin:8px 0 0;padding:0}.q{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--line)}.q.todo{background:var(--amber-wash);margin:0 -8px;padding:10px 8px;border-radius:8px;border-top-color:transparent}' +
'.qt{flex:1 1 130px;font-size:15px}.yn{display:inline-flex;gap:8px;flex:0 0 auto}' +
'.yn-b{min-width:60px;min-height:44px;padding:0 14px;border-radius:99px;border:2px solid var(--line2);background:var(--sheet);color:var(--ink);font:800 15px inherit;font-family:inherit}' +
'.yn-b.yes.on{background:var(--signal);border-color:var(--signal);color:#fff}.yn-b.no.on{background:var(--ok);border-color:var(--ok);color:#fff}' +
'.alt{margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--paper);border-left:4px solid var(--ok)}.alt.todo{border-left-color:var(--signal);background:var(--signal-wash)}' +
'.dish-add{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.dish-add .in{flex:1 1 200px}' +
'.menu-paste{margin-top:10px}.menu-paste>summary{cursor:pointer;font-weight:700;font-size:14px;color:var(--soft);padding:8px 0}.menu-paste .in{margin:6px 0 8px}' +
'.callout{background:var(--amber-wash);border-radius:12px;padding:12px 14px;margin:0 0 10px}.callout p{margin:0 0 6px;font-size:14px}.callout pre{white-space:pre-wrap;margin:0 0 10px;font:inherit;font-size:14px;color:var(--soft)}' +
'.legacy{margin-top:18px;border-top:1px solid var(--line);padding-top:6px}' +
'.ods-hint{font:13px system-ui,sans-serif;color:var(--soft);margin:0 0 14px}' +
'.overlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}' +
'.panel{background:var(--sheet);width:100%;max-width:640px;max-height:92vh;overflow:auto;border-radius:20px 20px 0 0;padding:22px 18px calc(24px + var(--safe-bottom,0px))}.panel:focus{outline:none}' +
'@media (min-width:700px){.overlay{align-items:center}.panel{border-radius:20px}}' +
'.overlay.full .panel{max-width:820px;height:100%;max-height:100%;border-radius:0;padding-top:calc(16px + var(--safe-top,0px))}' +
'.sheet-foot{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}' +
'#toast{position:fixed;left:50%;bottom:calc(96px + var(--safe-bottom,0px));transform:translate(-50%,16px);background:var(--ink);color:#fff;padding:12px 18px;border-radius:var(--radius-md,12px);font:700 14px inherit;font-family:inherit;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:300;max-width:90vw;text-align:center}' +
'#toast.show{opacity:1;transform:translate(-50%,0)}' +
/* documento a schermo */
'.ods-actions{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:6px 0;position:sticky;top:0;z-index:6;background:var(--sheet,#fff);font-family:var(--font-body,system-ui,sans-serif)}.ods-actions .btn{flex:0 0 auto;min-height:44px;padding:0 11px;font-size:14px}.ods-actions .btn.primary{margin-right:auto}' +
DOC_CSS +
'@media (min-width:520px){.grid.nums{grid-template-columns:repeat(4,minmax(0,1fr))}}' +
'@media (max-width:560px){.rowform.team{grid-template-columns:auto minmax(0,1fr)}.rowform.team>.in,.rowform.team>.kindtag{grid-column:2}}' +
'@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}';

return {
  init: init, render: render, refresh: refresh, onRemote: onRemote, summary: summary, updateTrigger: updateTrigger,
  openFromLink: openFromLink, flushNotices: flushNotices
};
})();
window.ODS = ODS;
