type ConfirmActionProps = {
  action: (formData: FormData) => void | Promise<void>;
  label: string;
  intent?: "default" | "danger";
  fields?: Record<string, string>;
};

export function ConfirmAction({ action, label, intent = "default", fields }: ConfirmActionProps) {
  const className =
    intent === "danger"
      ? "crm-button-danger w-full sm:w-auto"
      : "crm-button-secondary w-full sm:w-auto";

  return (
    <form action={action} className="w-full sm:w-auto">
      {fields
        ? Object.entries(fields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)
        : null}
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
