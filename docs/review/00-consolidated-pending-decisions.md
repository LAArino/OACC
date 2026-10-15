# OECP v3.0: revisión consolidada y decisiones pendientes

Fecha: 14-10-2026. Fuente: tres revisiones independientes (identidad, modelo de datos e ingesta, arquitectura/stack/licencias) en esta carpeta, validadas desde la sesión principal. Donde una afirmación la he comprobado yo directamente se indica con **[verificado]**; el resto procede de los informes parciales con sus fuentes.

## 1. Veredicto corto

La idea es sólida y el alcance es el correcto para una alianza. Pero la especificación v3.0 todavía no se puede programar: tiene decisiones "A o B" abiertas, una capa de identidad más ambiciosa de lo que el MVP necesita, un modelo de datos al que le faltan las tablas de las que depende la propia interfaz descrita, y varias afirmaciones técnicas que no se sostienen tal como están escritas.

Recomendación: fijar las decisiones del apartado 4, reescribir la spec como v4.0 (en inglés) y empezar por un MVP sin wallet y solo con OEAPI v5 harvest + CSV + formulario.

## 2. Hallazgos que cambian la especificación

### 2.1 Identidad

- **El módulo `simplesamlphp-module-oid4vp` es tuyo** (LAArino, EUPL-1.2, v1.0.0 de septiembre 2026, último push 08-10-2026) **[verificado]**. La spec lo presenta como un componente externo "open-source"; conviene decir que es parte del proyecto, porque cambia la lectura del riesgo de mantenimiento (un solo mantenedor) y de auditoría (ninguna externa).
- **Dos fallos de seguridad en `PresentationVerifier.php` [verificado leyendo `main`]:**
  1. La clave del emisor se resuelve desde el `kid` de la cabecera del VC (cualquier `did:key` vale) y la confianza se comprueba después sobre el claim `iss`. Nada obliga a que el DID del `kid` sea el de `iss`. Un atacante puede firmar un VC con una clave propia y poner como `iss` el DID de una universidad de confianza.
  2. No hay vinculación del titular: no se comprueba que el firmante del VP coincida con `credentialSubject.id`, así que un VC robado se puede presentar desde otra wallet.
  Además solo se procesa el primer VC, `exp` del VP es opcional, la resolución `did:web` y el Universal Resolver hacen peticiones salientes a URLs que controla quien presenta (SSRF), y sin lista de confianza el módulo acepta cualquier emisor en "modo desarrollo".
- **La spec describe algo que el módulo no hace.** Solo acepta W3C VC en JWT (ES256, DIDs); SD-JWT VC, DCQL y `direct_post.jwt` figuran como planificados. Las wallets nacionales EUDI (ARF/HAIP) exigen SD-JWT VC o mdoc, cliente identificado por X.509 y certificado de registro del RP. Hoy el módulo encaja con el ecosistema EBSI/BLUE, no con "la EUDI Wallet". El texto "W3C VC (SD-JWT / JWT)" mezcla dos formatos distintos.
- **Keycloak 26.8 (01-10-2026) ya trae un verificador OID4VP experimental** con SD-JWT VC y DCQL. No está listo para producción, pero cambia la justificación de la sección 2.
- **Ninguna credencial académica prueba "admin de la Universidad X".** EducationalID, AllianceID y MyAcademicID acreditan identidad o afiliación. Los roles de administración deben asignarse localmente, y el modelo `uni_valencia_admin` (un rol por universidad) no escala: mejor un rol `partner_admin` más un claim `organization_id`.
- **MyAcademicID** es sobre todo el proxy IAM de GÉANT para Erasmus+/ESCI, no un "marco de credencial de DC4EU". El ESI solo se libera para estudiantes activos, así que no sirve para el personal del panel.
- **Para el MVP sobra simpleSAMLphp.** El panel lo usan los gestores de 9 o 10 socios, no toda eduGAIN. Keycloak solo, con un IdP SAML por socio y MFA local, basta. El contrato con el backend es el JWT de Keycloak, así que el proxy con OID4VP (o el verificador nativo de Keycloak cuando madure) se añade después como un IdP más.
- **Faltan:** registro del SP en la federación nacional con entity categories (REFEDS Personalized + CoCo v2 + Sirtfi), identificador estable (`subject-id`/`pairwise-id`, no ePPN), flujo de alta/baja de administradores y bootstrap del primer admin global, política de MFA, tiempos de sesión y logout propagado, DPIA y acuerdo de corresponsabilidad (art. 26 RGPD), y la declaración explícita de que el portal público no pasa por Keycloak.

### 2.2 Modelo de datos e ingesta

- **Nombre y versiones.** OEAPI y OOAPI son el mismo estándar de SURF; el nombre actual es OEAPI. La versión estable es la v5.0; la v6.0 está en release candidate (`v6.0-rc.3`, 30-09-2026) y rompe compatibilidad con v5 (elimina `educationSpecifications`, renombra recursos, añade `offeringState`). La v4 es legacy. El ingestor debe plantearse como **v5 + v6**, no v4 + v5. Unificar el nombre en todo el documento, incluido el enum y las rutas.
- **OEAPI es pull.** La sirve cada universidad con GET paginados, sin webhooks ni parámetro de delta. Una ruta "push" `/api/v1/ingest/ooapi/v5` necesita un contrato propio que la spec no define. Recomendación: el Canal A es un harvester programado; el push, como mucho, una notificación que dispara un harvest. Las bajas solo se detectan por ausencia en un harvest completo.
- **El ENUM de modalidad no coincide con OEAPI** (v5: `distance-learning`, `on campus`, `online`, `hybrid`, `situated`; v6: `blended`, `coil`, `hybrid`, `online`, `presential`, extensible). Ninguna fuente distingue síncrono de asíncrono, así que ese filtro no tendría datos.
- **Idiomas:** OEAPI v5 usa ISO 639-2 de tres letras y textos como arrays tipados por idioma BCP 47; la spec usa ISO 639-1 y dos columnas fijas. Hace falta mapeo explícito y una estructura multilingüe real (tabla `course_texts` o JSONB por idioma). `title_en NOT NULL` excluye socios sin inglés.
- **Bloqueantes del SQL:** no hay tabla `organizations` (con jerarquía, SCHAC, código Erasmus, PIC); no hay `UNIQUE (organization_id, ext_id)` ni `UNIQUE (course_id, ext_offering_id)`, así que cada reingesta duplica; las PK son VARCHAR sin regla de generación; no hay estado de ciclo de vida ni borrado lógico, así que un socio no puede despublicar; `ON DELETE CASCADE` borra ofertas en silencio.
- **Tablas que la UI presupone y no existen:** `partner_integrations` (canal, endpoint, versión, credenciales en vault), `sync_runs`, `sync_errors`, `academic_sessions`. Sin ellas no hay monitor de historial, ni configuración de sincronización, ni semáforo, ni deprecación por versión.
- **Campos que la ficha pública necesita y faltan:** URL de solicitud, palabras clave, nivel (bachelor/master, EQF), evaluación, horas, contacto, campus, `enrollStartDate`, zona horaria. Las "plazas remanentes" no tienen origen: OEAPI ofrece `enrolledNumberStudents`; hay que traerlo con timestamp de frescura o retirar la promesa.
- **ELM** no se limita a credenciales: el perfil LOQ cubre oportunidades de aprendizaje. La "alineación" solo vale si se define un export a LOQ. **ISCED-F** necesita CHECK, tabla de referencia multilingüe y soporte multivalor.
- **EWP Courses API** es un canal de catálogo que muchos socios tienen aunque no tengan OEAPI; la spec lo ignora.
- **Búsqueda:** decidir PostgreSQL (tsvector por idioma + pg_trgm + unaccent; el catalán no trae stemmer de serie) o motor dedicado. El esquema actual condiciona ambas opciones.

### 2.3 Arquitectura, stack y licencias

- **Kong ya no cumple la promesa de la sección 6:** el código sigue en Apache 2.0, pero desde la 3.10 (marzo 2025) no hay imágenes OSS ni free mode, y plugins como OIDC son de pago. Recomendación: **Traefik**.
- **Decisiones A/B recomendadas:** NestJS (TypeScript de punta a punta, mismo esquema Zod en navegador y servidor para el validador CSV), Vue 3 + Nuxt (SSR para SEO del catálogo, curva de entrada baja), Traefik. FastAPI es válido si el equipo es Python; lo importante es cerrar.
- **La tabla de licencias mezcla dos cosas:** desplegar Keycloak, Traefik o PostgreSQL sin modificarlos no crea obra derivada; solo lo modificado (temas, SPI, forks) importa. simpleSAMLphp es LGPL-2.1-or-later. EUPL tiene cláusula de red: quien despliegue una versión modificada debe publicar su código. Al ampliar el stack: Valkey en vez de Redis, OpenBao en vez de Vault.
- **Gobernanza:** DCO (no CLA), Contributor Covenant, SECURITY.md, GOVERNANCE.md, `publiccode.yml`, REUSE/SPDX. Titularidad del repositorio y la marca: entidad jurídica de la alianza o universidad coordinadora con acuerdo firmado. Comprobar que el grant agreement Erasmus+ permite EUPL.
- **Requisitos no funcionales ausentes:** hosting y operación, SLO/RPO/RTO, backups con PITR, observabilidad, RGPD (responsable/encargado, retención del JSONB, registro de actividades), accesibilidad (Directiva 2016/2102 obliga a EN 301 549 = WCAG 2.1 AA; apuntar a 2.2), i18n de la interfaz (no solo del contenido), API pública de lectura OEAPI v5 para que otros cosechen el catálogo, JSON-LD schema.org/Course, seguridad (OWASP ASVS L2, claves de partners cifradas, inyección CSV, rate limiting, lista de destinos permitidos para evitar SSRF), tests de contrato contra el OpenAPI de OEAPI.
- **Arquitectura:** faltan motor de búsqueda, cola de trabajos, planificador de harvest, almacenamiento de ficheros y correo. "Contenedores independientes" y "ACL dentro del Backend Core" se contradicen: mejor un monolito modular. No hay autenticación máquina a máquina para el canal push.

## 3. Fases propuestas

| Fase | Incluye | Se aplaza porque |
|---|---|---|
| MVP | Catálogo público (PG FTS, filtros, ficha), API pública OEAPI v5 de lectura, panel con formulario y CSV, Keycloak con SAML por socio y RBAC por organización, MFA, Docker Compose, WCAG AA, UI en EN + un idioma | |
| v1 | Harvester OEAPI v5 (y v6 cuando salga de RC), monitor de sincronización, gestión de organizaciones, observabilidad, Helm, motor de búsqueda dedicado si PG no basta | Depende de qué socios tienen API real |
| v2 | Wallet (OID4VP vía SSP o Keycloak nativo), EWP Courses API, OEAPI v4 si un socio lo exige, consola de versiones, analítica, export ELM/LOQ | La wallet aporta poco a un panel de staff con IdP institucional, y el módulo necesita las correcciones de 2.1 y SD-JWT VC antes de producción |

## 4. Decisiones que debes tomar antes de escribir código

Ordenadas por impacto. Cada una bloquea algo concreto.

1. **Alcance del MVP:** ¿sin wallet y sin OEAPI v4, con Keycloak solo? Bloquea la arquitectura de identidad entera.
2. **Titularidad y RGPD:** ¿qué entidad jurídica es dueña del código y la marca, responsable del tratamiento, y RP registrado ante eIDAS2 cuando toque? Bloquea licencias, DPIA y registro del SP en eduGAIN.
3. **Canal A, pull o push:** ¿harvest programado de la OEAPI de cada socio, o alguien envía payloads? Si push, ¿quién y con qué contrato? Bloquea el diseño de la ACL.
4. **Inventario de socios:** ¿cuántos tienen OEAPI (v5 o v6), cuántos EWP, cuántos solo CSV o formulario? Bloquea la prioridad de canales y si EWP entra.
5. **Clave natural y ciclo de vida:** ¿cuál es el identificador estable de curso y oferta por organización, qué estados existen y cómo despublica un socio desde cada canal? Bloquea el esquema.
6. **Multilingüismo:** ¿inglés obligatorio o se publican cursos solo en idioma local, con qué fallback, y cuántos idiomas por socio? Bloquea el esquema y la búsqueda.
7. **Vocabulario de modalidad:** ¿se adopta el de OEAPI v6 o uno propio, y de dónde saldría síncrono/asíncrono? Bloquea el filtro público y la plantilla CSV.
8. **Plazas remanentes:** ¿del SIS vía OEAPI, gestionadas en el portal, o fuera de alcance? Bloquea la ficha pública.
9. **Roles y altas:** ¿quién asigna y retira administradores de socio y globales, cómo se crea el primero, se exige MFA? Bloquea Keycloak.
10. **Stack y equipo:** ¿NestJS + Vue/Nuxt + Traefik, o FastAPI porque el equipo es Python? ¿Quién aloja y opera, con qué presupuesto y SLO? Bloquea el scaffolding.
11. **Idioma y gobernanza del proyecto:** ¿inglés en código, docs e issues, DCO con inbound = outbound EUPL-1.2, monorepo? Bloquea el primer commit.
12. **Canales mixtos:** ¿puede una organización combinar canales y qué prevalece cuando se edita a mano un dato ingerido? Bloquea el CRUD manual.

## 5. Acción inmediata independiente del portal

Corregir en `simplesamlphp-module-oid4vp`, antes de cualquier despliegue: (a) exigir que el DID del `kid` del VC coincida con `iss`, o resolver la clave a partir de `iss` y no del `kid`; (b) comprobar que el DID del firmante del VP coincide con `credentialSubject.id`; (c) bloquear el modo sin lista de confianza fuera de desarrollo; (d) restringir la resolución `did:web` y el Universal Resolver a dominios permitidos; (e) hacer obligatorio `exp` en el VP y procesar o rechazar explícitamente VPs con varios VC.
