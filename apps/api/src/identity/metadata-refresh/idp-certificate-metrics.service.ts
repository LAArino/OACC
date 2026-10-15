// SPDX-License-Identifier: EUPL-1.2
import { X509Certificate } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import type { IdpCertificateExpiry } from '../../metrics/run-metrics.js';
import { RunMetricsService } from '../../metrics/run-metrics.service.js';
import { KeycloakAdminService } from '../keycloak-admin.service.js';

/** The certificate expiries are also re-read this often (manual changes in Keycloak). */
export const IDP_CERTIFICATE_CHECK_INTERVAL_MS = 60 * 60_000;

/** PEM armour for a base64 DER certificate (Keycloak stores it without). */
function pem(der: string): string {
  const body = der.replace(/\s+/g, '');
  return `-----BEGIN CERTIFICATE-----\n${body.replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Latest `notAfter` among the certificates of a Keycloak SAML IdP
 * `signingCertificate` value (base64 DER, several separated by commas), or
 * undefined when it holds none that parses. Each unparsable certificate is
 * reported through `warn` (its position only) and skipped.
 */
export function latestCertificateExpiry(
  value: string | undefined,
  warn: (message: string) => void = () => undefined,
): Date | undefined {
  let latest: Date | undefined;
  const ders = (value ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
  ders.forEach((der, index) => {
    let notAfter: Date;
    try {
      notAfter = new Date(new X509Certificate(pem(der)).validTo);
    } catch (error) {
      warn(
        `signing certificate ${index + 1} of ${ders.length} not parsed: ${(error as Error).message}`,
      );
      return;
    }
    if (Number.isNaN(notAfter.getTime())) {
      warn(`signing certificate ${index + 1} of ${ders.length} has no readable notAfter`);
      return;
    }
    if (!latest || notAfter > latest) latest = notAfter;
  });
  return latest;
}

/**
 * Worker only (spec §10): `oecp_idp_certificate_expiry_timestamp_seconds{alias}`
 * from the `signingCertificate` of every identity provider of the realm (enabled
 * or not), read from Keycloak's Admin API at start-up, after every IdP metadata
 * refresh run and every {@link IDP_CERTIFICATE_CHECK_INTERVAL_MS}. When Keycloak
 * does not answer the previous values stay (and
 * `oecp_idp_certificate_check_last_success_timestamp_seconds` ages). Does
 * nothing without RunMetricsService (api, CLI) or with OECP_METRICS_ENABLED=false.
 */
@Injectable()
export class IdpCertificateMetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IdpCertificateMetricsService.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<boolean> | undefined;

  constructor(
    @Inject(KeycloakAdminService)
    private readonly keycloak: Pick<
      KeycloakAdminService,
      'listIdentityProviders' | 'getIdentityProvider'
    >,
    @Optional() private readonly metrics?: RunMetricsService,
  ) {}

  private get active(): boolean {
    return this.metrics?.enabled === true;
  }

  onApplicationBootstrap(): void {
    if (!this.active) return;
    // Not awaited: a slow or absent Keycloak must not delay the worker's start.
    void this.check();
    this.timer = setInterval(() => void this.check(), IDP_CERTIFICATE_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Re-reads the certificates (one check at a time); false when Keycloak did not answer. */
  check(): Promise<boolean> {
    if (!this.active) return Promise.resolve(false);
    this.running ??= this.read().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async read(): Promise<boolean> {
    const expiries: IdpCertificateExpiry[] = [];
    try {
      const idps = await this.keycloak.listIdentityProviders();
      for (const brief of idps) {
        if (brief.providerId !== undefined && brief.providerId !== 'saml') continue;
        const idp = await this.keycloak.getIdentityProvider(brief.alias);
        if (!idp || (idp.providerId ?? 'saml') !== 'saml') continue;
        const notAfter = latestCertificateExpiry(idp.config?.signingCertificate, (message) =>
          this.logger.warn(`Identity provider ${idp.alias}: ${message}`),
        );
        if (notAfter) expiries.push({ alias: idp.alias, enabled: idp.enabled !== false, notAfter });
      }
    } catch (error) {
      this.logger.warn(
        `IdP signing certificates not checked (previous values kept): ${(error as Error).message}`,
      );
      return false;
    }
    this.metrics?.idpCertificatesChecked(expiries, new Date());
    return true;
  }
}
