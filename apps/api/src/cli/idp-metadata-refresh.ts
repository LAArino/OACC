// SPDX-License-Identifier: EUPL-1.2
import { Injectable } from '@nestjs/common';
import {
  IdpMetadataRefreshService,
  type IdpRefreshOutcome,
  outcomeFailed,
} from '../identity/metadata-refresh/idp-metadata-refresh.service.js';
import {
  type CliOutput,
  EXIT,
  type ExitCode,
  type IdpMetadataRefreshCliOptions,
} from './program.js';

/** `oecp idp-metadata-refresh`: one run of the job, printed as a table. */
@Injectable()
export class IdpMetadataRefreshCommand {
  constructor(private readonly refresh: IdpMetadataRefreshService) {}

  async run(options: IdpMetadataRefreshCliOptions, output: CliOutput): Promise<ExitCode> {
    const outcome = await this.refresh.runOnce({
      dryRun: options.dryRun,
      verify: options.verify,
      ...(options.alias ? { aliases: [options.alias] } : {}),
      ...(options.file ? { file: options.file } : {}),
    });
    output.writeOut(formatOutcome(outcome));
    return outcomeFailed(outcome) ? EXIT.FAILURE : EXIT.OK;
  }
}

/** Human-readable report: aggregate line, one row per alias, warnings, summary. */
export function formatOutcome(outcome: IdpRefreshOutcome): string {
  if (outcome.status === 'not_configured') {
    return 'idp-metadata-refresh: OECP_IDP_METADATA_URL is not set and no --file given; nothing to do\n';
  }
  const lines: string[] = [];
  const a = outcome.aggregate;
  if (a) {
    lines.push(
      `aggregate: ${a.kind} ${a.location}` +
        `${a.verified ? ' (signature verified)' : ' (signature NOT verified)'}, ` +
        `${a.entityCount} entities, ${a.bytes} bytes, sha256 ${a.sha256.slice(0, 16)}…, ` +
        `validUntil ${a.validUntil ?? 'none'}`,
    );
  }
  if (outcome.aggregateError) lines.push(`aggregate: UNAVAILABLE: ${outcome.aggregateError}`);
  for (const w of outcome.warnings) lines.push(`warning: ${w}`);
  if (lines.length) lines.push('');

  const rows = outcome.results.map((r) => [
    r.alias,
    r.status,
    r.changes.join(', ') || '-',
    r.entityId ?? '-',
  ]);
  const header = ['ALIAS', 'STATUS', outcome.dryRun ? 'CHANGES (dry run)' : 'CHANGES', 'ENTITY ID'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const fmt = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd();
  lines.push(fmt(header));
  outcome.results.forEach((r, i) => {
    lines.push(fmt(rows[i]!));
    const indent = ' '.repeat(widths[0]! + 2);
    if (r.error) lines.push(`${indent}${r.status === 'failed' ? 'error' : 'reason'}: ${r.error}`);
    for (const w of r.warnings) lines.push(`${indent}warning: ${w}`);
  });
  if (outcome.results.length === 0) lines.push('(no organization with a keycloak_idp_alias)');

  const count = (s: string) => outcome.results.filter((r) => r.status === s).length;
  lines.push(
    '',
    `${outcome.dryRun ? 'dry run: ' : ''}${count('updated')} ${outcome.dryRun ? 'to update' : 'updated'}, ` +
      `${count('unchanged')} unchanged, ${count('skipped')} skipped, ${count('failed')} failed` +
      `${outcome.dryRun ? '; nothing written' : ''}`,
  );
  return `${lines.join('\n')}\n`;
}
