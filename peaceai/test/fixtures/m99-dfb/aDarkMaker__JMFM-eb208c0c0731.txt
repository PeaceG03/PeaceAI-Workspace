import {REQUEST} from '../constants';
import {FetchResult} from './http';

export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function abortTimeout(timeoutMs: number): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

function timeoutError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'TimeoutError';
}

export async function fetchOnce(
  url: string,
  headers?: Record<string, string>,
  binary = false,
  timeoutMs = REQUEST.READ_TIMEOUT_MS
): Promise<FetchResult> {
  const signal = abortTimeout(timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: headers as HeadersInit,
      ...(signal ? {signal} : {}),
    });
    const ok = resp.status >= 200 && resp.status < 300;
    if (!ok) {
      return {
        ok: false,
        status: resp.status,
        error: `HTTP ${resp.status}`,
        retryable: isRetryableStatus(resp.status),
      };
    }
    if (binary) {
      const buf = await resp.arrayBuffer();
      if (buf.byteLength === 0) {
        return {ok: false, status: resp.status, retryable: true, error: 'empty body'};
      }
      return {ok: true, status: resp.status, bytes: new Uint8Array(buf)};
    }
    return {ok: true, status: resp.status, text: await resp.text()};
  } catch (e) {
    return {ok: false, status: 0, retryable: true, error: timeoutError(e) ? 'timeout' : undefined};
  }
}
