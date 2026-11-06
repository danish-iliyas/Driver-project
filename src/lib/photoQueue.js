import { TIME_ZONE } from './time';
import { WORK_LABELS } from './work';

// Photos wait here in the phone until they reach the server, so no signal never loses one.
const DB_NAME = 'driver-photos';
const STORE = 'queue';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'clientId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}

export const addPhoto = (item) => run('readwrite', (store) => store.put(item));
export const listPhotos = () => run('readonly', (store) => store.getAll());
export const removePhoto = (clientId) => run('readwrite', (store) => store.delete(clientId));

const MAX_SIDE = 1280;
const QUALITY = 0.6;
const DARK_BELOW = 40;

function isDark(source) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, 32, 32);
  const { data } = context.getImageData(0, 0, 32, 32);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) total += (data[i] + data[i + 1] + data[i + 2]) / 3;
  return total / (data.length / 4) < DARK_BELOW;
}

// Shrinks the camera photo to about 200 KB and prints the proof on it.
export async function preparePhoto(file, { name, type, lat, lng, at }) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dark = isDark(bitmap);
  bitmap.close();

  const size = Math.max(16, Math.round(canvas.width / 38));
  const lines = [
    `${name} • ${WORK_LABELS[type]}`,
    new Date(at).toLocaleString('en-GB', { timeZone: TIME_ZONE, hourCycle: 'h23' }),
    `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
  ];
  context.fillStyle = 'rgba(0, 0, 0, 0.65)';
  context.fillRect(0, canvas.height - size * 4.6, canvas.width, size * 4.6);
  context.fillStyle = '#fff';
  context.font = `600 ${size}px sans-serif`;
  lines.forEach((line, index) => {
    context.fillText(line, size * 0.6, canvas.height - size * (3.2 - index * 1.3));
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve({ blob, dark }) : reject(new Error('Photo failed'))), 'image/jpeg', QUALITY);
  });
}
