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
  if (!key) {
    console.error("[croma] Set CROMA_API_KEY in .env.local.");
    throw new CromaError("missing_api_key", "The transit source is not configured.", 500);
  }

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
    const code = failed.success ? failed.data.error.code : `http_${res.status}`;
    // The source's own wording stays in the log; riders and callers get a code and a plain sentence.
    console.error("[croma]", endpoint, res.status, code, failed.success ? failed.data.error.message : res.statusText);
    throw new CromaError(code, "Croma could not answer.");
  }

  const parsed = schema.safeParse((json as { data?: unknown } | null)?.data);
  if (!parsed.success) {
    console.error("[croma]", endpoint, "unexpected shape", parsed.error.issues.slice(0, 3));
    throw new CromaError("unexpected_response", "Croma answered in an unexpected way.");
  }
  return parsed.data;
}

export function isLive(asOf: string, live: boolean | undefined): boolean {
  if (live === false) return false;
  return Date.now() - Date.parse(asOf) <= STALE_AFTER_MS;
}

/** One answer per key for `ttlMs`, shared by every rider on this instance, joining a request already in flight. */
export function cached<T>(ttlMs: number, graceMs = 0) {
  const entries = new Map<string, { at: number; value: Promise<T>; last?: { at: number; value: T } }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const last = hit?.last;
    const entry: { at: number; value: Promise<T>; last?: { at: number; value: T } } = { at: Date.now(), value: Promise.resolve(undefined as T), last };
    entry.value = load().then(
      (value) => {
        entry.last = { at: Date.now(), value };
        return value;
      },
      (error: unknown) => {
        // The source stumbles now and then. A recent answer, which says how old it is, serves a rider better than an error.
        if (last && Date.now() - last.at < graceMs) return last.value;
        entries.delete(key);
        throw error;
      },
    );
    entries.set(key, entry);
    if (entries.size > 2_000) entries.delete(entries.keys().next().value as string);
    return entry.value;
  };
}
