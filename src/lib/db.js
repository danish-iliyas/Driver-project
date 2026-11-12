import { MongoClient } from 'mongodb';

// Live location points are small but many, so they are kept for 35 days only.
const TRACK_KEEP_SECONDS = 35 * 24 * 60 * 60;

async function connect() {
  const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? 'driver_tracker');
  await Promise.all([
    db.collection('drivers').createIndex({ phone: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('sessions').createIndex({ driverId: 1 }),
    db.collection('loginFails').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('photos').createIndex({ driverId: 1, clientId: 1 }, { unique: true }),
    db.collection('photos').createIndex({ driverId: 1, day: 1, capturedAt: 1 }),
    db.collection('photos').createIndex({ day: 1, capturedAt: 1 }),
    db.collection('photos').createIndex({ driverId: 1, capturedAt: -1 }),
    db.collection('admins').createIndex({ username: 1 }, { unique: true }),
    db.collection('drivers').createIndex({ adminId: 1 }),
    db.collection('tracks').createIndex({ driverId: 1, day: 1, at: 1 }),
    db.collection('tracks').createIndex({ driverId: 1, pointId: 1 }, { unique: true }),
    db.collection('tracks').createIndex({ at: 1 }, { expireAfterSeconds: TRACK_KEEP_SECONDS }),
  ]);
  return db;
}

// Dev reloads re-run this module, so the connection is kept on globalThis.
export function getDb() {
  globalThis.driverDb ??= connect().catch((err) => {
    globalThis.driverDb = undefined;
    throw err;
  });
  return globalThis.driverDb;
}

// Photo details live apart from the image bytes so lists and reports never load images.
export async function collections() {
  const db = await getDb();
  return {
    admins: db.collection('admins'),
    drivers: db.collection('drivers'),
    sessions: db.collection('sessions'),
    loginFails: db.collection('loginFails'),
    photos: db.collection('photos'),
    photoBlobs: db.collection('photoBlobs'),
    places: db.collection('places'),
    tracks: db.collection('tracks'),
  };
}

export async function imageStorageBytes() {
  const db = await getDb();
  const stats = await db.command({ collStats: 'photoBlobs' }).catch(() => null);
  return stats?.storageSize ?? 0;
}
