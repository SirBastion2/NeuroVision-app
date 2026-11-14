import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseMembership,
  parseOrganization,
  parseParticipant,
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
});
