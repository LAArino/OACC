-- SPDX-License-Identifier: EUPL-1.2
-- 0003_partner_base_url_http: let partner_integrations.base_url hold an http URL.
--
-- Why: 0001 restricts base_url to https in the database, so a development stack
-- cannot point a partner at the OEAPI mock (http://oeapi-mock:8090) at all. The
-- https-only rule of spec §6.2.6 is enforced by the API and the harvester, which
-- accept http (and non-443 ports, private addresses) only when the deployment
-- sets OECP_ALLOW_INSECURE_PARTNER_HTTP=true. The shape check (absolute URL, no
-- userinfo, query or fragment) stays in the database.

-- Up Migration
ALTER TABLE partner_integrations DROP CONSTRAINT IF EXISTS partner_integrations_base_url_check;
ALTER TABLE partner_integrations ADD CONSTRAINT partner_integrations_base_url_check
  CHECK (base_url ~ '^https?://[^/?#@]+(/[^?#]*)?$');

-- Down Migration
UPDATE partner_integrations SET base_url = NULL, enabled = false, access_mode = NULL,
  authoritative_channel = 'form'
  WHERE base_url !~ '^https://';
ALTER TABLE partner_integrations DROP CONSTRAINT IF EXISTS partner_integrations_base_url_check;
ALTER TABLE partner_integrations ADD CONSTRAINT partner_integrations_base_url_check
  CHECK (base_url ~ '^https://[^/?#@]+(/[^?#]*)?$');
