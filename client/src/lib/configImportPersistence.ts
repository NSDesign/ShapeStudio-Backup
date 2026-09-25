export type ImportPersistenceStep<T> = {
  saveNext: () => Promise<void>;
  restorePrevious: () => Promise<void>;
};

export interface CoordinatedImportOptions<T> {
  steps: ImportPersistenceStep<T>[];
  commitRuntime: () => void;
  restoreRuntime: () => void;
}

/**
 * Runs the independent persistence writes as one client-side transaction.
 * A step is considered dirty before its save starts because a transport can
 * fail after applying the write but before returning a response.
 */
export async function persistImportedConfiguration<T>({
  steps,
  commitRuntime,
  restoreRuntime,
}: CoordinatedImportOptions<T>): Promise<void> {
  const attempted: ImportPersistenceStep<T>[] = [];
  try {
    for (const step of steps) {
      attempted.push(step);
      await step.saveNext();
    }
    commitRuntime();
  } catch (error) {
    restoreRuntime();
    const recoveryErrors: string[] = [];
    for (const step of attempted.reverse()) {
      try {
        await step.restorePrevious();
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError instanceof Error ? recoveryError.message : 'unknown recovery error');
      }
    }
    if (recoveryErrors.length) {
      const message = error instanceof Error ? error.message : 'Configuration import failed.';
      throw new Error(`${message} Recovery also failed: ${recoveryErrors.join('; ')}`);
    }
    throw error;
  }
}