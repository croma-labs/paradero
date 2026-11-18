import { z } from "zod";

const BASE_URL = process.env.CROMA_API_URL ?? "https://api.croma.run";
const STALE_AFTER_MS = 5 * 60_000;

/** A rider is waiting on the other end, so a slow upstream fails fast instead of hanging the screen. */
const TIMEOUT_MS = 8_000;

export class CromaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

const failure = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export async function croma<S extends z.ZodType>(endpoint: string, body: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
  const key = process.env.CROMA_API_KEY;
  if (!key) throw new CromaError("missing_api_key", "Set CROMA_API_KEY in .env.local.", 500);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/co/transmilenio/${endpoint}/v1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const slow = error instanceof DOMException && error.name === "TimeoutError";
    throw new CromaError(slow ? "timeout" : "network", slow ? "Croma took too long to answer." : "Could not reach Croma.", slow ? 504 : 502);
  }

  const json: unknown = await res.json().catch(() => null);
  const failed = failure.safeParse(json);
  if (!res.ok || failed.success) {
    throw new CromaError(failed.success ? failed.data.error.code : `http_${res.status}`, failed.success ? failed.data.error.message : res.statusText);
  }

  const parsed = schema.safeParse((json as { data?: unknown } | null)?.data);
  if (!parsed.success) throw new CromaError("unexpected_response", `Unexpected shape from ${endpoint}.`);
  return parsed.data;
}

export function isLive(asOf: string, live: boolean | undefined): boolean {
  if (live === false) return false;
  return Date.now() - Date.parse(asOf) <= STALE_AFTER_MS;
}

const MAX_KEYS = 2_000;

function trim(map: Map<string, unknown>) {
  if (map.size > MAX_KEYS) map.delete(map.keys().next().value as string);
}

/**
 * One answer per key for `ttlMs` after it arrives, shared by every rider on this instance.
 * A request still in flight is always joined, even past the TTL: a slow source must not get a second and third copy of the same question.
 */
export function cached<T>(ttlMs: number, graceMs = 0) {
  type Entry = { at: number; settled: boolean; value: Promise<T> };
  const entries = new Map<string, Entry>();
  // The latest good answer per key, kept apart from the entries so a newer success is never forgotten by an older failure.
  const lasts = new Map<string, { at: number; value: T }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && (!hit.settled || Date.now() - hit.at < ttlMs)) return hit.value;
    const entry: Entry = { at: Date.now(), settled: false, value: Promise.resolve(undefined as T) };
    entry.value = load().then(
      (value) => {
        entry.settled = true;
        entry.at = Date.now();
        if (graceMs > 0) {
          lasts.set(key, { at: entry.at, value });
          trim(lasts);
        }
        return value;
      },
      (error: unknown) => {
        entry.settled = true;
        entry.at = Date.now();
        // The source stumbles now and then. A recent answer, which says how old it is, serves a rider better than an error.
        const last = lasts.get(key);
        if (last && Date.now() - last.at < graceMs) return last.value;
        // Only this entry is dropped: a newer one for the same key may already be waiting on its own answer.
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      },
    );
    entries.set(key, entry);
    trim(entries);
    return entry.value;
  };
}
