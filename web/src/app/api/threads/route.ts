import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";

type CreateThreadBody = {
  patientCaseTitle: string;
};

const mockThreads = [
  {
    id: "thr_1001",
    title: "Smith, Jane - Lumbar MRI Appeal",
    updatedAt: "2026-02-21T19:00:00.000Z",
  },
  {
    id: "thr_1002",
    title: "Turner, Alex - LMN for CGM Coverage",
    updatedAt: "2026-02-21T19:10:00.000Z",
  },
];

export async function GET() {
  return jsonOk({ threads: mockThreads });
}

export async function POST(request: Request) {
  const body = await parseJsonBody<CreateThreadBody>(request);
  if (!body || !body.patientCaseTitle?.trim()) {
    return jsonError("Missing required field: patientCaseTitle", 422);
  }

  return jsonOk(
    {
      thread: {
        id: `thr_${crypto.randomUUID()}`,
        title: body.patientCaseTitle.trim(),
        updatedAt: new Date().toISOString(),
      },
    },
    201,
  );
}
