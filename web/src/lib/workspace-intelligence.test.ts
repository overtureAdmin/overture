import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSmartPromptAddendum,
  buildWorkspaceIntelligence,
  chooseSmartAction,
  emptyIntakeModel,
  inferIntakeFromText,
  mergeIntakeWithInference,
} from "./workspace-intelligence.ts";

test("inferIntakeFromText extracts baseline fields", () => {
  const inferred = inferIntakeFromText([
    "Patient Name: Jane Doe",
    "DOB: 01/02/1980",
    "Sex: Female",
    "Diagnosis: Stage III head and neck squamous cell carcinoma",
    "Requested treatment: Proton therapy",
    "Denial reason: deemed not medically necessary",
    "Insurance company: Acme Health",
    "Member ID: M12345",
  ].join("\n"));

  assert.equal(inferred.patientName, "Jane Doe");
  assert.equal(inferred.dob, "01/02/1980");
  assert.equal(inferred.sex, "Female");
  assert.equal(inferred.payerName, "Acme Health");
  assert.equal(inferred.memberId, "M12345");
});

test("mergeIntakeWithInference preserves manually entered values", () => {
  const current = emptyIntakeModel();
  current.patientName = "Manual Name";

  const merged = mergeIntakeWithInference(current, {
    patientName: "Inferred Name",
    diagnosis: "Glioblastoma",
  });

  assert.equal(merged.patientName, "Manual Name");
  assert.equal(merged.diagnosis, "Glioblastoma");
});

test("buildWorkspaceIntelligence flags missing required and comparative recommendation", () => {
  const intake = emptyIntakeModel();
  intake.diagnosis = "Head and neck cancer";
  intake.denialReason = "Not medically necessary";

  const intelligence = buildWorkspaceIntelligence({
    intake,
    combinedContext: "head and neck case with denial",
    documentContent: "Introduction\nClinical summary\nRequested determination",
  });

  assert.ok(intelligence.missingRequired.length > 0);
  assert.equal(intelligence.comparativePlanRecommended, true);
  assert.equal(intelligence.progress[0]?.status, "active");
});

test("chooseSmartAction resolves generate/revise/chat", () => {
  assert.equal(chooseSmartAction({ hasDocument: false, prompt: "generate a first draft" }), "generate");
  assert.equal(chooseSmartAction({ hasDocument: true, prompt: "revise the clinical summary" }), "revise");
  assert.equal(chooseSmartAction({ hasDocument: true, prompt: "what is weak in this letter?" }), "chat");
});

test("buildSmartPromptAddendum includes legal and comparative guidance when relevant", () => {
  const intelligence = buildWorkspaceIntelligence({
    intake: {
      ...emptyIntakeModel(),
      diagnosis: "head and neck cancer",
      planType: "ERISA",
    },
    combinedContext: "ERISA appeal level 2",
    documentContent: "",
  });

  const addendum = buildSmartPromptAddendum(intelligence);
  assert.match(addendum, /trusted references/i);
  assert.match(addendum, /comparative treatment plan/i);
  assert.match(addendum, /not legal advice/i);
});
