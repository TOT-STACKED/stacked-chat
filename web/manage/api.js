export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/** Thin client for /api/v1. Adds the session token; a 401 means the session ended. */
export function createApi(auth, onSessionEnded) {
  async function request(method, path, body, headers) {
    const token = await auth.token();
    const res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(headers || {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) { onSessionEnded(); throw new ApiError(401, 'unauthorized', 'Please sign in again'); }
    if (!res.ok) throw new ApiError(res.status, data && data.error && data.error.code, (data && data.error && data.error.message) || 'Something went wrong');
    return data;
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b, h) => request('POST', p, b ?? {}, h),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
  };
}
