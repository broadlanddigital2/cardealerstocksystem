/** An on/off switch that works as a normal checkbox in a form. */
export function Toggle({
  name,
  value,
  defaultChecked,
  label,
  disabled,
}: {
  name?: string;
  value?: string;
  defaultChecked?: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`relative inline-flex shrink-0 items-center ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        disabled={disabled}
        aria-label={label}
        className="peer sr-only"
      />
      <span className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-green-600 peer-focus-visible:ring-2 peer-focus-visible:ring-slate-400" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
    </label>
  );
}
