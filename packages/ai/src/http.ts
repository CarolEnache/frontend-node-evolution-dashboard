export const SUMMARY_HTTP_TIMEOUT_MS = 20_000;
export const SUMMARY_HTTP_MAX_BYTES = 64 * 1024;

export function createLimitedFetch(options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}): typeof fetch {
  const base = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? SUMMARY_HTTP_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? SUMMARY_HTTP_MAX_BYTES;
  return async (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await base(input, { ...init, signal });
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new Error(`response body exceeds ${maxBytes} bytes`);
    }
    const body = await readBodyLimited(response, maxBytes);
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
