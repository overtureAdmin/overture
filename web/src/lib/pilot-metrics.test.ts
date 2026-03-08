import assert from "node:assert/strict";
import test from "node:test";
import {
  countFollowUpQuestions,
  createInitialPilotMetrics,
  getDraftTimeSeconds,
  withDerivedFollowUpCount,
  withFirstDraftReady,
  withFirstDraftRequested,
  withSatisfaction,
} from "./pilot-metrics.ts";

test("records first draft requested and ready once", () => {
  const initial = createInitialPilotMetrics("thread-1", "2026-02-23T00:00:00.000Z");
  const requested = withFirstDraftRequested(initial, "2026-02-23T00:00:10.000Z");
  const requestedAgain = withFirstDraftRequested(requested, "2026-02-23T00:00:20.000Z");
  const ready = withFirstDraftReady(requestedAgain, "2026-02-23T00:00:50.000Z");

  assert.equal(requested.firstDraftRequestedAt, "2026-02-23T00:00:10.000Z");
  assert.equal(requestedAgain.firstDraftRequestedAt, "2026-02-23T00:00:10.000Z");
  assert.equal(ready.firstDraftReadyAt, "2026-02-23T00:00:50.000Z");
  assert.equal(getDraftTimeSeconds(ready), 40);
});

test("counts follow-up user messages after first draft ready", () => {
  const messages = [
    { id: "m1", role: "user", content: "before", createdAt: "2026-02-23T00:00:05.000Z" },
    { id: "m2", role: "assistant", content: "reply", createdAt: "2026-02-23T00:00:06.000Z" },
    { id: "m3", role: "user", content: "after one", createdAt: "2026-02-23T00:01:05.000Z" },
    { id: "m4", role: "user", content: "after two", createdAt: "2026-02-23T00:01:10.000Z" },
  ] as const;

  const count = countFollowUpQuestions([...messages], "2026-02-23T00:01:00.000Z");
  assert.equal(count, 2);
});

test("applies derived follow-up and satisfaction updates", () => {
  const initial = createInitialPilotMetrics("thread-2", "2026-02-23T00:00:00.000Z");
  const ready = withFirstDraftReady(initial, "2026-02-23T00:00:10.000Z");
  const withFollowUp = withDerivedFollowUpCount(
    ready,
    [
      { id: "u1", role: "user", content: "q1", createdAt: "2026-02-23T00:00:11.000Z" },
      { id: "a1", role: "assistant", content: "a1", createdAt: "2026-02-23T00:00:12.000Z" },
      { id: "u2", role: "user", content: "q2", createdAt: "2026-02-23T00:00:13.000Z" },
    ],
    "2026-02-23T00:00:20.000Z",
  );

  const satisfied = withSatisfaction(withFollowUp, 5, "Great", "2026-02-23T00:00:21.000Z");

  assert.equal(withFollowUp.followUpQuestionCount, 2);
  assert.equal(satisfied.satisfactionScore, 5);
  assert.equal(satisfied.satisfactionNotes, "Great");
});
