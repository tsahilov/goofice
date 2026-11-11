// User-run migration only. Never overwrites an existing registry or touches marks.
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, doc, runTransaction, terminate } from 'firebase/firestore';
import { firebaseConfig } from '../firebase-config.mjs';
import { initialRegistry } from '../participants.mjs';
import '../data.js';
if (!process.argv.includes('--initialize')) {
  console.log('Manual migration: node tools/initialize-participants.mjs --initialize');
  console.log('Run only after reviewing and publishing the new backward-compatible rules.');
} else {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('This manual production command must not run with FIRESTORE_EMULATOR_HOST set. Use the emulator tests instead.');
  const app = initializeApp(firebaseConfig, 'manual-participant-migration');
  const db = getFirestore(app);
  try {
    const result = await runTransaction(db, async transaction => {
      const ref = doc(db, 'team', 'registry');
      const existing = await transaction.get(ref);
      if (existing.exists()) return 'Registry already exists; nothing changed.';
      transaction.set(ref, initialRegistry(globalThis.OfficePlanner.MEMBERS));
      return 'Created team/registry with the original four participants. Marks were not touched.';
    });
    console.log(firebaseConfig.projectId + ': ' + result);
  } catch (error) {
    console.error('Migration failed: ' + (error.code || error.message));
    process.exitCode = 1;
  } finally { await terminate(db); await deleteApp(app); }
}
