import { createHash } from "node:crypto";
import type { VehicleLookup } from "@workspace/api-zod";

const ENDPOINT = "https://www.rapidcarcheck.co.uk/api/";
const CACHE_TTL = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class VehicleLookupError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VehicleLookupError";
  }
}

export function normaliseRegistration(value: string): string {
  const registration = value.toUpperCase().replace(/\s/g, "");
  // Supports current, suffix/prefix, cherished and Northern Irish registrations.
  if (!/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{2,7}$/.test(registration)) {
    throw new VehicleLookupError(400, "Enter a valid UK registration using letters and numbers.");
  }
  return registration;
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const result = value.trim();
    if (
      !result || result.length > 300 ||
      /^(?:[.\s…*\-]+|n\/?a|none|null|undefined|unknown|not (?:available|provided|known|found)|unavailable|redacted)$/i.test(result) ||
      /<[^>]*>/.test(result)
    ) continue;
    return result;
  }
  return null;
}

function providerError(message: unknown): VehicleLookupError {
  // Classify internally, but NEVER send provider text to clients: it may echo credentials.
  const value = typeof message === "string" ? message : "";
  if (/quota|allowance|limit|credit|subscription|plan.*exceed/i.test(value)) {
    return new VehicleLookupError(429, "Rapid Car Check's lookup allowance has been reached. Check your plan or enter the details manually.");
  }
  if (/key|domain|authori[sz]|forbidden|access|enabled/i.test(value)) {
    return new VehicleLookupError(503, "Rapid Car Check has not authorised the lookup. Check the API key, registered domain and active plan.");
  }
  if (/not found|no (?:vehicle|result)|invalid.*(?:plate|vrm|registration)/i.test(value)) {
    return new VehicleLookupError(404, "No vehicle details were found for this registration. Check the registration or enter the details manually.");
  }
  return new VehicleLookupError(502, "Rapid Car Check could not return vehicle details. You can retry or enter them manually.");
}

export function parseRapidCarCheck(data: unknown, requestedRegistration: string): VehicleLookup {
  const registrationNumber = normaliseRegistration(requestedRegistration);
  const root = record(data);
  if (root.HasError === true) throw providerError(root.ErrorMessage);
  const results = record(root.Results);
  if (results.HasVehicleResults === false) {
    throw new VehicleLookupError(404, "No vehicle details were found for this registration. You can enter them manually.");
  }
  const initial = record(results.InitialVehicleCheckModel);
  // The live endpoint nests the usable fields here; some plans return them directly in InitialVehicleCheckModel.
  const basic = record(initial.BasicVehicleDetailsModel);
  const returnedVrm = text(initial.Vrm, basic.Vrm, basic.RegistrationNumber);
  if (returnedVrm && returnedVrm.toUpperCase().replace(/\s/g, "") !== registrationNumber) {
    throw new VehicleLookupError(502, "Rapid Car Check returned a different registration. No details have been applied.");
  }
  const make = text(basic.Make, initial.Make);
  const model = text(basic.Model, initial.Model);
  const colour = text(basic.Colour, initial.Colour);
  const rawVin = text(basic.Vin, initial.Vin, basic.VIN, initial.VIN)?.toUpperCase();
  // Do not place masked/partial placeholder VINs in stock records.
  const vin = rawVin && /^[A-HJ-NPR-Z0-9]{6,17}$/.test(rawVin) && !/X{4,}/.test(rawVin) ? rawVin : null;
  const engine = text(basic.CylinderCapacity, initial.CylinderCapacity);
  const fuel = text(basic.FuelType, initial.FuelType);
  const body = text(basic.BodyStyle, initial.BodyStyle);
  const spec = text(basic.VehicleDescription, basic.Description, basic.Derivative, initial.Description);
  const description = spec ?? (Array.from(new Set([
    model,
    engine && !/^0\s*(?:cc|l)?$/i.test(engine) ? engine : null,
    fuel,
    body,
  ].filter((part): part is string => !!part))).join(" · ") || null);
  if (!make && !model && !colour && !vin) {
    throw new VehicleLookupError(502, "Rapid Car Check returned no usable vehicle details. Try again or enter them manually.");
  }
  const missing = [
    !make && "make", !model && "model", !vin && "VIN", !colour && "colour", !description && "description",
  ].filter(Boolean);
  return {
    registrationNumber, make, model, vin, colour, description,
    warnings: [
      ...(missing.length ? [`Not supplied by Rapid Car Check: ${missing.join(", ")}. Enter these details manually.`] : []),
      "Check the VIN against the vehicle or V5C. Mileage must be entered from the vehicle; MOT and estimated mileages are not used.",
    ],
  };
}

async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new VehicleLookupError(502, "Rapid Car Check returned an unexpectedly large response.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new VehicleLookupError(502, "Rapid Car Check returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new VehicleLookupError(502, "Rapid Car Check returned an unexpectedly large response.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}

interface LookupOptions {
  apiKey?: string;
  domain?: string;
  fetcher?: typeof fetch;
}

// Per-instance bounded cache and in-flight coalescing reduce chargeable duplicate calls.
// Failures are not cached so staff can retry after correcting account configuration.
export function createRapidCarCheckLookup(options: LookupOptions = {}) {
  const cache = new Map<string, { expires: number; value: VehicleLookup }>();
  const pending = new Map<string, Promise<VehicleLookup>>();
  let windowStart = 0;
  let windowCount = 0;

  return async (input: string): Promise<VehicleLookup> => {
    const registration = normaliseRegistration(input);
    const apiKey = options.apiKey ?? process.env.RAPID_CAR_CHECK_API_KEY;
    const domain = options.domain ?? process.env.RAPID_CAR_CHECK_DOMAIN ?? "motormetric-mg.co.uk";
    if (!apiKey?.trim()) {
      throw new VehicleLookupError(503, "Registration lookup is not configured. You can still enter vehicle details manually.");
    }
    // A credentials change must not serve stale authorisation/cache results.
    const key = createHash("sha256").update(`${apiKey}\0${domain}\0${registration}`).digest("hex");
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expires > now) return structuredClone(cached.value);
    cache.delete(key);
    const existing = pending.get(key);
    if (existing) return structuredClone(await existing);
    if (now - windowStart >= 60_000) {
      windowStart = now;
      windowCount = 0;
    }
    if (windowCount >= 30 || pending.size >= 4) {
      throw new VehicleLookupError(429, "Too many registration lookups. Wait a minute and try again.");
    }
    windowCount++;
    const request = (async () => {
      const url = new URL(ENDPOINT);
      url.searchParams.set("key", apiKey.trim());
      url.searchParams.set("domain", domain);
      url.searchParams.set("plate", registration);
      const signal = AbortSignal.timeout(20_000);
      try {
        const response = await (options.fetcher ?? fetch)(url, {
          signal,
          redirect: "error",
          headers: { Accept: "application/json" },
        });
        const status = response.status;
        if (status !== 200 && status !== 206) {
          await response.body?.cancel();
          if (status === 204 || status === 404) throw providerError("vehicle not found");
          if (status === 401 || status === 403) throw providerError("not authorised");
          if (status === 429) throw providerError("quota reached");
          if (status === 202) throw new VehicleLookupError(503, "Rapid Car Check is still processing this vehicle. Please retry shortly.");
          throw new VehicleLookupError(503, "Rapid Car Check is temporarily unavailable. Please retry or enter the details manually.");
        }
        const value = parseRapidCarCheck(await readJson(response), registration);
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now() + CACHE_TTL, value });
        return value;
      } catch (error) {
        if (error instanceof VehicleLookupError) throw error;
        // Do not log or propagate a fetch error/cause: it can contain the URL/API key.
        if (signal.aborted) throw new VehicleLookupError(504, "Rapid Car Check timed out. Please retry or enter the details manually.");
        throw new VehicleLookupError(502, "Unable to read vehicle details from Rapid Car Check. Please retry or enter them manually.");
      }
    })();
    pending.set(key, request);
    try {
      return structuredClone(await request);
    } finally {
      pending.delete(key);
    }
  };
}

export const lookupRapidCarCheck = createRapidCarCheckLookup();