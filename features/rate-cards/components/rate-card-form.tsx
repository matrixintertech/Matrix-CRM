"use client";

import { RateCardStatus } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";
import { RateCardLinesForm } from "@/features/rate-cards/components/rate-card-lines-form";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type ClientOption = {
  id: string;
  code: string;
  name: string;
  servicePartnerId: string;
};

type ItemOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  active: boolean;
  servicePartnerId: string;
};

type RateCardFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  clients: ClientOption[];
  items: ItemOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  rateCard?: {
    servicePartnerId: string;
    clientId: string | null;
    code: string;
    name: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: RateCardStatus;
    lines: Array<{
      itemId: string;
      rate: string;
      taxPercent?: string;
    }>;
  };
};

export function RateCardForm({
  action,
  cancelHref,
  servicePartners,
  clients,
  items,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  rateCard,
}: RateCardFormProps) {
  const initialServicePartnerId = rateCard?.servicePartnerId ?? defaultServicePartnerId ?? servicePartners[0]?.id ?? "";
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(initialServicePartnerId);

  const filteredClients = useMemo(
    () => clients.filter((client) => client.servicePartnerId === selectedServicePartnerId),
    [clients, selectedServicePartnerId]
  );
  const filteredItems = useMemo(
    () => items.filter((item) => item.servicePartnerId === selectedServicePartnerId),
    [items, selectedServicePartnerId]
  );

  const initialClientId = rateCard?.clientId ?? "";
  const [selectedClientId, setSelectedClientId] = useState(initialClientId);

  useEffect(() => {
    if (selectedClientId === "") {
      return;
    }
    if (filteredClients.some((client) => client.id === selectedClientId)) {
      return;
    }
    setSelectedClientId("");
  }, [filteredClients, selectedClientId]);

  const filteredInitialLines = useMemo(
    () =>
      rateCard?.lines.filter((line) => filteredItems.some((item) => item.id === line.itemId)),
    [rateCard?.lines, filteredItems]
  );

  return (
    <form action={action} className="crm-form-shell space-y-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Service partner</span>
          <select
            name="servicePartnerId"
            value={selectedServicePartnerId}
            onChange={(event) => setSelectedServicePartnerId(event.target.value)}
            disabled={!canChooseServicePartner}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 disabled:bg-slate-50"
          >
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {getServicePartnerDisplayLabel(partner)}
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={selectedServicePartnerId} /> : null}
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Code</span>
          <input
            name="code"
            defaultValue={rateCard?.code ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={40}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select name="status" defaultValue={rateCard?.status ?? RateCardStatus.DRAFT} className="h-9 w-full rounded-md border border-[var(--border)] px-3">
            {Object.values(RateCardStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Name</span>
          <input
            name="name"
            defaultValue={rateCard?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Client (optional)</span>
          <select
            name="clientId"
            value={selectedClientId}
            onChange={(event) => setSelectedClientId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="">General rate card (no client)</option>
            {filteredClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.code})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Effective from</span>
          <input
            type="date"
            name="effectiveFrom"
            defaultValue={rateCard?.effectiveFrom ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Effective to</span>
          <input
            type="date"
            name="effectiveTo"
            defaultValue={rateCard?.effectiveTo ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
      </div>

      <RateCardLinesForm key={selectedServicePartnerId} itemOptions={filteredItems} initialLines={filteredInitialLines} />
      <FormActions cancelHref={cancelHref} submitLabel={rateCard ? "Update rate card" : "Create rate card"} />
    </form>
  );
}
