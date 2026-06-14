"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";
import { SearchableSelect, type SearchableSelectOption } from "@/components/admin/searchable-select";
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

type SubcategoryOption = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  servicePartnerId: string;
  category: {
    id: string;
    code: string;
    name: string;
  };
};

type UomOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  servicePartnerId: string;
};

type ItemFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  returnToPath?: string;
  servicePartners: ServicePartnerOption[];
  categories: CategoryOption[];
  subcategories: SubcategoryOption[];
  uoms: UomOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  defaultCategoryId?: string;
  defaultSubcategoryId?: string;
  defaultUomId?: string;
  defaultUomCode?: string;
  item?: {
    servicePartnerId: string;
    categoryId: string;
    subcategoryId: string | null;
    uomId: string | null;
    code: string;
    name: string;
    unit: string;
    description: string | null;
    active: boolean;
  };
};

function dedupeByCode<T extends { code: string }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!map.has(row.code)) {
      map.set(row.code, row);
    }
  }
  return Array.from(map.values());
}

export function ItemForm({
  action,
  cancelHref,
  returnToPath,
  servicePartners,
  categories,
  subcategories,
  uoms,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  defaultCategoryId,
  defaultSubcategoryId,
  defaultUomId,
  defaultUomCode,
  item,
}: ItemFormProps) {
  const initialServicePartnerId = defaultServicePartnerId ?? item?.servicePartnerId ?? servicePartners[0]?.id ?? "";
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(initialServicePartnerId);
  const isAllPartners = selectedServicePartnerId === ALL_SERVICE_PARTNERS_OPTION;
  const servicePartnerOptions = useMemo<SearchableSelectOption[]>(() => {
    const options = servicePartners.map((partner) => ({
      value: partner.id,
      label: getServicePartnerDisplayLabel(partner),
    }));

    if (canChooseServicePartner && !item) {
      return [{ value: ALL_SERVICE_PARTNERS_OPTION, label: "All Partners" }, ...options];
    }

    return options;
  }, [canChooseServicePartner, item, servicePartners]);

  const categoryOptions = useMemo(() => {
    if (!isAllPartners) {
      return categories.filter((category) => category.servicePartnerId === selectedServicePartnerId);
    }

    return dedupeByCode(categories).sort((left, right) => left.name.localeCompare(right.name));
  }, [categories, isAllPartners, selectedServicePartnerId]);
  const categorySelectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      categoryOptions.map((category) => ({
        value: category.id,
        label: `${category.name} (${category.code})`,
      })),
    [categoryOptions]
  );

  const initialCategoryId =
    defaultCategoryId ??
    item?.categoryId ??
    categories.find((category) => category.servicePartnerId === initialServicePartnerId)?.id ??
    "";
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialCategoryId);

  useEffect(() => {
    if (categoryOptions.some((category) => category.id === selectedCategoryId)) {
      return;
    }
    setSelectedCategoryId(categoryOptions[0]?.id ?? "");
  }, [categoryOptions, selectedCategoryId]);

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const selectedCategoryCode = selectedCategory?.code;

  const subcategoryOptions = useMemo(() => {
    if (!selectedCategoryId) {
      return [];
    }

    if (!isAllPartners) {
      return subcategories.filter(
        (subcategory) =>
          subcategory.servicePartnerId === selectedServicePartnerId && subcategory.categoryId === selectedCategoryId
      );
    }

    return dedupeByCode(
      subcategories.filter((subcategory) => subcategory.category.code === selectedCategoryCode)
    ).sort((left, right) => left.name.localeCompare(right.name));
  }, [isAllPartners, selectedCategoryCode, selectedCategoryId, selectedServicePartnerId, subcategories]);
  const subcategorySelectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      subcategoryOptions.map((subcategory) => ({
        value: subcategory.id,
        label: `${subcategory.name} (${subcategory.code})`,
      })),
    [subcategoryOptions]
  );

  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState(defaultSubcategoryId ?? item?.subcategoryId ?? "");

  useEffect(() => {
    if (subcategoryOptions.some((subcategory) => subcategory.id === selectedSubcategoryId)) {
      return;
    }
    setSelectedSubcategoryId(subcategoryOptions[0]?.id ?? "");
  }, [selectedSubcategoryId, subcategoryOptions]);

  const uomOptions = useMemo(() => {
    if (!isAllPartners) {
      return uoms.filter((uom) => uom.servicePartnerId === selectedServicePartnerId);
    }

    return dedupeByCode(uoms).sort((left, right) => left.name.localeCompare(right.name));
  }, [isAllPartners, selectedServicePartnerId, uoms]);
  const uomSelectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      uomOptions.map((uom) => ({
        value: uom.id,
        label: `${uom.name} (${uom.symbol})`,
      })),
    [uomOptions]
  );

  const [selectedUomId, setSelectedUomId] = useState(defaultUomId ?? item?.uomId ?? "");

  useEffect(() => {
    if (uomOptions.some((uom) => uom.id === selectedUomId)) {
      return;
    }
    if (defaultUomCode) {
      const matchedUom = uomOptions.find((uom) => uom.code.toUpperCase() === defaultUomCode.toUpperCase());
      if (matchedUom) {
        setSelectedUomId(matchedUom.id);
        return;
      }
    }
    setSelectedUomId(uomOptions[0]?.id ?? "");
  }, [defaultUomCode, selectedUomId, uomOptions]);

  const createCategoryHref =
    canChooseServicePartner && selectedServicePartnerId
      ? `/categories/new?servicePartnerId=${selectedServicePartnerId}`
      : "/categories/new";
  const createSubcategoryHref = selectedCategoryId
    ? `/subcategories/new?servicePartnerId=${selectedServicePartnerId}&categoryId=${selectedCategoryId}`
    : `/subcategories/new?servicePartnerId=${selectedServicePartnerId}`;
  const returnToHref = useMemo(() => {
    if (!returnToPath) {
      return undefined;
    }

    const params = new URLSearchParams();
    if (selectedServicePartnerId) {
      params.set("servicePartnerId", selectedServicePartnerId);
    }
    if (selectedCategoryId) {
      params.set("categoryId", selectedCategoryId);
    }
    if (selectedSubcategoryId) {
      params.set("subcategoryId", selectedSubcategoryId);
    }

    const query = params.toString();
    return query ? `${returnToPath}?${query}` : returnToPath;
  }, [returnToPath, selectedCategoryId, selectedServicePartnerId, selectedSubcategoryId]);

  const createUomHref = useMemo(() => {
    const params = new URLSearchParams();

    if (selectedServicePartnerId) {
      params.set("servicePartnerId", selectedServicePartnerId);
    }
    if (returnToHref) {
      params.set("redirectTo", returnToHref);
    }

    const query = params.toString();
    return query ? `/uoms/new?${query}` : "/uoms/new";
  }, [returnToHref, selectedServicePartnerId]);

  return (
    <form action={action} className="crm-form-shell space-y-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
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
        </div>

        <div className="space-y-1 text-sm">
          <SearchableSelect
            label="Category"
            name="categoryId"
            value={selectedCategoryId}
            options={categorySelectOptions}
            placeholder="Select a category"
            searchPlaceholder="Search categories..."
            emptyMessage="No matching categories found."
            required
            onChange={setSelectedCategoryId}
          />
          <div className="flex items-center justify-between gap-3">
            {categoryOptions.length === 0 ? <p className="text-xs text-red-700">No categories available for the selected service partner.</p> : <span />}
            <Link href={createCategoryHref} className="text-xs font-semibold text-[#315cff] underline">
              Create category
            </Link>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <SearchableSelect
            label="Subcategory"
            name="subcategoryId"
            value={selectedSubcategoryId}
            options={subcategorySelectOptions}
            placeholder={selectedCategoryId ? "Select a subcategory" : "Select a category first"}
            searchPlaceholder="Search subcategories..."
            emptyMessage={selectedCategoryId ? "No matching subcategories found." : "Select a category first."}
            disabled={!selectedCategoryId}
            required
            onChange={setSelectedSubcategoryId}
          />
          <div className="flex items-center justify-between gap-3">
            {subcategoryOptions.length === 0 ? <p className="text-xs text-red-700">No subcategories available for the selected category.</p> : <span />}
            <Link href={createSubcategoryHref} className="text-xs font-semibold text-[#315cff] underline">
              Create subcategory
            </Link>
          </div>
        </div>

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

        <div className="space-y-1 text-sm">
          <SearchableSelect
            label="Unit"
            name="uomId"
            value={selectedUomId}
            options={uomSelectOptions}
            placeholder="Select a unit"
            searchPlaceholder="Search units..."
            emptyMessage="No matching units found."
            required
            onChange={setSelectedUomId}
          />
          <div className="flex items-center justify-between gap-3">
            {uomOptions.length === 0 ? <p className="text-xs text-red-700">No UOMs available for the selected service partner.</p> : <span />}
            <Link href={createUomHref} className="text-xs font-semibold text-[#315cff] underline">
              Create unit
            </Link>
          </div>
        </div>

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
