<?php
// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
//
// Hosted IdP of the dev-only test SAML IdP: plays "URV" (organization `urv`,
// Keycloak IdP alias `urv`). Signing key: cert/idp.urv.test.{key,crt}, a
// development-only key pair committed on purpose (CN=idp.urv.test, valid until
// 2036-10-11); its certificate is pasted into identity/keycloak/realm-oecp.yaml.
// The image's built-in test key cannot be used: its certificate expired in
// 2020 and Keycloak ignores expired IdP certificates ("Ignoring invalid
// certificate", then invalid_signature).

$metadata['https://idp.urv.test/saml2/idp'] = [
    'host' => '__DEFAULT__',
    'privatekey' => 'idp.urv.test.key',
    'certificate' => 'idp.urv.test.crt',
    'auth' => 'urv-test-users',
    // Attributes are released under their urn:oid / urn:oasis names, as eduGAIN
    // IdPs do (REFEDS attribute profile).
    'attributes.NameFormat' => 'urn:oasis:names:tc:SAML:2.0:attrname-format:uri',
    'signature.algorithm' => 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    'NameIDFormat' => 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
];
