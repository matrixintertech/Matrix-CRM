export const permissionActionOrder = [
  "read",
  "create",
  "update",
  "delete",
  "export",
  "assign",
  "assign.downline",
  "assign.any",
  "delegate",
  "approve",
  "reject",
  "send",
  "status.update",
  "remark.create",
  "history.read",
  "check_in",
  "check_out",
  "work_sessions.read",
  "location.read",
  "attachments.read",
  "attachments.upload",
  "attachments.delete",
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
  "assign.downline": "Assign Downline",
  "assign.any": "Assign Any",
  delegate: "Delegate",
  approve: "Approve",
  reject: "Reject",
  send: "Send",
  "status.update": "Status Update",
  "remark.create": "Remark Create",
  "history.read": "History Read",
  check_in: "Check In",
  check_out: "Check Out",
  "work_sessions.read": "Work Sessions Read",
  "location.read": "Location Read",
  "attachments.read": "Attachments Read",
  "attachments.upload": "Attachments Upload",
  "attachments.delete": "Attachments Delete",
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
