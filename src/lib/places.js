import { collections } from './db';

// OpenStreetMap's free lookup allows one request per second.
const GAP_MS = 1100;
let nextSlot = 0;

async function waitTurn() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + GAP_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

function shortName({ address = {}, display_name: full }) {
  const parts = [
    address.amenity ?? address.building ?? address.shop ?? address.office ?? address.industrial ?? address.road,
    address.suburb ?? address.neighbourhood ?? address.quarter ?? address.residential,
    address.city ?? address.town ?? address.village ?? address.state,
  ].filter(Boolean);
  const name = [...new Set(parts)].join(', ');
  return name || full?.split(',').slice(0, 3).join(',').trim() || null;
}

async function lookUp(lat, lng) {
  await waitTurn();
  const query = new URLSearchParams({ format: 'jsonv2', lat, lon: lng, zoom: 17, 'accept-language': 'en' });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${query}`, {
    headers: { 'User-Agent': 'DriverTracker/1.0' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  return shortName(await response.json());
}

// Nearby photos (about 100 m) share one saved name, so a regular stop is looked up once.
async function placeName(lat, lng) {
  const { places } = await collections();
  const _id = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const saved = await places.findOne({ _id });
  if (saved) return saved.name;
  const name = await lookUp(lat, lng);
  if (name) await places.updateOne({ _id }, { $set: { name } }, { upsert: true });
  return name;
}

export async function savePlace({ _id, lat, lng }) {
  const name = await placeName(lat, lng);
  if (!name) return false;
  const { photos } = await collections();
  await photos.updateOne({ _id }, { $set: { place: name } });
  return true;
}

// Fills photos whose lookup failed earlier. A failed lookup stops the run; the next one retries.
export async function fillMissingPlaces(filter, limit) {
  const { photos } = await collections();
  const missing = await photos
    .find({ ...filter, place: { $exists: false }, lat: { $ne: null } })
    .limit(limit)
    .toArray();
  for (const photo of missing) {
    const saved = await savePlace(photo).catch(() => false);
    if (!saved) return;
  }
}
