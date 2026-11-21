const DB_NAME = 'whale-memory';
const DB_VERSION = 1;
const STORE = 'session';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(mode, operation) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        try {
          operation(transaction.objectStore(STORE));
        } catch (error) {
          db.close();
          reject(error);
          return;
        }
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      }),
  );
}

export async function loadSession() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get('current');
    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export function saveSession(session) {
  return withStore('readwrite', (store) => {
    store.put(session, 'current');
  });
}

export function clearSession() {
  return withStore('readwrite', (store) => {
    store.delete('current');
  });
}
