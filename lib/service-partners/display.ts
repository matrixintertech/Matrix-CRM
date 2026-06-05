type ServicePartnerLabelSource = {
  code?: string | null;
  companyName?: string | null;
  legalName?: string | null;
  name?: string | null;
  servicePartnerName?: string | null;
};

function firstNonEmpty(values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

export function getServicePartnerPrimaryName(source: ServicePartnerLabelSource) {
  return (
    firstNonEmpty([source.name, source.companyName, source.servicePartnerName, source.legalName, source.code]) ??
    "Unnamed service partner"
  );
}

export function getServicePartnerDisplayLabel(source: ServicePartnerLabelSource) {
  const primary = getServicePartnerPrimaryName(source);
  const code = source.code?.trim();

  if (!code || code === primary) {
    return primary;
  }

  return `${primary} (${code})`;
}
