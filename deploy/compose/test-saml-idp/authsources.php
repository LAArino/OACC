<?php
// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
//
// Authentication sources of the dev-only test SAML IdP (service `test-saml-idp`,
// profile `dev`). Users and their attributes come from users.json, which the
// Playwright suite in tools/e2e-identity reads too (one source of truth).

$users = json_decode(file_get_contents(__DIR__ . '/users.json'), true, 512, JSON_THROW_ON_ERROR)['users'];

$userpass = ['exampleauth:UserPass'];
foreach ($users as $name => $user) {
    $userpass[$name . ':' . $user['password']] = $user['attributes'];
}

$config = [
    'admin' => ['core:AdminPassword'],
    'urv-test-users' => $userpass,
];
