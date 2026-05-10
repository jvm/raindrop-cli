const nodeOptions = process.env.NODE_OPTIONS ?? "";
if (!nodeOptions.split(/\s+/).includes("--no-deprecation")) {
  process.env.NODE_OPTIONS = `${nodeOptions} --no-deprecation`.trim();
}
