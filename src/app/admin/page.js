'use client';

import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, dayOf, dubaiDate, shiftTime, TIME_ZONE, timeOf } from '@/lib/time';
import { dayState, OPEN_STATUSES, STATUS_LABELS, WORK_LABELS } from '@/lib/work';

// day marks times after midnight of that shift date as "(next day)".
const time = (value, day) => shiftTime(value, day) || '—';
const statusLabel = (status, day) =>
  status === 'absent' && day === todayText() ? 'Not started' : STATUS_LABELS[status];
const DUBAI_CENTER = [25.2048, 55.2708];
const todayText = () => new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

function DayNav({ day, setDay }) {
  const today = todayText();
  return (
    <div className="day-nav">
      <button className="ghost" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>‹</button>
      <input type="date" aria-label="Day" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
      <button className="ghost" aria-label="Next day" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>›</button>
      <button className="ghost" disabled={day === today} onClick={() => setDay(today)}>Today</button>
    </div>
  );
}

const pad = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, n) => pad(n));
const MINUTES = Array.from({ length: 60 }, (_, n) => pad(n));

// The browser time box follows the computer's 12 or 24 hour setting, so hour and minute are picked here.
function TimeInput({ value, onChange }) {
  const [hour = '', minute = ''] = value ? value.split(':') : [];
  return (
    <span className="time-input">
      <select aria-label="Hour" required value={hour} onChange={(e) => onChange(`${e.target.value}:${minute}`)}>
        <option value="" disabled>HH</option>
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <b>:</b>
      <select aria-label="Minute" required value={minute} onChange={(e) => onChange(`${hour}:${e.target.value}`)}>
        <option value="" disabled>MM</option>
        {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </span>
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

// Points with weaker GPS than this are left off the route.
const ROUTE_ACCURACY_METERS = 300;
// A working driver with no new location for this long has probably closed the app.
const NO_UPDATE_MS = 15 * 60 * 1000;
const MARKERS = {
  photo: { radius: 8, color: '#0a0d14', weight: 2, fillColor: '#e8c26e', fillOpacity: 1 },
  track: { radius: 4, color: '#5aa9ff', weight: 1, fillColor: '#5aa9ff', fillOpacity: 0.9 },
  now: { radius: 10, color: '#0a0d14', weight: 3, fillColor: '#3ddc97', fillOpacity: 1 },
};

// The super admin picks whose drivers to show. "none" is the super admin's own drivers.
function AdminFilter({ admins, value, onChange }) {
  return (
    <label className="field inline">
      Admin
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All admins</option>
        <option value="none">Super Admin (own drivers)</option>
        {admins.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
      </select>
    </label>
  );
}

// points: { lat, lng, label, kind? } where kind is photo (default), track or now. A route joins them in order.
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
      points.forEach((point) => {
        const marker = L.circleMarker([point.lat, point.lng], MARKERS[point.kind ?? 'photo']).addTo(layer);
        const popup = document.createElement('div');
        popup.textContent = point.label;
        marker.bindPopup(popup);
        if (onPick) marker.on('click', () => onPick(point));
      });
      // No animation: leaving the page during a zoom animation breaks Leaflet.
      if (coords.length) map.fitBounds(coords, { padding: [40, 40], maxZoom: 14, animate: false });
    }
    const element = box.current;
    draw();
    element.addEventListener('mapready', draw);
    return () => element.removeEventListener('mapready', draw);
  }, [points, route, onPick]);

  return <div className="map" ref={box} />;
}

function Dashboard({ onOpen, day, setDay, onExpired, me, admins }) {
  const [data, setData] = useState(null);
  const [version, setVersion] = useState(0);
  const [only, setOnly] = useState('');

  useEffect(() => {
    let live = true;
    const load = () =>
      api(`/api/admin/summary?${new URLSearchParams({ day, ...(only && { admin: only }) })}`)
        .then((result) => live && setData(result))
        .catch((error) => error.status === 401 && onExpired());
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [day, onExpired, version, only]);

  async function resolve(alert) {
    await send(`/api/admin/photos/${alert.id}`, 'PATCH', { resolved: true }).catch(() => {});
    setVersion((value) => value + 1);
  }

  if (!data) return <p className="empty">Loading…</p>;
  const count = (status) => data.rows.filter((row) => row.status === status).length;
  const points = data.rows
    .filter((row) => row.lat !== null)
    .map((row) => ({
      lat: row.lat,
      lng: row.lng,
      kind: OPEN_STATUSES.includes(row.status) ? 'now' : 'photo',
      label: `${row.name} • ${time(row.seenAt, row.day)}`,
    }));
  const noUpdate = (row) =>
    OPEN_STATUSES.includes(row.status) && (!row.seenAt || Date.now() - new Date(row.seenAt).getTime() > NO_UPDATE_MS);

  return (
    <>
      <div className="bar">
        <DayNav day={day} setDay={setDay} />
        {me.isSuper && <AdminFilter admins={admins} value={only} onChange={setOnly} />}
      </div>
      <section className="kpis">
        <div className="kpi"><span>Drivers</span><b>{data.rows.length}</b></div>
        <div className="kpi"><span>Working</span><b>{count('working') + count('quiet') + count('breakdown')}</b></div>
        <div className="kpi"><span>Finished</span><b>{count('finished')}</b></div>
        <div className="kpi"><span>{day === data.today ? 'Not started' : 'Absent'}</span><b>{count('absent')}</b></div>
        <div className="kpi"><span>To fix</span><b>{count('start-missing') + count('end-missing')}</b></div>
        {data.storageBytes !== null && <div className="kpi"><span>Image storage</span><b>{(data.storageBytes / 1024 ** 3).toFixed(2)} GB</b></div>}
      </section>
      {data.alerts.length > 0 && (
        <section className="panel danger">
          <h2>Breakdowns ({data.alerts.length})</h2>
          {data.alerts.map((alert) => (
            <div className="alert-row" key={alert.id}>
              <span>{alert.driver} • {alert.day} {time(alert.capturedAt, alert.day)} • {alert.place ?? 'Finding place…'}</span>
              <button className="ghost" onClick={() => onOpen(alert.driverId, alert.day)}>Open</button>
              <button className="primary" onClick={() => resolve(alert)}>Resolved</button>
            </div>
          ))}
        </section>
      )}
      <section className="panel">
        <h2>Last location of each driver <small className="legend">Green: working now</small></h2>
        <MapView points={points} />
      </section>
      <section className="panel">
        <h2>Drivers</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Driver</th><th>Vehicle</th><th>Status</th><th>First photo</th><th>Last photo</th><th>Last seen</th><th>Last place</th><th>Photos</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr className="link" key={row.id} onClick={() => onOpen(row.id, row.day)}>
                  <td>{row.name}</td>
                  <td>{row.vehicle}</td>
                  <td>
                    <span className={`badge ${row.status}`}>{statusLabel(row.status, day)}</span>
                    {row.day !== day && <small className="note"> Night shift from {row.day}</small>}
                  </td>
                  <td>{time(row.first, row.day)}</td>
                  <td>{time(row.last, row.day)}</td>
                  <td>
                    {time(row.seenAt, row.day)}
                    {noUpdate(row) && <small className="note late">No update 15 min+. App closed?</small>}
                  </td>
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
  const blank = { id: null, type: 'start', time: '', note: '', nextDay: false, oldAt: null };
  const [entry, setEntry] = useState(blank);
  const [error, setError] = useState('');
  const month = day.slice(0, 7);

  useEffect(() => {
    const load = () => api(`/api/admin/drivers/${id}/day?day=${day}`).then(setData).catch(() => setData(null));
    load();
    // Recent days can still have a running shift, so the route keeps moving.
    if (day < addDays(todayText(), -1)) return;
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [id, day, version]);

  useEffect(() => {
    api(`/api/admin/drivers/${id}/days?month=${month}`).then(setDays).catch(() => setDays([]));
  }, [id, month, version]);

  // Photos and live location points together, in time order.
  const points = useMemo(() => {
    const photoPoints = (data?.photos ?? [])
      .filter((photo) => photo.lat !== null)
      .map((photo) => ({
        lat: photo.lat,
        lng: photo.lng,
        at: photo.capturedAt,
        label: `${time(photo.capturedAt, day)} • ${WORK_LABELS[photo.type]} • ${photo.place ?? ''}`,
      }));
    const trackPoints = (data?.track ?? [])
      .filter((point) => point.accuracy <= ROUTE_ACCURACY_METERS)
      .map((point) => ({ lat: point.lat, lng: point.lng, at: point.at, kind: 'track', label: `${time(point.at, day)} • Live location` }));
    const all = [...photoPoints, ...trackPoints].sort((a, b) => new Date(a.at) - new Date(b.at));
    const last = all.at(-1);
    if (last && OPEN_STATUSES.includes(dayState(data.photos).status)) all[all.length - 1] = { ...last, kind: 'now', label: `Now: ${last.label}` };
    return all;
  }, [data, day]);
  const lastSeen = points.at(-1)?.at;
  const dayRow = days.find((row) => row.day === day);
  const missing = { 'start-missing': 'start', 'end-missing': 'end' }[dayRow?.status];
  const startAt = data?.photos.findLast((photo) => photo.type === 'start' && dayOf(photo.capturedAt) === day)?.capturedAt;

  // A time earlier than START on this date is after midnight, so the next date is ticked for it.
  function changeEntry(change) {
    const next = { ...entry, ...change };
    if (startAt && /^\d\d:\d\d$/.test(next.time) && next.type !== 'start' && ('time' in change || 'type' in change)) {
      next.nextDay = next.time < timeOf(startAt);
    }
    setEntry(next);
  }

  async function saveEntry(event) {
    event.preventDefault();
    setError('');
    try {
      if (entry.id) {
        const body = { type: entry.type, note: entry.note };
        const at = dubaiDate(entry.nextDay ? addDays(day, 1) : day, entry.time);
        if (at.getTime() !== new Date(entry.oldAt).getTime()) Object.assign(body, { time: entry.time, nextDay: entry.nextDay });
        await send(`/api/admin/photos/${entry.id}`, 'PATCH', body);
      } else {
        await send(`/api/admin/drivers/${id}/entries`, 'POST', { day, type: entry.type, time: entry.time, nextDay: entry.nextDay, note: entry.note });
      }
      setEntry(blank);
      setVersion((value) => value + 1);
    } catch (e) {
      setError(e.message);
    }
  }

  function editEntry(photo) {
    setEntry({
      id: photo._id,
      type: photo.type,
      time: timeOf(photo.capturedAt),
      nextDay: dayOf(photo.capturedAt) !== day,
      oldAt: photo.capturedAt,
      note: photo.note ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteEntry(photo) {
    const label = `${WORK_LABELS[photo.type]} at ${time(photo.capturedAt, day)}`;
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
            {dayRow.status === 'start-missing'
              ? 'Start missing. Hours count only from Start to End, so add Start Work.'
              : 'End missing. Add End Work to finish this day and count hours.'}
            <button className="ghost" onClick={() => setEntry({ ...blank, type: missing })}>Add {WORK_LABELS[missing]}</button>
          </div>
        )}
        <form className="form" onSubmit={saveEntry}>
          <label className="field">
            Work
            <select name="work" value={entry.type} onChange={(e) => changeEntry({ type: e.target.value })}>
              {Object.entries(WORK_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <div className="field">Time (24 hour)<TimeInput value={entry.time} onChange={(time) => changeEntry({ time })} /></div>
          <label className="check">
            <input type="checkbox" checked={entry.nextDay} onChange={(e) => setEntry({ ...entry, nextDay: e.target.checked })} />
            Next day (after 12 at night), {addDays(day, 1)}
          </label>
          <label className="field">Note<input maxLength={80} value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} /></label>
          <button className="primary">{entry.id ? 'Save' : 'Add entry'}</button>
          {entry.id && <button type="button" className="ghost" onClick={() => setEntry(blank)}>Cancel</button>}
        </form>
        {error && <p className="error" role="alert" style={{ padding: '0 18px 18px' }}>{error}</p>}
      </section>
      <section className="panel">
        <h2>
          Route: {data?.photos.filter((photo) => photo.lat !== null).length ?? 0} photos, {data?.track.length ?? 0} live points
          {lastSeen && ` • Last seen ${time(lastSeen, day)}`}
          <small className="legend">Gold: photo • Blue: live location • Green: now</small>
        </h2>
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
                  <img src={`/api/admin/photos/${photo._id}/image`} alt={`${WORK_LABELS[photo.type]} at ${time(photo.capturedAt, day)}`} loading="lazy" />
                </a>
              )}
              <div>
                {time(photo.capturedAt, day)} • {WORK_LABELS[photo.type]}
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
            <thead><tr><th>Date</th><th>Attendance</th><th>Status</th><th>Start</th><th>End</th><th>Hours</th><th>Entries</th></tr></thead>
            <tbody>
              {days.map((row) => (
                <tr className={`link ${row.day === day ? 'selected' : ''}`} key={row.day} onClick={() => setDay(row.day)}>
                  <td>{row.day}</td>
                  <td><span className={`badge ${row.present ? 'present' : 'absent'}`}>{row.present ? 'Present' : 'Absent'}</span></td>
                  <td><span className={`badge ${row.status}`}>{statusLabel(row.status, row.day)}</span></td>
                  <td>{time(row.start, row.day)}</td>
                  <td>{time(row.end, row.day)}</td>
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

function Drivers({ me, admins }) {
  const empty = { name: '', phone: '', vehicle: '', pin: '', adminId: '' };
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
    setForm({ name: driver.name, phone: driver.phone, vehicle: driver.vehicle, pin: '', adminId: '' });
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
          {me.isSuper && !editingId && (
            <label className="field">
              Admin
              <select value={form.adminId} onChange={(e) => setForm({ ...form, adminId: e.target.value })}>
                <option value="">Super Admin (own)</option>
                {admins.filter((item) => item.active).map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
              </select>
            </label>
          )}
          <button className="primary">{editingId ? 'Save' : 'Add driver'}</button>
          {editingId && <button type="button" className="ghost" onClick={cancelEdit}>Cancel</button>}
        </form>
        {error && <p className="error" role="alert" style={{ padding: '0 18px 18px' }}>{error}</p>}
      </section>
      <section className="panel">
        <h2>All drivers ({list.length})</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Name</th><th>Mobile</th><th>Vehicle</th>{me.isSuper && <th>Admin</th>}<th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((driver) => (
                <tr key={driver._id}>
                  <td>{driver.name}</td>
                  <td>{driver.phone}</td>
                  <td>{driver.vehicle}</td>
                  {me.isSuper && (
                    <td>
                      <select
                        className="cell-select"
                        aria-label={`Admin of ${driver.name}`}
                        value={driver.adminId ?? ''}
                        onChange={(e) => change(driver, { adminId: e.target.value || null })}
                      >
                        <option value="">Super Admin</option>
                        {admins.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                      </select>
                    </td>
                  )}
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

function Report({ me, admins }) {
  const today = todayText();
  const [drivers, setDrivers] = useState([]);
  const [driver, setDriver] = useState('');
  const [only, setOnly] = useState('');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);

  useEffect(() => {
    setDriver('');
    api(`/api/admin/drivers?${new URLSearchParams(only ? { admin: only } : {})}`).then(setDrivers).catch(() => {});
  }, [only]);

  const query = new URLSearchParams({ from, to, ...(driver && { driver }), ...(only && { admin: only }) });

  return (
    <section className="panel">
      <h2>Download report</h2>
      <div className="form">
        {me.isSuper && <AdminFilter admins={admins} value={only} onChange={setOnly} />}
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
      <p className="empty">One row for each driver for each day, with Present or Absent (Present when the day has a Start Work), start, end and hours. Each photo has its own column with time, work, place, note and map link. Times are 24 hour. Maximum 92 days.</p>
    </section>
  );
}

// Super admin only: admins who each manage their own drivers.
function Admins({ admins, reload }) {
  const empty = { name: '', username: '', password: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');

  async function run(action) {
    setError('');
    try {
      await action();
      reload();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }

  async function add(event) {
    event.preventDefault();
    if (await run(() => send('/api/admin/admins', 'POST', form))) setForm(empty);
  }

  function rename(admin) {
    const name = window.prompt(`New name for ${admin.name}`, admin.name);
    if (name) run(() => send(`/api/admin/admins/${admin._id}`, 'PATCH', { name }));
  }

  function resetPassword(admin) {
    const password = window.prompt(`New password for ${admin.name} (at least 8 characters)`);
    if (password) run(() => send(`/api/admin/admins/${admin._id}`, 'PATCH', { password }));
  }

  const input = (key, label, props) => (
    <label className="field">
      {label}
      <input required value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </label>
  );

  return (
    <>
      <section className="panel">
        <h2>Add admin</h2>
        <form className="form" onSubmit={add}>
          {input('name', 'Name')}
          {input('username', 'Username', { autoCapitalize: 'none', autoComplete: 'off' })}
          {input('password', 'Password (8+ characters)', { type: 'password', autoComplete: 'new-password', minLength: 8 })}
          <button className="primary">Add admin</button>
        </form>
        {error && <p className="error" role="alert" style={{ padding: '0 18px 18px' }}>{error}</p>}
        <p className="empty">An admin logs in at this same page and sees only their own drivers. Give drivers to an admin in the Drivers tab.</p>
      </section>
      <section className="panel">
        <h2>All admins ({admins.length})</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Drivers</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin._id}>
                  <td>{admin.name}</td>
                  <td>{admin.username}</td>
                  <td>{admin.drivers}</td>
                  <td><span className={`badge ${admin.active ? 'present' : 'off'}`}>{admin.active ? 'Active' : 'Disabled'}</span></td>
                  <td>
                    <div className="row-actions">
                      <button className="ghost" onClick={() => rename(admin)}>Edit name</button>
                      <button className="ghost" onClick={() => resetPassword(admin)}>Reset password</button>
                      <button className="ghost" onClick={() => run(() => send(`/api/admin/admins/${admin._id}`, 'PATCH', { active: !admin.active }))}>
                        {admin.active ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!admins.length && <p className="empty">No admins yet.</p>}
      </section>
    </>
  );
}

function AdminLogin({ onLogin }) {
  const [username, setUsername] = useState('');
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
        <label className="field">Username<input autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="field">Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary">Login</button>
      </form>
    </main>
  );
}

export default function AdminPage() {
  // undefined: checking, null: logged out, else { name, isSuper }.
  const [me, setMe] = useState(undefined);
  const [admins, setAdmins] = useState([]);
  const [tab, setTab] = useState('dashboard');
  const [openDriver, setOpenDriver] = useState(null);
  const [day, setDay] = useState(todayText);

  const expire = useCallback(() => setMe(null), []);
  const loadMe = useCallback(() => api('/api/admin/me').then(setMe).catch(() => setMe(null)), []);
  const loadAdmins = useCallback(() => api('/api/admin/admins').then(setAdmins).catch(() => setAdmins([])), []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (me?.isSuper) loadAdmins();
  }, [me, loadAdmins]);

  if (me === undefined) return null;
  if (!me) return <AdminLogin onLogin={loadMe} />;

  async function logout() {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    setMe(null);
    setTab('dashboard');
    setOpenDriver(null);
  }

  const tabs = [['dashboard', 'Dashboard'], ['drivers', 'Drivers'], ['report', 'Report'], ...(me.isSuper ? [['admins', 'Admins']] : [])];

  function openDay(id, nextDay) {
    if (nextDay) setDay(nextDay);
    setOpenDriver(id);
  }

  function pick(next) {
    setOpenDriver(null);
    setTab(next);
    // Driver counts change when drivers move between admins.
    if (me.isSuper) loadAdmins();
  }

  return (
    <main className="admin">
      <header className="bar">
        <div><div className="brand">Driver Tracker</div><h1>{me.isSuper ? 'Super Admin' : me.name}</h1></div>
        <span className="spacer" />
        <nav className="tabs">
          {tabs.map(([key, label]) => (
            <button key={key} className={tab === key && !openDriver ? 'on' : ''} onClick={() => pick(key)}>{label}</button>
          ))}
        </nav>
        <button className="ghost" onClick={logout}>Logout</button>
      </header>
      {openDriver ? (
        <DriverDay id={openDriver} day={day} setDay={setDay} onBack={() => setOpenDriver(null)} />
      ) : tab === 'dashboard' ? (
        <Dashboard onOpen={openDay} day={day} setDay={setDay} onExpired={expire} me={me} admins={admins} />
      ) : tab === 'drivers' ? (
        <Drivers me={me} admins={admins} />
      ) : tab === 'admins' ? (
        <Admins admins={admins} reload={loadAdmins} />
      ) : (
        <Report me={me} admins={admins} />
      )}
    </main>
  );
}
