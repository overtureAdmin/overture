import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRequiredChecklist, extractRequiredFieldValues, hasStructuredIntakeContext } from "./workflow-checklist.ts";
import { getDefaultWorkflowPolicy } from "./workflow-policy.ts";

test("extractRequiredFieldValues parses narrative intake phrasing", () => {
  const values = extractRequiredFieldValues(
    [
      "Patient Ben Frank was denied proton therapy by ACCESS COMMUNITY HEALTH NETWORK due to not medically necessary criteria.",
      "DOB is 04/23/1989 and gender is male.",
      "Diagnosed with C61 - malignant neoplasm of prostate.",
      "Member # 123456",
    ].join(" "),
  );

  assert.equal(values.patientName, "Ben Frank");
  assert.equal(values.requestedTreatment, "proton therapy");
  assert.equal(values.payerName, "ACCESS COMMUNITY HEALTH NETWORK");
  assert.equal(values.denialReason, "not medically necessary criteria");
  assert.equal(values.dob, "04/23/1989");
  assert.equal(values.sex, "Male");
  assert.equal(values.diagnosis, "C61 - Malignant neoplasm of prostate");
  assert.equal(values.memberId, "123456");
});

test("evaluateRequiredChecklist uses extracted values even without context header", () => {
  const policy = getDefaultWorkflowPolicy();
  const checklistContext = "DOB: 01/02/1980. Diagnosis: C61.";
  const hasStructuredContext = hasStructuredIntakeContext(checklistContext);
  const evaluation = evaluateRequiredChecklist({
    policy,
    checklistContext,
    hasStructuredContext,
  });

  assert.equal(hasStructuredContext, true);
  assert.ok(evaluation.missingRequired.includes("Patient name"));
  assert.ok(!evaluation.missingRequired.includes("DOB"));
  assert.ok(!evaluation.missingRequired.includes("Diagnosis"));
});

test("extractRequiredFieldValues rejects placeholder patient names", () => {
  const values = extractRequiredFieldValues("Patient name: name. Diagnosis: prostate cancer.");
  assert.equal(values.patientName, undefined);
});

test("extractRequiredFieldValues normalizes free-text diagnosis to ICD-10 label when confident", () => {
  const values = extractRequiredFieldValues("Diagnosis: prostate cancer.");
  assert.equal(values.diagnosis, "C61 - Malignant neoplasm of prostate");
});
