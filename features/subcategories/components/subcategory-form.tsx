"use client";

import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";
import { ALL_SERVICE_PARTNERS_OPTION } from "@/lib/service-partners/constants";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type CategoryOption = {
  id: string;
  code: string;
  name: string;
  servicePartnerId: string;
};

type SubcategoryFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  categories: CategoryOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string | null;
  defaultCategoryId?: string | null;
};

export function SubcategoryForm({
  action,
  cancelHref,
  servicePartners,
  categories,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  defaultCategoryId,
}: SubcategoryFormProps) {
  const initialServicePartnerId = defaultServicePartnerId ?? "";
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(initialServicePartnerId);
  const isAllPartners = selectedServicePartnerId === ALL_SERVICE_PARTNERS_OPTION;

  const categoryOptions = useMemo(() => {
    if (!isAllPartners) {
      return categories.filter((category) => category.servicePartnerId === selectedServicePartnerId);
    }

    const deduped = new Map<string, CategoryOption>();
    for (const category of categories) {
      if (!deduped.has(category.code)) {
        deduped.set(category.code, category);
      }
    }
    return Array.from(deduped.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [categories, isAllPartners, selectedServicePartnerId]);

  const [selectedCategoryId, setSelectedCategoryId] = useState(defaultCategoryId ?? "");

  useEffect(() => {
    if (categoryOptions.some((category) => category.id === selectedCategoryId)) {
      return;
    }
    setSelectedCategoryId(categoryOptions[0]?.id ?? "");
  }, [categoryOptions, selectedCategoryId]);

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
            {canChooseServicePartner ? <option value="">Select a service partner</option> : null}
            {canChooseServicePartner ? <option value={ALL_SERVICE_PARTNERS_OPTION}>All Partners</option> : null}
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {getServicePartnerDisplayLabel(partner)}
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={selectedServicePartnerId} /> : null}
        </label>

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Category</span>
          <select
            name="categoryId"
            value={selectedCategoryId}
            onChange={(event) => setSelectedCategoryId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          >
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.code})
              </option>
            ))}
          </select>
          {categoryOptions.length === 0 ? <p className="text-xs text-red-700">Create categories first for the selected service partner.</p> : null}
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Code</span>
          <input name="code" className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase" maxLength={40} required />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Name</span>
          <input name="name" className="h-9 w-full rounded-md border border-[var(--border)] px-3" maxLength={180} required />
        </label>

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <textarea name="description" className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2" maxLength={300} />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel="Create subcategory" />
    </form>
  );
}
