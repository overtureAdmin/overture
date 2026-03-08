import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDraftPhiContext,
  hydrateDraftPlaceholders,
  normalizeToCanonicalPlaceholders,
} from "./document-placeholders.ts";

test("collectDraftPhiContext extracts key PHI fields", () => {
  const context = collectDraftPhiContext(
    [
      "Context for this case:",
      "Patient name: Ben Frank",
      "DOB: 1989-04-23",
      "Sex: Male",
      "Payer/plan: ACCESS COMMUNITY HEALTH NETWORK",
      "Member ID: 123456",
    ].join("\n"),
  );
  assert.equal(context.patientName, "Ben Frank");
  assert.equal(context.dob, "1989-04-23");
  assert.equal(context.sex, "Male");
  assert.equal(context.payerName, "ACCESS COMMUNITY HEALTH NETWORK");
  assert.equal(context.memberId, "123456");
});

test("hydrateDraftPlaceholders replaces canonical and alias placeholders", () => {
  const template = [
    "Dear [Payer/Plan Name],",
    "Patient: [REDACTED_NAME]",
    "DOB: [DATE OF BIRTH]",
    "Member: [POLICY ID]",
  ].join("\n");
  const hydrated = hydrateDraftPlaceholders(normalizeToCanonicalPlaceholders(template), {
    patientName: "Jane Doe",
    dob: "01/02/1980",
    payerName: "Acme Health",
    memberId: "M123",
  });
  assert.match(hydrated, /Dear Acme Health,/);
  assert.match(hydrated, /Patient: Jane Doe/);
  assert.match(hydrated, /DOB: 01\/02\/1980/);
  assert.match(hydrated, /Member: M123/);
});
