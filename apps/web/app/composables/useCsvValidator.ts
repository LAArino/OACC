// SPDX-License-Identifier: EUPL-1.2
// Browser-side validation of the CSV console: in a Web Worker when the browser
// supports module workers, else (or if the worker fails) on the main thread.
// Both paths run the same `runCsvValidation` (utils/csvConsole.ts).
import {
  type CsvValidationInput,
  type CsvValidationSummary,
  runCsvValidation,
} from '../utils/csvConsole';
import type { CsvWorkerRequest, CsvWorkerResponse } from '../workers/csv-validate.worker';

let nextId = 1;

function validateInWorker(input: CsvValidationInput): Promise<CsvValidationSummary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/csv-validate.worker.ts', import.meta.url), {
      type: 'module',
      name: 'oecp-csv-validate',
    });
    const id = nextId++;
    const done = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<CsvWorkerResponse>) => {
      if (event.data.id !== id) return;
      done();
      if (event.data.ok) resolve(event.data.summary);
      else reject(new Error('CSV validation failed in the worker'));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      done();
      reject(new Error('CSV validation worker unavailable'));
    };
    worker.onmessageerror = () => {
      done();
      reject(new Error('CSV validation worker message error'));
    };
    const request: CsvWorkerRequest = { id, input };
    // Copied, not transferred: the main-thread fallback may still need the bytes.
    worker.postMessage(request);
  });
}

export interface CsvValidatorOptions {
  /** `false` forces the main-thread path (tests, or browsers without module workers). */
  worker?: boolean;
}

export function useCsvValidator(options: CsvValidatorOptions = {}) {
  const useWorker = options.worker ?? true;
  return {
    async validate(input: CsvValidationInput): Promise<CsvValidationSummary> {
      if (useWorker && typeof Worker !== 'undefined') {
        try {
          return await validateInWorker(input);
        } catch {
          // Fall through: e.g. module workers unsupported or the chunk failed to load.
        }
      }
      return runCsvValidation(input);
    },
  };
}
