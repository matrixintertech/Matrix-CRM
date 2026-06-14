"use client";

import { useMemo, useState } from "react";

import { ClientStatus } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";
import { SearchableSelect, type SearchableSelectOption } from "@/components/admin/searchable-select";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

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

type ClientFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  states: StateOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  client?: {
    servicePartnerId: string;
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
    status: ClientStatus;
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

function toSelectOption(value: string): SearchableSelectOption {
  return {
    value,
    label: value,
  };
}

export function ClientForm({
  action,
  cancelHref,
  servicePartners,
  states,
  canChooseServicePartner,
  errorMessage,
  client,
}: ClientFormProps) {
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(client?.servicePartnerId ?? servicePartners[0]?.id ?? "");
  const initialStateValue = normalizeLocationValue(client?.state);
  const initialCityValue = normalizeLocationValue(client?.city);
  const initialCountryValue = normalizeLocationValue(client?.country);
  const [manualCountry, setManualCountry] = useState(initialCountryValue);
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
  const availableCityOptions = useMemo(() => {
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
  const stateSelectOptions = useMemo(() => stateOptions.map((state) => toSelectOption(state.name)), [stateOptions]);
  const citySelectOptions = useMemo(() => availableCityOptions.map((city) => toSelectOption(city.name)), [availableCityOptions]);
  const servicePartnerOptions = useMemo<SearchableSelectOption[]>(
    () =>
      servicePartners.map((partner) => ({
        value: partner.id,
        label: getServicePartnerDisplayLabel(partner),
      })),
    [servicePartners]
  );

  const isLegacyState = Boolean(selectedState) && !selectedStateRecord;
  const isLegacyCity =
    Boolean(selectedCity) &&
    (!selectedStateRecord || !findCityByName(selectedStateRecord.cities, selectedCity));
  const derivedCountry = selectedStateRecord ? "India" : manualCountry;

  function handleStateChange(nextState: string) {
    setSelectedState(nextState);

    const nextStateRecord = findStateByName(states, nextState);
    if (!nextState) {
      setSelectedCity("");
      return;
    }

    if (!nextStateRecord) {
      return;
    }

    if (selectedCity && !findCityByName(nextStateRecord.cities, selectedCity)) {
      setSelectedCity("");
    }
  }

  return (
    <form action={action} className="crm-form-shell space-y-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-sm md:col-span-2">
          <SearchableSelect
            label="Service partner"
            name="servicePartnerId"
            value={selectedServicePartnerId}
            options={servicePartnerOptions}
            placeholder="Select a service partner"
            searchPlaceholder="Search service partners..."
            emptyMessage="No matching service partners found."
            disabled={!canChooseServicePartner}
            required
            onChange={setSelectedServicePartnerId}
          />
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={selectedServicePartnerId} /> : null}
        </div>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Code</span>
          <input
            name="code"
            defaultValue={client?.code ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={40}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={client?.status ?? ClientStatus.ACTIVE}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {Object.values(ClientStatus).map((status) => (
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
            defaultValue={client?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Legal name</span>
          <input
            name="legalName"
            defaultValue={client?.legalName ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={client?.email ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Phone</span>
          <input
            name="phone"
            defaultValue={client?.phone ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={30}
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Address</span>
          <textarea
            name="address"
            defaultValue={client?.address ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={300}
          />
        </label>
        <div className="space-y-1 text-sm">
          <SearchableSelect
            label="State"
            name="state"
            value={selectedState}
            onChange={handleStateChange}
            options={stateSelectOptions}
            placeholder="Select state"
            searchPlaceholder="Type state name..."
            emptyMessage="No matching states found."
          />
          {isLegacyState ? <p className="text-xs text-amber-700">Current state is a legacy value outside the reference list.</p> : null}
        </div>
        <div className="space-y-1 text-sm">
          <SearchableSelect
            label="City"
            name="city"
            value={selectedCity}
            onChange={setSelectedCity}
            options={citySelectOptions}
            placeholder={selectedState ? "Select city" : "Select state first"}
            searchPlaceholder="Type city name..."
            emptyMessage={selectedState ? "No matching cities found." : "Select state first."}
            disabled={!selectedState}
          />
          {isLegacyCity ? <p className="text-xs text-amber-700">Current city is a legacy value outside the selected state&apos;s reference list.</p> : null}
        </div>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Country</span>
          <input
            name="country"
            value={derivedCountry}
            onChange={(event) => setManualCountry(event.target.value)}
            readOnly={Boolean(selectedStateRecord)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 read-only:bg-slate-50"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Postal code</span>
          <input
            name="postalCode"
            defaultValue={client?.postalCode ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={20}
          />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={client ? "Update client" : "Create client"} />
    </form>
  );
}
