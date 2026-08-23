export interface SetupIntentReference {
  id: string;
  status: string;
}

export interface SetupIntentOperationResult<TSetupIntent extends SetupIntentReference> {
  setupIntent?: TSetupIntent | undefined;
  error?: unknown | undefined;
}

export type SetupConfirmationOutcome<TSetupIntent extends SetupIntentReference> =
  | {
      kind: "succeeded";
      setupIntent: TSetupIntent;
      recovered: boolean;
    }
  | {
      kind: "incomplete";
      setupIntent: TSetupIntent | undefined;
      providerError: unknown | undefined;
      timedOut: boolean;
    };

export class OperationTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} did not finish within ${timeoutMs}ms.`);
    this.name = "OperationTimeoutError";
  }
}

export function isOperationTimeoutError(error: unknown): error is OperationTimeoutError {
  return error instanceof OperationTimeoutError;
}

export async function withOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  operationName: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new OperationTimeoutError(operationName, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function confirmSetupWithRecovery<TSetupIntent extends SetupIntentReference>({
  confirm,
  retrieve,
  confirmationTimeoutMs = 25_000,
  recoveryTimeoutMs = 10_000,
}: {
  confirm: () => Promise<SetupIntentOperationResult<TSetupIntent>>;
  retrieve: () => Promise<SetupIntentOperationResult<TSetupIntent>>;
  confirmationTimeoutMs?: number;
  recoveryTimeoutMs?: number;
}): Promise<SetupConfirmationOutcome<TSetupIntent>> {
  let confirmationFailure: unknown;

  try {
    const result = await withOperationTimeout(
      confirm(),
      confirmationTimeoutMs,
      "Stripe card confirmation",
    );
    if (result.setupIntent?.status === "succeeded") {
      return { kind: "succeeded", setupIntent: result.setupIntent, recovered: false };
    }
    return {
      kind: "incomplete",
      setupIntent: result.setupIntent,
      providerError: result.error,
      timedOut: false,
    };
  } catch (error) {
    confirmationFailure = error;
  }

  try {
    const recovered = await withOperationTimeout(
      retrieve(),
      recoveryTimeoutMs,
      "Stripe card confirmation recovery",
    );
    if (recovered.setupIntent?.status === "succeeded") {
      return { kind: "succeeded", setupIntent: recovered.setupIntent, recovered: true };
    }
    return {
      kind: "incomplete",
      setupIntent: recovered.setupIntent,
      providerError: recovered.error ?? confirmationFailure,
      timedOut: isOperationTimeoutError(confirmationFailure),
    };
  } catch (recoveryFailure) {
    return {
      kind: "incomplete",
      setupIntent: undefined,
      providerError: confirmationFailure ?? recoveryFailure,
      timedOut:
        isOperationTimeoutError(confirmationFailure) || isOperationTimeoutError(recoveryFailure),
    };
  }
}
