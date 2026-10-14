// SPDX-License-Identifier: EUPL-1.2
/**
 * `oecp` operations CLI, run inside the api container:
 *   node dist/cli.js seed-organizations [--file <path>] [--dry-run]
 *   node dist/cli.js seed-attribute-definitions [--file <path>] [--dry-run]
 *   node dist/cli.js bootstrap-alliance-admin --email <e> --org <slug> [--ttl-hours 24]
 *   printf %s "$SECRET" | node dist/cli.js store-secret --purpose surfeduhub
 */
import 'reflect-metadata';
import { ConsoleLogger, type INestApplicationContext, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { BootstrapAllianceAdminCommand } from './cli/bootstrap-alliance-admin.js';
import { CliModule } from './cli/cli.module.js';
import {
  type CliHandlers,
  type CliOutput,
  EXIT,
  type ExitCode,
  runProgram,
} from './cli/program.js';
import { SeedAttributeDefinitionsCommand } from './cli/seed-attribute-definitions.js';
import { SeedOrganizationsCommand } from './cli/seed-organizations.js';
import { readStdin, StoreSecretCommand } from './cli/store-secret.js';

const output: CliOutput = {
  writeOut: (text) => process.stdout.write(text),
  writeErr: (text) => process.stderr.write(text),
};

/** Nest's console logger, but on stderr only (used until pino takes over, and on boot errors). */
class StderrLogger extends ConsoleLogger {
  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
  ): void {
    super.printMessages(messages, context, logLevel, 'stderr');
  }
}

/** Boots the Nest application context only once a command has been parsed. */
async function withContext(
  run: (app: INestApplicationContext) => Promise<ExitCode>,
): Promise<ExitCode> {
  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(CliModule, {
      logger: new StderrLogger(),
      bufferLogs: true,
      abortOnError: false,
    });
    app.useLogger(app.get(Logger));
    return await run(app);
  } catch (error) {
    output.writeErr(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.FAILURE;
  } finally {
    await app?.close();
  }
}

const handlers: CliHandlers = {
  seedOrganizations: (options) =>
    withContext((app) => app.get(SeedOrganizationsCommand).run(options, output)),
  seedAttributeDefinitions: (options) =>
    withContext((app) => app.get(SeedAttributeDefinitionsCommand).run(options, output)),
  bootstrapAllianceAdmin: (options) =>
    withContext((app) => app.get(BootstrapAllianceAdminCommand).run(options, output)),
  storeSecret: async (options) => {
    const secret = await readStdin(process.stdin);
    return withContext((app) => app.get(StoreSecretCommand).run(options, secret, output));
  },
};

process.exit(await runProgram(process.argv.slice(2), handlers, output));
