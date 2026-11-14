import { isNonEmptyString, isObject, isOneOf, parseFail } from "./guard.js";

export const ROLES = ["owner", "admin", "reviewer", "participant"] as const;
export type Role = (typeof ROLES)[number];

export interface Organization {
  id: string;
  name: string;
}

export interface Membership {
  orgId: string;
  subject: string;
  role: Role;
}

/** Org-scoped participant identity. `orgId` + `participantId` is the unique key. */
export interface Participant {
  orgId: string;
  participantId: string;
  label: string;
  subject: string | null;
}

export function isRole(value: unknown): value is Role {
  return isOneOf(value, ROLES);
}

export function parseRole(value: unknown): Role {
  if (!isRole(value)) parseFail("role");
  return value;
}

export function isOrganization(value: unknown): value is Organization {
  return isObject(value) && isNonEmptyString(value.id) && isNonEmptyString(value.name);
}

export function parseOrganization(value: unknown): Organization {
  if (!isOrganization(value)) parseFail("organization");
  return { id: value.id, name: value.name };
}

export function isMembership(value: unknown): value is Membership {
  return (
    isObject(value) &&
    isNonEmptyString(value.orgId) &&
    isNonEmptyString(value.subject) &&
    isRole(value.role)
  );
}

export function parseMembership(value: unknown): Membership {
  if (!isMembership(value)) parseFail("membership");
  return { orgId: value.orgId, subject: value.subject, role: value.role };
}

export function isParticipant(value: unknown): value is Participant {
  return (
    isObject(value) &&
    isNonEmptyString(value.orgId) &&
    isNonEmptyString(value.participantId) &&
    typeof value.label === "string" &&
    (value.subject === null || isNonEmptyString(value.subject))
  );
}

export function parseParticipant(value: unknown): Participant {
  if (!isParticipant(value)) parseFail("participant");
  return {
    orgId: value.orgId,
    participantId: value.participantId,
    label: value.label,
    subject: value.subject,
  };
}
