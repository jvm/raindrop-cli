import { readFile } from "node:fs/promises";
import { CLIError, ExitCode } from "./errors.js";

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function parseData(
  input?: string,
): Promise<Record<string, unknown>> {
  if (!input) return {};
  let text: string;
  if (input === "-") text = await readStdin();
  else if (input.startsWith("@")) text = await readFile(input.slice(1), "utf8");
  else text = input;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("JSON body must be an object");
    return parsed as Record<string, unknown>;
  } catch (error: any) {
    throw new CLIError({
      code: "invalid_json",
      message: `Invalid JSON data: ${error.message}`,
      exitCode: ExitCode.Usage,
    });
  }
}

export function mergeBody(
  base: Record<string, unknown>,
  overrides: Record<string, unknown | undefined>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides))
    if (value !== undefined) result[key] = value;
  return result;
}
