// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Atomic provider config filesystem boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export class ProviderConfigurationFileError extends Error {
  readonly code: "path_violation" | "revision_conflict" | "io_failed";
  readonly resourceId: string | undefined;
  readonly currentRevision: string | undefined;

  constructor(input: {
    code: ProviderConfigurationFileError["code"];
    message: string;
    resourceId?: string;
    currentRevision?: string;
  }) {
    super(input.message);
    this.name = "ProviderConfigurationFileError";
    this.code = input.code;
    this.resourceId = input.resourceId;
    this.currentRevision = input.currentRevision;
  }
}

export interface ConfigurationFileSnapshot {
  readonly contents: string;
  readonly revision: string;
  readonly exists: boolean;
}

export interface ConfigurationFileChange {
  readonly relativePath: string;
  readonly expectedRevision: string;
  readonly operation: "write" | "delete";
  readonly contents?: string;
}

const revisionOf = (contents: string, exists: boolean): string =>
  NodeCrypto.createHash("sha256")
    .update(exists ? "file\0" : "missing\0")
    .update(contents)
    .digest("hex");

const isWithin = (root: string, candidate: string): boolean => {
  const delta = NodePath.relative(root, candidate);
  return (
    delta === "" ||
    (!delta.startsWith(`..${NodePath.sep}`) && delta !== ".." && !NodePath.isAbsolute(delta))
  );
};

export async function resolveFileWithinRoot(root: string, relativePath: string): Promise<string> {
  if (relativePath.length === 0 || NodePath.isAbsolute(relativePath)) {
    throw new ProviderConfigurationFileError({
      code: "path_violation",
      message: "Configuration paths must be non-empty and relative.",
      resourceId: relativePath,
    });
  }
  const canonicalRoot = await NodeFSP.realpath(root);
  const candidate = NodePath.resolve(canonicalRoot, relativePath);
  if (!isWithin(canonicalRoot, candidate)) {
    throw new ProviderConfigurationFileError({
      code: "path_violation",
      message: "Configuration path resolves outside its provider-owned root.",
      resourceId: relativePath,
    });
  }

  let existingAncestor = NodePath.dirname(candidate);
  while (existingAncestor !== canonicalRoot) {
    try {
      const canonicalAncestor = await NodeFSP.realpath(existingAncestor);
      if (!isWithin(canonicalRoot, canonicalAncestor)) {
        throw new ProviderConfigurationFileError({
          code: "path_violation",
          message: "Configuration path traverses a symlink outside its provider-owned root.",
          resourceId: relativePath,
        });
      }
      break;
    } catch (error) {
      if (error instanceof ProviderConfigurationFileError) throw error;
      existingAncestor = NodePath.dirname(existingAncestor);
      if (!isWithin(canonicalRoot, existingAncestor)) break;
    }
  }

  try {
    const metadata = await NodeFSP.lstat(candidate);
    if (metadata.isSymbolicLink()) {
      const canonicalCandidate = await NodeFSP.realpath(candidate);
      if (!isWithin(canonicalRoot, canonicalCandidate)) {
        throw new ProviderConfigurationFileError({
          code: "path_violation",
          message: "Configuration file symlink resolves outside its provider-owned root.",
          resourceId: relativePath,
        });
      }
    }
  } catch (error) {
    if (error instanceof ProviderConfigurationFileError) throw error;
  }
  return candidate;
}

export async function readConfigurationFile(
  root: string,
  relativePath: string,
): Promise<ConfigurationFileSnapshot> {
  const filePath = await resolveFileWithinRoot(root, relativePath);
  try {
    const contents = await NodeFSP.readFile(filePath, "utf8");
    return { contents, revision: revisionOf(contents, true), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { contents: "", revision: revisionOf("", false), exists: false };
    }
    throw error;
  }
}

export async function applyConfigurationFiles(
  root: string,
  changes: ReadonlyArray<ConfigurationFileChange>,
): Promise<{ readonly backups: ReadonlyArray<string> }> {
  const resolved = await Promise.all(
    changes.map(async (change) => ({
      change,
      filePath: await resolveFileWithinRoot(root, change.relativePath),
      current: await readConfigurationFile(root, change.relativePath),
    })),
  );

  for (const entry of resolved) {
    if (entry.current.revision !== entry.change.expectedRevision) {
      throw new ProviderConfigurationFileError({
        code: "revision_conflict",
        message: `Configuration resource '${entry.change.relativePath}' changed outside T3Code.`,
        resourceId: entry.change.relativePath,
        currentRevision: entry.current.revision,
      });
    }
  }

  const backupDirectory = NodePath.join(await NodeFSP.realpath(root), ".t3code-backups");
  const backups: string[] = [];
  if (resolved.some((entry) => entry.current.exists))
    await NodeFSP.mkdir(backupDirectory, { recursive: true });

  for (const entry of resolved) {
    if (entry.current.exists) {
      const backupPath = NodePath.join(
        backupDirectory,
        `${entry.change.relativePath.replaceAll(NodePath.sep, "_")}.${NodeCrypto.randomUUID()}.bak`,
      );
      await NodeFSP.copyFile(entry.filePath, backupPath);
      backups.push(backupPath);
    }

    if (entry.change.operation === "delete") {
      await NodeFSP.rm(entry.filePath, { force: true });
      continue;
    }

    await NodeFSP.mkdir(NodePath.dirname(entry.filePath), { recursive: true });
    const temporaryPath = NodePath.join(
      NodePath.dirname(entry.filePath),
      `.${NodeCrypto.randomUUID()}.t3code.tmp`,
    );
    const mode = entry.current.exists ? (await NodeFSP.stat(entry.filePath)).mode & 0o777 : 0o600;
    await NodeFSP.writeFile(temporaryPath, entry.change.contents ?? "", { mode });
    await NodeFSP.chmod(temporaryPath, mode);
    await NodeFSP.rename(temporaryPath, entry.filePath);
  }

  return { backups };
}
