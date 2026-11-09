'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addPhoto, listPhotos, preparePhoto, removePhoto } from '@/lib/photoQueue';
import { dayOf, dubaiDate, shiftTime, TIME_ZONE, timeOf } from '@/lib/time';
import { MAX_SHIFT_MS, STATUS_LABELS, WORK_LABELS } from '@/lib/work';

const RETRY_MS = 30_000;
const FIX_MAX_AGE_MS = 2 * 60 * 1000;
const NEW_PHOTO_MS = 2 * 60 * 1000;
const WEAK_GPS_METERS = 100;
const REPEAT_MS = 2 * 60 * 1000;

function isToday(entry) {
  return Boolean(entry) && dayOf(new Date(entry.capturedAt)) === dayOf(new Date());
}

// A started shift stays open after midnight, so a night shift keeps its buttons and photo count.
function isWorking(me) {
  return Boolean(me.working) && Date.now() - new Date(me.shiftStartedAt).getTime() < MAX_SHIFT_MS;
}

const isCurrent = (me) => isWorking(me) || isToday(me.last);
const dayText = (day) =>
  dubaiDate(day, '12:00').toLocaleDateString('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' });

function say(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function freshPosition(fallback) {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      () => resolve(fallback),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 },
    );
  });
}

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.6" />
  </svg>
);

function statusText({ day, status }) {
  if (status === 'absent' && day === dayOf(new Date())) return 'Not started';
  if (status === 'quiet') return STATUS_LABELS.working;
  return STATUS_LABELS[status];
}

function DayDetail({ summary, onBack, onLoggedOut }) {
  const [entries, setEntries] = useState(null);
  const [failed, setFailed] = useState(false);
  const missing = summary.status === 'start-missing' || summary.status === 'end-missing';

  useEffect(() => {
    fetch(`/api/me/days/${summary.day}`)
      .then(async (response) => {
        if (response.status === 401) return onLoggedOut();
        if (!response.ok) return setFailed(true);
        setEntries(await response.json());
      })
      .catch(() => setFailed(true));
  }, [summary.day, onLoggedOut]);

  return (
    <main className="phone">
      <header className="top">
        <div>
          <div className="brand">My Attendance</div>
          <h1>{dayText(summary.day)}</h1>
          <p>{statusText(summary)}{summary.hours && `, ${summary.hours} hours`}</p>
        </div>
        <button className="ghost" onClick={onBack}>Back</button>
      </header>
      {missing && <p className="warn">{statusText(summary)}. Tell your admin to fix it.</p>}
      {failed && <p className="warn">No internet. Try again.</p>}
      {!entries && !failed && <p className="last-sent">Please wait…</p>}
      {entries?.length === 0 && <p className="last-sent">No work on this day.</p>}
      {entries?.map((entry) => (
        <article className="entry" key={entry._id}>
          {!entry.manual && <img src={`/api/me/photos/${entry._id}`} alt={WORK_LABELS[entry.type]} loading="lazy" />}
          <div>
            <b>{WORK_LABELS[entry.type]}</b>
            <span>{shiftTime(entry.capturedAt, summary.day)}</span>
            {entry.place && <p>{entry.place}</p>}
            {entry.note && <p>{entry.note}</p>}
            {entry.manual && <p>Added by admin</p>}
          </div>
        </article>
      ))}
    </main>
  );
}

function Attendance({ pending, onBack, onLoggedOut }) {
  const [days, setDays] = useState(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch('/api/me/days')
      .then(async (response) => {
        if (response.status === 401) return onLoggedOut();
        if (!response.ok) return setFailed(true);
        setDays(await response.json());
      })
      .catch(() => setFailed(true));
  }, [onLoggedOut]);

  if (selected) return <DayDetail summary={selected} onBack={() => setSelected(null)} onLoggedOut={onLoggedOut} />;

  const today = dayOf(new Date());
  const worked = days?.filter((day) => day.present).length ?? 0;
  const absent = days?.filter((day) => !day.present && day.day !== today).length ?? 0;
  const hours = days?.reduce((total, day) => total + Number(day.hours), 0) ?? 0;

  return (
    <main className="phone">
      <header className="top">
        <div>
          <div className="brand">Driver Tracker</div>
          <h1>My Attendance</h1>
          <p>Last 30 days</p>
        </div>
        <button className="ghost" onClick={onBack}>Back</button>
      </header>
      {pending > 0 && <p className="warn">{pending} photo waiting. It will show here after it is sent.</p>}
      {failed && <p className="warn">No internet. Try again.</p>}
      {!days && !failed && <p className="last-sent">Please wait…</p>}
      {days && (
        <>
          <section className="stats three">
            <div className="stat"><b>{worked}</b><span>Present</span></div>
            <div className="stat"><b>{absent}</b><span>Absent</span></div>
            <div className="stat"><b>{hours.toFixed(1)}</b><span>Hours</span></div>
          </section>
          <section className="days">
            {days.map((day) => (
              <button className="day-row" key={day.day} onClick={() => setSelected(day)}>
                <span>
                  <b>{dayText(day.day)}</b>
                  <small>
                    {day.count > 0 ? `${shiftTime(day.first, day.day)} to ${shiftTime(day.last, day.day)}` : 'No photo'}
                    {day.hours && `, ${day.hours} hours`}
                  </small>
                </span>
                <span className={`badge ${day.status}`}>{statusText(day)}</span>
              </button>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function Login({ onLogin }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
      });
      const data = await response.json();
      if (response.ok) onLogin(await (await fetch('/api/me')).json());
      else setError(data.error);
    } catch {
      setError('No internet. Try again.');
    }
    setBusy(false);
  }

  return (
    <main className="phone">
      <form className="login-card" onSubmit={submit}>
        <div>
          <div className="brand">Driver Tracker</div>
          <h1>Login</h1>
        </div>
        <label className="field">
          Mobile number
          <input type="tel" autoComplete="username" required value={phone}
            onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          4 digit PIN
          <input className="pin-input" type="password" inputMode="numeric" maxLength={4} autoComplete="current-password"
            required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Login'}</button>
      </form>
    </main>
  );
}

function Home({ me, setMe }) {
  const [fix, setFix] = useState(null);
  const [gps, setGps] = useState('searching');
  const [pending, setPending] = useState(0);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState(null);
  const [showAttendance, setShowAttendance] = useState(false);
  const input = useRef(null);
  const photoType = useRef('loading');
  const flushing = useRef(false);

  const showToast = useCallback((text, bad = false) => {
    setToast({ text, bad });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/me').catch(() => null);
    if (response?.ok) setMe(await response.json());
  }, [setMe]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    let sent = false;
    try {
      const items = (await listPhotos()).filter((item) => item.driverId === me.id);
      setPending(items.length);
      for (const item of items) {
        const query = new URLSearchParams({
          type: item.type,
          note: item.note ?? '',
          clientId: item.clientId,
          lat: item.lat,
          lng: item.lng,
          accuracy: item.accuracy,
          ageMs: Date.now() - item.capturedAt,
        });
        const response = await fetch(`/api/photos?${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: item.blob,
        });
        if (response.status === 401) return setMe(null);
        if (response.ok) {
          sent = true;
        } else if (response.status >= 500 || response.status === 429) {
          return;
        } else {
          showToast('One old photo was rejected', true);
        }
        await removePhoto(item.clientId);
        setPending((count) => count - 1);
      }
    } catch {
      // No signal: the photos stay queued for the next try.
    } finally {
      flushing.current = false;
      if (sent) refresh();
    }
  }, [me.id, setMe, showToast, refresh]);

  useEffect(() => {
    localStorage.setItem('driver', JSON.stringify(me));
  }, [me]);

  // Picks up entries the admin added and a new day when the phone is opened again.
  useEffect(() => {
    function onShow() {
      if (document.visibilityState === 'visible') flush().then(refresh);
    }
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [flush, refresh]);

  useEffect(() => {
    navigator.storage?.persist?.();
    flush();
    const timer = setInterval(flush, RETRY_MS);
    window.addEventListener('online', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, [flush]);

  useEffect(() => {
    if (!navigator.geolocation) return setGps('denied');
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setFix({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: Date.now() });
        setGps('ready');
      },
      (error) => setGps(error.code === error.PERMISSION_DENIED ? 'denied' : 'searching'),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  function takePhoto(type) {
    if (gps === 'denied') return showToast('Turn on location first', true);
    if (!fix || Date.now() - fix.at > FIX_MAX_AGE_MS) return showToast('Wait for location', true);
    photoType.current = type;
    input.current.click();
  }

  async function onPhoto(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (Date.now() - file.lastModified > NEW_PHOTO_MS) return showToast('Use the camera. Old photos not allowed.', true);

    setSaving(true);
    try {
      const position = await freshPosition(fix);
      const capturedAt = Date.now();
      const type = photoType.current;
      const { blob, dark } = await preparePhoto(file, { name: me.name, type, at: capturedAt, ...position });
      if (review) URL.revokeObjectURL(review.url);
      setReview({ blob, url: URL.createObjectURL(blob), type, position, capturedAt, dark, note: review?.note ?? '' });
    } catch {
      showToast('Photo failed. Try again.', true);
    }
    setSaving(false);
  }

  function closeReview() {
    URL.revokeObjectURL(review.url);
    setReview(null);
  }


  async function sendPhoto() {
    const { blob, type, position, capturedAt, note } = review;
    setSaving(true);
    try {
      await addPhoto({
        clientId: crypto.randomUUID(),
        driverId: me.id,
        type,
        note: note.trim(),
        lat: position.lat,
        lng: position.lng,
        accuracy: position.accuracy,
        capturedAt,
        blob,
      });
      closeReview();
      setPending((count) => count + 1);
      setMe((current) => {
        if (!current) return current;
        return {
          ...current,
          last: { type, capturedAt },
          todayCount: (isCurrent(current) ? current.todayCount : 0) + 1,
          working: type === 'start' || (type !== 'end' && isWorking(current)),
          shiftStartedAt: type === 'start' ? capturedAt : current.shiftStartedAt,
        };
      });
      showToast(navigator.onLine ? 'Photo saved ✓' : 'Saved. Will send when internet comes.');
      say('Photo saved');
      navigator.vibrate?.(150);
      flush();
    } catch {
      showToast('Phone storage is full. Delete some files and try again.', true);
    }
    setSaving(false);
  }

  const onLoggedOut = useCallback(() => setMe(null), [setMe]);
  const closeAttendance = useCallback(() => setShowAttendance(false), []);

  async function logout() {
    if (pending > 0 && !window.confirm(`${pending} photo not sent yet. They will send after you login again. Logout?`)) return;
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    setMe(null);
  }

  const weakGps = gps === 'ready' && fix?.accuracy > WEAK_GPS_METERS;
  const gpsText = {
    ready: weakGps ? 'Weak location. Go to open area.' : 'Location ready',
    searching: 'Finding location…',
    denied: 'Location is off',
  }[gps];
  const repeated = review && me.last?.type === review.type &&
    review.capturedAt - new Date(me.last.capturedAt).getTime() < REPEAT_MS;
  const last = isCurrent(me) ? me.last : null;
  const working = isWorking(me);
  const needsNote = review?.type === 'other' && !review.note.trim();

  if (showAttendance) return <Attendance pending={pending} onBack={closeAttendance} onLoggedOut={onLoggedOut} />;

  if (review) {
    return (
      <main className="phone review">
        <h1>{WORK_LABELS[review.type]}</h1>
        <img src={review.url} alt="Your photo" />
        {review.type === 'other' && (
          <label className="field">
            Write what happened
            <input maxLength={80} value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value })} />
          </label>
        )}
        {repeated && <p className="warn">You just sent this. Send again?</p>}
        {review.dark && <p className="warn">Photo is too dark. Take again.</p>}
        {review.position.accuracy > WEAK_GPS_METERS && <p className="warn">Weak location. Go to open area and take again.</p>}
        <button className="primary send" disabled={saving || needsNote} onClick={sendPhoto}>SEND</button>
        <div className="review-actions">
          <button className="ghost" disabled={saving} onClick={() => input.current.click()}>Take again</button>
          <button className="ghost" disabled={saving} onClick={closeReview}>Cancel</button>
        </div>
        <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
        {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`} role="alert">{toast.text}</div>}
      </main>
    );
  }

  return (
    <main className="phone">
      <header className="top">
        <div>
          <div className="brand">Driver Tracker</div>
          <h1>Hello, {me.name.split(' ')[0]}</h1>
          <p>{me.vehicle}</p>
        </div>
        <button className="ghost" onClick={logout}>Logout</button>
      </header>

      <div className={`gps ${weakGps ? 'searching' : gps}`} role="status"><span className="dot" />{gpsText}</div>
      {gps === 'denied' && (
        <div className="help">
          <p>1. Open phone Settings and turn on Location.</p>
          <p>2. Allow location for this app.</p>
          <button className="primary" onClick={() => window.location.reload()}>Try again</button>
        </div>
      )}
      {pending > 0 && <p className="warn">{pending} photo waiting. Open this app when internet comes.</p>}

      {working ? (
        <section className="actions working">
          <button className="action loading" disabled={saving} onClick={() => takePhoto('loading')}>
            <CameraIcon />LOADING
          </button>
          <button className="action unloading" disabled={saving} onClick={() => takePhoto('unloading')}>
            <CameraIcon />UNLOADING
          </button>
          <button className="action breakdown" disabled={saving} onClick={() => takePhoto('breakdown')}>
            <CameraIcon />BREAKDOWN
          </button>
          <button className="action other" disabled={saving} onClick={() => takePhoto('other')}>
            <CameraIcon />OTHER
          </button>
          <button className="action end" disabled={saving} onClick={() => takePhoto('end')}>
            <CameraIcon />END WORK
          </button>
        </section>
      ) : (
        <section className="actions">
          {last?.type === 'end' && <p className="done">Work finished ✓</p>}
          <button className="action start" disabled={saving} onClick={() => takePhoto('start')}>
            <CameraIcon />START WORK<small>Take photo</small>
          </button>
        </section>
      )}

      <section className="stats">
        <div className="stat"><b>{last ? me.todayCount : 0}</b><span>Photos today</span></div>
        <div className="stat"><b>{pending}</b><span>Waiting to send</span></div>
      </section>
      {last && (
        <p className="last-sent">
          Last: {WORK_LABELS[last.type]}, {timeOf(last.capturedAt)}
        </p>
      )}
      <button className="ghost my-attendance" onClick={() => setShowAttendance(true)}>My Attendance</button>

      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`} role="alert">{toast.text}</div>}
    </main>
  );
}

export default function DriverPage() {
  const [me, setMe] = useState(undefined);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && navigator.serviceWorker) {
      navigator.serviceWorker.register('/sw.js');
      // Files of this first visit loaded before the worker started, so keep them for offline use.
      navigator.serviceWorker.ready.then(async () => {
        const files = performance
          .getEntriesByType('resource')
          .map((entry) => new URL(entry.name))
          .filter((url) => url.pathname.startsWith('/_next/static/'))
          .map((url) => url.href);
        const cache = await caches.open('driver-v1');
        await cache.addAll(files);
      });
    }
    fetch('/api/me')
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json();
          localStorage.setItem('driver', JSON.stringify(data));
          setMe(data);
        } else {
          localStorage.removeItem('driver');
          setMe(null);
        }
      })
      .catch(() => {
        // Offline: keep working with the last known driver.
        const saved = localStorage.getItem('driver');
        setMe(saved ? JSON.parse(saved) : null);
      });
  }, []);

  function onLogin(driver) {
    localStorage.setItem('driver', JSON.stringify(driver));
    setMe(driver);
  }

  if (me === undefined) return null;
  return me ? <Home me={me} setMe={setMe} /> : <Login onLogin={onLogin} />;
}
