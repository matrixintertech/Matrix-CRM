import path from "node:path";

import { AttachmentType, Prisma, ServicePartnerStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { ServicePartnerUpsertInput } from "@/features/service-partners/validations";
import { resolveStateCitySelection } from "@/features/locations/services/location.service";
import { hasPermission } from "@/lib/auth/permissions";
import { buildFilterSignature, buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { invalidateAuthorizationCaches, invalidateLocationCaches, invalidateTenantDataCaches } from "@/lib/cache/cache-invalidation";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";
import { measurePerf } from "@/lib/observability/perf";
import { ensureBaselinePermissions, ensureTenantRbac } from "@/lib/rbac/bootstrap";
import {
  canUploadAttachments,
  deleteStorageObject,
  getStorageDriver,
  readStorageObject,
  uploadStorageObject,
} from "@/lib/storage/storage.service";

type ListServicePartnersInput = {
  q?: string;
  status?: ServicePartnerStatus;
  page?: number;
  pageSize?: number;
};

type ServicePartnerDocumentRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: AttachmentType;
  documentLabel: string | null;
  note: string | null;
  createdAt: Date;
  uploadedBy: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export type ServicePartnerDocumentView = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: AttachmentType;
  documentLabel: string | null;
  note: string | null;
  createdAt: Date;
  fileUrl: string;
  uploadedBy: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

const ALLOWED_DOCUMENT_TYPES: Record<
  string,
  {
    mimeTypes: string[];
    attachmentType: AttachmentType;
  }
> = {
  ".jpg": { mimeTypes: ["image/jpeg"], attachmentType: AttachmentType.IMAGE },
  ".jpeg": { mimeTypes: ["image/jpeg"], attachmentType: AttachmentType.IMAGE },
  ".png": { mimeTypes: ["image/png"], attachmentType: AttachmentType.IMAGE },
  ".webp": { mimeTypes: ["image/webp"], attachmentType: AttachmentType.IMAGE },
  ".pdf": { mimeTypes: ["application/pdf"], attachmentType: AttachmentType.PDF },
};

const servicePartnerListSelect = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  _count: {
    select: {
      users: true,
      clients: true,
      branches: true,
    },
  },
} satisfies Prisma.ServicePartnerSelect;

const servicePartnerDetailSelect = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  status: true,
  email: true,
  phone: true,
  gstNumber: true,
  shortProfile: true,
  bankName: true,
  bankBranch: true,
  bankIfscCode: true,
  bankAccountNumber: true,
  address: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      users: true,
      clients: true,
      branches: true,
    },
  },
} satisfies Prisma.ServicePartnerSelect;

const servicePartnerDetailLegacySelect = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  status: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      users: true,
      clients: true,
      branches: true,
    },
  },
} satisfies Prisma.ServicePartnerSelect;

const servicePartnerDocumentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  attachmentType: true,
  documentLabel: true,
  note: true,
  createdAt: true,
  uploadedBy: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
    },
  },
} satisfies Prisma.AttachmentSelect;

const servicePartnerDocumentLegacySelect = {
  id: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  attachmentType: true,
  note: true,
  createdAt: true,
  uploadedBy: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
    },
  },
} satisfies Prisma.AttachmentSelect;

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

function normalizeUppercaseOptionalString(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeAccountNumber(value?: string | null) {
  const normalized = value?.replace(/\s+/g, "").trim();
  return normalized || null;
}

function sanitizeFileName(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, extension).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
  return {
    extension,
    safeFileName: `${baseName || "service-partner-document"}${extension}`,
  };
}

function buildServicePartnerDocumentUrl(attachmentId: string) {
  return `/api/service-partner-attachments/${attachmentId}`;
}

function isMissingServicePartnerProfileColumnError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["gstNumber", "shortProfile", "bankName", "bankBranch", "bankIfscCode", "bankAccountNumber"].some((column) =>
      error.message.includes(`ServicePartner.${column}`)
    )
  );
}

function isMissingServicePartnerDocumentLabelError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.message.includes("Attachment.documentLabel");
}

function mapServicePartnerDocument(row: ServicePartnerDocumentRecord): ServicePartnerDocumentView {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    attachmentType: row.attachmentType,
    documentLabel: row.documentLabel,
    note: row.note,
    createdAt: row.createdAt,
    fileUrl: buildServicePartnerDocumentUrl(row.id),
    uploadedBy: row.uploadedBy,
  };
}

async function requireVisibleServicePartner(session: Session, id: string) {
  const servicePartner = await getServicePartnerById(session, id);
  if (!servicePartner) {
    throw new Error("Service partner not found.");
  }
  return servicePartner;
}

async function canReadServicePartnerDocuments(session: Session) {
  return session.user.isSuperAdmin || (await hasPermission(session, "service_partners.read"));
}

async function canManageServicePartnerDocuments(session: Session) {
  return session.user.isSuperAdmin || (await hasPermission(session, "service_partners.update"));
}

export function getServicePartnerScopeWhere(session: Session): Prisma.ServicePartnerWhereInput {
  if (session.user.isSuperAdmin) {
    return {};
  }

  return {
    id: session.user.servicePartnerId,
  };
}

export function canManageServicePartners(session: Session) {
  return session.user.isSuperAdmin;
}

export async function listServicePartners(session: Session, input: ListServicePartnersInput) {
  return measurePerf("service_partners.list", async () => {
    const pagination = getPagination(input);
    const cacheKey = [
      session.user.id,
      session.user.servicePartnerId,
      buildRoleSignature(session.user.roleKeys),
      buildFilterSignature({
        q: input.q?.trim() || null,
        status: input.status ?? null,
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
    ].join(":");
    const where: Prisma.ServicePartnerWhereInput = {
      ...getServicePartnerScopeWhere(session),
      deletedAt: null,
    };

    if (input.status) {
      where.status = input.status;
    }

    if (input.q?.trim()) {
      const q = input.q.trim();
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }

    const loadServicePartners = async () => {
      const [servicePartners, total] = await Promise.all([
        prisma.servicePartner.findMany({
          where,
          skip: pagination.skip,
          take: pagination.take,
          orderBy: [{ createdAt: "desc" }],
          select: servicePartnerListSelect,
        }),
        prisma.servicePartner.count({ where }),
      ]);

      return {
        servicePartners,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalPages: getTotalPages(total, pagination.pageSize),
      };
    };

    if (pagination.page === 1) {
      return getOrSetServerCache("service_partners.list", cacheKey, loadServicePartners, {
        ttlSeconds: 20,
        prefixes: [cachePrefixes.servicePartners],
      });
    }

    return loadServicePartners();
  });
}

export async function getServicePartnerById(session: Session, id: string) {
  const where = {
    id,
    deletedAt: null,
    ...getServicePartnerScopeWhere(session),
  };

  try {
    return await prisma.servicePartner.findFirst({
      where,
      select: servicePartnerDetailSelect,
    });
  } catch (error) {
    if (!isMissingServicePartnerProfileColumnError(error)) {
      throw error;
    }

    const servicePartner = await prisma.servicePartner.findFirst({
      where,
      select: servicePartnerDetailLegacySelect,
    });

    if (!servicePartner) {
      return null;
    }

    return {
      ...servicePartner,
      gstNumber: null,
      shortProfile: null,
      bankName: null,
      bankBranch: null,
      bankIfscCode: null,
      bankAccountNumber: null,
    };
  }
}

export async function listServicePartnersForForm(session: Session) {
  return getOrSetServerCache(
    "options.service_partners_for_form",
    `${session.user.id}:${session.user.isSuperAdmin ? "super_admin" : session.user.servicePartnerId}`,
    () =>
      prisma.servicePartner.findMany({
        where: {
          ...getServicePartnerScopeWhere(session),
          deletedAt: null,
        },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          code: true,
          legalName: true,
          name: true,
          status: true,
        },
      }),
    {
      ttlSeconds: 60,
      prefixes: [cachePrefixes.options, cachePrefixes.servicePartners],
    }
  );
}

export function isPlatformServicePartnerCode(code: string) {
  return code === env().PLATFORM_SERVICE_PARTNER_CODE;
}

export async function createServicePartner(input: ServicePartnerUpsertInput) {
  const permissionIdsByKey = await ensureBaselinePermissions(prisma);
  const location = await resolveStateCitySelection(input);

  const servicePartner = await prisma.$transaction(async (tx) => {
    const servicePartner = await tx.servicePartner.create({
      data: {
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        legalName: normalizeOptionalString(input.legalName),
        email: normalizeEmail(input.email),
        phone: normalizeOptionalString(input.phone),
        gstNumber: normalizeUppercaseOptionalString(input.gstNumber),
        shortProfile: normalizeOptionalString(input.shortProfile),
        bankName: normalizeOptionalString(input.bankName),
        bankBranch: normalizeOptionalString(input.bankBranch),
        bankIfscCode: normalizeUppercaseOptionalString(input.bankIfscCode),
        bankAccountNumber: normalizeAccountNumber(input.bankAccountNumber),
        address: normalizeOptionalString(input.address),
        city: location.city,
        state: location.state,
        country: normalizeOptionalString(input.country),
        postalCode: normalizeOptionalString(input.postalCode),
        status: input.status,
      },
    });

    await ensureTenantRbac(tx, {
      servicePartnerId: servicePartner.id,
      includePlatformRole: false,
      permissionIdsByKey,
    });

    return servicePartner;
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  });

  await invalidateAuthorizationCaches();
  await invalidateLocationCaches();
  return servicePartner;
}

export async function updateServicePartner(id: string, input: ServicePartnerUpsertInput) {
  const existing = await prisma.servicePartner.findUnique({
    where: { id },
    select: {
      state: true,
      city: true,
    },
  });
  const allowLegacyPair = Boolean(
    existing &&
      normalizeOptionalString(existing.state) === normalizeOptionalString(input.state) &&
      normalizeOptionalString(existing.city) === normalizeOptionalString(input.city)
  );
  const location = await resolveStateCitySelection(input, {
    allowLegacyPair,
  });

  const servicePartner = await prisma.servicePartner.update({
    where: { id },
    data: {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      legalName: normalizeOptionalString(input.legalName),
      email: normalizeEmail(input.email),
      phone: normalizeOptionalString(input.phone),
      gstNumber: normalizeUppercaseOptionalString(input.gstNumber),
      shortProfile: normalizeOptionalString(input.shortProfile),
      bankName: normalizeOptionalString(input.bankName),
      bankBranch: normalizeOptionalString(input.bankBranch),
      bankIfscCode: normalizeUppercaseOptionalString(input.bankIfscCode),
      bankAccountNumber: normalizeAccountNumber(input.bankAccountNumber),
      address: normalizeOptionalString(input.address),
      city: location.city,
      state: location.state,
      country: normalizeOptionalString(input.country),
      postalCode: normalizeOptionalString(input.postalCode),
      status: input.status,
    },
  });

  await invalidateTenantDataCaches(servicePartner.id);
  await invalidateLocationCaches();
  return servicePartner;
}

export async function updateServicePartnerStatus(id: string, status: ServicePartnerStatus) {
  const servicePartner = await prisma.servicePartner.update({
    where: { id },
    data: { status },
  });

  await invalidateTenantDataCaches(servicePartner.id);
  return servicePartner;
}

export async function softDeleteServicePartner(id: string) {
  const servicePartner = await prisma.servicePartner.update({
    where: { id },
    data: {
      status: ServicePartnerStatus.INACTIVE,
      deletedAt: new Date(),
    },
  });

  await invalidateTenantDataCaches(servicePartner.id);
  await invalidateAuthorizationCaches();
  return servicePartner;
}

export async function listServicePartnerDocuments(session: Session, servicePartnerId: string) {
  if (!(await canReadServicePartnerDocuments(session))) {
    throw new Error("You do not have permission to read service partner documents.");
  }

  await requireVisibleServicePartner(session, servicePartnerId);

  const where = {
    servicePartnerId,
    deletedAt: null,
    serviceRequestId: null,
    taskId: null,
    quotationId: null,
    invoiceId: null,
    expenseId: null,
    messageId: null,
  } satisfies Prisma.AttachmentWhereInput;

  try {
    const attachments = await prisma.attachment.findMany({
      where,
      select: servicePartnerDocumentSelect,
      orderBy: [{ createdAt: "desc" }],
    });

    return attachments.map((attachment) => mapServicePartnerDocument(attachment as ServicePartnerDocumentRecord));
  } catch (error) {
    if (!isMissingServicePartnerDocumentLabelError(error)) {
      throw error;
    }

    const attachments = await prisma.attachment.findMany({
      where,
      select: servicePartnerDocumentLegacySelect,
      orderBy: [{ createdAt: "desc" }],
    });

    return attachments.map((attachment) =>
      mapServicePartnerDocument({
        ...(attachment as Omit<ServicePartnerDocumentRecord, "documentLabel">),
        documentLabel: null,
      })
    );
  }
}

export async function uploadServicePartnerDocument(
  session: Session,
  servicePartnerId: string,
  input: { file: File; documentLabel?: string | null; note?: string | null }
) {
  return measurePerf("service_partners.document_upload", async () => {
    if (!(await canManageServicePartnerDocuments(session))) {
      throw new Error("You do not have permission to manage service partner documents.");
    }

    if (!canUploadAttachments()) {
      const driver = getStorageDriver();
      if (env().IS_PRODUCTION && driver !== "s3") {
        throw new Error("Service partner document uploads require S3 or R2 storage in production.");
      }
      throw new Error("Service partner document uploads are not configured.");
    }

    const servicePartner = await requireVisibleServicePartner(session, servicePartnerId);
    const file = input.file;
    if (!(file instanceof File) || file.size <= 0) {
      throw new Error("Select a valid document file to upload.");
    }

    const { extension, safeFileName } = sanitizeFileName(file.name);
    const allowedType = ALLOWED_DOCUMENT_TYPES[extension];
    if (!allowedType || !allowedType.mimeTypes.includes(file.type)) {
      throw new Error("Only JPG, JPEG, PNG, WEBP, and PDF documents are allowed.");
    }

    const maxBytes = env().TASK_ATTACHMENT_MAX_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`Service partner document exceeds the ${env().TASK_ATTACHMENT_MAX_MB}MB upload limit.`);
    }

    const attachmentId = crypto.randomUUID();
    const storageKey = `service-partner-documents/${servicePartner.id}/${attachmentId}-${safeFileName}`;
    const body = new Uint8Array(await file.arrayBuffer());

    await uploadStorageObject({
      key: storageKey,
      body,
      contentType: file.type,
    });

    try {
      let created: ServicePartnerDocumentRecord;
      try {
        created = (await prisma.attachment.create({
          data: {
            id: attachmentId,
            servicePartnerId: servicePartner.id,
            uploadedByUserId: session.user.id,
            fileName: safeFileName,
            fileUrl: buildServicePartnerDocumentUrl(attachmentId),
            storageKey,
            mimeType: file.type,
            fileSize: file.size,
            attachmentType: allowedType.attachmentType,
            documentLabel: normalizeOptionalString(input.documentLabel),
            note: normalizeOptionalString(input.note),
          },
          select: servicePartnerDocumentSelect,
        })) as ServicePartnerDocumentRecord;
      } catch (error) {
        if (!isMissingServicePartnerDocumentLabelError(error)) {
          throw error;
        }

        const legacyCreated = await prisma.attachment.create({
          data: {
            id: attachmentId,
            servicePartnerId: servicePartner.id,
            uploadedByUserId: session.user.id,
            fileName: safeFileName,
            fileUrl: buildServicePartnerDocumentUrl(attachmentId),
            storageKey,
            mimeType: file.type,
            fileSize: file.size,
            attachmentType: allowedType.attachmentType,
            note: normalizeOptionalString(input.note),
          },
          select: servicePartnerDocumentLegacySelect,
        });

        created = {
          ...(legacyCreated as Omit<ServicePartnerDocumentRecord, "documentLabel">),
          documentLabel: null,
        };
      }

      await invalidateTenantDataCaches(servicePartner.id);
      return {
        servicePartner,
        document: mapServicePartnerDocument(created),
      };
    } catch (error) {
      await deleteStorageObject(storageKey);
      throw error;
    }
  });
}

export async function deleteServicePartnerDocument(session: Session, attachmentId: string) {
  return measurePerf("service_partners.document_delete", async () => {
    if (!(await canManageServicePartnerDocuments(session))) {
      throw new Error("You do not have permission to manage service partner documents.");
    }

    const where = {
      id: attachmentId,
      deletedAt: null,
      serviceRequestId: null,
      taskId: null,
      quotationId: null,
      invoiceId: null,
      expenseId: null,
      messageId: null,
    } satisfies Prisma.AttachmentWhereInput;

    let attachment: (ServicePartnerDocumentRecord & { servicePartnerId: string; storageKey: string | null }) | null;
    try {
      attachment = (await prisma.attachment.findFirst({
        where,
        select: {
          ...servicePartnerDocumentSelect,
          servicePartnerId: true,
          storageKey: true,
        },
      })) as (ServicePartnerDocumentRecord & { servicePartnerId: string; storageKey: string | null }) | null;
    } catch (error) {
      if (!isMissingServicePartnerDocumentLabelError(error)) {
        throw error;
      }

      const legacyAttachment = await prisma.attachment.findFirst({
        where,
        select: {
          ...servicePartnerDocumentLegacySelect,
          servicePartnerId: true,
          storageKey: true,
        },
      });

      attachment = legacyAttachment
        ? {
            ...(legacyAttachment as Omit<ServicePartnerDocumentRecord, "documentLabel"> & {
              servicePartnerId: string;
              storageKey: string | null;
            }),
            documentLabel: null,
          }
        : null;
    }

    if (!attachment) {
      throw new Error("Service partner document not found.");
    }

    const servicePartner = await requireVisibleServicePartner(session, attachment.servicePartnerId);

    await prisma.attachment.update({
      where: { id: attachment.id },
      data: {
        deletedAt: new Date(),
      },
    });

    if (attachment.storageKey) {
      await deleteStorageObject(attachment.storageKey);
    }

    await invalidateTenantDataCaches(servicePartner.id);
    return {
      servicePartner,
      document: mapServicePartnerDocument(attachment),
    };
  });
}

export async function getServicePartnerDocumentDownload(session: Session, attachmentId: string) {
  return measurePerf("service_partners.document_download", async () => {
    if (!(await canReadServicePartnerDocuments(session))) {
      throw new Error("You do not have permission to read service partner documents.");
    }

    const attachment = await prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        deletedAt: null,
        serviceRequestId: null,
        taskId: null,
        quotationId: null,
        invoiceId: null,
        expenseId: null,
        messageId: null,
      },
      select: {
        servicePartnerId: true,
        storageKey: true,
        mimeType: true,
        fileName: true,
      },
    });

    if (!attachment) {
      throw new Error("Service partner document not found.");
    }

    await requireVisibleServicePartner(session, attachment.servicePartnerId);
    if (!attachment.storageKey) {
      throw new Error("Stored document is missing its storage key.");
    }

    const storedObject = await readStorageObject(attachment.storageKey, attachment.mimeType);
    return {
      fileName: attachment.fileName,
      mimeType: storedObject.contentType,
      body: storedObject.body,
    };
  });
}
