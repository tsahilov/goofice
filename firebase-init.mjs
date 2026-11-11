import { createCloudStore } from './cloud-store.mjs?v=members-20';
import { firebaseConfig as config } from './firebase-config.mjs';
// Pinned modular browser SDK; no build tooling or npm required.
try {
  const [{ initializeApp }, api] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js'),
  ]);
  const db = api.getFirestore(initializeApp(config));
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  window.goofficeStore = createCloudStore({ api, db, storage, planner: window.OfficePlanner });
  await import('./app.js?v=members-20');
} catch (error) {
  const note = document.querySelector('#storage-note');
  note.classList.remove('sr-only');
  note.textContent = 'Не удалось загрузить Firebase. Проверьте интернет и обновите страницу. Отметки не загружены.';
  console.error('Firestore initialization failed', error);
}
