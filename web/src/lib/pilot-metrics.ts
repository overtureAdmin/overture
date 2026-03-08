import type { ThreadMessage } from "@/lib/client-api";

export type PilotMetrics = {
  threadId: string;
  sessionStartedAt: string;
  firstDraftRequestedAt: string | null;
  firstDraftReadyAt: string | null;
  followUpQuestionCount: number;
  satisfactionScore: number | null;
  satisfactionNotes: string;
  lastUpdatedAt: string;
};

export function createInitialPilotMetrics(threadId: string, nowIso: string): PilotMetrics {
  return {
    threadId,
    sessionStartedAt: nowIso,
    firstDraftRequestedAt: null,
    firstDraftReadyAt: null,
    followUpQuestionCount: 0,
    satisfactionScore: null,
    satisfactionNotes: "",
    lastUpdatedAt: nowIso,
  };
}

export function withFirstDraftRequested(metrics: PilotMetrics, nowIso: string): PilotMetrics {
  if (metrics.firstDraftRequestedAt) {
    return metrics;
  }
  return {
    ...metrics,
    firstDraftRequestedAt: nowIso,
    lastUpdatedAt: nowIso,
  };
}

export function withFirstDraftReady(metrics: PilotMetrics, nowIso: string): PilotMetrics {
  if (metrics.firstDraftReadyAt) {
    return metrics;
  }
  return {
    ...metrics,
    firstDraftReadyAt: nowIso,
    lastUpdatedAt: nowIso,
  };
}

export function withSatisfaction(metrics: PilotMetrics, score: number | null, notes: string, nowIso: string): PilotMetrics {
  return {
    ...metrics,
    satisfactionScore: score,
    satisfactionNotes: notes,
    lastUpdatedAt: nowIso,
  };
}

export function countFollowUpQuestions(messages: ThreadMessage[], firstDraftReadyAt: string | null): number {
  if (!firstDraftReadyAt) {
    return 0;
  }
  const firstDraftTs = Date.parse(firstDraftReadyAt);
  if (Number.isNaN(firstDraftTs)) {
    return 0;
  }
  return messages.filter((message) => {
    if (message.role !== "user") {
      return false;
    }
    const messageTs = Date.parse(message.createdAt);
    if (Number.isNaN(messageTs)) {
      return false;
    }
    return messageTs > firstDraftTs;
  }).length;
}

export function withDerivedFollowUpCount(metrics: PilotMetrics, messages: ThreadMessage[], nowIso: string): PilotMetrics {
  const nextCount = countFollowUpQuestions(messages, metrics.firstDraftReadyAt);
  if (nextCount === metrics.followUpQuestionCount) {
    return metrics;
  }

  return {
    ...metrics,
    followUpQuestionCount: nextCount,
    lastUpdatedAt: nowIso,
  };
}

export function getDraftTimeSeconds(metrics: PilotMetrics): number | null {
  if (!metrics.firstDraftRequestedAt || !metrics.firstDraftReadyAt) {
    return null;
  }

  const requested = Date.parse(metrics.firstDraftRequestedAt);
  const ready = Date.parse(metrics.firstDraftReadyAt);
  if (Number.isNaN(requested) || Number.isNaN(ready) || ready < requested) {
    return null;
  }

  return Math.round((ready - requested) / 1000);
}
