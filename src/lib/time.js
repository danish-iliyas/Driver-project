export const TIME_ZONE = 'Asia/Dubai';

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
// 24 hour clock, so a night time is never mixed up with a day time.
export const CLOCK = { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const timeFormat = new Intl.DateTimeFormat('en-GB', CLOCK);

export const dayOf = (date) => dayFormat.format(new Date(date));
// Dubai is always UTC+4; it has no daylight saving.
export const dubaiDate = (day, time) => new Date(`${day}T${time}:00+04:00`);
export const timeOf = (date) => timeFormat.format(new Date(date));

export function addDays(day, by) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

// A night shift entry after midnight is marked, for example "02:15 (next day)".
export const shiftTime = (date, day) =>
  date ? `${timeOf(date)}${day && dayOf(date) !== day ? ' (next day)' : ''}` : '';
