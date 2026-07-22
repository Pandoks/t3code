// Local fork "update": build the macOS dmg, quit the installed app, swap the
// bundle in /Applications, and relaunch it. Equivalent to a brew cask upgrade
// but sourced from the working tree.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const APP_NAME = "T3 Code (Alpha)";
const APP_BUNDLE = `${APP_NAME}.app`;
const INSTALL_PATH = `/Applications/${APP_BUNDLE}`;

const repoRoot = path.resolve(import.meta.dirname, "..");
const releaseDir = path.join(repoRoot, "release");

function run(command: string, args: ReadonlyArray<string>, allowFailure = false): string {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return result.stdout ?? "";
}

function log(message: string): void {
  console.log(`[install-desktop-local] ${message}`);
}

if (process.platform !== "darwin") {
  throw new Error("This script installs the macOS app bundle and only runs on macOS.");
}

log("Building desktop dmg...");
const build = spawnSync(
  "node",
  ["scripts/build-desktop-artifact.ts", "--platform", "mac", "--target", "dmg"],
  { cwd: repoRoot, stdio: "inherit" },
);
if (build.status !== 0) {
  throw new Error(`Desktop build failed with exit code ${build.status}`);
}

const dmgPath = fs
  .readdirSync(releaseDir)
  .filter((name) => /^T3-Code-.*\.dmg$/.test(name))
  .map((name) => path.join(releaseDir, name))
  .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
if (!dmgPath) {
  throw new Error(`No T3-Code-*.dmg found in ${releaseDir}`);
}
log(`Installing ${path.basename(dmgPath)}...`);

// A running instance keeps the old code alive even after the bundle is
// replaced, so quit it first and relaunch at the end.
const wasRunning =
  spawnSync("pgrep", ["-f", `${INSTALL_PATH}/Contents/MacOS/`], { stdio: "ignore" }).status === 0;
if (wasRunning) {
  log("Quitting running app...");
  run("osascript", ["-e", `tell application "${APP_NAME}" to quit`], true);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const alive =
      spawnSync("pgrep", ["-f", `${INSTALL_PATH}/Contents/MacOS/`], { stdio: "ignore" }).status ===
      0;
    if (!alive) break;
    spawnSync("sleep", ["0.5"]);
  }
}

const attachOutput = run("hdiutil", ["attach", "-nobrowse", dmgPath]);
const mountPoint = attachOutput
  .split("\n")
  .map((line) => line.trim().split("\t").at(-1) ?? "")
  .findLast((entry) => entry.startsWith("/Volumes/"));
if (!mountPoint) {
  throw new Error(`Could not determine mount point from hdiutil output:\n${attachOutput}`);
}

try {
  fs.rmSync(INSTALL_PATH, { recursive: true, force: true });
  run("cp", ["-R", path.join(mountPoint, APP_BUNDLE), "/Applications/"]);
} finally {
  run("hdiutil", ["detach", "-quiet", mountPoint], true);
}
log(`Installed ${INSTALL_PATH}`);

if (wasRunning) {
  log("Relaunching app...");
  run("open", ["-a", INSTALL_PATH], true);
}
log("Done.");
