// Input validation helpers. A failed check throws an error carrying the HTTP status to send.
export function requireThat(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
export function field(value, limit, required = true) {
  requireThat(typeof value === 'string' && value.length <= limit && (!required || value.trim()), 'Enter a valid value.');
  return value.trim();
}
export function integer(value, max = Number.MAX_SAFE_INTEGER, min = 1) {
  requireThat(Number.isSafeInteger(value) && value >= min && value <= max, 'Enter a valid number.');
  return value;
}
export function email(value) {
  const address = field(value, 254).toLowerCase();
  requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address), 'Enter a valid email.');
  return address;
}
// Reads a JSON object body of at most 4 MB (photos are sent inline as data URLs).
export async function readJson(request) {
  requireThat(request.headers.get('content-type')?.split(';')[0] === 'application/json', 'Send JSON.', 415);
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4_000_000) { reader.cancel().catch(() => {}); requireThat(false, 'Request is too large.', 413); }
      chunks.push(value);
    }
  }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(concat(chunks, size))); } catch { requireThat(false, 'Invalid JSON.'); }
  requireThat(data && typeof data === 'object' && !Array.isArray(data), 'Invalid request.');
  return data;
}
function concat(chunks, size) {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
