// SPDX-License-Identifier: EUPL-1.2
import { Injectable } from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service.js';
import { type CliOutput, EXIT, type ExitCode, type StoreSecretOptions } from './program.js';

/** Reads all of stdin; one trailing newline (from `echo`) is removed. */
export async function readStdin(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

/** `oecp store-secret --purpose <label>`: prints the `db:<uuid>` reference, never the secret. */
@Injectable()
export class StoreSecretCommand {
  constructor(private readonly secrets: SecretsService) {}

  async run(options: StoreSecretOptions, secret: string, output: CliOutput): Promise<ExitCode> {
    if (secret.length === 0 || secret.length > 4096) {
      output.writeErr('Error: expected a secret of 1 to 4096 characters on stdin.\n');
      return EXIT.REFUSED;
    }
    const ref = await this.secrets.store(options.purpose, secret);
    output.writeOut(`${ref}\n`);
    return EXIT.OK;
  }
}
