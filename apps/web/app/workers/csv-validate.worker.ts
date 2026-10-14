// SPDX-License-Identifier: EUPL-1.2
// Web Worker of the CSV console (spec §6.3): decodes and validates the selected
// files off the main thread with the shared validator of @oecp/schemas. Loaded
// by composables/useCsvValidator.ts through Vite's
// `new Worker(new URL(…, import.meta.url), { type: 'module' })`.
// The files never leave the browser here, and nothing is logged.
import { type CsvValidationInput, runCsvValidation } from '../utils/csvConsole';

export interface CsvWorkerRequest {
  id: number;
  input: CsvValidationInput;
}

export type CsvWorkerResponse =
  | { id: number; ok: true; summary: ReturnType<typeof runCsvValidation> }
  | { id: number; ok: false };

interface WorkerScope {
  onmessage: ((event: MessageEvent<CsvWorkerRequest>) => void) | null;
  postMessage(message: CsvWorkerResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, input } = event.data;
  try {
    scope.postMessage({ id, ok: true, summary: runCsvValidation(input) });
  } catch {
    // The caller falls back to the main thread, which reports the failure.
    scope.postMessage({ id, ok: false });
  }
};
