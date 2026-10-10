import { describe, expect, it, vi } from "vitest";
import {
  createRapidCarCheckLookup,
  normaliseRegistration,
  parseRapidCarCheck,
  VehicleLookupError,
} from "../lib/rapidCarCheck";

const observedResponse = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const vehiclePayload = (overrides: Record<string, unknown> = {}) => ({
  Results: {
    HasVehicleResults: true,
    InitialVehicleCheckModel: {
      Vrm: "AB12 CDE",
      BasicVehicleDetailsModel: {
        Make: "Example Motors",
        Model: "Roadster",
        Colour: "Blue",
        Vin: "WVWZZZ1JZXW000001",
        CylinderCapacity: "1,998 cc",
        FuelType: "Petrol",
        BodyStyle: "Hatchback",
        ...overrides,
      },
    },
  },
});

function expectLookupError(action: () => unknown, status: number) {
  expect(action).toThrowError(VehicleLookupError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ status });
  }
}

describe("Rapid Car Check response parsing", () => {
  it("reads the live nested BasicVehicleDetailsModel shape", () => {
    const details = parseRapidCarCheck(vehiclePayload(), "AB12 CDE");

    expect(details).toMatchObject({
      registrationNumber: "AB12CDE",
      make: "Example Motors",
      model: "Roadster",
      colour: "Blue",
      vin: "WVWZZZ1JZXW000001",
      description: "Roadster · 1,998 cc · Petrol · Hatchback",
    });
    expect(details.warnings.join(" ")).toContain("Mileage must be entered from the vehicle");
    expect(details).not.toHaveProperty("mileage");
    expect(details).not.toHaveProperty("averageMileage");
    expect(details).not.toHaveProperty("motMileage");
  });

  it.each([
    ["modern", "AB12 CDE", "AB12CDE"],
    ["prefix", "A123 BCD", "A123BCD"],
    ["Northern Irish", "1234 AB", "1234AB"],
    ["cherished", "1 A", "1A"],
    ["suffix", "ABC 1234", "ABC1234"],
  ])("normalises %s registrations", (_name, input, expected) => {
    expect(normaliseRegistration(input)).toBe(expected);
  });

  it.each(["", "   ", "ABC", "1234567", "AB<script>1</script>", "CAZOO", "AB12;DROP TABLE"])(
    "rejects unsafe or invalid registration %j",
    (input) => expectLookupError(() => normaliseRegistration(input), 400),
  );

  it("ignores placeholders and nulls rather than storing them", () => {
    const details = parseRapidCarCheck(
      vehiclePayload({
        Make: "Example Motors",
        Model: "N/A",
        Colour: null,
        Vin: "************",
        CylinderCapacity: "0 cc",
        FuelType: "unknown",
        BodyStyle: null,
      }),
      "AB12CDE",
    );

    expect(details.make).toBe("Example Motors");
    expect(details.model).toBeNull();
    expect(details.colour).toBeNull();
    expect(details.vin).toBeNull();
    expect(details.description).toBeNull();
    expect(details).not.toHaveProperty("mileage");
    expect(details).not.toHaveProperty("averageMileage");
    expect(details).not.toHaveProperty("motMileage");
  });

  it("omits masked VINs while retaining other usable details", () => {
    const details = parseRapidCarCheck(
      vehiclePayload({ Vin: "XXXX123456789" }),
      "AB12CDE",
    );
    expect(details.vin).toBeNull();
    expect(details.make).toBe("Example Motors");
  });

  it("rejects a response for a different registration", () => {
    expectLookupError(
      () => parseRapidCarCheck(vehiclePayload(), "ZZ99ZZZ"),
      502,
    );
  });

  it("handles partial results and rejects no usable results", () => {
    const partial = parseRapidCarCheck(
      vehiclePayload({ Make: "Example Motors", Model: null, Colour: null, Vin: null }),
      "AB12CDE",
    );
    expect(partial.make).toBe("Example Motors");
    expect(partial.model).toBeNull();
    expect(partial.warnings.join(" ")).toMatch(/Not supplied.*model/i);

    expectLookupError(
      () => parseRapidCarCheck({ Results: { HasVehicleResults: false } }, "AB12CDE"),
      404,
    );
    expectLookupError(
      () => parseRapidCarCheck({ Results: { HasVehicleResults: true } }, "AB12CDE"),
      502,
    );
  });

  it.each([
    [{ HasError: true, ErrorMessage: "quota exceeded for key SECRET" }, 429],
    [{ HasError: true, ErrorMessage: "not authorised" }, 503],
    [{ HasError: true, ErrorMessage: "vehicle not found" }, 404],
  ])("maps provider error flags without exposing provider text", (payload, status) => {
    expectLookupError(() => parseRapidCarCheck(payload, "AB12CDE"), status);
    try {
      parseRapidCarCheck(payload, "AB12CDE");
    } catch (error) {
      expect((error as Error).message).not.toContain("SECRET");
    }
  });
});

describe("Rapid Car Check HTTP boundary", () => {
  it.each([
    [403, 503],
    [429, 429],
    [202, 503],
    [204, 404],
  ])("maps HTTP %s to a safe lookup error", async (status, expectedStatus) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(observedResponse({}, status));
    await expect(createRapidCarCheckLookup({ apiKey: "test-key", fetcher })("AB12CDE"))
      .rejects.toMatchObject({ status: expectedStatus });
  });

  it("redacts malformed JSON and network error causes", async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{ definitely-not-json", { status: 200 }),
    );
    try {
      await createRapidCarCheckLookup({ apiKey: "secret-key", fetcher: malformed })("AB12CDE");
      throw new Error("expected malformed JSON to fail");
    } catch (error) {
      expect(error).toMatchObject({ status: 502 });
      expect((error as Error).message).not.toMatch(/secret-key|definitely-not-json/i);
    }

    const network = vi.fn<typeof fetch>().mockRejectedValue(
      new Error("https://rapidcarcheck.co.uk/api/?key=secret-key leaked"),
    );
    try {
      await createRapidCarCheckLookup({ apiKey: "secret-key", fetcher: network })("AB12CDE");
      throw new Error("expected network failure");
    } catch (error) {
      expect(error).toMatchObject({ status: 502 });
      expect((error as Error).message).not.toMatch(/secret-key|rapidcarcheck/i);
    }
  });

  it("coalesces simultaneous requests and serves subsequent calls from cache", async () => {
    let resolveResponse!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(
      new Promise((resolve) => { resolveResponse = resolve; }),
    );
    const lookup = createRapidCarCheckLookup({ apiKey: "test-key", fetcher });
    const first = lookup("AB12CDE");
    const second = lookup("AB12 CDE");
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveResponse(observedResponse(vehiclePayload()));
    await Promise.all([first, second]);
    await lookup("AB12CDE");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});