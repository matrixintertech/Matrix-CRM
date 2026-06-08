"use client";

import { useMemo, useState } from "react";

import { ServicePartnerStatus } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";
import { SearchableSelect, type SearchableSelectOption } from "@/components/admin/searchable-select";

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
    gstNumber: string | null;
    shortProfile: string | null;
    bankName: string | null;
    bankBranch: string | null;
    bankIfscCode: string | null;
    bankAccountNumber: string | null;
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

function toSelectOption(value: string): SearchableSelectOption {
  return {
    value,
    label: value,
  };
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

  const isLegacyState = Boolean(selectedState) && !selectedStateRecord;
  const isLegacyCity =
    Boolean(selectedCity) &&
    (!selectedStateRecord || !findCityByName(selectedStateRecord.cities, selectedCity));

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
        <label className="space-y-1 text-sm">
          <span className="font-medium">GST No.</span>
          <input
            name="gstNumber"
            defaultValue={servicePartner?.gstNumber ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={20}
            placeholder="29ABCDE1234F1Z5"
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Short profile</span>
          <textarea
            name="shortProfile"
            defaultValue={servicePartner?.shortProfile ?? ""}
            className="min-h-24 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={600}
            placeholder="Brief company profile, capabilities, and service coverage."
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Bank name</span>
          <input
            name="bankName"
            defaultValue={servicePartner?.bankName ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={160}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Bank branch</span>
          <input
            name="bankBranch"
            defaultValue={servicePartner?.bankBranch ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={160}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">IFSC No.</span>
          <input
            name="bankIfscCode"
            defaultValue={servicePartner?.bankIfscCode ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={20}
            placeholder="HDFC0001234"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">A/C No.</span>
          <input
            name="bankAccountNumber"
            defaultValue={servicePartner?.bankAccountNumber ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={34}
            inputMode="numeric"
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
