type ConfirmActionProps = {
  action: (formData: FormData) => void | Promise<void>;
  label: string;
  intent?: "default" | "danger";
  fields?: Record<string, string>;
};

export function ConfirmAction({ action, label, intent = "default", fields }: ConfirmActionProps) {
  const className =
    intent === "danger"
      ? "inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
      : "inline-flex h-10 items-center justify-center rounded-xl border border-[#cfdcf3] bg-white px-4 text-sm font-semibold text-[#2b4672] transition hover:bg-[#f5f8ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9e5ff]";

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
