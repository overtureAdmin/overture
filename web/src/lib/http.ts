import { NextResponse } from "next/server";

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(
    {
      ok: true,
      requestId: crypto.randomUUID(),
      data,
    },
    { status },
  );
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json(
    {
      ok: false,
      requestId: crypto.randomUUID(),
      error: message,
    },
    { status },
  );
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
