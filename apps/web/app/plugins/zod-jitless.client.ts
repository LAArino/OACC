// SPDX-License-Identifier: EUPL-1.2
// Zod 4 compiles object parsers with `new Function` when the page allows it, and
// finds out by calling `Function('')` once, when the first object schema is
// constructed. The portal's Content-Security-Policy has no `'unsafe-eval'`
// (server/plugins/csp.ts), so that probe is blocked and reported as a violation.
// `jitless` skips the probe; parsing gives the same results without the compiled
// fast path.
//
// The call is at module level, not in `setup()`: @oecp/schemas builds its schemas
// when its modules are evaluated, which for page chunks happens during the
// router's initial navigation, before plugins without dependencies run. Plugin
// modules are imported by the entry, so this line runs before any page chunk.
// (The CSV validator worker is a separate realm, served without a policy, so it
// keeps the fast path.)
import { z } from 'zod';

z.config({ jitless: true });

export default defineNuxtPlugin({ name: 'oecp:zod-jitless' });
