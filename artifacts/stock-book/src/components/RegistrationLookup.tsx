import { forwardRef, useCallback, useEffect, useRef, useState, type FocusEventHandler } from "react";
import { useLookupVehicle, type VehicleLookup } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";

export type RegistrationLookupFields = {
  make?: string | null;
  model?: string | null;
  vin?: string | null;
  colour?: string | null;
  description?: string | null;
};

export type RegistrationLookupFill = {
  [K in keyof RegistrationLookupFields]?: string;
};

export function mapRegistrationLookupToPartExchange(values: RegistrationLookupFill): {
  partExchangeMake?: string;
  partExchangeModel?: string;
} {
  return {
    ...(values.make !== undefined ? { partExchangeMake: values.make } : {}),
    ...(values.model !== undefined ? { partExchangeModel: values.model } : {}),
  };
}

export function normalizeRegistration(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function registrationLookupKey(value: string): string {
  return normalizeRegistration(value).replace(/\s/g, "");
}

export function isValidRegistration(value: string): boolean {
  const key = registrationLookupKey(value);
  return /^[A-Z0-9]{2,7}$/.test(key) && /[A-Z]/.test(key) && /[0-9]/.test(key);
}

type RegistrationLookupProps = {
  value: string;
  onChange: (value: string) => void;
  fields: RegistrationLookupFields;
  onFill: (values: RegistrationLookupFill) => void;
  /** PX forms deliberately expose only the make and model returned by the service. */
  partExchange?: boolean;
  /** Prevent requests while a containing dialog is closed. */
  active?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  name?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
  onBlur?: FocusEventHandler<HTMLInputElement>;
};

type LookupStatus = "idle" | "loading" | "success" | "partial" | "not-found" | "error" | "preserved";

function returnedValues(result: VehicleLookup, partExchange: boolean): RegistrationLookupFill {
  const values: RegistrationLookupFill = {};
  if (result.make != null && !partExchange) values.make = result.make;
  if (result.make != null && partExchange) values.make = result.make;
  if (result.model != null) values.model = result.model;
  if (!partExchange) {
    if (result.vin != null) values.vin = result.vin;
    if (result.colour != null) values.colour = result.colour;
    if (result.description != null) values.description = result.description;
  }
  return values;
}

export const RegistrationLookup = forwardRef<HTMLInputElement, RegistrationLookupProps>(function RegistrationLookup({
  value,
  onChange,
  fields,
  onFill,
  partExchange = false,
  active = true,
  required = false,
  className,
  id,
  name,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  onBlur: externalOnBlur,
}, ref) {
  const lookup = useLookupVehicle();
  const [status, setStatus] = useState<LookupStatus>("idle");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pendingResult, setPendingResult] = useState<{ registration: string; values: RegistrationLookupFill } | null>(null);
  const mounted = useRef(true);
  const activeRef = useRef(active);
  const sequence = useRef(0);
  const lastRequested = useRef("");
  const latestFields = useRef(fields);
  const latestOnFill = useRef(onFill);
  const latestValue = useRef(value);
  const userChanged = useRef(false);
  const inFlight = useRef(false);

  // Keep this synchronous with rendering so a response cannot land in the
  // small interval before the active-state effect runs when a dialog closes.
  activeRef.current = active;
  latestFields.current = fields;
  latestOnFill.current = onFill;
  latestValue.current = value;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      sequence.current += 1;
      inFlight.current = false;
      lastRequested.current = "";
      userChanged.current = false;
      setStatus("idle");
      setMessage("");
      setWarnings([]);
      setPendingResult(null);
    } else {
      // Hydrating or reopening a form must not count as entering a registration.
      userChanged.current = false;
      lastRequested.current = registrationLookupKey(latestValue.current);
    }
  }, [active]);

  const performLookup = useCallback(async () => {
    if (!activeRef.current || inFlight.current) return;
    const registration = registrationLookupKey(latestValue.current);
    if (!isValidRegistration(latestValue.current)) {
      setStatus("idle");
      setMessage("");
      setWarnings([]);
      setPendingResult(null);
      return;
    }

    const requestSequence = ++sequence.current;
    inFlight.current = true;
    lastRequested.current = registration;
    setStatus("loading");
    setMessage("");
    setWarnings([]);
    setPendingResult(null);
    try {
      const result = await lookup.mutateAsync({ data: { registrationNumber: registration } });
      if (!mounted.current || !activeRef.current || requestSequence !== sequence.current) return;
      if (registrationLookupKey(latestValue.current) !== registration) return;

      const values = returnedValues(result, partExchange);
      const nonBlankExisting = Object.keys(values).some((key) => {
        const current = latestFields.current[key as keyof RegistrationLookupFields];
        return typeof current === "string" ? current.trim() !== "" : current != null;
      });
      const emptyOnly = Object.fromEntries(
        Object.entries(values).filter(([key]) => {
          const current = latestFields.current[key as keyof RegistrationLookupFields];
          return current == null || (typeof current === "string" && current.trim() === "");
        }),
      ) as RegistrationLookupFill;
      if (Object.keys(emptyOnly).length > 0) latestOnFill.current(emptyOnly);

      setWarnings(result.warnings ?? []);
      setPendingResult({ registration, values });
      if (Object.keys(values).length === 0) {
        setStatus("not-found");
        setMessage("No vehicle details were returned. You can enter the details manually.");
      } else if (nonBlankExisting) {
        setStatus("preserved");
        setMessage("Existing details were kept. Review the result, then choose Replace existing details if appropriate.");
      } else if (Object.keys(values).length < (partExchange ? 2 : 5)) {
        setStatus("partial");
        setMessage("Some details were returned. Missing details remain available for manual entry.");
      } else {
        setStatus("success");
        setMessage("Details filled from Rapid Car Check. Please review them before saving.");
      }
    } catch (error: any) {
      if (!mounted.current || !activeRef.current || requestSequence !== sequence.current) return;
      if (registrationLookupKey(latestValue.current) !== registration) return;
      const notFound = error?.status === 404 || error?.response?.status === 404;
      setStatus(notFound ? "not-found" : "error");
      setMessage(notFound
        ? "No vehicle details were found. You can enter the details manually."
        : error?.data?.error ?? error?.error ?? error?.message ?? "Lookup failed. Check the registration and try again.");
      setWarnings([]);
      setPendingResult(null);
    } finally {
      if (requestSequence === sequence.current) inFlight.current = false;
    }
  }, [lookup, partExchange]);

  const handleChange = (next: string) => {
    sequence.current += 1;
    inFlight.current = false;
    userChanged.current = true;
    setStatus("idle");
    setMessage("");
    setWarnings([]);
    setPendingResult(null);
    onChange(normalizeRegistration(next));
  };

  const handleReplace = () => {
    if (!pendingResult || registrationLookupKey(latestValue.current) !== pendingResult.registration) return;
    latestOnFill.current(pendingResult.values);
    setStatus("success");
    setMessage("Returned details applied. Please review them before saving.");
    setPendingResult(null);
  };

  const statusClass = status === "error" || status === "not-found"
    ? "text-red-600"
    : status === "loading"
      ? "text-slate-500"
      : "text-slate-600";

  return (
    <div className={className}>
      <div className="flex gap-2">
        <Input
          ref={ref}
          id={id}
          name={name}
          value={value}
          required={required}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={(event) => {
            externalOnBlur?.(event);
            if (userChanged.current && isValidRegistration(value) && registrationLookupKey(value) !== lastRequested.current) void performLookup();
          }}
          className="uppercase"
          aria-label="Registration number"
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
        />
        <Button type="button" variant="outline" onClick={() => void performLookup()} disabled={status === "loading" || !isValidRegistration(value)}>
          {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {status === "error" ? "Retry" : "Look up"}
        </Button>
      </div>
      {status !== "idle" && (
        <p className={`text-xs ${statusClass}`} role="status">
          {status === "loading" ? "Looking up vehicle details…" : message}
        </p>
      )}
      {pendingResult && status === "preserved" && (
        <>
          <p className="text-xs text-slate-600">
            Returned details: {Object.entries(pendingResult.values).map(([key, result]) => `${key} ${result}`).join(" · ")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={handleReplace}>
            Replace existing details
          </Button>
        </>
      )}
      {warnings.map((warning, index) => (
        <p key={`${warning}-${index}`} className="text-xs text-amber-700">{warning}</p>
      ))}
      {status !== "idle" && (
        <p className="text-xs text-slate-500">
          {partExchange
            ? "Only make and model are looked up here. Mileage remains manual."
            : "Please review VIN and other details before saving. Mileage remains manual."}{" "}
          <a className="underline" href="https://www.rapidcarcheck.co.uk/" target="_blank" rel="noreferrer">
            Powered by Rapid Car Check
          </a>
        </p>
      )}
      {status === "idle" && (
        <p className="text-xs text-slate-500">
          {partExchange ? "Only make and model are looked up here. Mileage remains manual. " : "Review VIN and details before saving; mileage remains manual. "}
          <a className="underline" href="https://www.rapidcarcheck.co.uk/" target="_blank" rel="noreferrer">
            Powered by Rapid Car Check
          </a>
        </p>
      )}
    </div>
  );
});
RegistrationLookup.displayName = "RegistrationLookup";