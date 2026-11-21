// Service worker minimo: si disinstalla da solo
// Questo forza tutti i dispositivi a ricaricare sempre i file freschi da Netlify
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Nessun fetch handler: tutte le richieste vanno direttamente alla rete

// ===== Notifiche push =====
// Arriva qui anche ad app chiusa — è tutto il punto delle notifiche
// "vere". Il contenuto (titolo, testo, link) lo decide la Edge Function
// su Supabase quando manda il messaggio; qui ci si limita a mostrarlo.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Lou Tchappé', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Lou Tchappé';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tocco sulla notifica: se l'app è già aperta in una scheda, la NAVIGA
// verso il punto giusto (non solo la porta in primo piano — prima non
// bastava, una scheda già aperta restava dov'era invece di aprire la
// pagina indicata dalla notifica).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) {
            return client.navigate(url).then((c) => c.focus());
          }
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
