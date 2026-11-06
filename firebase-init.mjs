import { createCloudStore } from './cloud-store.mjs';
const config = {
  apiKey: 'AIzaSyB81o01cA0z6Alxf5tBnOMoqcBUlFOUZvc',
  authDomain: 'gooffice-5f6c0.firebaseapp.com',
  projectId: 'gooffice-5f6c0',
  storageBucket: 'gooffice-5f6c0.firebasestorage.app',
  messagingSenderId: '816071174706',
  appId: '1:816071174706:web:d7b470866a79ad0bf5aa2b',
};
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
  await import('./app.js');
} catch (error) {
  const note = document.querySelector('#storage-note');
  note.classList.remove('sr-only');
  note.textContent = 'Не удалось загрузить Firebase. Проверьте интернет и обновите страницу. Отметки не загружены.';
  console.error('Firestore initialization failed', error);
}
