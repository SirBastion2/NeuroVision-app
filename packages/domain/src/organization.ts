import { isNonEmptyString, isObject, isOneOf, parseFail } from "./guard.js";

export const ROLES = ["owner", "admin", "reviewer", "participant"] as const;
export type Role = (typeof ROLES)[number];

/** Letters, digits, and dash. Used as the local-identity subject and participant id. */
export const PARTICIPANT_ID_MIN = 3;
export const PARTICIPANT_ID_MAX = 32;
export const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9-]{3,32}$/;

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

export function isParticipantId(value: unknown): value is string {
  return typeof value === "string" && PARTICIPANT_ID_PATTERN.test(value);
}

export function parseParticipantId(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!isParticipantId(trimmed)) parseFail("participant id");
  return trimmed;
}
