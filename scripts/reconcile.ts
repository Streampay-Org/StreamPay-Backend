#!/usr/bin/env ts-node
/** File-backed reference CLI; production deployments can replace the adapter with a DB adapter. */
import { promises as fs } from "fs";
import {
  InMemoryReconciliationSource,
  ReconciliationCheckpoint,
  ReconciliationCheckpointStore,
  ReconciliationRecord,
  ReconciliationService,
  parseCliArgs,
} from "../src/services/reconciliationService";

class JsonCheckpointStore implements ReconciliationCheckpointStore {
  constructor(private readonly path: string) {}
  async load(jobId: string): Promise<ReconciliationCheckpoint | null> {
    try {
      const value = JSON.parse(
        await fs.readFile(this.path, "utf8"),
      ) as ReconciliationCheckpoint;
      return value.jobId === jobId ? value : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async save(checkpoint: ReconciliationCheckpoint): Promise<void> {
    const temporaryPath = `${this.path}.tmp`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(temporaryPath, this.path);
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const records = JSON.parse(
    await fs.readFile(options.inputPath, "utf8"),
  ) as ReconciliationRecord[];
  if (!Array.isArray(records))
    throw new Error(
      "input file must contain an array of reconciliation records",
    );
  const source = new InMemoryReconciliationSource(records);
  const service = new ReconciliationService(
    source,
    new JsonCheckpointStore(options.checkpointPath),
  );
  const result = await service.run(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
