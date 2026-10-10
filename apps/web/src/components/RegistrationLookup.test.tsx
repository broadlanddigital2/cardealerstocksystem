import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { StrictMode, useState } from "react";
import {
  mapRegistrationLookupToPartExchange,
  RegistrationLookup,
  isValidRegistration,
  normalizeRegistration,
} from "./RegistrationLookup";

const mutateAsync = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useLookupVehicle: () => ({ mutateAsync }),
}));

function renderLookup(
  value = "",
  fields: { make?: string; model?: string } = {},
  onChange = vi.fn(),
  onFill = vi.fn(),
) {
  function Harness() {
    const [current, setCurrent] = useState(value);
    return (
      <RegistrationLookup
        value={current}
        fields={fields}
        onChange={(next) => {
          setCurrent(next);
          onChange(next);
        }}
        onFill={onFill}
      />
    );
  }
  return {
    onChange,
    onFill,
    ...render(<Harness />),
  };
}

describe("RegistrationLookup", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("normalizes registrations and only accepts mixed alphanumeric values", () => {
    expect(normalizeRegistration(" ab12   cde ")).toBe("AB12 CDE");
    expect(isValidRegistration("AB12 CDE")).toBe(true);
    expect(isValidRegistration("ABCDE")).toBe(false);
    expect(isValidRegistration("12345678")).toBe(false);
  });

  it("maps PX lookup fields to the existing sale state names", () => {
    expect(mapRegistrationLookupToPartExchange({ make: "Ford", model: "Fiesta", vin: "ignored" }))
      .toEqual({ partExchangeMake: "Ford", partExchangeModel: "Fiesta" });
  });

  it("does not look up a prefilled value until the user changes it or presses the button", async () => {
    mutateAsync.mockResolvedValue({ make: "Ford", model: "Fiesta", vin: null, colour: null, description: null, warnings: [] });
    const view = renderLookup("AB12 CDE");
    fireEvent.blur(screen.getByRole("textbox"));
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ data: { registrationNumber: "AB12CDE" } }));
    view.unmount();
  });

  it("looks up on blur after a changed registration", async () => {
    mutateAsync.mockResolvedValue({ make: "Ford", model: "Fiesta", vin: null, colour: null, description: null, warnings: [] });
    const { onChange } = renderLookup();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "ab12 cde" } });
    fireEvent.blur(input);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ data: { registrationNumber: "AB12CDE" } }));
  });

  it("preserves entered details and offers an explicit replacement", async () => {
    mutateAsync.mockResolvedValue({ make: "Ford", model: "Fiesta", vin: "VIN", colour: "Blue", description: "Details", warnings: [] });
    const { onFill } = renderLookup("", { make: "My make" });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "AB12CDE" } });
    expect(input).toHaveProperty("value", "AB12CDE");
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    await waitFor(() => expect(onFill).toHaveBeenCalledWith({ model: "Fiesta", vin: "VIN", colour: "Blue", description: "Details" }));
    expect(screen.getByText(/existing details were kept/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /replace existing details/i }));
    expect(onFill).toHaveBeenLastCalledWith({ make: "Ford", model: "Fiesta", vin: "VIN", colour: "Blue", description: "Details" });
  });

  it("ignores a response for an older registration", async () => {
    let requestNumber = 0;
    mutateAsync.mockImplementation((_args?: unknown) => new Promise((resolve) => {
      const isOld = requestNumber++ === 0;
      setTimeout(() => resolve({
        make: isOld ? "Old" : "New",
        model: "Car",
        vin: null,
        colour: null,
        description: null,
        warnings: [],
      }), isOld ? 20 : 0);
    }));
    const { onFill } = renderLookup();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "AB12CDE" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "XY34ZZZ" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onFill).toHaveBeenCalledWith({ make: "New", model: "Car" }));
    expect(onFill).not.toHaveBeenCalledWith({ make: "Old", model: "Car" });
  });

  it("accepts a response after StrictMode effect replay", async () => {
    mutateAsync.mockResolvedValue({ make: "Ford", model: "Fiesta", vin: null, colour: null, description: null, warnings: [] });
    function StrictHarness() {
      const [current, setCurrent] = useState("AB12 CDE");
      return (
        <RegistrationLookup
          value={current}
          onChange={setCurrent}
          fields={{}}
          onFill={vi.fn()}
        />
      );
    }
    render(
      <StrictMode>
        <StrictHarness />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/returned|filled/i));
  });
});