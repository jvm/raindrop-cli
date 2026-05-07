export type OutputMode = "json" | "human";

let colorEnabled = !process.env.NO_COLOR && process.stdout.isTTY;

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function isColorEnabled(): boolean {
  return colorEnabled;
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeOutput(
  value: unknown,
  human: string | undefined,
  mode: OutputMode,
): void {
  if (mode === "human" && human) process.stdout.write(`${human}\n`);
  else writeJson(value);
}

export function table(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): string {
  if (rows.length === 0) return "(none)";
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const line = columns
    .map((c, i) => c.padEnd(widths[i] ?? c.length))
    .join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map((r) =>
      columns
        .map((c, i) => String(r[c] ?? "").padEnd(widths[i] ?? c.length))
        .join("  "),
    )
    .join("\n");
  return `${line}\n${sep}\n${body}`;
}

export function keyval(obj: Record<string, unknown>, indent = ""): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return `${indent}${k}:\n${keyval(v as Record<string, unknown>, indent + "  ")}`;
      }
      return `${indent}${k}: ${formatVal(v)}`;
    })
    .join("\n");
}

function formatVal(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "(none)";
  return String(v);
}

/** Format a single-object human summary */
export function itemSummary(
  label: string,
  fields: Record<string, unknown>,
): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      if (Array.isArray(v))
        return `  ${k}: ${v.length ? v.join(", ") : "(none)"}`;
      return `  ${k}: ${v}`;
    });
  return `${label}\n${lines.join("\n")}`;
}
