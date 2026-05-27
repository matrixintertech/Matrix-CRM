"use client";

import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";

type ServicePartnerOption = {
  id: string;
  name: string;
  code: string;
};

type CategoryOption = {
  id: string;
  code: string;
  name: string;
  servicePartnerId: string;
};

type ItemFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  categories: CategoryOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  defaultCategoryId?: string;
  item?: {
    servicePartnerId: string;
    categoryId: string;
    code: string;
    name: string;
    unit: string;
    description: string | null;
    active: boolean;
  };
};

export function ItemForm({
  action,
  cancelHref,
  servicePartners,
  categories,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  defaultCategoryId,
  item,
}: ItemFormProps) {
  const initialServicePartnerId = item?.servicePartnerId ?? defaultServicePartnerId ?? servicePartners[0]?.id ?? "";
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(initialServicePartnerId);

  const categoryOptions = useMemo(
    () => categories.filter((category) => category.servicePartnerId === selectedServicePartnerId),
    [categories, selectedServicePartnerId]
  );

  const initialCategoryId =
    item?.categoryId ??
    defaultCategoryId ??
    categories.find((category) => category.servicePartnerId === initialServicePartnerId)?.id ??
    "";
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialCategoryId);

  useEffect(() => {
    if (categoryOptions.some((category) => category.id === selectedCategoryId)) {
      return;
    }
    setSelectedCategoryId(categoryOptions[0]?.id ?? "");
  }, [categoryOptions, selectedCategoryId]);

  return (
    <form action={action} className="space-y-5 rounded-md border border-[var(--border)] bg-white p-5">
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
                {partner.name} ({partner.code})
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
          {categoryOptions.length === 0 ? (
            <p className="text-xs text-red-700">No categories available for the selected service partner.</p>
          ) : null}
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Code</span>
          <input
            name="code"
            defaultValue={item?.code ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={40}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Unit</span>
          <input
            name="unit"
            defaultValue={item?.unit ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={40}
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Name</span>
          <input
            name="name"
            defaultValue={item?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Active</span>
          <select
            name="active"
            defaultValue={String(item?.active ?? true)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <textarea
            name="description"
            defaultValue={item?.description ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={300}
          />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={item ? "Update item" : "Create item"} />
    </form>
  );
}
