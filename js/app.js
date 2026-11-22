/**
 * app.js
 * Bootstrap: gestisce login, ruoli, caricamento dati e tutti gli event listener.
 */

document.addEventListener('DOMContentLoaded', () => init());

async function init() {
  // Collega subito il bottone login, prima di qualsiasi controllo sessione
  bindLogin();

  // Precarica i PIN dipendenti (dentro la configurazione condivisa) ANCHE
  // prima del login — altrimenti chi ha appena avuto un PIN nuovo da
  // Luca/Davy non verrebbe riconosciuto al primo tentativo. Una volta
  // caricata, porta anche le vecchie password fisse nel sistema
  // modificabile, se non è già stato fatto — una tantum, per sempre.
  SharedTables.load().then(() => SharedTables.migrateFixedCredentials()).catch(() => {});

  // Prova a ripristinare la sessione dal localStorage
  if (DB.restoreSession()) {
    await enterApp();
  } else {
    showLogin();
  }
  registerServiceWorker();
  watchOnlineStatus();
  bindGlobalDelegation();
}

/**
 * Event delegation globale per bottoni che possono essere
 * aggiunti dinamicamente o che hanno problemi di timing.
 */
function bindGlobalDelegation() {
  // Blocco centralizzato del click residuo dopo aver chiuso una modal.
  // Il tentativo precedente (preventDefault su pointerdown) partiva
  // dall'assunzione che questo basti a impedire il click successivo — non
  // è garantito su tutti i browser, e infatti non ha risolto il problema.
  // Qui invece, per una finestra breve subito dopo aver chiuso una modal,
  // QUALUNQUE click viene bloccato del tutto prima che possa raggiungere
  // qualsiasi altro gestore della pagina — non importa dove atterri o cosa
  // farebbe normalmente, in quella finestra viene sempre ignorato. Va in
  // fase di "cattura" (true), cioè PRIMA di ogni altro gestore click nella
  // pagina, compreso quello dei tab in basso e quello delle card lista.
  document.addEventListener('click', (e) => {
    if (Date.now() < (UI._suppressClickUntil || 0)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Chiudere qualunque modal toccando fuori (sullo sfondo scuro, non sulla
  // scheda) — mancava del tutto, su tutte le 15 modal dell'app. Un solo
  // gestore qui copre tutte quelle già esistenti e quelle future, senza
  // doverlo ricordare di aggiungere ogni volta che se ne crea una nuova.
  // Uso "pointerdown" (inizio di un tocco vero e nuovo) e non "click": un
  // tocco su un tavolo apre una modal SUBITO, nello stesso gesto — e alla
  // fine di quel gesto il browser genera comunque un evento "click" finale,
  // che a quel punto atterra sulla modal appena apparsa sopra al dito
  // invece che sul tavolo sottostante, richiudendola all'istante. Con
  // pointerdown il problema non c'è: è un tocco genuinamente nuovo, non la
  // coda dello stesso gesto che ha aperto la modal.
  document.addEventListener('pointerdown', (e) => {
    if (e.target.classList && e.target.classList.contains('modal-overlay') && !e.target.classList.contains('modal-blocking')) {
      UI._suppressClickUntil = Date.now() + 400;
      e.target.classList.remove('active');
    }
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.id;

    if (id === 'miseBtnLunch') { UI.state.miseService = 'lunch'; UI.renderMise(); return; }
    if (id === 'miseBtnDinner') { UI.state.miseService = 'dinner'; UI.renderMise(); return; }
    if (id === 'roMiseBtnLunch') { UI.state.miseService = 'lunch'; renderRoMise(); return; }
    if (id === 'roMiseBtnDinner') { UI.state.miseService = 'dinner'; renderRoMise(); return; }

    // Amministratori: passaggio sala ⇄ cucina
    if (btn.classList.contains('go-kitchen-btn')) { enterKitchenView(); return; }
    if (id === 'roBackToSalaBtn') { leaveKitchenView(); return; }

    if (id === 'roBtnLunch') {
      UI.state.roService = 'lunch';
      UI.renderReadOnlyView();
      return;
    }
    if (id === 'roBtnDinner') {
      UI.state.roService = 'dinner';
      UI.renderReadOnlyView();
      return;
    }

    if (id === 'cfgAddZoneBtn') {
      e.stopPropagation();
      const container = document.getElementById('cfgZoneTavoliList');
      if (container) container.appendChild(UI.buildZoneEditor('', []));
    }

    if (id === 'cfgZoneTavoliSaveBtn') {
      e.stopPropagation();
      const zt = UI.getZoneTavoliFromEditor();
      if (Object.keys(zt).length === 0) { UI.toast('Aggiungi almeno una zona', 'warning'); return; }
      btn.disabled = true;
      btn.textContent = 'Salvo…';
      UI.showSyncIndicator(true);
      const ok = await SharedTables.save(zt);
      UI.showSyncIndicator(false);
      btn.disabled = false;
      btn.textContent = 'Salva tutto';
      if (ok) {
        const confirmEl = document.getElementById('cfgZoneTavoliConfirm');
        if (confirmEl) { confirmEl.classList.add('visible'); setTimeout(() => confirmEl.classList.remove('visible'), 2000); }
        UI.toast('Zone e tavoli aggiornati ✓');
        // Aggiorna le zone nel form prenotazione se è aperto
        if (UI.state.currentScreen === 'form') {
          UI.populateZoneOptions();
          UI.populateFormTablePicker();
        }
        // Aggiorna la dashboard e la lista
        UI.renderDashboard();
      } else {
        UI.toast('Errore nel salvataggio', 'warning');
      }
    }

    if (btn.classList.contains('zone-editor-del')) {
      e.stopPropagation();
      const block = btn.closest('.zone-editor-block');
      if (block) {
        const name = block.querySelector('.zone-editor-name')?.value || 'questa zona';
        if (confirm('Eliminare "' + name + '"?')) block.remove();
      }
    }

    // ===== Progetti Gastronomici — stessa delegazione centralizzata =====
    if (id === 'projectsNewBtn') { UI.openProjectForm(null); return; }
    if (id === 'projectsModeToggle') {
      Storage.set('projectSimpleMode', !UI.isProjectSimpleMode());
      UI.renderProjects();
      return;
    }
    if (id === 'projectFormBackBtn') { UI.showScreen('projects'); return; }
    if (id === 'projectSaveBtn') { await UI.saveProject(); return; }
    if (id === 'projectSummaryBtn') { UI.openProjectSummaryModal(); return; }
    if (id === 'projectDeleteLink') { e.preventDefault(); await UI.deleteProject(); return; }
    // Allergie: prima il pop-up di consenso (frase da leggere + casella), poi il campo
    if (id === 'fIntolerancesChip') { UI.requestAllergyConsent(() => UI.expandQuickField('fIntolerancesChip', 'fIntolerancesWrap', 'fIntolerances')); return; }
    if (id === 'fSpecialNeedsChip') { UI.expandQuickField('fSpecialNeedsChip', 'fSpecialNeedsWrap', 'fSpecialNeeds'); return; }
    if (id === 'fNotesChip') { UI.expandQuickField('fNotesChip', 'fNotesWrap', 'fNotes'); return; }

    if (id === 'pjCopertiMinus') {
      UI._projectCoperti = Math.max(1, (UI._projectCoperti || 20) - 1);
      document.getElementById('pjCopertiValue').textContent = UI._projectCoperti;
      UI.updateProjectEconomicsBox();
      return;
    }
    if (id === 'pjCopertiPlus') {
      UI._projectCoperti = (UI._projectCoperti || 20) + 1;
      document.getElementById('pjCopertiValue').textContent = UI._projectCoperti;
      UI.updateProjectEconomicsBox();
      return;
    }
    if (id === 'pjCoursesToggle') {
      const box = document.getElementById('pjCoursesBox');
      const willShow = box.classList.contains('hidden');
      if (willShow) {
        // Si apre: se non c'è già nulla (progetto nuovo), parte con una
        // portata vuota — più invitante di un riquadro vuoto da capire.
        if (!UI._projectCourses || UI._projectCourses.length === 0) {
          const firstOpt = { id: Utils.uid('opt'), name: '', foodCost: 0 };
          UI._projectCourses = [{ id: Utils.uid('course'), name: '', options: [firstOpt], chosenId: firstOpt.id }];
        }
        box.classList.remove('hidden');
        btn.textContent = '📋 Nascondi la scomposizione per portata';
        UI.renderProjectCourses();
      } else {
        // Si chiude: se c'era già scritto qualcosa di vero, chiede conferma
        // prima di svuotare — non deve sparire per uno sfioramento distratto.
        const hasContent = (UI._projectCourses || []).some(c => c.name?.trim() || (c.options || []).some(o => o.name?.trim() || o.foodCost > 0));
        if (hasContent && !confirm('Chiudendo la scomposizione per portata perdi quello che hai scritto lì dentro — continuare?')) return;
        UI._projectCourses = [];
        box.classList.add('hidden');
        btn.textContent = '📋 Scomponi il food cost per portata (facoltativo)';
        document.getElementById('pjFoodCost').readOnly = false;
        document.getElementById('pjFoodCost').classList.remove('project-foodcost-computed');
      }
      UI.updateProjectEconomicsBox();
      return;
    }

    // ===== Chip "cosa è incluso" =====
    if (btn.classList.contains('project-include-chip')) {
      const key = btn.dataset.key;
      if (!UI._projectIncludes) UI._projectIncludes = [];
      const idx = UI._projectIncludes.indexOf(key);
      if (idx === -1) UI._projectIncludes.push(key); else UI._projectIncludes.splice(idx, 1);
      UI.renderProjectIncludes();
      return;
    }

    // ===== Esigenze alimentari — steppers =====
    const dietarySteppers = {
      pjVegMinus: ['vegetarians', -1], pjVegPlus: ['vegetarians', 1],
      pjVeganMinus: ['vegans', -1], pjVeganPlus: ['vegans', 1],
      pjCeliacMinus: ['celiac', -1], pjCeliacPlus: ['celiac', 1],
    };
    if (dietarySteppers[id]) {
      const [field, delta] = dietarySteppers[id];
      if (!UI._projectDietary) UI._projectDietary = { vegetarians: 0, vegans: 0, celiac: 0, other: '' };
      UI._projectDietary[field] = Math.max(0, (UI._projectDietary[field] || 0) + delta);
      const valueId = { vegetarians: 'pjVegValue', vegans: 'pjVeganValue', celiac: 'pjCeliacValue' }[field];
      document.getElementById(valueId).textContent = UI._projectDietary[field];
      return;
    }
  });
}

/* ==========================================================================
   LOGIN
   ========================================================================== */
function showLogin() {
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('bottomNav').style.display = 'none';
  document.getElementById('roBottomNav').style.display = 'none';
}

function bindLogin() {
  const btn      = document.getElementById('loginBtn');
  const input    = document.getElementById('loginPassword');
  const errEl    = document.getElementById('loginError');

  async function tryLogin() {
    const pw   = input.value.trim();
    const role = await DB.login(pw);
    if (!role) {
      errEl.textContent = DB._lastLoginError || 'Password non corretta.';
      errEl.classList.remove('hidden');
      input.value = '';
      input.focus();
      return;
    }
    errEl.classList.add('hidden');
    await enterApp();
  }

  btn.addEventListener('click', tryLogin);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
}

let _appBound = false;

// Mini nav readonly: Lista / Eventi / Chiusi / Piatti / Mise — un'unica
// funzione generalizzata invece di ripetere la stessa logica per ogni
// coppia di pulsanti. A livello di primo piano (non dentro bindReadOnly)
// perché serve anche al gestore degli indirizzi delle notifiche, per
// portare alla scheda giusta anche da fuori la vista chef.
function switchRoTab(screenId, activeBtnId) {
  ['screen-readonly', 'screen-ro-eventi', 'screen-ro-chiusure', 'screen-ro-piatti', 'screen-ro-mise', 'screen-ods'].forEach(id => {
    document.getElementById(id)?.classList.toggle('active', id === screenId);
  });
  document.querySelectorAll('.ro-nav-btn').forEach(b => b.classList.remove('active'));
  if (activeBtnId) document.getElementById(activeBtnId)?.classList.add('active');
}

/**
 * Legge l'indirizzo con cui si è aperta la pagina (es. dal tocco su una
 * notifica) e porta al punto giusto — una prenotazione precisa, la
 * pagina piatti del giorno, il resoconto di un servizio, ecc. Chiamata
 * dopo che la schermata normale è già stata mostrata, così la sovrascrive
 * solo se c'è davvero un indirizzo da seguire.
 */
function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const open = params.get('open');
  if (!open) return;
  // Toglie i parametri dall'indirizzo dopo averli letti — altrimenti
  // riaprirebbero lo stesso punto ad ogni ricarica della pagina, anche
  // quando non c'entra più nulla con quello che si sta facendo.
  history.replaceState({}, '', location.pathname);

  const canEdit = DB.canEdit();
  const isChef = DB.getRole() === 'read';

  if (open === 'booking') {
    const id = params.get('id');
    if (id && canEdit) UI.openEditForm(id);
  } else if (open === 'daily-specials') {
    if (isChef) {
      switchRoTab('screen-ro-piatti', 'roBtnPiatti');
      UI.openPiattiTab(UI.state.selectedDate);
    } else if (canEdit) {
      UI.showScreen('dashboard');
    }
  } else if (open === 'reminders') {
    if (canEdit) UI.showScreen('dashboard');
  } else if (open === 'events') {
    if (isChef) {
      switchRoTab('screen-ro-eventi', 'roBtnEventi');
      UI.renderRoEventiPage();
    } else if (canEdit) {
      UI.showScreen('dashboard');
    }
  } else if (open === 'report') {
    const service = params.get('service');
    const date = params.get('date');
    if (service && date && canEdit) UI.openServiceReport(date, service);
  } else if (open === 'ods') {
    // Ordini di servizio: tocco su un avviso, dritto all'evento
    if (isChef) switchRoTab('screen-ods', null);
    else UI.showScreen('ods');
    if (typeof ODS !== 'undefined') ODS.openFromLink(params.get('id'));
  }
}

/**
 * Amministratori: dalla propria pagina (sala) possono vedere la vista
 * cucina e tornare indietro, senza uscire e rientrare. Non cambia chi
 * sono né cosa possono fare: cambia solo la schermata. Lo stato vive in
 * UI.state.kitchenMode (si azzera a ogni ingresso, vedi enterApp).
 */
function canSwitchToKitchen() {
  return DB.isLoggedIn() && DB.getRole() !== 'read' && DB.isFullAdmin();
}

function updateKitchenSwitch() {
  const can = canSwitchToKitchen();
  document.querySelectorAll('.go-kitchen-btn').forEach(b => b.classList.toggle('hidden', !can));
  const inKitchen = !!UI.state.kitchenMode;
  document.getElementById('roBackToSalaBtn')?.classList.toggle('hidden', !inKitchen);
  // Nella vista cucina l'amministratore torna in sala: si esce da lì
  document.getElementById('roLogoutBtn')?.classList.toggle('hidden', inKitchen);
}

function enterKitchenView() {
  if (!canSwitchToKitchen()) return;
  UI.state.kitchenMode = true;
  // stesso giorno e stesso servizio che si stavano guardando
  UI.state.roService = UI.state.selectedService || UI.state.roService;
  document.getElementById('bottomNav').style.display = 'none';
  document.getElementById('roBottomNav').style.display = 'flex';
  bindReadOnly();
  updateKitchenSwitch();
  UI.showScreen('readonly');
  switchRoTab('screen-readonly', 'roBtnList');
  try { window.scrollTo(0, 0); document.body.scrollTop = 0; } catch (e) { /* ignora */ }
}

function leaveKitchenView() {
  UI.state.kitchenMode = false;
  if (UI.state.roService) UI.state.selectedService = UI.state.roService;
  ['roEventsPopover', 'roTakeawayPopover'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  document.getElementById('roBottomNav').style.display = 'none';
  document.getElementById('bottomNav').style.display = 'flex';
  updateKitchenSwitch();
  UI.showScreen('dashboard');
  try { window.scrollTo(0, 0); document.body.scrollTop = 0; } catch (e) { /* ignora */ }
}
window.updateKitchenSwitch = updateKitchenSwitch;

async function enterApp() {
  // Mostra/nasconde pulsanti di modifica in base al ruolo
  const canEdit = DB.canEdit();
  const isFullAdmin = DB.isFullAdmin();
  // Quale SCHERMATA mostrare non è la stessa domanda di "può modificare?"
  // — un chef principale ha canEdit() vero ma resta sulla vista chef,
  // solo con più poteri dentro quella vista. La schermata dipende dal
  // ruolo vero e proprio, non da canEdit().
  const isReadRole = DB.getRole() === 'read';
  document.querySelectorAll('.fab-new-booking').forEach(el => {
    el.classList.toggle('hidden', !canEdit);
  });
  document.getElementById('roManageAccessBtn')?.classList.toggle('hidden', !DB.isHeadChef());
  // Ogni ingresso parte dalla vista del proprio ruolo
  UI.state.kitchenMode = false;
  updateKitchenSwitch();

  // Inizializza stato navigazione — servizio (ed eventualmente giorno) già
  // avanzati in automatico se il servizio corrente è chiuso da un po'
  // (es. pranzo finito da 15+ minuti passa già alla cena)
  const initial = Utils.currentServiceAndDate();
  UI.state.selectedDate    = initial.date;
  UI.state.selectedService = initial.service;
  UI.state.previewDate     = UI.state.selectedDate;
  UI.state.previewService  = UI.state.selectedService;
  UI.state.roService       = initial.service;

  if (!_appBound) {
    bindAll();
    _appBound = true;
    // Verifica l'autorizzazione in tempo reale — se un PIN personale
    // (admin o dipendente) viene eliminato da Impostazioni mentre chi lo
    // usa è già dentro, lo butta fuori subito, non solo entro i 15
    // secondi del controllo periodico che già esisteva. Solo per
    // sala/admin: lo chef ha già il proprio, separato, dentro
    // bindReadOnly — evitare due sottoscrizioni al tempo reale per la
    // stessa scheda.
    if (!isReadRole) {
      DB.subscribeRealtime({
        onConfigChange: (newRow) => {
          SharedTables.applyRealtimeUpdate(newRow.zone_tavoli, newRow.updated_at);
          if (!DB.checkStillAuthorized()) {
            forceLogout('Il tuo accesso è stato disattivato da chi gestisce l\'app.');
          }
        },
        onOdsChange: (payload) => { if (typeof ODS !== 'undefined') ODS.onRemote(payload); },
      });
    }
  }

  // Carica dati
  UI.showSyncIndicator(true);
  await Promise.all([
    Bookings.loadAll(),
    SharedTables.load(),
    canEdit ? Buoni.loadAll() : Promise.resolve(),
  ]);
  UI.showSyncIndicator(false);
  // Profili appena scaricati: se mentre l'app era chiusa a questa persona è stata tolta la
  // stella di chef principale (o il profilo è stato disattivato/eliminato), non si entra
  // coi vecchi permessi salvati nel dispositivo
  if (!DB.checkStillAuthorized()) {
    await forceLogout('I tuoi permessi sono cambiati o il tuo accesso è stato disattivato. Accedi di nuovo.');
    return;
  }
  // Ordini di servizio: si caricano in sottofondo, non fanno aspettare l'ingresso
  if (typeof ODS !== 'undefined') ODS.init();

  document.getElementById('screen-login').classList.remove('active');

  if (!isReadRole) {
    // Mostra voci nav riservate ad admin/staff, e quelle solo per admin pieno
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
    document.querySelectorAll('.fulladmin-only').forEach(el => el.style.display = isFullAdmin ? '' : 'none');
    UI.state.miseService = Utils.currentService();
    document.getElementById('bottomNav').style.display = 'flex';
    UI.showScreen('dashboard');

    // Aggiornamento automatico dell'app principale: prima non esisteva
    // affatto (esisteva solo per la vista sola lettura) — per questo un
    // walk-in segnato da un altro dispositivo non compariva finché non si
    // tirava giù per aggiornare a mano. Ogni 15 secondi, solo se si è su
    // Home o Lista e non si sta spostando un tavolo o con una scheda
    // aperta, per non interrompere qualcosa a metà.
    if (!_mainAutoRefreshStarted) {
      _mainAutoRefreshStarted = true;
      setInterval(autoRefreshMain, 15000);
    }

    // Accesso staff condiviso: prima di lavorare, chiedi "chi sei stasera"
    // (bloccante — niente Annulla finché non è scelto un nome). Se manca
    // solo l'etichetta del dispositivo (operatore già scelto in una
    // sessione precedente), chiede solo quella.
    if (DB.needsOperatorPick()) {
      UI.openOperatorPicker(true);
    } else if (DB.needsDeviceLabel()) {
      UI.openDeviceLabelPicker(true);
    }
  } else {
    document.getElementById('bottomNav').style.display = 'none';
    document.getElementById('roBottomNav').style.display = 'flex';
    bindReadOnly();
    UI.renderReadOnlyView();
    UI.showScreen('readonly');
  }

  // Ultimo passo: se si è arrivati qui dal tocco su una notifica, questo
  // sovrascrive la schermata di partenza appena mostrata con quella giusta.
  handleDeepLink();
}

/* ==========================================================================
   BIND TUTTI I LISTENER
   ========================================================================== */
function bindAll() {
  bindBottomNav();
  bindDashboard();
  bindList();
  bindSearch();
  bindConfig();
  bindForm();
  bindDeleteModal();
  bindPreview();
  // Sempre agganciati (non ri-eseguiti ad ogni cambio utente sullo stesso
  // tablet): l'accesso reale resta comunque filtrato dalla nav nascosta
  // e dai controlli DB.isFullAdmin()/DB.canEdit() dentro ogni azione.
  bindBuoni();
  bindMise();
  bindStats();
  bindProjects();
  bindOrdini();
}

function bindProjects() {
  // Ricalcolo dal vivo della Fase 2 (quadro economico) ad ogni modifica
  // dei campi della Fase 1 — non passa dalla delegazione click centrale
  // (qui serve l'evento "input", non "click").
  ['pjPrice', 'pjFoodCost', 'pjMarginTarget', 'pjFoodCostMax', 'pjStaffCost', 'pjOtherCosts'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => UI.updateProjectEconomicsBox());
  });
}

function bindMise() {
  document.getElementById('misePrevDay')?.addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, -1);
    UI.renderMise();
  });
  document.getElementById('miseNextDay')?.addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, 1);
    UI.renderMise();
  });
  document.getElementById('miseRefreshBtn')?.addEventListener('click', async () => {
    UI.showSyncIndicator(true);
    await Bookings.loadAll();
    UI.showSyncIndicator(false);
    UI.renderMise();
    UI.toast('Aggiornato ✓');
  });
}

function bindBottomNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => UI.showScreen(btn.dataset.screen));
  });
}

function bindOrdini() {
  document.getElementById('ordiniAddItemBtn')?.addEventListener('click', () => UI.openInventoryItemModal());
  document.getElementById('ordiniHistoryBtn')?.addEventListener('click', () => UI.openInventoryCountHistoryModal());
}

function bindDashboard() {
  document.getElementById('kitchenFreeBtn')?.addEventListener('click', signalKitchenFree);
  document.getElementById('odsTrigger')?.addEventListener('click', () => UI.showScreen('ods'));

  // Pannello Proposte del giorno — apri/chiudi con una classe, mai con
  // display:none, per poter animare lo scorrimento laterale. Tre modi
  // per chiuderlo: la X, toccare fuori (overlay), o Esc da tastiera.
  const openDailySpecialsDrawer = () => {
    document.getElementById('dailySpecialsDrawerPanel')?.classList.add('open');
    document.getElementById('dailySpecialsDrawerOverlay')?.classList.add('open');
    // Il banner "serve il codice" ha senso mostrarlo solo al tablet
    // condiviso, e solo se non ha già sbloccato la modifica — per
    // chiunque altro (admin, o un dipendente in sola lettura comunque)
    // sarebbe solo confusione.
    const isTablet = DB.getRole() === 'staff' && DB._loginMethod === 'shared';
    const banner = document.getElementById('tabletUnlockBanner');
    if (banner) banner.classList.toggle('hidden', !isTablet || DB.isTabletEditUnlocked());
  };
  const closeDailySpecialsDrawer = () => {
    document.getElementById('dailySpecialsDrawerPanel')?.classList.remove('open');
    document.getElementById('dailySpecialsDrawerOverlay')?.classList.remove('open');
  };
  UI.closeDailySpecialsDrawer = closeDailySpecialsDrawer;
  document.getElementById('piattiBackBtn')?.addEventListener('click', () => UI.showScreen('dashboard'));
  document.getElementById('dailySpecialsDrawerTrigger')?.addEventListener('click', openDailySpecialsDrawer);
  document.getElementById('dailySpecialsDrawerClose')?.addEventListener('click', closeDailySpecialsDrawer);
  document.getElementById('tabletUnlockBtn')?.addEventListener('click', () => {
    const code = prompt('Codice di sblocco modifiche:');
    if (code === null) return;
    if (DB.unlockTabletEdit(code.trim())) {
      document.getElementById('tabletUnlockBanner')?.classList.add('hidden');
      UI.toast('Sbloccato ✓ — puoi modificare i menu per questa sessione');
      UI.renderDailySpecials(UI.state.selectedDate);
    } else {
      UI.toast('Codice sbagliato', 'warning');
    }
  });
  document.getElementById('dailySpecialsDrawerOverlay')?.addEventListener('click', closeDailySpecialsDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDailySpecialsDrawer();
  });

  document.getElementById('eventoDetailBack').addEventListener('click', () => {
    UI.showScreen('dashboard');
  });
  document.getElementById('dashNewDayEventBtn').addEventListener('click', () => {
    UI.openDayEventForm(null);
  });
  document.getElementById('dashPrevDay').addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, -1);
    UI.renderDashboard();
  });
  document.getElementById('dashNextDay').addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, 1);
    UI.renderDashboard();
  });
  document.getElementById('dashTodayBtn').addEventListener('click', () => {
    UI.state.selectedDate = Utils.todayISO();
    UI.renderDashboard();
  });
  document.getElementById('dashJumpDate').addEventListener('change', (e) => {
    if (!e.target.value) return;
    UI.state.selectedDate = e.target.value;
    UI.renderDashboard();
  });
  document.getElementById('reminderAddBtn').addEventListener('click', () => UI.addReminder());
  document.getElementById('reminderInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') UI.addReminder();
  });
  document.getElementById('btnServiceLunch').addEventListener('click', () => {
    UI.state.selectedService = 'lunch'; UI.renderDashboard();
  });
  document.getElementById('btnServiceDinner').addEventListener('click', () => {
    UI.state.selectedService = 'dinner'; UI.renderDashboard();
  });
  document.getElementById('fabNewBooking').addEventListener('click', () => UI.openNewForm());
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    UI.showSyncIndicator(true);
    await Bookings.loadAll();
    UI.showSyncIndicator(false);
    UI.renderDashboard();
    UI.toast('Aggiornato ✓');
  });
}

function bindList() {
  document.getElementById('listPrevDay').addEventListener('click', () => {
    UI.state.piantinaMoveSource = null;
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, -1); UI.renderList();
  });
  document.getElementById('listNextDay').addEventListener('click', () => {
    UI.state.piantinaMoveSource = null;
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, 1); UI.renderList();
  });
  document.getElementById('listTodayBtn').addEventListener('click', () => {
    UI.state.piantinaMoveSource = null;
    UI.state.selectedDate = Utils.todayISO(); UI.renderList();
  });
  document.getElementById('listJumpDate').addEventListener('change', (e) => {
    if (!e.target.value) return;
    UI.state.piantinaMoveSource = null;
    UI.state.selectedDate = e.target.value;
    UI.renderList();
  });
  document.getElementById('listBtnLunch').addEventListener('click', () => {
    UI.state.piantinaMoveSource = null;
    UI.state.selectedService = 'lunch'; UI.renderList();
  });
  document.getElementById('listBtnDinner').addEventListener('click', () => {
    UI.state.piantinaMoveSource = null;
    UI.state.selectedService = 'dinner'; UI.renderList();
  });
  document.getElementById('fabNewBookingList').addEventListener('click', () => UI.openNewForm());
  document.getElementById('openPreviewBtn').addEventListener('click', () => UI.openPreview());
}

function bindSearch() {
  const input = document.getElementById('searchInput');
  const debounced = Utils.debounce(v => UI.renderSearch(v), 150);
  input.addEventListener('input', e => debounced(e.target.value));
}

function bindConfig() {
  document.getElementById('cfgAdminUnlockBtn')?.addEventListener('click', () => {
    UI.openAdminElevateModal();
  });

  document.getElementById('cfgPushToggleBtn')?.addEventListener('click', handlePushButtonClick);
  refreshPushButtonState();

  const debounced = Utils.debounce(() => UI.saveConfigFromForm(), 400);
  ['cfgTablesIndoor','cfgTablesOutdoor','cfgLunchStart','cfgLunchEnd',
   'cfgDinnerStart','cfgDinnerEnd','cfgSlotDuration','cfgMaxPerSlot'].forEach(id => {
    document.getElementById(id).addEventListener('input', debounced);
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await DB.logout();
    document.getElementById('bottomNav').style.display = 'none';
    document.getElementById('roBottomNav').style.display = 'none';
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('loginPassword').value = '';
    document.getElementById('screen-login').classList.add('active');
  });

  document.getElementById('cfgOpenStatsBtn')?.addEventListener('click', () => {
    // Non solo nascondere il pulsante — un controllo vero anche al
    // momento di aprire, nel caso arrivi qui in un altro modo. Rigoroso
    // apposta: solo PIN amministratore, mai un PIN cuoco (a differenza
    // del gate sulle proposte del giorno, qui "admin o chef" non basta).
    if (DB.isFullAdmin()) { UI.showScreen('stats'); return; }
    UI.promptStrictAdminPin('Apri statistiche', () => UI.showScreen('stats'));
  });

  document.getElementById('cfgSwitchOperatorBtn')?.addEventListener('click', () => UI.openOperatorPicker(false));

  document.getElementById('cfgEditDeviceBtn')?.addEventListener('click', () => UI.openDeviceLabelPicker(false));

  document.getElementById('cfgAddStaffNameBtn')?.addEventListener('click', async () => {
    const names = SharedTables.getStaffNames();
    await SharedTables.saveStaffNames([...names, '']);
    UI.renderStaffNamesEditor();
    const inputs = document.querySelectorAll('#cfgStaffNamesList .staff-name-input');
    inputs[inputs.length - 1]?.focus();
  });

  document.getElementById('cfgAddEmployeePinBtn')?.addEventListener('click', async () => {
    const name = prompt('Nome del nuovo dipendente:');
    if (!name || !name.trim()) return;
    let pin;
    while (true) {
      pin = prompt('PIN o password per ' + name.trim() + ' (almeno 4 caratteri):');
      if (pin === null) return; // annullato
      pin = pin.trim();
      if (!/^.{4,20}$/.test(pin)) { alert('Deve avere almeno 4 caratteri (massimo 20).'); continue; }
      if (SharedTables.isPinTaken(pin)) { alert('PIN già usato da un altro dipendente o amministratore, scegline un altro.'); continue; }
      break;
    }
    if (!(await SharedTables.addEmployeePin(name.trim(), pin))) return;
    UI.renderEmployeePinsEditor();
    UI.toast('Dipendente aggiunto ✓');
  });

  document.getElementById('cfgAddChefPinBtn')?.addEventListener('click', async () => {
    const name = prompt('Nome del nuovo cuoco:');
    if (!name || !name.trim()) return;
    let pin;
    while (true) {
      pin = prompt('PIN o password per ' + name.trim() + ' (almeno 4 caratteri):');
      if (pin === null) return; // annullato
      pin = pin.trim();
      if (!/^.{4,20}$/.test(pin)) { alert('Deve avere almeno 4 caratteri (massimo 20).'); continue; }
      if (SharedTables.isPinTaken(pin)) { alert('PIN già usato da un altro cuoco, dipendente o amministratore, scegline un altro.'); continue; }
      break;
    }
    if (!(await SharedTables.addChefPin(name.trim(), pin))) return;
    UI.renderChefPinsEditor();
    UI.toast('Cuoco aggiunto ✓');
  });

  document.getElementById('cfgSaveSharedPasswordBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('cfgSharedPasswordInput');
    const pw = input.value.trim();
    if (!/^.{4,30}$/.test(pw)) { UI.toast('Deve avere almeno 4 caratteri', 'warning'); return; }
    if (!confirm('Cambiare la password condivisa del tablet d\'ingresso? Chi la conosceva non potrà più entrare con quella vecchia — dovrai comunicare la nuova a chi lavora ancora con voi.')) return;
    if (!(await SharedTables.setSharedPassword(pw))) return;
    input.value = '';
    UI.toast('Password condivisa aggiornata ✓');
  });

  document.querySelectorAll('#cfgClosureServiceOptions .service-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cfgClosureServiceOptions .service-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('cfgAddClosureBtn')?.addEventListener('click', async () => {
    const startDate = document.getElementById('cfgClosureStart').value;
    if (!startDate) { UI.toast('Serve almeno la data di inizio', 'warning'); return; }
    const endDate = document.getElementById('cfgClosureEnd').value || startDate;
    if (endDate < startDate) { UI.toast('La data di fine non può essere prima di quella di inizio', 'warning'); return; }
    const service = document.querySelector('#cfgClosureServiceOptions .service-btn.active')?.dataset.service || 'all';
    const reason = document.getElementById('cfgClosureReason').value.trim();

    // Avviso se ci sono già prenotazioni prese in quel periodo — non le
    // tocca, ma è meglio saperlo prima di chiudere, non scoprirlo dopo.
    const existingCount = Bookings.getCached().filter(b => {
      if (b.status === STATUS.CANCELLED) return false;
      if (b.date < startDate || b.date > endDate) return false;
      return service === 'all' || b.service === service;
    }).length;
    if (existingCount > 0) {
      const proceed = confirm('Ci sono già ' + existingCount + ' prenotazioni prese in questo periodo — non verranno toccate, ma resteranno lì mentre il periodo risulta chiuso a nuove prenotazioni. Continuare?');
      if (!proceed) return;
    }

    await SharedTables.addClosure({ startDate, endDate, service, reason });
    document.getElementById('cfgClosureStart').value = '';
    document.getElementById('cfgClosureEnd').value = '';
    document.getElementById('cfgClosureReason').value = '';
    UI.renderClosuresEditor();
    UI.toast('Chiusura aggiunta ✓');
  });

  // Chiusure di zona — stesso schema di quelle generali, con in più la
  // zona da scegliere.
  document.querySelectorAll('#cfgZoneClosureServiceOptions .service-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cfgZoneClosureServiceOptions .service-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('cfgAddZoneClosureBtn')?.addEventListener('click', async () => {
    const zone = document.getElementById('cfgZoneClosureZone').value;
    if (!zone) { UI.toast('Scegli una zona', 'warning'); return; }
    const startDate = document.getElementById('cfgZoneClosureStart').value;
    if (!startDate) { UI.toast('Serve almeno la data di inizio', 'warning'); return; }
    const endDate = document.getElementById('cfgZoneClosureEnd').value || startDate;
    if (endDate < startDate) { UI.toast('La data di fine non può essere prima di quella di inizio', 'warning'); return; }
    const service = document.querySelector('#cfgZoneClosureServiceOptions .service-btn.active')?.dataset.service || 'all';
    const reason = document.getElementById('cfgZoneClosureReason').value.trim();

    const existingCount = Bookings.getCached().filter(b => {
      if (b.status === STATUS.CANCELLED) return false;
      if (b.date < startDate || b.date > endDate) return false;
      if (b.zone !== zone) return false;
      return service === 'all' || b.service === service;
    }).length;
    if (existingCount > 0) {
      const proceed = confirm('Ci sono già ' + existingCount + ' prenotazioni prese in questa zona nel periodo scelto — non verranno toccate, ma resteranno lì mentre la zona risulta chiusa a nuove prenotazioni. Continuare?');
      if (!proceed) return;
    }

    await SharedTables.addZoneClosure({ zone, startDate, endDate, service, reason });
    document.getElementById('cfgZoneClosureStart').value = '';
    document.getElementById('cfgZoneClosureEnd').value = '';
    document.getElementById('cfgZoneClosureReason').value = '';
    UI.renderZoneClosuresEditor();
    UI.toast('Chiusura di zona aggiunta ✓');
  });

  document.getElementById('cfgAddWineBtn')?.addEventListener('click', () => {
    UI.openWineAddModal();
  });

  document.getElementById('cfgAddAdminPinBtn')?.addEventListener('click', async () => {
    const name = prompt('A chi appartiene questo PIN? (es. Luca, Davy):');
    if (!name || !name.trim()) return;
    let pin;
    while (true) {
      pin = prompt('PIN o password per ' + name.trim() + ' (almeno 4 caratteri):');
      if (pin === null) return; // annullato
      pin = pin.trim();
      if (!/^.{4,20}$/.test(pin)) { alert('Deve avere almeno 4 caratteri (massimo 20).'); continue; }
      if (SharedTables.isPinTaken(pin)) { alert('PIN già usato da un altro dipendente o amministratore, scegline un altro.'); continue; }
      break;
    }
    if (!(await SharedTables.addAdminPin(name.trim(), pin))) return;
    UI.renderAdminPinsEditor();
    UI.toast('PIN amministratore aggiunto ✓');
  });

  document.getElementById('cfgKickEveryoneBtn')?.addEventListener('click', async () => {
    if (!confirm('Disconnettere DAVVERO chiunque sia collegato in questo momento? Anche tu dovrai rifare il login subito dopo. Non si può annullare.')) return;
    await SharedTables.kickEveryone();
    UI.toast('Fatto — tutti disconnessi, incluso tu stesso tra pochi secondi');
  });

  document.getElementById('cfgTabletEditCodeInput')?.addEventListener('change', async (e) => {
    const code = e.target.value.trim();
    if (code && code.length < 4) {
      UI.toast('Almeno 4 caratteri', 'warning');
      e.target.value = SharedTables.getTabletEditCode() || '';
      return;
    }
    await SharedTables.setTabletEditCode(code);
    UI.toast(code ? 'Codice tablet salvato ✓' : 'Codice tablet tolto ✓');
  });
}

function bindStats() {
  document.getElementById('statsBackBtn').addEventListener('click', () => UI.showScreen('config'));
  document.getElementById('serviceReportBackBtn')?.addEventListener('click', () => UI.showScreen('dashboard'));

  document.querySelectorAll('#statsRangeTabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      UI.state.statsRange = btn.dataset.range;
      document.getElementById('statsCustomRange').classList.toggle('hidden', btn.dataset.range !== 'custom');
      UI.renderStats();
    });
  });
  document.getElementById('statsFromDate').addEventListener('change', () => UI.renderStats());
  document.getElementById('statsToDate').addEventListener('change', () => UI.renderStats());
}

function bindForm() {
  document.getElementById('formBackBtn').addEventListener('click', () => {
    // Un chef principale non deve mai finire sulla dashboard/lista admin
    // — resta sulla sua vista di sempre.
    UI.showScreen(DB.isHeadChef() || UI.state.kitchenMode ? 'readonly' : (UI.state.editingBookingId ? 'list' : 'dashboard'));
  });
  document.getElementById('fName').addEventListener('input', () => UI.updateSaveButtonState());
  document.getElementById('peopleMinus').addEventListener('click', () => UI.setPeopleValue(UI._peopleValue - 1));
  document.getElementById('peoplePlus').addEventListener('click', () => UI.setPeopleValue(UI._peopleValue + 1));
  document.getElementById('dogsMinus').addEventListener('click', () => UI.setDogsValue(UI._dogsValue - 1));
  document.getElementById('dogsPlus').addEventListener('click', () => UI.setDogsValue(UI._dogsValue + 1));
  document.getElementById('highchairsMinus').addEventListener('click', () => UI.setHighchairsValue(UI._highchairsValue - 1));
  document.getElementById('highchairsPlus').addEventListener('click', () => UI.setHighchairsValue(UI._highchairsValue + 1));
  document.getElementById('fDate').addEventListener('change', () => {
    UI.updateDateWeekdayLabel();
    UI.populateSlotGrid();
    UI._selectedTime = null;
    UI.autoSelectFirstAvailableSlot();
    UI.updateFormTablesHint();
    UI.populateFormTablePicker();
    UI.updateSaveButtonState();
    UI.refreshWorkerMenuHint(document.getElementById('fIsWorkerMenu').checked);
  });

  // Scorciatoie Oggi/Domani — evitano del tutto il selettore data nativo
  // per il caso più comune, quello dove un tocco impreciso sulla rotella
  // fa scattare il giorno sbagliato per sbaglio.
  document.getElementById('fDateQuickToday')?.addEventListener('click', () => {
    document.getElementById('fDate').value = Utils.todayISO();
    document.getElementById('fDate').dispatchEvent(new Event('change'));
  });
  document.getElementById('fDateQuickTomorrow')?.addEventListener('click', () => {
    const tm = Utils.isoToDate(Utils.todayISO());
    tm.setDate(tm.getDate() + 1);
    document.getElementById('fDate').value = Utils.dateToISO(tm);
    document.getElementById('fDate').dispatchEvent(new Event('change'));
  });

  document.getElementById('formTableClear')?.addEventListener('click', () => {
    UI._formTable = null;
    UI.updateFormTableSelected();
    UI.populateFormTablePicker();
  });
  document.querySelectorAll('#formServiceOptions .service-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      UI.setFormService(btn.dataset.service);
      UI._selectedTime = null;
      UI.autoSelectFirstAvailableSlot();
      UI.updateSaveButtonState();
    });
  });
  document.querySelectorAll('#formZoneOptions .zone-btn').forEach(btn => {
    btn.addEventListener('click', () => UI.setFormZone(btn.dataset.zone));
  });
  document.getElementById('optionalToggle').addEventListener('click', () => {
    const expanded = document.getElementById('optionalToggle').classList.toggle('expanded');
    document.getElementById('optionalFields').classList.toggle('expanded', expanded);
  });
  document.getElementById('fIsEvento').addEventListener('change', (e) => {
    document.getElementById('eventoDetailsFields').classList.toggle('hidden', !e.target.checked);
  });
  document.getElementById('fIsWaitlist').addEventListener('change', (e) => {
    const phoneLabel = document.getElementById('fPhoneLabel');
    if (phoneLabel) phoneLabel.textContent = e.target.checked ? 'Telefono (obbligatorio)' : 'Telefono';
    UI.populateFormTablePicker();
    UI.updateSaveButtonState();
  });
  document.getElementById('fIsTakeaway')?.addEventListener('change', (e) => {
    document.getElementById('takeawayFields').classList.toggle('hidden', !e.target.checked);
    UI.populateFormTablePicker();
    UI.updateSaveButtonState();
  });
  document.getElementById('fTakeawayItems')?.addEventListener('input', () => UI.updateSaveButtonState());
  document.getElementById('fIsHotelGuest')?.addEventListener('change', (e) => {
    document.getElementById('hotelGuestFields').classList.toggle('hidden', !e.target.checked);
    UI.updateSaveButtonState();
  });
  document.getElementById('fRoomNumber')?.addEventListener('input', () => UI.refreshHotelVisitHint());
  document.getElementById('fRoomNumber')?.addEventListener('blur', () => {
    // Se non c'è ancora una partenza scritta, e questa camera ha già un
    // soggiorno aperto, la precompila da sola — comodo per chi prenota di
    // nuovo la stessa camera nello stesso soggiorno, non deve riscriverla
    // ogni volta.
    const roomInput = document.getElementById('fRoomNumber');
    const departureInput = document.getElementById('fDepartureDate');
    if (!departureInput.value && roomInput.value.trim()) {
      const known = Bookings.findOpenDepartureForRoom(roomInput.value.trim(), Utils.todayISO());
      if (known) departureInput.value = known;
    }
    UI.refreshHotelVisitHint();
  });
  document.getElementById('fDepartureDate')?.addEventListener('change', () => UI.refreshHotelVisitHint());
  document.getElementById('fIsWorkerMenu')?.addEventListener('change', (e) => {
    UI.refreshWorkerMenuHint(e.target.checked);
  });
  document.querySelectorAll('#fMealPlanToggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#fMealPlanToggle button').forEach(b => b.classList.toggle('active', b === btn));
      UI.refreshHotelVisitHint();
    });
  });
  document.getElementById('fPhone').addEventListener('input', () => UI.updateSaveButtonState());
  document.getElementById('saveBtn').addEventListener('click', () => UI.saveForm());
  document.getElementById('deleteLink').addEventListener('click', e => {
    e.preventDefault(); UI.confirmDelete();
  });
}

function bindDeleteModal() {
  document.getElementById('deleteModalCancel').addEventListener('click', () => {
    document.getElementById('deleteModal').classList.remove('active');
  });
  document.getElementById('deleteModalConfirm').addEventListener('click', () => UI.executeDelete());
}

function bindPreview() {
  document.getElementById('previewBackBtn').addEventListener('click', () => UI.showScreen('list'));
  document.getElementById('previewPrevDay').addEventListener('click', () => {
    UI.state.previewDate = UI.shiftDate(UI.state.previewDate, -1); UI.renderPreview();
  });
  document.getElementById('previewNextDay').addEventListener('click', () => {
    UI.state.previewDate = UI.shiftDate(UI.state.previewDate, 1); UI.renderPreview();
  });
  document.getElementById('previewBtnLunch').addEventListener('click', () => {
    UI.state.previewService = 'lunch'; UI.renderPreview();
  });
  document.getElementById('previewBtnDinner').addEventListener('click', () => {
    UI.state.previewService = 'dinner'; UI.renderPreview();
  });
}

let _mainAutoRefreshStarted = false;

/**
 * Ricarica prenotazioni e configurazione condivisa in background, e
 * riaggiorna lo schermo se si è su Home o Lista — senza toast, senza
 * disturbare (a differenza del refresh manuale). Salta silenziosamente se:
 * - non si è su Home/Lista (es. si sta compilando un form: non tocca nulla)
 * - si sta spostando un tavolo sulla piantina (non interrompe a metà)
 * - c'è una scheda/modal aperta (non fa sparire qualcosa sotto le dita)
 */
// Buttare fuori chi si vede eliminare il proprio profilo (PIN) da
// Impostazioni — stessa pulizia del pulsante "Esci" normale, più un
// messaggio che spiega perché è successo, invece di lasciarlo pensare a
// un errore a caso.
async function forceLogout(reason) {
  await DB.logout();
  document.getElementById('bottomNav').style.display = 'none';
  document.getElementById('roBottomNav').style.display = 'none';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('loginPassword').value = '';
  document.getElementById('screen-login').classList.add('active');
  const errEl = document.getElementById('loginError');
  if (errEl) {
    errEl.textContent = reason || 'Il tuo accesso è stato disattivato.';
    errEl.classList.remove('hidden');
  }
}

async function autoRefreshMain() {
  // Il controllo di autorizzazione ha bisogno di dati aggiornati per
  // funzionare davvero — prima veniva fatto usando quello che c'era già
  // in memoria, che poteva restare vecchio per tutta la serata se non ci
  // si trovava su Dashboard/Lista (l'unico punto, più sotto, dove i dati
  // venivano davvero richiesti al server). Risultato: chi lavorava
  // principalmente da un'altra schermata (piantina, un form aperto,
  // statistiche) poteva non essere buttato fuori anche dopo essere stato
  // eliminato, restando "coperto" solo dal tempo reale — se per qualche
  // motivo quello non arrivava su quel dispositivo, nessuno se ne
  // accorgeva. Ora la configurazione condivisa si aggiorna SEMPRE prima
  // del controllo, qualunque schermata si stia guardando.
  try {
    await SharedTables.load();
  } catch (e) { /* offline: si procede con l'ultima copia disponibile */ }
  if (!DB.checkStillAuthorized()) {
    await forceLogout('Il tuo accesso è stato disattivato da chi gestisce l\'app.');
    return;
  }
  if (typeof ODS !== 'undefined') ODS.refresh();

  // Amministratore nella vista cucina: stesso aggiornamento, ma della
  // lista cucina (mai mentre si scrive o con una finestra aperta)
  if (UI.state.kitchenMode) {
    if (!document.getElementById('screen-readonly')?.classList.contains('active')) return;
    if (document.querySelector('.modal-overlay.active')) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    try {
      await Bookings.loadAll();
      if (UI.state.kitchenMode) UI.renderReadOnlyView();
    } catch (e) { console.warn('autoRefreshMain (cucina) fallito:', e.message); }
    return;
  }

  const screen = UI.state.currentScreen;
  if (screen !== 'dashboard' && screen !== 'list') return;
  if (UI.state.piantinaMoveSource) return;
  if (document.querySelector('.modal-overlay.active')) return;
  // Se il dito è ancora appoggiato su un tavolo (tra tocco e rilascio),
  // ricostruire la piantina proprio in quell'istante toglierebbe
  // l'elemento da sotto il dito — è probabilmente la causa del bug per
  // cui "ogni tanto" il tocco sul tavolo non fa quello che dovrebbe.
  if (UI.state.piantinaPointerActive) return;
  try {
    await Bookings.loadAll();
    if (UI.state.currentScreen === 'dashboard') UI.renderDashboard();
    else if (UI.state.currentScreen === 'list') UI.renderList();
  } catch (e) {
    console.warn('autoRefreshMain fallito:', e.message);
  }
}

async function refreshReadOnly() {
  const btn = document.getElementById('roRefreshBtn');
  if (btn) btn.textContent = '⏳';
  // Mancava il ricaricamento della configurazione condivisa — solo le
  // prenotazioni venivano riprese, mai proposte del giorno/chiusure/altro
  // aggiunte da un altro dispositivo (sala, admin). Ecco perché la vista
  // chef poteva restare indietro anche aspettando l'aggiornamento
  // automatico: quello che cercava, semplicemente, non veniva mai chiesto.
  await Promise.all([Bookings.loadAll(), SharedTables.load()]);
  if (typeof ODS !== 'undefined') ODS.refresh(true);
  UI.renderReadOnlyView();
  if (btn) btn.textContent = '🔄';
  UI.toast('Aggiornato ✓');
}

function bindReadOnly() {
  if (document.getElementById('roPrevDay')._bound) return;
  document.getElementById('roPrevDay')._bound = true;

  document.getElementById('roPushToggleBtn')?.addEventListener('click', handlePushButtonClick);
  refreshPushButtonState();

  // Solo per il chef principale — aggiunge una prenotazione senza
  // lasciare questa vista, e gestisce tutti gli accessi (admin compreso).
  document.getElementById('roFabNewBooking')?.addEventListener('click', () => UI.openNewForm());
  document.getElementById('roManageAccessBtn')?.addEventListener('click', () => UI.openHeadChefAccessManagementView());

  // Badge eventi nel topbar: apre/chiude il piccolo popover con i dettagli
  document.getElementById('roEventsBadgeBtn').addEventListener('click', () => {
    document.getElementById('roEventsPopover').classList.toggle('hidden');
  });
  document.getElementById('roEventsPopoverClose').addEventListener('click', () => {
    document.getElementById('roEventsPopover').classList.add('hidden');
  });
  // Stesso schema per gli asporti — finestra a sé, separata dalla lista
  // tavoli.
  document.getElementById('roTakeawayBadgeBtn').addEventListener('click', () => {
    document.getElementById('roTakeawayPopover').classList.toggle('hidden');
  });
  document.getElementById('roTakeawayPopoverClose').addEventListener('click', () => {
    document.getElementById('roTakeawayPopover').classList.add('hidden');
  });
  document.getElementById('roEventoDetailBack').addEventListener('click', () => {
    UI.showScreen('readonly');
  });

  // Logout
  document.getElementById('roLogoutBtn').addEventListener('click', async () => {
    await DB.logout();
    document.getElementById('roBottomNav').style.display = 'none';
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('loginPassword').value = '';
    document.getElementById('screen-login').classList.add('active');
  });

  document.getElementById('roPrevDay').addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, -1);
    UI.renderReadOnlyView();
  });
  document.getElementById('roNextDay').addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, 1);
    UI.renderReadOnlyView();
  });

  // Bottone aggiorna manuale
  document.getElementById('roRefreshBtn').addEventListener('click', refreshReadOnly);

  // Pull-to-refresh
  let touchStartY = 0;
  let pulling = false;
  const screen = document.getElementById('screen-readonly');
  screen.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
    pulling = screen.scrollTop === 0;
  }, { passive: true });
  screen.addEventListener('touchend', async (e) => {
    if (!pulling) return;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    if (deltaY > 80) refreshReadOnly();
    pulling = false;
  }, { passive: true });

  // Tempo reale — resta in ascolto dei cambiamenti invece di richiedere
  // ogni 30 secondi "è cambiato qualcosa?": un avviso arriva già con
  // dentro il dato nuovo, si vede quasi subito. Le stesse protezioni di
  // prima restano — mai mentre si sta scrivendo, e SharedTables non
  // applica un aggiornamento se c'è ancora un salvataggio locale in
  // corso, per non rischiare di cancellare qualcosa appena scritto.
  const roIsTyping = () => {
    const active = document.activeElement;
    return active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  };
  // Un amministratore che passa alla vista cucina è già in ascolto (vedi
  // enterApp) e si aggiorna con autoRefreshMain: niente secondo canale.
  if (DB.getRole() === 'read') DB.subscribeRealtime({
    onConfigChange: (newRow) => {
      // newRow è l'intera riga della tabella configurazione (id,
      // updated_at, zone_tavoli, ecc.) — serve solo il pezzo
      // zone_tavoli, non la riga intera: passarla così com'è
      // sovrascriveva i dati con una struttura sbagliata, e ogni cosa
      // appena scritta sembrava sparire subito dopo.
      if (roIsTyping()) return;
      if (SharedTables.applyRealtimeUpdate(newRow.zone_tavoli, newRow.updated_at)) UI.renderReadOnlyView();
    },
    onBookingChange: async () => {
      if (roIsTyping()) return;
      await Bookings.loadAll();
      UI.renderReadOnlyView();
    },
    onOdsChange: (payload) => { if (typeof ODS !== 'undefined') ODS.onRemote(payload); },
  });

  // Controllo di riserva — molto meno frequente ora che il tempo reale
  // fa il grosso del lavoro, resta solo per il caso in cui la
  // connessione in ascolto si interrompa senza che nessuno se ne
  // accorga (o se la libreria non si è mai caricata, es. primo avvio
  // offline: qui diventa l'unico modo in cui l'app si aggiorna).
  setInterval(() => {
    if (DB.getRole() !== 'read') return; // amministratori: ci pensa autoRefreshMain
    if (roIsTyping()) return;
    refreshReadOnly();
  }, 180000);

  document.getElementById('roBtnList')?.addEventListener('click', () => switchRoTab('screen-readonly', 'roBtnList'));
  document.getElementById('roOdsBtn')?.addEventListener('click', () => {
    switchRoTab('screen-ods', null);
    if (typeof ODS !== 'undefined') ODS.render();
  });
  document.getElementById('roBtnEventi')?.addEventListener('click', () => {
    switchRoTab('screen-ro-eventi', 'roBtnEventi');
    UI.renderRoEventiPage();
  });
  document.getElementById('roBtnChiusure')?.addEventListener('click', () => {
    switchRoTab('screen-ro-chiusure', 'roBtnChiusure');
    UI.renderRoChiusurePage();
  });
  document.getElementById('roBtnPiatti')?.addEventListener('click', () => {
    switchRoTab('screen-ro-piatti', 'roBtnPiatti');
    UI.openPiattiTab();
  });
  document.getElementById('piattiPrevDay')?.addEventListener('click', () => {
    UI.openPiattiTab(UI.shiftDate(UI.state.piattiSelectedDate, -1));
  });
  document.getElementById('piattiNextDay')?.addEventListener('click', () => {
    UI.openPiattiTab(UI.shiftDate(UI.state.piattiSelectedDate, 1));
  });
  document.getElementById('roBtnMise')?.addEventListener('click', () => {
    switchRoTab('screen-ro-mise', 'roBtnMise');
    renderRoMise();
  });
  document.getElementById('roMiseBackBtn')?.addEventListener('click', () => switchRoTab('screen-readonly', 'roBtnList'));

  document.getElementById('roMiseRefreshBtn')?.addEventListener('click', async () => {
    UI.showSyncIndicator(true);
    await Bookings.loadAll();
    UI.showSyncIndicator(false);
    renderRoMise();
  });
  document.getElementById('roMisePrevDay')?.addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, -1);
    renderRoMise();
  });
  document.getElementById('roMiseNextDay')?.addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, 1);
    renderRoMise();
  });
}

function renderRoMise() {
  const date = UI.state.selectedDate;
  const service = UI.state.miseService || UI.state.roService || 'lunch';
  document.getElementById('roMiseDateLabel').textContent = UI.dateLabel(date);
  document.getElementById('roMiseBtnLunch')?.classList.toggle('active', service === 'lunch');
  document.getElementById('roMiseBtnDinner')?.classList.toggle('active', service === 'dinner');
  // Riusa la stessa logica di renderMise ma nel contenitore ro
  const origContainer = document.getElementById('miseContent');
  const roContainer = document.getElementById('roMiseContent');
  if (!roContainer) return;
  // Temporaneamente usa il render admin ma in sola lettura
  UI.state.miseService = service;
  const savedContainer = document.getElementById('miseContent');
  // Clona la logica direttamente
  UI.renderMise && UI.renderMise();
  if (origContainer) roContainer.innerHTML = origContainer.innerHTML;
}

function watchOnlineStatus() {
  const badge = document.getElementById('offlineBadge');
  function update() { badge.classList.toggle('visible', !navigator.onLine); }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(console.error);
    });
  }
}

/* ==========================================================================
   NOTIFICHE PUSH
   ========================================================================== */
// Chiave pubblica VAPID — è fatta apposta per stare nel codice del sito,
// non è un segreto (il segreto è la chiave PRIVATA, che vive solo dentro
// Supabase, mai qui). Serve al browser per autenticare la sottoscrizione
// verso il servizio push, e alla Edge Function per firmare i messaggi
// che manda: devono coincidere, sono una coppia.
const VAPID_PUBLIC_KEY = 'BO98m_iujOEH2nJFfsRpDlWRXUkZOjMC4EOHCprD4iT1CQcGOEetGgs3CUF4CWDU4nIh25uD9aRlGK6aZz0vZLQ';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function getExistingPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch (e) { return null; }
}

/**
 * Aggiorna l'aspetto del pulsante in base allo stato reale della
 * sottoscrizione su QUESTO dispositivo — chiamata sia all'avvio (per
 * mostrare subito lo stato giusto) sia dopo ogni attivazione/disattivazione.
 */
async function refreshPushButtonState() {
  const existing = await getExistingPushSubscription();
  const isOn = !!existing;
  ['cfgPushToggleBtn', 'roPushToggleBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (id === 'cfgPushToggleBtn') {
      btn.textContent = isOn ? '🔕 Disattiva notifiche su questo dispositivo' : '🔔 Attiva notifiche su questo dispositivo';
    } else {
      btn.textContent = isOn ? '🔕' : '🔔';
    }
  });
}

/**
 * "Cucina libera" — non passa dai trigger del database (niente da
 * salvare, nessuna prenotazione coinvolta): chiama direttamente la
 * funzione, con un pacchetto diverso da quello che manda Supabase sui
 * Database Webhook. La chiave usata qui è quella JWT (non quella nuova
 * usata per le tabelle) — è l'unica confermata funzionante per
 * autenticare la chiamata alla funzione.
 */
const EDGE_FUNCTION_ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoZHpjaHdoeW1ham5xaG9jaXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMTkyNDAsImV4cCI6MjA5ODU5NTI0MH0.CuzNfi7epkK70zHgN4qxp1BmTsZhw_xVFLmtN04Ydxo';

async function signalKitchenFree() {
  if (!confirm('Avvisare la cucina che tutti i clienti hanno preso il dessert?')) return;
  try {
    await fetch('https://shdzchwhymajnqhocirp.supabase.co/functions/v1/send-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + EDGE_FUNCTION_ANON_JWT,
      },
      body: JSON.stringify({
        type: 'MANUAL',
        action: 'kitchen_free',
        operatorName: DB.getOperator(),
      }),
    });
    UI.toast('Cucina avvisata ✓');
  } catch (e) {
    console.warn('signalKitchenFree fallito:', e);
    UI.toast('Non sono riuscito ad avvisare la cucina', 'warning');
  }
}

async function togglePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    UI.toast('Le notifiche push non sono supportate su questo browser', 'warning');
    return;
  }
  const existing = await getExistingPushSubscription();
  if (existing) {
    // Disattiva: toglie prima la sottoscrizione dall'elenco condiviso
    // (così la Edge Function smette di mandarci roba), poi la cancella
    // davvero lato browser.
    UI.showSyncIndicator(true);
    await SharedTables.removePushSubscription(existing.endpoint);
    await existing.unsubscribe();
    UI.showSyncIndicator(false);
    UI.toast('Notifiche disattivate su questo dispositivo');
    await refreshPushButtonState();
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    UI.toast('Permesso negato — puoi riattivarlo dalle impostazioni del browser', 'warning');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    UI.showSyncIndicator(true);
    // Preferenze di partenza ragionevoli in base al ruolo — modificabili
    // subito dopo dalla scheda che si apre in automatico.
    const role = DB.getRole();
    const defaultPrefs = Object.keys(NOTIFICATION_TYPES).reduce((acc, key) => {
      if (key.indexOf('ods_') === 0) acc[key] = true;
      else if (role === 'read') acc[key] = (key === 'special_needs' || key === 'new_daily_special' || key === 'kitchen_free');
      else acc[key] = (key === 'new_booking_today' || key === 'booking_cancelled');
      return acc;
    }, {});
    await SharedTables.addPushSubscription({
      endpoint: sub.endpoint,
      keys: {
        p256dh: arrayBufferToBase64(sub.getKey('p256dh')),
        auth: arrayBufferToBase64(sub.getKey('auth')),
      },
      role: role,
      deviceId: DB._getDeviceId(),
      operatorName: DB.getOperator(),
      notificationPrefs: defaultPrefs,
    });
    UI.showSyncIndicator(false);
    UI.toast('Notifiche attivate su questo dispositivo ✓');
  } catch (e) {
    console.error('Sottoscrizione push fallita:', e);
    UI.toast('Non sono riuscito ad attivare le notifiche', 'warning');
  }
  await refreshPushButtonState();
}

/**
 * Il tocco sulla campanella non attiva/disattiva più direttamente —
 * apre la scheda con le preferenze. Se non è ancora sottoscritto, prima
 * lo sottoscrive (con le preferenze di partenza), poi apre comunque la
 * scheda per aggiustarle subito.
 */
async function handlePushButtonClick() {
  let existing = await getExistingPushSubscription();
  if (!existing) {
    await togglePushNotifications();
    // Ricontrolla: se togglePushNotifications non è riuscita a sottoscrivere
    // (permesso negato, errore, browser non supportato), ha già mostrato
    // il motivo esatto — non proseguire con un secondo messaggio generico
    // e fuorviante sopra a quello vero.
    existing = await getExistingPushSubscription();
    if (!existing) return;
  }
  await UI.openNotificationPrefsModal();
}




function bindBuoni() {
  // Voce nav buoni
  document.querySelector('.nav-item[data-screen="buoni"]')
    ?.addEventListener('click', async () => {
      if (!DB.isFullAdmin()) return;
      UI.showSyncIndicator(true);
      await Buoni.loadAll();
      UI.showSyncIndicator(false);
      UI.renderBuoni('');
      UI.showScreen('buoni');
    });

  // Bottone nuovo buono
  document.getElementById('buoniNewBtn')
    ?.addEventListener('click', () => UI.openBuonoForm());

  // Ricerca buoni
  const searchInput = document.getElementById('buoniSearchInput');
  if (searchInput) {
    const debounced = Utils.debounce(v => UI.renderBuoni(v), 150);
    searchInput.addEventListener('input', e => debounced(e.target.value));
  }

  // Form - indietro
  document.getElementById('buonoFormBackBtn')
    ?.addEventListener('click', () => UI.showScreen('buoni'));

  // Stepper persone buono
  document.getElementById('bPersoneMinus')?.addEventListener('click', () => {
    UI._buonoPersone = Math.max(0, (UI._buonoPersone || 0) - 1);
    document.getElementById('bPersoneValue').textContent = UI._buonoPersone > 0 ? UI._buonoPersone : '—';
  });
  document.getElementById('bPersonePlus')?.addEventListener('click', () => {
    UI._buonoPersone = (UI._buonoPersone || 0) + 1;
    document.getElementById('bPersoneValue').textContent = UI._buonoPersone;
  });

  // Salva buono
  document.getElementById('buonoSaveBtn')
    ?.addEventListener('click', () => UI.saveBuono());

  // Abilita bottone salva solo se codice presente
  document.getElementById('bCodice')?.addEventListener('input', () => {
    const btn = document.getElementById('buonoSaveBtn');
    if (btn) btn.disabled = !document.getElementById('bCodice').value.trim();
  });
}
