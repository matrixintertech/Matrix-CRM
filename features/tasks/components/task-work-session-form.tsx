"use client";

import { useRef, useState } from "react";

type TaskWorkSessionFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  redirectTo: string;
  buttonLabel: string;
  noteLabel: string;
  notePlaceholder: string;
  locationRequired: boolean;
  disabled?: boolean;
};

type Coordinates = {
  latitude: string;
  longitude: string;
};

function extractErrorMessage(error: unknown, locationRequired: boolean) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const geolocationError = error as { code?: number };
    if (geolocationError.code === 1) {
      return locationRequired
        ? "Location permission is required for this action."
        : "Location permission was denied. You can continue without location.";
    }
    return "Location could not be captured. Try again.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Location could not be captured. Try again.";
}

export function TaskWorkSessionForm({
  action,
  redirectTo,
  buttonLabel,
  noteLabel,
  notePlaceholder,
  locationRequired,
  disabled = false,
}: TaskWorkSessionFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const allowSubmitRef = useRef(false);
  const [isLocating, setIsLocating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function getCoordinates(): Promise<Coordinates> {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (locationRequired) {
        throw new Error("This device does not support browser geolocation.");
      }

      return {
        latitude: "",
        longitude: "",
      };
    }

    return new Promise<Coordinates>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            latitude: String(position.coords.latitude),
            longitude: String(position.coords.longitude),
          }),
        reject,
        {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 0,
        }
      );
    });
  }

  async function handleSubmitPreparation() {
    if (!formRef.current) {
      return;
    }

    setErrorMessage(null);
    setIsLocating(true);

    try {
      const coordinates = await getCoordinates();
      const latitudeInput = formRef.current.elements.namedItem("latitude") as HTMLInputElement | null;
      const longitudeInput = formRef.current.elements.namedItem("longitude") as HTMLInputElement | null;
      const addressInput = formRef.current.elements.namedItem("address") as HTMLInputElement | null;

      if (latitudeInput) {
        latitudeInput.value = coordinates.latitude;
      }
      if (longitudeInput) {
        longitudeInput.value = coordinates.longitude;
      }
      if (addressInput) {
        addressInput.value = "";
      }

      allowSubmitRef.current = true;
      formRef.current.requestSubmit(submitRef.current ?? undefined);
    } catch (error) {
      const message = extractErrorMessage(error, locationRequired);
      if (locationRequired || !message.includes("continue without location")) {
        setErrorMessage(message);
        setIsLocating(false);
        return;
      }

      allowSubmitRef.current = true;
      formRef.current.requestSubmit(submitRef.current ?? undefined);
    }
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-3"
      onSubmit={(event) => {
        if (allowSubmitRef.current) {
          allowSubmitRef.current = false;
          setIsLocating(false);
          return;
        }

        event.preventDefault();
        void handleSubmitPreparation();
      }}
    >
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="latitude" />
      <input type="hidden" name="longitude" />
      <input type="hidden" name="address" />

      <label className="crm-field">
        <span className="crm-field-label">{noteLabel}</span>
        <textarea
          name="note"
          maxLength={1000}
          className="crm-textarea"
          placeholder={notePlaceholder}
        />
      </label>

      <div className="flex flex-col gap-2">
        <button
          ref={submitRef}
          type="submit"
          disabled={disabled || isLocating}
          className="crm-button w-full"
        >
          {isLocating ? "Capturing location..." : buttonLabel}
        </button>
        <p className="crm-field-note">
          {locationRequired
            ? "Location permission is required when you submit this action."
            : "Location is requested only when you submit this action. If permission is denied, the action still continues."}
        </p>
        {errorMessage ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      </div>
    </form>
  );
}
