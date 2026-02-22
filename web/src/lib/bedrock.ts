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
  const command = new ConverseCommand({
    modelId: getBedrockModelId(),
    system: [{ text: systemPrompt }],
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
    throw new Error("Bedrock returned an empty response");
  }
  return text;
}
