import { homedir } from "node:os";
import { join } from "node:path";

export function configDir(): string {
  return (
    process.env.RAINDROP_CONFIG_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "raindrop")
  );
}

export function stateDir(): string {
  return join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "raindrop",
  );
}

export function configPath(): string {
  return join(configDir(), "config.toml");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

export function profilesPath(): string {
  return join(configDir(), "profiles.json");
}

export function feedbackPath(): string {
  return join(stateDir(), "feedback.jsonl");
}

export function jobsPath(): string {
  return join(stateDir(), "jobs.jsonl");
}
