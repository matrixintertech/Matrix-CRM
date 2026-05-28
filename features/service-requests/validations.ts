import { ServiceRequestStatus } from "@prisma/client";
import { z } from "zod";

const optionalString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  );

const optionalUuid = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().uuid().optional()
);

const optionalDate = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return new Date(value);
  }
  return value;
}, z.date().optional());

export const serviceRequestUpsertSchema = z.object({
  servicePartnerId: z.string().uuid(),
  serviceNumber: optionalString(60),
  clientId: z.string().uuid(),
  branchId: optionalUuid,
  title: z.string().trim().min(2).max(240),
  description: optionalString(1000),
  serviceType: z.string().trim().min(2).max(120),
  status: z.nativeEnum(ServiceRequestStatus).default(ServiceRequestStatus.RAISED),
  requestedAt: optionalDate,
  targetDate: optionalDate,
});

export const serviceRequestStatusSchema = z.object({
  status: z.nativeEnum(ServiceRequestStatus),
  remarks: optionalString(500),
});

export type ServiceRequestUpsertInput = z.infer<typeof serviceRequestUpsertSchema>;
export type ServiceRequestStatusInput = z.infer<typeof serviceRequestStatusSchema>;

