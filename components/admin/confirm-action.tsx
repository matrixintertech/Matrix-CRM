type ConfirmActionProps = {
  action: (formData: FormData) => void | Promise<void>;
  label: string;
  intent?: "default" | "danger";
  fields?: Record<string, string>;
};

export function ConfirmAction({ action, label, intent = "default", fields }: ConfirmActionProps) {
  const className =
    intent === "danger"
      ? "rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      : "rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";

  return (
    <form action={action}>
      {fields
        ? Object.entries(fields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)
        : null}
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
