// SPDX-License-Identifier: EUPL-1.2
/**
 * OpenAPI documents of /api/public/v1 and /api/admin/v1: valid OpenAPI 3.1, in
 * sync with every route the Nest application registers (paths, methods, roles,
 * success status), equal to the committed copies in docs/api/, and served.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { INestApplication, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Validator } from '@seriousme/openapi-schema-validator';
import type { Ajv as AjvInstance } from 'ajv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdminJwtGuard } from '../../src/admin/auth/admin-jwt.guard.js';
import { AllowRoleless, RequireRoles } from '../../src/admin/auth/decorators.js';
import {
  buildOpenApiDocuments,
  OPENAPI_FILE_NAMES,
  type OpenApiDocument,
  rootPackageVersion,
  serializeOpenApiDocument,
} from '../../src/openapi/document.js';
import { OpenApiModule } from '../../src/openapi/openapi.module.js';

const require = createRequire(import.meta.url);
const Ajv2020 = (require('ajv/dist/2020') as { default: typeof AjvInstance }).default;
const addFormats = (require('ajv-formats') as { default: (ajv: AjvInstance) => AjvInstance })
  .default;

const version = rootPackageVersion();
const documents = buildOpenApiDocuments(version);
const APIS = ['public', 'admin'] as const;
const PREFIX = { public: '/api/public/v1', admin: '/api/admin/v1' } as const;

interface Route {
  method: string;
  path: string;
  controller: Type;
  handler: (...args: unknown[]) => unknown;
}

/** Placeholder configuration so that importing AppModule passes env validation. */
const ENV = {
  DATABASE_URL: 'postgres://oecp@localhost/oecp',
  VALKEY_URL: 'redis://localhost:6379',
  KEYCLOAK_ISSUER: 'https://auth.example.org/realms/oecp',
  KEYCLOAK_JWKS_URL: 'https://auth.example.org/realms/oecp/protocol/openid-connect/certs',
  OECP_MASTER_KEY_FILE: '/run/secrets/oecp_master_key',
  OECP_PUBLIC_BASE_URL: 'https://campus.example.org',
  KEYCLOAK_ADMIN_URL: 'http://keycloak:8080',
  KEYCLOAK_ADMIN_CLIENT_SECRET_FILE: '/run/secrets/oecp_backend_client_secret',
};

type ModuleRef =
  Type | { module: Type; imports?: unknown[]; controllers?: Type[] } | Promise<unknown>;

/** Every controller reachable from the module, following static and dynamic imports. */
async function controllersOf(root: ModuleRef): Promise<Set<Type>> {
  const controllers = new Set<Type>();
  const seen = new Set<unknown>();
  const visit = async (entry: unknown): Promise<void> => {
    let ref = entry instanceof Promise ? await entry : entry;
    if (ref && typeof ref === 'object' && 'forwardRef' in ref) {
      ref = (ref as { forwardRef: () => unknown }).forwardRef();
    }
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    const dynamic = typeof ref === 'object' && 'module' in ref;
    const cls = (dynamic ? (ref as { module: Type }).module : ref) as Type;
    const extra = dynamic ? (ref as { imports?: unknown[]; controllers?: Type[] }) : {};
    for (const c of [
      ...((Reflect.getMetadata('controllers', cls) as Type[] | undefined) ?? []),
      ...(extra.controllers ?? []),
    ]) {
      controllers.add(c);
    }
    for (const i of [
      ...((Reflect.getMetadata('imports', cls) as unknown[] | undefined) ?? []),
      ...(extra.imports ?? []),
    ]) {
      await visit(i);
    }
  };
  await visit(root);
  return controllers;
}

const asArray = (v: string | string[] | undefined): string[] =>
  v === undefined ? [''] : Array.isArray(v) ? v : [v];

function routesOf(controller: Type): Route[] {
  const routes: Route[] = [];
  const prototype = controller.prototype as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(prototype)) {
    const handler = prototype[name];
    if (name === 'constructor' || typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) continue;
    for (const base of asArray(Reflect.getMetadata(PATH_METADATA, controller))) {
      for (const path of asArray(Reflect.getMetadata(PATH_METADATA, handler))) {
        const joined = `/${[base, path].filter(Boolean).join('/')}`
          .replace(/\/+/g, '/')
          .replace(/(.)\/$/, '$1')
          .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        routes.push({
          method: RequestMethod[method].toLowerCase(),
          path: joined,
          controller,
          handler: handler as Route['handler'],
        });
      }
    }
  }
  return routes;
}

function operations(document: OpenApiDocument): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) out.set(`${method} ${path}`, operation);
  }
  return out;
}

describe('OpenAPI documents', () => {
  it.each(APIS)('%s: is a valid OpenAPI 3.1 document', async (api) => {
    const document = documents[api];
    const result = await new Validator().validate(document);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(document['openapi']).toMatch(/^3\.1\./);
    expect(document.info.version).toBe(version);
    expect(document['info']).toMatchObject({
      license: { identifier: 'EUPL-1.2' },
      'x-oecp-spec': expect.stringContaining('docs/spec-v4.1.md'),
    });
  });

  it.each(APIS)('%s: every component schema compiles as JSON Schema 2020-12', (api) => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(documents[api] as object, 'doc');
    const schemas = (documents[api]['components'] as { schemas: Record<string, unknown> }).schemas;
    for (const name of Object.keys(schemas)) {
      expect(() => ajv.compile({ $ref: `doc#/components/schemas/${name}` }), name).not.toThrow();
    }
  });

  it.each(APIS)('%s: operation ids are unique and stable in form', (api) => {
    const ids = [...operations(documents[api]).values()].map((op) => op['operationId'] as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(new RegExp(`^${api}[A-Z][A-Za-z]+$`));
  });

  it('the error code enum lists every stable code', () => {
    const errors = JSON.parse(
      readFileSync(new URL('../../../../packages/schemas/errors.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    const schemas = (
      documents.admin['components'] as { schemas: Record<string, { enum?: string[] }> }
    ).schemas;
    expect(schemas['ErrorCode']?.enum).toEqual(Object.keys(errors));
    expect(Object.keys(errors)).toHaveLength(138);
  });

  it.each(APIS)('%s: the committed copy in docs/api is up to date', (api) => {
    const file = new URL(`../../../../docs/api/${OPENAPI_FILE_NAMES[api]}`, import.meta.url);
    const committed = readFileSync(file, 'utf8');
    const upToDate = committed === serializeOpenApiDocument(documents[api]);
    expect(upToDate, `docs/api/${OPENAPI_FILE_NAMES[api]}: run \`pnpm openapi:generate\``).toBe(
      true,
    );
  });
});

describe('OpenAPI route coverage', () => {
  let routes: Route[];

  beforeAll(async () => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    const { AppModule } = await import('../../src/app.module.js');
    routes = [...(await controllersOf(AppModule))].flatMap(routesOf);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it.each(APIS)('%s: documents every route and nothing else', (api) => {
    const registered = routes
      .filter((r) => r.path === PREFIX[api] || r.path.startsWith(`${PREFIX[api]}/`))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    const documented = [...operations(documents[api]).keys()].sort();
    expect(registered.length).toBeGreaterThan(0);
    expect(documented).toEqual(registered);
  });

  it.each(APIS)('%s: roles and security match the guards', (api) => {
    const reflector = new Reflector();
    const ops = operations(documents[api]);
    for (const route of routes.filter((r) => r.path.startsWith(`${PREFIX[api]}/`))) {
      const operation = ops.get(`${route.method} ${route.path}`) as Record<string, unknown>;
      const label = `${route.method.toUpperCase()} ${route.path}`;
      const guards = [
        ...((Reflect.getMetadata(GUARDS_METADATA, route.controller) as unknown[]) ?? []),
        ...((Reflect.getMetadata(GUARDS_METADATA, route.handler) as unknown[]) ?? []),
      ];
      const guarded = guards.includes(AdminJwtGuard);
      if (api === 'public') {
        expect(guarded, label).toBe(false);
        expect(operation['security'], label).toBeUndefined();
        continue;
      }
      let expected: string[];
      if (!guarded) {
        expected = ['anonymous'];
        expect(operation['security'], label).toEqual([]);
      } else {
        const targets = [route.handler, route.controller];
        const required = reflector.getAllAndOverride(RequireRoles, targets);
        const roleless = reflector.getAllAndOverride(AllowRoleless, targets) === true;
        expected = required
          ? [...required]
          : ['partner_admin', 'alliance_admin', ...(roleless ? ['role-less'] : [])];
        expect(operation['security'], label).toBeUndefined();
      }
      expect([...(operation['x-oecp-roles'] as string[])].sort(), label).toEqual(expected.sort());
    }
  });

  it.each(APIS)('%s: documents the success status of every handler', (api) => {
    const ops = operations(documents[api]);
    for (const route of routes.filter((r) => r.path.startsWith(`${PREFIX[api]}/`))) {
      const status =
        (Reflect.getMetadata(HTTP_CODE_METADATA, route.handler) as number | undefined) ??
        (route.method === 'post' ? 201 : 200);
      const operation = ops.get(`${route.method} ${route.path}`) as {
        responses: Record<string, unknown>;
      };
      expect(Object.keys(operation.responses), `${route.method} ${route.path}`).toContain(
        String(status),
      );
    }
  });
});

describe('OpenAPI endpoints', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [OpenApiModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(APIS)('GET /api/%s/v1/openapi.json is anonymous and cacheable', async (api) => {
    const response = await request(app.getHttpServer())
      .get(`${PREFIX[api]}/openapi.json`)
      .expect(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['cache-control']).toBe('public, max-age=3600');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.text).toBe(serializeOpenApiDocument(documents[api]));
    const etag = response.headers['etag'] as string;
    expect(etag).toBeTruthy();
    await request(app.getHttpServer())
      .get(`${PREFIX[api]}/openapi.json`)
      .set('If-None-Match', etag)
      .expect(304);
  });
});
