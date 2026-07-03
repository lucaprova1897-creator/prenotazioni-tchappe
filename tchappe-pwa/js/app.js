/**
 * app.js
 * Bootstrap: gestisce login, ruoli, caricamento dati e tutti gli event listener.
 */

document.addEventListener('DOMContentLoaded', () => init());

async function init() {
  // Collega subito il bottone login, prima di qualsiasi controllo sessione
  bindLogin();

  // Prova a ripristinare la sessione dal localStorage
  if (DB.restoreSession()) {
    await enterApp();
  } else {
    showLogin();
  }
  registerServiceWorker();
  watchOnlineStatus();
}

/* ==========================================================================
   LOGIN
   ========================================================================== */
function showLogin() {
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('bottomNav').style.display = 'none';
}

function bindLogin() {
  const btn      = document.getElementById('loginBtn');
  const input    = document.getElementById('loginPassword');
  const errEl    = document.getElementById('loginError');

  async function tryLogin() {
    const pw   = input.value.trim();
    const role = DB.login(pw);
    if (!role) {
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

async function enterApp() {
  // Mostra/nasconde pulsanti di modifica in base al ruolo
  const canEdit = DB.canEdit();
  document.querySelectorAll('.fab-new-booking').forEach(el => {
    el.classList.toggle('hidden', !canEdit);
  });

  // Inizializza stato navigazione
  UI.state.selectedDate    = Utils.todayISO();
  UI.state.selectedService = Utils.currentService();
  UI.state.previewDate     = UI.state.selectedDate;
  UI.state.previewService  = UI.state.selectedService;

  bindAll();

  // Carica dati
  UI.showSyncIndicator(true);
  await Bookings.loadAll();
  UI.showSyncIndicator(false);

  // Nasconde login, mostra nav e dashboard
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('bottomNav').style.display = 'flex';
  UI.showScreen('dashboard');
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
}

function bindBottomNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => UI.showScreen(btn.dataset.screen));
  });
}

function bindDashboard() {
  document.getElementById('dashPrevDay').addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, -1);
    UI.renderDashboard();
  });
  document.getElementById('dashNextDay').addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, 1);
    UI.renderDashboard();
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
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, -1); UI.renderList();
  });
  document.getElementById('listNextDay').addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, 1); UI.renderList();
  });
  document.getElementById('listBtnLunch').addEventListener('click', () => {
    UI.state.selectedService = 'lunch'; UI.renderList();
  });
  document.getElementById('listBtnDinner').addEventListener('click', () => {
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
  // Mostra ruolo attivo
  const roleEl = document.getElementById('cfgRole');
  if (roleEl) roleEl.textContent = DB.canEdit() ? 'Admin (modifica)' : 'Lettura';

  const debounced = Utils.debounce(() => UI.saveConfigFromForm(), 400);
  ['cfgTablesIndoor','cfgTablesOutdoor','cfgLunchStart','cfgLunchEnd',
   'cfgDinnerStart','cfgDinnerEnd','cfgSlotDuration','cfgMaxPerSlot',
   'cfgDoubleShiftDuration'].forEach(id => {
    document.getElementById(id).addEventListener('input', debounced);
  });
  document.querySelectorAll('#cfgDoubleShiftDays .day-toggle').forEach(btn => {
    btn.addEventListener('click', () => { btn.classList.toggle('active'); debounced(); });
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    DB.logout();
    document.getElementById('bottomNav').style.display = 'none';
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('loginPassword').value = '';
    document.getElementById('screen-login').classList.add('active');
  });
}

function bindForm() {
  document.getElementById('formBackBtn').addEventListener('click', () => {
    UI.showScreen(UI.state.editingBookingId ? 'list' : 'dashboard');
  });
  document.getElementById('fName').addEventListener('input', () => UI.updateSaveButtonState());
  document.getElementById('peopleMinus').addEventListener('click', () => UI.setPeopleValue(UI._peopleValue - 1));
  document.getElementById('peoplePlus').addEventListener('click', () => UI.setPeopleValue(UI._peopleValue + 1));
  document.getElementById('dogsMinus').addEventListener('click', () => UI.setDogsValue(UI._dogsValue - 1));
  document.getElementById('dogsPlus').addEventListener('click', () => UI.setDogsValue(UI._dogsValue + 1));
  document.getElementById('fDate').addEventListener('change', () => {
    UI.populateSlotGrid(); UI._selectedTime = null; UI.autoSelectFirstAvailableSlot();
  });
  document.querySelectorAll('#formServiceOptions .service-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      UI.setFormService(btn.dataset.service);
      UI._selectedTime = null;
      UI.autoSelectFirstAvailableSlot();
    });
  });
  document.querySelectorAll('#formZoneOptions .zone-btn').forEach(btn => {
    btn.addEventListener('click', () => UI.setFormZone(btn.dataset.zone));
  });
  document.getElementById('optionalToggle').addEventListener('click', () => {
    const expanded = document.getElementById('optionalToggle').classList.toggle('expanded');
    document.getElementById('optionalFields').classList.toggle('expanded', expanded);
  });
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

function bindReadOnly() {
  if (document.getElementById('roPrevDay')._bound) return;
  document.getElementById('roPrevDay')._bound = true;

  document.getElementById('roPrevDay').addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, -1);
    UI.renderReadOnlyView();
  });
  document.getElementById('roNextDay').addEventListener('click', () => {
    UI.state.selectedDate = UI.shiftDate(UI.state.selectedDate, 1);
    UI.renderReadOnlyView();
  });

  // Aggiornamento automatico ogni 60 secondi
  setInterval(async () => {
    await Bookings.loadAll();
    UI.renderReadOnlyView();
  }, 60000);
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
