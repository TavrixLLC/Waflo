import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
}

export async function runExecutable(input: {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}): Promise<ProcessResult> {
  const path = process.env.PATH;
  const libraryPath = process.env.LD_LIBRARY_PATH;
  const { stdout, stderr } = await executeFile(input.executable, [...input.arguments], {
    timeout: input.timeoutMs,
    windowsHide: true,
    maxBuffer: 256 * 1024,
    env: {
      ...(path ? { PATH: path } : {}),
      ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}),
      LANG: "C.UTF-8",
      ...input.environment,
    },
  });
  return { stdout, stderr };
}
