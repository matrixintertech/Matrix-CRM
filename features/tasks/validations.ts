import { TaskStatus } from "@prisma/client";
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

export const createTaskSchema = z.object({
  serviceRequestId: z.string().uuid(),
  parentTaskId: optionalUuid,
  title: z.string().trim().min(2).max(240),
  description: optionalString(1000),
  assigneeUserId: optionalUuid,
  status: z.nativeEnum(TaskStatus).default(TaskStatus.YET_TO_START),
  requestedAt: optionalDate,
  startDate: optionalDate,
  dueDate: optionalDate,
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(240),
  description: optionalString(1000),
  assigneeUserId: optionalUuid,
  status: z.nativeEnum(TaskStatus),
  requestedAt: optionalDate,
  startDate: optionalDate,
  dueDate: optionalDate,
});

export const updateTaskStatusSchema = z.object({
  status: z.nativeEnum(TaskStatus),
});

export const createTaskRemarkSchema = z.object({
  remark: z.string().trim().min(2).max(1000),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type CreateTaskRemarkInput = z.infer<typeof createTaskRemarkSchema>;
