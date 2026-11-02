// Calls the Cloudflare Worker's /api routes. The admin session lives in an
// HttpOnly cookie, which the browser sends automatically (same origin).

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Request failed (HTTP ${res.status})`, res.status);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      err?.name === 'AbortError' ? 'The request timed out. Please check your connection and try again.'
        : 'Network error. Please check your connection and try again.',
      0
    );
  } finally {
    clearTimeout(timer);
  }
}
