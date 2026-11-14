import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isParticipantId,
  parseMembership,
  parseOrganization,
  parseParticipant,
  parseParticipantId,
  parseRole,
  ROLES,
} from "../src/index.ts";

describe("organization contracts", () => {
  it("parses organization, membership, role, and org-scoped participant", () => {
    assert.deepEqual(ROLES, ["owner", "admin", "reviewer", "participant"]);
    assert.equal(parseRole("owner"), "owner");
    assert.deepEqual(parseOrganization({ id: "org-1", name: "Clinic" }), { id: "org-1", name: "Clinic" });
    assert.deepEqual(parseMembership({ orgId: "org-1", subject: "sub-1", role: "admin" }), {
      orgId: "org-1",
      subject: "sub-1",
      role: "admin",
    });
    assert.deepEqual(
      parseParticipant({ orgId: "org-1", participantId: "p-1", label: "P1", subject: null }),
      { orgId: "org-1", participantId: "p-1", label: "P1", subject: null },
    );
  });

  it("rejects unknown roles and participants missing org or participant id", () => {
    assert.throws(() => parseRole("observer"), /invalid role/);
    assert.throws(() => parseOrganization({ id: "", name: "Clinic" }), /invalid organization/);
    assert.throws(
      () => parseParticipant({ orgId: "org-1", id: "p-1", label: "P1", subject: null }),
      /invalid participant/,
    );
    assert.throws(
      () => parseMembership({ orgId: "org-1", subject: "sub-1", role: "owner-admin" }),
      /invalid membership/,
    );
  });

  it("accepts participant ids of letters, digits, and dashes between 3 and 32 characters", () => {
    assert.equal(parseParticipantId("P-014"), "P-014");
    assert.equal(parseParticipantId("  ab3  "), "ab3");
    assert.equal(isParticipantId("participant-demo"), true);
    assert.equal(isParticipantId("a".repeat(32)), true);
    assert.equal(isParticipantId("ab"), false);
    assert.equal(isParticipantId("a".repeat(33)), false);
    assert.equal(isParticipantId("user_name"), false);
    assert.equal(isParticipantId("id.1"), false);
    assert.equal(isParticipantId("id 1"), false);
    assert.throws(() => parseParticipantId("ab"), /invalid participant id/);
    assert.throws(() => parseParticipantId("user_name"), /invalid participant id/);
    assert.throws(() => parseParticipantId(""), /invalid participant id/);
  });
});
