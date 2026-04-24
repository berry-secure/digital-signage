export type UserRole = "owner" | "manager" | "editor";

export type AccessSubject = {
  role: UserRole;
  clientIds: string[];
};

export function canManageUsers(subject: AccessSubject) {
  return subject.role === "owner";
}

export function canManageClientData(subject: AccessSubject, clientId: string) {
  if (subject.role === "owner") {
    return true;
  }

  return Boolean(clientId) && subject.clientIds.includes(clientId);
}
