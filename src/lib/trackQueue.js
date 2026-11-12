// Live location points wait here until they are sent, so a weak signal loses nothing.
const KEY = 'trackQueue';
const MAX_POINTS = 300;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

function write(points) {
  try {
    localStorage.setItem(KEY, JSON.stringify(points.slice(-MAX_POINTS)));
  } catch {
    // Storage full or blocked: the newest point is lost, tracking goes on.
  }
}

export function queuePoint(point) {
  write([...read(), point]);
}

export async function sendPoints(driverId) {
  const now = Date.now();
  const fresh = read().filter((point) => now - point.at < MAX_AGE_MS);
  const mine = fresh.filter((point) => point.driverId === driverId);
  if (!mine.length) return;
  const points = mine.map(({ id, lat, lng, accuracy, at }) => ({ id, lat, lng, accuracy, ageMs: now - at }));
  const response = await fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points }),
  }).catch(() => null);
  if (!response?.ok) return;
  const sent = new Set(mine.map((point) => point.id));
  write(read().filter((point) => !sent.has(point.id) && now - point.at < MAX_AGE_MS));
}
