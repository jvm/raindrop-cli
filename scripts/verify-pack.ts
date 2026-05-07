import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function main() {
  const { stdout } = await exec("pnpm", ["pack"], { cwd: process.cwd() });
  const tarball = stdout.trim().split(/\n/).at(-1);
  if (!tarball) throw new Error("pnpm pack did not return a tarball");

  const { stdout: packedFiles } = await exec("tar", ["-tzf", tarball], {
    cwd: process.cwd(),
  });
  const forbiddenFiles = packedFiles
    .trim()
    .split(/\n/)
    .filter((file) => /(^|\/)(PLAN|TODO)\.md$/i.test(file));
  if (forbiddenFiles.length) {
    throw new Error(
      `Forbidden planning files included in package: ${forbiddenFiles.join(", ")}`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "raindrop-cli-pack-"));
  try {
    await exec("pnpm", ["init"], { cwd: dir });
    await exec("pnpm", ["add", join(process.cwd(), tarball)], { cwd: dir });
    await exec("pnpm", ["exec", "raindrop", "--version"], { cwd: dir });
    await exec("pnpm", ["exec", "raindrop", "agent-context"], { cwd: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await main();
