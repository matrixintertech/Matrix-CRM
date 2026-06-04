export const permissionActionOrder = [
  "read",
  "create",
  "update",
  "delete",
  "export",
  "assign",
  "approve",
  "reject",
  "send",
  "status.update",
  "status",
  "roles.assign",
  "responsibility.read",
  "responsibility.update",
  "submit",
  "reverse",
  "purge",
  "publish",
  "timeline",
  "platform",
  "company",
  "dashboard",
  "manage",
  "email_change.request",
] as const;

export const permissionActionLabels: Record<string, string> = {
  read: "Read",
  create: "Create",
  update: "Edit",
  delete: "Delete",
  export: "Export",
  assign: "Assign",
  approve: "Approve",
  reject: "Reject",
  send: "Send",
  "status.update": "Status Update",
  status: "Status",
  "roles.assign": "Roles Assign",
  "responsibility.read": "Responsibility Read",
  "responsibility.update": "Responsibility Update",
  submit: "Submit",
  reverse: "Reverse",
  purge: "Purge",
  publish: "Publish",
  timeline: "Timeline",
  platform: "Platform",
  company: "Company",
  dashboard: "Dashboard",
  manage: "Manage",
  "email_change.request": "Email Change Request",
};

export function getPermissionActionLabel(action: string) {
  return permissionActionLabels[action] ?? action.replaceAll(".", " ").replaceAll("_", " ");
}

export function comparePermissionActions(left: string, right: string) {
  const leftIndex = permissionActionOrder.indexOf(left as (typeof permissionActionOrder)[number]);
  const rightIndex = permissionActionOrder.indexOf(right as (typeof permissionActionOrder)[number]);

  if (leftIndex === -1 && rightIndex === -1) {
    return left.localeCompare(right);
  }
  if (leftIndex === -1) {
    return 1;
  }
  if (rightIndex === -1) {
    return -1;
  }

  return leftIndex - rightIndex;
}
