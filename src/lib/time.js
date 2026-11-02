export const TIME_ZONE = 'Asia/Dubai';

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export const dayOf = (date) => dayFormat.format(date);
// Dubai is always UTC+4; it has no daylight saving.
export const dubaiDate = (day, time) => new Date(`${day}T${time}:00+04:00`);
export const timeOf = (date) => timeFormat.format(new Date(date));
