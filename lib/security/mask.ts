function maskEmail(email: string): string {
  const [localPart = "", domain = ""] = email.split("@");
  const localLead = localPart.slice(0, 1);
  const domainParts = domain.split(".");
  const domainName = domainParts[0] ?? "";
  const domainTail = domainParts.slice(1).join(".");

  const maskedLocal = `${localLead}${"*".repeat(Math.max(localPart.length - 1, 2))}`;
  const maskedDomain = domainName.length > 0 ? `${domainName.slice(0, 1)}***` : "***";

  return `${maskedLocal}@${maskedDomain}${domainTail ? `.${domainTail}` : ""}`;
}

function maskPhone(phone: string): string {
  const normalized = phone.trim();
  const suffixLength = Math.min(4, normalized.length);
  const suffix = normalized.slice(-suffixLength);
  const prefix = normalized.startsWith("+") ? "+" : "";
  const maskedBodyLength = Math.max(normalized.length - suffixLength - prefix.length, 4);

  return `${prefix}${"*".repeat(maskedBodyLength)}${suffix}`;
}

export function maskTarget(target: string): string {
  if (target.includes("@")) {
    return maskEmail(target);
  }

  return maskPhone(target);
}
