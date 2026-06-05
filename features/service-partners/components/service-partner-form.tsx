"use client";

import { useEffect, useMemo, useState } from "react";

import { ServicePartnerStatus } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";

type CityOption = {
  id: string;
  name: string;
};

type StateOption = {
  id: string;
  name: string;
  code: string | null;
  cities: CityOption[];
};

type ServicePartnerFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  errorMessage?: string;
  states: StateOption[];
  servicePartner?: {
    code: string;
    name: string;
    legalName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postalCode: string | null;
    status: ServicePartnerStatus;
  };
};

function normalizeLocationValue(value?: string | null) {
  return value?.trim() || "";
}

function findStateByName(states: StateOption[], value?: string | null) {
  const normalizedValue = normalizeLocationValue(value).toLowerCase();
  if (!normalizedValue) {
    return undefined;
  }

  return states.find((state) => state.name.trim().toLowerCase() === normalizedValue);
}

function findCityByName(cities: CityOption[], value?: string | null) {
  const normalizedValue = normalizeLocationValue(value).toLowerCase();
  if (!normalizedValue) {
    return undefined;
  }

  return cities.find((city) => city.name.trim().toLowerCase() === normalizedValue);
}

export function ServicePartnerForm({ action, cancelHref, errorMessage, states, servicePartner }: ServicePartnerFormProps) {
  const initialStateValue = normalizeLocationValue(servicePartner?.state);
  const initialCityValue = normalizeLocationValue(servicePartner?.city);

  const [selectedState, setSelectedState] = useState(() => findStateByName(states, initialStateValue)?.name ?? initialStateValue);
  const [selectedCity, setSelectedCity] = useState(() => {
    const initialState = findStateByName(states, initialStateValue);
    return findCityByName(initialState?.cities ?? [], initialCityValue)?.name ?? initialCityValue;
  });

  const selectedStateRecord = useMemo(() => findStateByName(states, selectedState), [selectedState, states]);

  const stateOptions = useMemo(() => {
    if (!selectedState || selectedStateRecord) {
      return states;
    }

    return [
      {
        id: `legacy-state:${selectedState}`,
        name: selectedState,
        code: null,
        cities: [],
      },
      ...states,
    ];
  }, [selectedState, selectedStateRecord, states]);

  const cityOptions = useMemo(() => {
    const baseCities = selectedStateRecord?.cities ?? [];
    if (!selectedCity || findCityByName(baseCities, selectedCity)) {
      return baseCities;
    }

    return [
      {
        id: `legacy-city:${selectedCity}`,
        name: selectedCity,
      },
      ...baseCities,
    ];
  }, [selectedCity, selectedStateRecord]);

  useEffect(() => {
    if (!selectedState) {
      if (selectedCity) {
        setSelectedCity("");
      }
      return;
    }

    if (!selectedStateRecord) {
      return;
    }

    if (selectedCity && !findCityByName(selectedStateRecord.cities, selectedCity)) {
      setSelectedCity("");
    }
  }, [selectedCity, selectedState, selectedStateRecord]);

  const isLegacyState = Boolean(selectedState) && !selectedStateRecord;
  const isLegacyCity =
    Boolean(selectedCity) &&
    (!selectedStateRecord || !findCityByName(selectedStateRecord.cities, selectedCity));

  return (
    <form action={action} className="space-y-5 rounded-md border border-[var(--border)] bg-white p-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Code</span>
          <input
            name="code"
            defaultValue={servicePartner?.code ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={30}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={servicePartner?.status ?? ServicePartnerStatus.ACTIVE}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {Object.values(ServicePartnerStatus).map((status) => (
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
            defaultValue={servicePartner?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={160}
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Legal name</span>
          <input
            name="legalName"
            defaultValue={servicePartner?.legalName ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={160}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={servicePartner?.email ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Phone</span>
          <input
            name="phone"
            defaultValue={servicePartner?.phone ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={30}
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Address</span>
          <textarea
            name="address"
            defaultValue={servicePartner?.address ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={300}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">State</span>
          <select
            name="state"
            value={selectedState}
            onChange={(event) => setSelectedState(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="">Select state</option>
            {stateOptions.map((state) => (
              <option key={state.id} value={state.name}>
                {state.name}
              </option>
            ))}
          </select>
          {isLegacyState ? <p className="text-xs text-amber-700">Current state is a legacy value outside the reference list.</p> : null}
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">City</span>
          <select
            name="city"
            value={selectedCity}
            onChange={(event) => setSelectedCity(event.target.value)}
            disabled={!selectedState}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 disabled:bg-slate-50"
          >
            <option value="">{selectedState ? "Select city" : "Select state first"}</option>
            {cityOptions.map((city) => (
              <option key={city.id} value={city.name}>
                {city.name}
              </option>
            ))}
          </select>
          {isLegacyCity ? <p className="text-xs text-amber-700">Current city is a legacy value outside the selected state&apos;s reference list.</p> : null}
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Country</span>
          <input
            name="country"
            defaultValue={servicePartner?.country ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Postal code</span>
          <input
            name="postalCode"
            defaultValue={servicePartner?.postalCode ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={20}
          />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={servicePartner ? "Update service partner" : "Create service partner"} />
    </form>
  );
}
