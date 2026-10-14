<?php
// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
//
// The OECP Keycloak broker as the only SP of the dev-only test SAML IdP.
//
// Entity ID and ACS are the PUBLIC ones (the browser posts the response to
// the auth host). The SP keys are not static: Keycloak generates the realm's
// signing and encryption keys at first start, so they are read from the
// broker's SP descriptor over the Docker network (TEST_IDP_SP_DESCRIPTOR_URL,
// http://keycloak:8080/...) and cached for 60 s. With them the IdP encrypts
// every assertion for Keycloak (spec §4: signed AND encrypted) and verifies
// Keycloak's signed AuthnRequests.

$spEntityId = getenv('TEST_IDP_SP_ENTITY_ID') ?: 'https://auth.oecp.localhost/realms/oecp';
$acs = getenv('TEST_IDP_SP_ACS_URL') ?: 'https://auth.oecp.localhost/realms/oecp/broker/urv/endpoint';
$descriptorUrl = getenv('TEST_IDP_SP_DESCRIPTOR_URL') ?: 'http://keycloak:8080/realms/oecp/broker/urv/endpoint/descriptor';

$cache = sys_get_temp_dir() . '/oecp-sp-descriptor.xml';
if (!is_file($cache) || filemtime($cache) < time() - 60) {
    $xml = @file_get_contents($descriptorUrl, false, stream_context_create(['http' => ['timeout' => 5]]));
    if ($xml === false || strpos($xml, 'EntityDescriptor') === false) {
        throw new \Exception("test-saml-idp: cannot read the SP descriptor at $descriptorUrl " .
            '(is IdP `urv` enabled in the realm? OECP_DEV_IDP_ENABLED=true + keycloak-config)');
    }
    file_put_contents($cache, $xml);
}
$doc = new \DOMDocument();
$doc->loadXML(file_get_contents($cache));
$xp = new \DOMXPath($doc);
$xp->registerNamespace('md', 'urn:oasis:names:tc:SAML:2.0:metadata');
$xp->registerNamespace('ds', 'http://www.w3.org/2000/09/xmldsig#');
$keys = [];
foreach ($xp->query('//md:SPSSODescriptor/md:KeyDescriptor') as $kd) {
    $use = $kd->getAttribute('use');
    foreach ($xp->query('.//ds:X509Certificate', $kd) as $cert) {
        $keys[] = [
            'type' => 'X509Certificate',
            'signing' => $use === '' || $use === 'signing',
            'encryption' => $use === '' || $use === 'encryption',
            'X509Certificate' => preg_replace('/\s+/', '', $cert->textContent),
        ];
    }
}

$metadata[$spEntityId] = [
    'AssertionConsumerService' => [[
        'Binding' => 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
        'Location' => $acs,
    ]],
    'NameIDFormat' => 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
    'attributes.NameFormat' => 'urn:oasis:names:tc:SAML:2.0:attrname-format:uri',
    'keys' => $keys,
    'validate.authnrequest' => true,
    'saml20.sign.assertion' => true,
    'saml20.sign.response' => true,
    'assertion.encryption' => true,
    'signature.algorithm' => 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
];
