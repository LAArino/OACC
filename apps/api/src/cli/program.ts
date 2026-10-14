// SPDX-License-Identifier: EUPL-1.2
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { email as emailSchema, INVITATION_MAX_TTL_HOURS, slug as slugSchema } from '@oecp/schemas';
import { Command, CommanderError, InvalidArgumentError } from 'commander';

/** Process exit codes of `oecp` commands. */
export const EXIT = {
  OK: 0,
  /** Runtime error (database, Keycloak, invalid seed file...). */
  FAILURE: 1,
  /** A precondition refused the operation (e.g. an alliance_admin already exists). */
  REFUSED: 2,
  /** Invalid command line (sysexits EX_USAGE). */
  USAGE: 64,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** `apps/api/db/seed/organizations.json`, from both `src/cli` and `dist/cli`. */
export const DEFAULT_SEED_FILE = fileURLToPath(
  new URL('../../db/seed/organizations.json', import.meta.url),
);
/** `apps/api/db/seed/attribute-definitions.json`, from both `src/cli` and `dist/cli`. */
export const DEFAULT_ATTRIBUTE_SEED_FILE = fileURLToPath(
  new URL('../../db/seed/attribute-definitions.json', import.meta.url),
);
export const BOOTSTRAP_TTL_HOURS = 24;

export interface SeedOrganizationsOptions {
  /** Absolute path. */
  file: string;
  dryRun: boolean;
}

export interface SeedAttributeDefinitionsOptions {
  /** Absolute path. */
  file: string;
  dryRun: boolean;
}

export interface BootstrapAllianceAdminOptions {
  email: string;
  org: string;
  ttlHours: number;
}

export interface StoreSecretOptions {
  /** Free label stored with the ciphertext, e.g. `surfeduhub`. */
  purpose: string;
}

export interface CliHandlers {
  seedOrganizations(options: SeedOrganizationsOptions): Promise<ExitCode>;
  seedAttributeDefinitions(options: SeedAttributeDefinitionsOptions): Promise<ExitCode>;
  bootstrapAllianceAdmin(options: BootstrapAllianceAdminOptions): Promise<ExitCode>;
  storeSecret(options: StoreSecretOptions): Promise<ExitCode>;
}

export interface CliOutput {
  writeOut(text: string): void;
  writeErr(text: string): void;
}

function parseEmail(value: string): string {
  const result = emailSchema.safeParse(value.trim());
  if (!result.success) throw new InvalidArgumentError('Not a valid e-mail address.');
  return result.data.toLowerCase();
}

function parseSlug(value: string): string {
  if (!slugSchema.safeParse(value).success) {
    throw new InvalidArgumentError('Expected an organization slug ([a-z0-9-]{2,40}).');
  }
  return value;
}

function parsePurpose(value: string): string {
  if (!/^[a-z0-9][a-z0-9:._-]{0,99}$/.test(value)) {
    throw new InvalidArgumentError(
      'Expected a purpose label ([a-z0-9:._-], up to 100 characters).',
    );
  }
  return value;
}

function parseTtlHours(value: string): number {
  const hours = Number(value);
  if (!/^\d+$/.test(value) || hours < 1 || hours > INVITATION_MAX_TTL_HOURS) {
    throw new InvalidArgumentError(`Expected an integer from 1 to ${INVITATION_MAX_TTL_HOURS}.`);
  }
  return hours;
}

/**
 * Command-line grammar of `oecp` (spec §2.1 bootstrap). Handlers do the work, so
 * parsing can be tested without a database or Keycloak.
 */
export function buildProgram(
  handlers: CliHandlers,
  output: CliOutput,
  onResult: (code: ExitCode) => void,
): Command {
  const program = new Command('oecp')
    .description('Open European Campus Portal operations (run inside the api container)')
    .exitOverride()
    .configureOutput({ writeOut: output.writeOut, writeErr: output.writeErr })
    .showHelpAfterError()
    .allowExcessArguments(false);

  program
    .command('seed-organizations')
    .description('Insert or update organizations from a JSON seed file, matched by slug')
    .option('--file <path>', 'seed file', DEFAULT_SEED_FILE)
    .option('--dry-run', 'validate the file and report the changes without writing', false)
    .action(async (opts: { file: string; dryRun: boolean }) => {
      onResult(await handlers.seedOrganizations({ file: resolve(opts.file), dryRun: opts.dryRun }));
    });

  program
    .command('seed-attribute-definitions')
    .description(
      "Insert or update the alliance's course attribute definitions from a JSON seed file, " +
        'matched by key (definitions missing from the file are kept)',
    )
    .option('--file <path>', 'seed file', DEFAULT_ATTRIBUTE_SEED_FILE)
    .option('--dry-run', 'validate the file and report the changes without writing', false)
    .action(async (opts: { file: string; dryRun: boolean }) => {
      onResult(
        await handlers.seedAttributeDefinitions({ file: resolve(opts.file), dryRun: opts.dryRun }),
      );
    });

  program
    .command('bootstrap-alliance-admin')
    .description(
      'Invite the first alliance_admin and print the invitation link; ' +
        'refused once any alliance_admin or pending alliance_admin invitation exists',
    )
    .requiredOption('--email <email>', 'e-mail address of the invitee', parseEmail)
    .requiredOption('--org <slug>', 'slug of the alliance organization', parseSlug)
    .option(
      '--ttl-hours <hours>',
      'validity of the invitation link in hours',
      parseTtlHours,
      BOOTSTRAP_TTL_HOURS,
    )
    .action(async (opts: BootstrapAllianceAdminOptions) => {
      onResult(await handlers.bootstrapAllianceAdmin(opts));
    });

  program
    .command('store-secret')
    .description(
      'Encrypt a secret read from stdin into the secrets table and print its db:<uuid> ' +
        'reference (e.g. for SURFEDUHUB_SECRET_REF; Basic credentials as username:password)',
    )
    .requiredOption('--purpose <label>', 'label stored with the secret', parsePurpose)
    .action(async (opts: StoreSecretOptions) => {
      onResult(await handlers.storeSecret(opts));
    });

  return program;
}

/** Parses `argv` (without node and script) and runs the selected command. */
export async function runProgram(
  argv: readonly string[],
  handlers: CliHandlers,
  output: CliOutput,
): Promise<ExitCode> {
  let code: ExitCode = EXIT.OK;
  const program = buildProgram(handlers, output, (result) => (code = result));
  try {
    if (argv.length === 0) {
      program.outputHelp({ error: true });
      return EXIT.USAGE;
    }
    await program.parseAsync([...argv], { from: 'user' });
    return code;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? EXIT.OK : EXIT.USAGE;
    }
    throw error;
  }
}
