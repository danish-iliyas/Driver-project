// +971 50 123 4567, 00971501234567 and 501234567 all become 0501234567.
export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^00/, '');
  if (/^9715\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  return digits;
}
