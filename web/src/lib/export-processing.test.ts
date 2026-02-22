import assert from "node:assert/strict";
import test from "node:test";
import { processExportQueue } from "./export-processing.ts";

test("processExportQueue stops when no queued jobs remain", async () => {
  let calls = 0;
  const result = await processExportQueue({
    limit: 10,
    processOne: async () => {
      calls += 1;
      if (calls === 1) {
        return { outcome: "completed", exportId: "a", storageKey: "k" } as const;
      }
      return { outcome: "none" } as const;
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.requestedLimit, 10);
  assert.equal(result.processedCount, 1);
  assert.deepEqual(result.processed, [{ exportId: "a", outcome: "completed", storageKey: "k" }]);
});

test("processExportQueue records failures", async () => {
  const seq = [
    { outcome: "failed", exportId: "x", reason: "boom" } as const,
    { outcome: "completed", exportId: "y", storageKey: "obj" } as const,
  ];
  const result = await processExportQueue({
    limit: 2,
    processOne: async () => seq.shift() ?? ({ outcome: "none" } as const),
  });

  assert.equal(result.processedCount, 2);
  assert.deepEqual(result.processed, [
    { exportId: "x", outcome: "failed", reason: "boom" },
    { exportId: "y", outcome: "completed", storageKey: "obj" },
  ]);
});
