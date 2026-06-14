"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
};

type SearchableSelectProps = {
  label: string;
  name: string;
  value: string;
  options: SearchableSelectOption[];
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  emptyMessage?: string;
  searchPlaceholder?: string;
  onChange: (value: string) => void;
};

function normalizeValue(value: string) {
  return value.trim().toLowerCase();
}

export function SearchableSelect({
  label,
  name,
  value,
  options,
  placeholder,
  disabled = false,
  required = false,
  emptyMessage = "No options found.",
  searchPlaceholder = "Type to search...",
  onChange,
}: SearchableSelectProps) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const selectedOption = useMemo(
    () => options.find((option) => normalizeValue(option.value) === normalizeValue(value)),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeValue(deferredQuery);
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) => normalizeValue(option.label).includes(normalizedQuery));
  }, [deferredQuery, options]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }

    searchInputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function handleOpen() {
    if (!disabled) {
      setIsOpen(true);
    }
  }

  function handleSelect(nextValue: string) {
    onChange(nextValue);
    setIsOpen(false);
    setQuery("");
  }

  const triggerLabel = selectedOption?.label || value || placeholder;

  return (
    <div ref={rootRef} className="space-y-1 text-sm">
      <label htmlFor={inputId} className="font-medium">
        {label}
      </label>
      <input type="hidden" name={name} value={value} />
      <div className="relative">
        <button
          id={inputId}
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-disabled={disabled}
          onClick={() => (isOpen ? setIsOpen(false) : handleOpen())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleOpen();
            }

            if (event.key === "Escape") {
              setIsOpen(false);
            }
          }}
          disabled={disabled}
          className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white px-3 text-left disabled:bg-slate-50 disabled:text-slate-500"
        >
          <span className={`${value ? "text-slate-900" : "text-slate-500"} min-w-0 flex-1 truncate`}>{triggerLabel}</span>
          <span className="text-xs text-slate-500" aria-hidden="true">
            {isOpen ? "Close" : "Search"}
          </span>
        </button>
        {isOpen ? (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-[var(--border)] bg-white p-2 shadow-lg">
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setIsOpen(false);
                }
              }}
              placeholder={searchPlaceholder}
              className="mb-2 h-10 w-full rounded-xl border border-[var(--border)] px-3"
            />
            {!required && value ? (
              <button
                type="button"
                onClick={() => handleSelect("")}
                className="mb-2 text-xs font-medium text-[var(--accent)] underline"
              >
                Clear selection
              </button>
            ) : null}
            <ul
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="max-h-[min(16rem,50vh)] overflow-y-auto rounded-xl border border-slate-100"
            >
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => {
                  const isSelected = normalizeValue(option.value) === normalizeValue(value);

                  return (
                    <li key={`${name}:${option.value}`} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelect(option.value)}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                          isSelected ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700"
                        }`}
                      >
                        <span>{option.label}</span>
                        {isSelected ? <span className="text-xs text-slate-500">Selected</span> : null}
                      </button>
                    </li>
                  );
                })
              ) : (
                <li className="px-3 py-2 text-sm text-slate-500">{emptyMessage}</li>
              )}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
