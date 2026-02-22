import {
  BedrockRuntimeClient,
  ConverseCommand,
  Message,
} from "@aws-sdk/client-bedrock-runtime";
import { optionalEnv } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __unityAppealsBedrockClient: BedrockRuntimeClient | undefined;
}

export type BedrockTextRequest = {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
};

const NON_PHI_POLICY_PROMPT =
  "Hard rule: PHI processing is disabled. Do not include patient names, dates of birth, phone numbers, emails, addresses, MRN/member IDs, policy IDs, SSNs, or any uniquely identifying details.";

const PHI_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: "phone", pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/ },
  { label: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { label: "dob", pattern: /\b(?:dob|date of birth)\b\s*[:#-]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/i },
  {
    label: "id",
    pattern: /\b(?:mrn|medical record number|member id|policy id|policy number)\b\s*[:#-]?\s*[A-Z0-9-]{4,}/i,
  },
  {
    label: "address",
    pattern: /\b\d{1,5}\s+[A-Z0-9][A-Z0-9\s.'-]{2,}\s(?:street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln)\b/i,
  },
];

export function findPhiFindings(text: string): string[] {
  return PHI_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

export class BedrockGuardrailError extends Error {
  constructor(
    public readonly code: "EMPTY_OUTPUT" | "PHI_DETECTED",
    message: string,
    public readonly findings: string[] = [],
  ) {
    super(message);
    this.name = "BedrockGuardrailError";
  }
}

export function getBedrockModelId(): string {
  return optionalEnv("BEDROCK_MODEL_ID") ?? "amazon.nova-lite-v1:0";
}

function getBedrockClient(): BedrockRuntimeClient {
  if (!global.__unityAppealsBedrockClient) {
    global.__unityAppealsBedrockClient = new BedrockRuntimeClient({
      region: optionalEnv("BEDROCK_REGION") ?? optionalEnv("AWS_REGION") ?? "us-east-1",
    });
  }
  return global.__unityAppealsBedrockClient;
}

function firstText(messages: Message[] | undefined): string | null {
  if (!messages) {
    return null;
  }
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if ("text" in part && typeof part.text === "string" && part.text.trim().length > 0) {
        return part.text.trim();
      }
    }
  }
  return null;
}

export async function generateTextWithBedrock({
  systemPrompt,
  userPrompt,
  maxTokens = 1200,
  temperature = 0.2,
}: BedrockTextRequest): Promise<string> {
  const fullSystemPrompt = `${systemPrompt}\n\n${NON_PHI_POLICY_PROMPT}`;
  const command = new ConverseCommand({
    modelId: getBedrockModelId(),
    system: [{ text: fullSystemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: userPrompt }],
      },
    ],
    inferenceConfig: {
      maxTokens,
      temperature,
    },
  });

  const response = await getBedrockClient().send(command);
  const text = firstText(response.output?.message ? [response.output.message] : undefined);
  if (!text) {
    throw new BedrockGuardrailError("EMPTY_OUTPUT", "Bedrock returned an empty response");
  }
  const findings = findPhiFindings(text);
  if (findings.length > 0) {
    throw new BedrockGuardrailError(
      "PHI_DETECTED",
      "Generated content violated PHI-disabled guardrails",
      findings,
    );
  }
  return text;
}
