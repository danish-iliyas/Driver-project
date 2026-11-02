'use client';

import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TIME_ZONE } from '@/lib/time';
import { STATUS_LABELS, WORK_LABELS } from '@/lib/work';

const time = (value) =>
  value ? new Date(value).toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const clock = (value) =>
  new Date(value).toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const statusLabel = (status, day) =>
  status === 'absent' && day === todayText() ? 'Not started' : STATUS_LABELS[status];
const DUBAI_CENTER = [25.2048, 55.2708];
const todayText = () => new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

function shiftDay(day, by) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

function DayNav({ day, setDay }) {
  const today = todayText();
  return (
    <div className="day-nav">
      <button className="ghost" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>‹</button>
      <input type="date" aria-label="Day" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
      <button className="ghost" aria-label="Next day" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}>›</button>
      <button className="ghost" disabled={day === today} onClick={() => setDay(today)}>Today</button>
    </div>
  );
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error ?? 'Something went wrong');
    error.status = response.status;
    throw error;
  }
  return data;
}

const send = (path, method, body) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// points: { lat, lng, label, photoId? }. A route joins them in order.
function MapView({ points, route = false, onPick }) {
  const box = useRef(null);
  const state = useRef(null);

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then(({ default: L }) => {
      if (cancelled || state.current) return;
      const map = L.map(box.current).setView(DUBAI_CENTER, 10);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      state.current = { L, map, layer: L.layerGroup().addTo(map) };
      box.current.dispatchEvent(new Event('mapready'));
    });
    return () => {
      cancelled = true;
      state.current?.map.remove();
      state.current = null;
    };
  }, []);

  useEffect(() => {
    function draw() {
      if (!state.current) return;
      const { L, map, layer } = state.current;
      layer.clearLayers();
      const coords = points.map((p) => [p.lat, p.lng]);
      if (route && coords.length > 1) L.polyline(coords, { color: '#e8c26e', weight: 3 }).addTo(layer);
      points.forEach((point, index) => {
        const marker = L.circleMarker([point.lat, point.lng], {
          radius: 8, color: '#0a0d14', weight: 2, fillColor: '#e8c26e', fillOpacity: 1,
        }).addTo(layer);
        const popup = document.createElement('div');
        popup.textContent = route ? `${index + 1}. ${point.label}` : point.label;
        marker.bindPopup(popup);
        if (onPick) marker.on('click', () => onPick(point));
      });
      if (coords.length) map.fitBounds(coords, { padding: [40, 40], maxZoom: 14 });
    }
    const element = box.current;
    draw();
    element.addEventListener('mapready', draw);
    return () => element.removeEventListener('mapready', draw);
  }, [points, route, onPick]);

  return <div className="map" ref={box} />;
}

function Dashboard({ onOpen, day, setDay, onExpired }) {
  const [data, setData] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    const load = () =>
      api(`/api/admin/summary?day=${day}`)
        .then((result) => live && setData(result))
        .catch((error) => error.status === 401 && onExpired());
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [day, onExpired, version]);

  async function resolve(alert) {
    await send(`/api/admin/photos/${alert.id}`, 'PATCH', { resolved: true }).catch(() => {});
    setVersion((value) => value + 1);
  }

  if (!data) return <p className="empty">Loading…</p>;
  const count = (status) => data.rows.filter((row) => row.status === status).length;
  const points = data.rows
    .filter((row) => row.lat !== null)
    .map((row) => ({ lat: row.lat, lng: row.lng, label: `${row.name} • ${time(row.last)} • ${row.place ?? ''}` }));

  return (
    <>
      <div className="bar"><DayNav day={day} setDay={setDay} /></div>
      <section className="kpis">
        <div className="kpi"><span>Drivers</span><b>{data.rows.length}</b></div>
        <div className="kpi"><span>Working</span><b>{count('working') + count('quiet') + count('breakdown')}</b></div>
        <div className="kpi"><span>Finished</span><b>{count('finished')}</b></div>
        <div className="kpi"><span>{day === data.today ? 'Not started' : 'Absent'}</span><b>{count('absent')}</b></div>
        <div className="kpi"><span>To fix</span><b>{count('start-missing') + count('end-missing')}</b></div>
        <div className="kpi"><span>Image storage</span><b>{(data.storageBytes / 1024 ** 3).toFixed(2)} GB</b></div>
      </section>
      {data.alerts.length > 0 && (
        <section className="panel danger">
          <h2>Breakdowns ({data.alerts.length})</h2>
          {data.alerts.map((alert) => (
            <div className="alert-row" key={alert.id}>
              <span>{alert.driver} • {alert.day} {time(alert.capturedAt)} • {alert.place ?? 'Finding place…'}</span>
              <button className="ghost" onClick={() => onOpen(alert.driverId, alert.day)}>Open</button>
              <button className="primary" onClick={() => resolve(alert)}>Resolved</button>
            </div>
          ))}
        </section>
      )}
      <section className="panel">
        <h2>Last location of each driver</h2>
        <MapView points={points} />
      </section>
      <section className="panel">
        <h2>Drivers</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Driver</th><th>Vehicle</th><th>Status</th><th>First photo</th><th>Last photo</th><th>Last place</th><th>Photos</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr className="link" key={row.id} onClick={() => onOpen(row.id)}>
                  <td>{row.name}</td>
                  <td>{row.vehicle}</td>
                  <td><span className={`badge ${row.status}`}>{statusLabel(row.status, day)}</span></td>
                  <td>{time(row.first)}</td>
                  <td>{time(row.last)}</td>
                  <td>{row.place ?? '—'}</td>
                  <td>{row.count}</td>
                  <td>{row.flagged || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.rows.length && <p className="empty">No drivers yet. Add them in the Drivers tab.</p>}
      </section>
    </>
  );
}

function DriverDay({ id, day, setDay, onBack }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState([]);
  const [version, setVersion] = useState(0);
  const blank = { id: null, type: 'start', time: '', note: '', oldTime: '' };
  const [entry, setEntry] = useState(blank);
  const [error, setError] = useState('');
  const month = day.slice(0, 7);

  useEffect(() => {
    api(`/api/admin/drivers/${id}/day?day=${day}`).then(setData).catch(() => setData(null));
  }, [id, day, version]);

  useEffect(() => {
    api(`/api/admin/drivers/${id}/days?month=${month}`).then(setDays).catch(() => setDays([]));
  }, [id, month, version]);

  const points = useMemo(
    () =>
      (data?.photos ?? [])
        .filter((photo) => photo.lat !== null)
        .map((photo) => ({
          lat: photo.lat,
          lng: photo.lng,
          label: `${time(photo.capturedAt)} • ${WORK_LABELS[photo.type]} • ${photo.place ?? ''}`,
        })),
    [data],
  );
  const dayRow = days.find((row) => row.day === day);
  const missing = { 'start-missing': 'start', 'end-missing': 'end' }[dayRow?.status];

  async function saveEntry(event) {
    event.preventDefault();
    setError('');
    try {
      if (entry.id) {
        const body = { type: entry.type, note: entry.note };
        if (entry.time !== entry.oldTime) body.time = entry.time;
        await send(`/api/admin/photos/${entry.id}`, 'PATCH', body);
      } else {
        await send(`/api/admin/drivers/${id}/entries`, 'POST', { day, type: entry.type, time: entry.time, note: entry.note });
      }
      setEntry(blank);
      setVersion((value) => value + 1);
    } catch (e) {
      setError(e.message);
    }
  }

  function editEntry(photo) {
    const at = clock(photo.capturedAt);
    setEntry({ id: photo._id, type: photo.type, time: at, oldTime: at, note: photo.note ?? '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteEntry(photo) {
    const label = `${WORK_LABELS[photo.type]} at ${time(photo.capturedAt)}`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    await send(`/api/admin/photos/${photo._id}`, 'DELETE').catch((e) => setError(e.message));
    setVersion((value) => value + 1);
  }

  return (
    <>
      <div className="bar">
        <button className="ghost" onClick={onBack}>← Back</button>
        <h1>{data?.driver.name ?? ''}</h1>
        <span className="spacer" />
        <DayNav day={day} setDay={setDay} />
      </div>
      <section className="panel">
        <h2>{entry.id ? 'Edit entry' : `Add entry for ${day}`}</h2>
        {missing && !entry.id && (
          <div className="warn">
            {STATUS_LABELS[dayRow.status]}
            <button className="ghost" onClick={() => setEntry({ ...blank, type: missing })}>Add {WORK_LABELS[missing]}</button>
          </div>
        )}
        <form className="form" onSubmit={saveEntry}>
          <label className="field">
            Work
            <select value={entry.type} onChange={(e) => setEntry({ ...entry, type: e.target.value })}>
              {Object.entries(WORK_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="field">Time<input type="time" required value={entry.time} onChange={(e) => setEntry({ ...entry, time: e.target.value })} /></label>
          <label className="field">Note<input maxLength={80} value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} /></label>
          <button className="primary">{entry.id ? 'Save' : 'Add entry'}</button>
          {entry.id && <button type="button" className="ghost" onClick={() => setEntry(blank)}>Cancel</button>}
        </form>
        {error && <p className="error" role="alert" style={{ padding: '0 18px 18px' }}>{error}</p>}
      </section>
      <section className="panel">
        <h2>Route: {points.length} stops</h2>
        <MapView points={points} route />
      </section>
      <section className="panel">
        <h2>Entries</h2>
        <div className="gallery">
          {data?.photos.map((photo) => (
            <article className="shot" key={photo._id}>
              {photo.manual ? (
                <p className="no-photo">No photo</p>
              ) : (
                <a href={`/api/admin/photos/${photo._id}/image`} target="_blank" rel="noreferrer">
                  <img src={`/api/admin/photos/${photo._id}/image`} alt={`${WORK_LABELS[photo.type]} at ${time(photo.capturedAt)}`} loading="lazy" />
                </a>
              )}
              <div>
                {time(photo.capturedAt)} • {WORK_LABELS[photo.type]}
                {photo.note && <em>{photo.note}</em>}
                {photo.lat !== null && <em>{photo.place ?? `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`}</em>}
                {photo.manual && <small>Added by admin</small>}
                {photo.editedAt && <small>Edited by admin</small>}
                {photo.late && <small>Late upload</small>}
                {photo.lowAccuracy && <small>Weak GPS ({Math.round(photo.accuracy)} m)</small>}
                <div className="row-actions">
                  <button className="ghost" onClick={() => editEntry(photo)}>Edit</button>
                  <button className="ghost" onClick={() => deleteEntry(photo)}>Delete</button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!data?.photos.length && <p className="empty">No photos on this day.</p>}
      </section>
      <section className="panel">
        <h2>Day wise ({month})</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Date</th><th>Status</th><th>First</th><th>Last</th><th>Hours</th><th>Entries</th></tr></thead>
            <tbody>
              {days.map((row) => (
                <tr className={`link ${row.day === day ? 'selected' : ''}`} key={row.day} onClick={() => setDay(row.day)}>
                  <td>{row.day}</td>
                  <td><span className={`badge ${row.status}`}>{statusLabel(row.status, row.day)}</span></td>
                  <td>{time(row.first)}</td>
                  <td>{time(row.last)}</td>
                  <td>{row.hours || '—'}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Drivers() {
  const empty = { name: '', phone: '', vehicle: '', pin: '' };
  const [list, setList] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api('/api/admin/drivers').then(setList).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function add(event) {
    event.preventDefault();
    setError('');
    try {
      if (editingId) {
        const { name, phone, vehicle } = form;
        await send(`/api/admin/drivers/${editingId}`, 'PATCH', { name, phone, vehicle });
      } else {
        await send('/api/admin/drivers', 'POST', form);
      }
      setEditingId(null);
      setForm(empty);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function change(driver, body) {
    setError('');
    try {
      await send(`/api/admin/drivers/${driver._id}`, 'PATCH', body);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  function startEdit(driver) {
    setEditingId(driver._id);
    setForm({ name: driver.name, phone: driver.phone, vehicle: driver.vehicle, pin: '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(empty);
  }

  function resetPin(driver) {
    const pin = window.prompt(`New 4 digit PIN for ${driver.name}`);
    if (pin) change(driver, { pin });
  }

  const input = (key, label, props) => (
    <label className="field">
      {label}
      <input required={key !== 'vehicle'} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </label>
  );

  return (
    <>
      <section className="panel">
        <h2>{editingId ? 'Edit driver' : 'Add driver'}</h2>
        <form className="form" onSubmit={add}>
          {input('name', 'Name')}
          {input('phone', 'Mobile number', { inputMode: 'tel' })}
          {input('vehicle', 'Vehicle number')}
          {!editingId && input('pin', '4 digit PIN', { inputMode: 'numeric', maxLength: 4 })}
          <button className="primary">{editingId ? 'Save' : 'Add driver'}</button>
          {editingId && <button type="button" className="ghost" onClick={cancelEdit}>Cancel</button>}
        </form>
        {error && <p className="error" role="alert" style={{ padding: '0 18px 18px' }}>{error}</p>}
      </section>
      <section className="panel">
        <h2>All drivers ({list.length})</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Name</th><th>Mobile</th><th>Vehicle</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((driver) => (
                <tr key={driver._id}>
                  <td>{driver.name}</td>
                  <td>{driver.phone}</td>
                  <td>{driver.vehicle}</td>
                  <td><span className={`badge ${driver.active ? 'present' : 'off'}`}>{driver.active ? 'Active' : 'Disabled'}</span></td>
                  <td>
                    <div className="row-actions">
                      <button className="ghost" onClick={() => startEdit(driver)}>Edit</button>
                      <button className="ghost" onClick={() => resetPin(driver)}>Reset PIN</button>
                      <button className="ghost" onClick={() => change(driver, { active: !driver.active })}>
                        {driver.active ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Report() {
  const today = todayText();
  const [drivers, setDrivers] = useState([]);
  const [driver, setDriver] = useState('');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);

  useEffect(() => {
    api('/api/admin/drivers').then(setDrivers).catch(() => {});
  }, []);

  const query = new URLSearchParams({ from, to, ...(driver && { driver }) });

  return (
    <section className="panel">
      <h2>Download report</h2>
      <div className="form">
        <label className="field">
          Driver
          <select value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="">All drivers</option>
            {drivers.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="field">To<input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <a className="primary" style={{ textAlign: 'center', textDecoration: 'none' }} href={`/api/admin/reports/attendance?${query}`}>
          Download Excel file (CSV)
        </a>
      </div>
      <p className="empty">One row for each entry, with time, work, note, place and map link. Maximum 92 days.</p>
    </section>
  );
}

function AdminLogin({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await send('/api/admin/login', 'POST', { username, password });
      onLogin();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main className="admin-login">
      <form className="login-card" onSubmit={submit}>
        <div><div className="brand">Driver Tracker</div><h1>Admin</h1></div>
        <label className="field">Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="field">Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary">Login</button>
      </form>
    </main>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [openDriver, setOpenDriver] = useState(null);
  const [day, setDay] = useState(todayText);

  const expire = useCallback(() => setAuthed(false), []);

  useEffect(() => {
    api('/api/admin/drivers').then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return null;
  if (!authed) return <AdminLogin onLogin={() => setAuthed(true)} />;

  async function logout() {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    setAuthed(false);
  }

  function openDay(id, nextDay) {
    if (nextDay) setDay(nextDay);
    setOpenDriver(id);
  }

  function pick(next) {
    setOpenDriver(null);
    setTab(next);
  }

  return (
    <main className="admin">
      <header className="bar">
        <div><div className="brand">Driver Tracker</div><h1>Admin</h1></div>
        <span className="spacer" />
        <nav className="tabs">
          {[['dashboard', 'Dashboard'], ['drivers', 'Drivers'], ['report', 'Report']].map(([key, label]) => (
            <button key={key} className={tab === key && !openDriver ? 'on' : ''} onClick={() => pick(key)}>{label}</button>
          ))}
        </nav>
        <button className="ghost" onClick={logout}>Logout</button>
      </header>
      {openDriver ? (
        <DriverDay id={openDriver} day={day} setDay={setDay} onBack={() => setOpenDriver(null)} />
      ) : tab === 'dashboard' ? (
        <Dashboard onOpen={openDay} day={day} setDay={setDay} onExpired={expire} />
      ) : tab === 'drivers' ? (
        <Drivers />
      ) : (
        <Report />
      )}
    </main>
  );
}
