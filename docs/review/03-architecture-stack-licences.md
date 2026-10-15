# Revisión crítica OECP v3.0: arquitectura, stack, licencias y definición de proyecto

## 0. Huecos de arquitectura (sección 1)

- **Faltan componentes:** motor de búsqueda (el "autocompletado en tiempo real" exige decidir entre PostgreSQL FTS y un motor dedicado), cola de trabajos para el CSV, planificador del *harvesting*, almacenamiento de ficheros y correo.
- **Monolito o microservicios:** el texto dice "contenedores independientes", pero el diagrama mete la ACL en el Backend Core. Recomiendo un **monolito modular**.
- **Sin autenticación máquina a máquina** para el canal *push* (API key, OAuth2 *client credentials* o mTLS).
- **Contradicción:** "indexa en tiempo real" no encaja con un *harvesting* periódico.
- **Ciclo de vida del dato sin definir:** borrador/publicado, cursos que desaparecen del origen, conflictos entre canales y origen de las "plazas remanentes".
- **Carga operativa alta para un equipo pequeño:** Java, PHP, Node/Python y PostgreSQL a la vez.

## 1. Decisiones "A o B" que hay que cerrar antes de escribir código

**Backend: NestJS (TypeScript).** La spec exige validar el CSV en el navegador y en el servidor: con TypeScript de punta a punta, el mismo esquema Zod, el modelo canónico y los DTO de OEAPI sirven en ambos lados, con un solo lenguaje, una cadena de herramientas y una CI. La estructura opinada de NestJS da coherencia cuando contribuyen varias universidades. FastAPI es igual de válido si el equipo ya domina Python; lo importante es decidir.

**Frontend: Vue 3 + Nuxt.** Curva de entrada más baja para el personal TI universitario que contribuye de forma ocasional; router, estado (Pinia) e i18n oficiales; Nuxt aporta el SSR que necesita el SEO del catálogo. Todo MIT. La accesibilidad depende de elegir una librería de componentes probada (por ejemplo, Reka UI).

**Gateway: Traefik Proxy (MIT).**
- Descubrimiento nativo en Docker y Kubernetes, TLS automático, *rate limiting* y ForwardAuth sin base de datos propia. La arquitectura no necesita la gestión de APIs de Kong.
- **Matiz sobre Kong:** el código de Kong Gateway OSS sigue siendo Apache 2.0, pero desde la 3.10 (marzo de 2025) no hay imágenes OSS precompiladas y el *free mode* desapareció. No hay comunicado oficial; lo confirman la comunidad, Supabase y un ADR de FOLIO. Plugins como OIDC son de pago. Kong obligaría a compilar el código uno mismo o a pasar a un nivel comercial, justo lo que la sección 6 promete evitar.

## 2. Licencias

- **Compatibilidad:** MIT, Apache 2.0, LGPL y PostgreSQL License son permisivas o de copyleft débil; pueden incorporarse a una obra EUPL o enlazarse con ella. La lista de compatibles del apéndice EUPL (GPL-2.0/3.0, AGPL-3.0, LGPL-2.1/3.0, MPL-2.0, EPL, OSL-3.0, CeCILL, LiLiQ, CC BY-SA 3.0 para datos) regula otra cosa: **redistribuir obra EUPL combinada bajo otra licencia**. Desplegar Keycloak, Traefik o PostgreSQL sin modificarlos no crea obra derivada; solo lo que se **modifica** (temas o SPI de Keycloak, módulos, *forks*). **La tabla de la sección 6 mezcla ambas cosas** y debe separar "dependencia desplegada" de "código derivado".
- **simpleSAMLphp:** es **LGPL-2.1-or-later** (con librerías incluidas bajo otras licencias, como xmlseclibs en BSD); el documento solo dice "LGPL".
- **simplesamlphp-module-oid4vp:** **EUPL-1.2** (Packagist, LAArino). Está en v1.0.0 y casi sin adopción, así que hay riesgo de *bus factor*. Debe seguir en su propio repositorio.
- **Contribuir a proyectos Apache 2.0:** los parches a Keycloak se aportan bajo Apache 2.0. Solo hay problema si nacen como código EUPL con varios autores, así que conviene desarrollarlos directamente en el repositorio original.
- **EUPL tiene cláusula de red:** dar acceso a las funcionalidades esenciales cuenta como distribución, así que quien despliegue una versión modificada debe publicar su código. Conviene decirlo explícitamente.
- **Cuidado al ampliar el stack:** mejor **Valkey** (BSD) que Redis (RSAL/SSPL/AGPL) y **OpenBao** (MPL-2.0) que Vault (BUSL). Grafana y Loki son AGPL, sin problema si no se modifican.
- **Gobernanza:**
  - **DCO** en lugar de CLA (*inbound = outbound* EUPL-1.2); un CLA solo hace falta para poder cambiar la licencia.
  - Contributor Covenant 2.1, SECURITY.md, GOVERNANCE.md, `publiccode.yml` y REUSE/SPDX.
  - **Titularidad:** el repositorio y la marca deberían ser de la **entidad jurídica de la alianza** o, si no existe, de una universidad coordinadora con un acuerdo firmado.
  - Revisar que el *grant agreement* de Erasmus+ permite publicar con EUPL.

## 3. Requisitos no funcionales ausentes

- **Hosting:** ¿quién aloja?, ¿una instancia por alianza o multi-alianza? Recomiendo **un despliegue por alianza** con varias organizaciones dentro.
- **Despliegue:** Docker Compose como referencia en el MVP y Helm en la v1.
- **Continuidad:** fijar SLO (por ejemplo, 99,5 %), RPO/RTO, *backups* PostgreSQL con PITR y pruebas de restauración. Prever picos cerca de los *application deadlines*.
- **Observabilidad:** OpenTelemetry, Prometheus/Grafana y logs centralizados. El "semáforo" de partners necesita métricas reales.
- **RGPD:** hay datos personales (atributos de administradores, auditoría y probablemente docentes dentro de `raw_payload`). Hay que definir **responsable** (entidad de la alianza o corresponsables según el art. 26), **encargado** (*hosting*, con DPA según el art. 28), retención del JSONB y registro de actividades (art. 30). La analítica pública debe ir sin cookies o con Matomo autoalojado.
- **Accesibilidad:** la Directiva (UE) 2016/2102 obliga a las universidades públicas a cumplir EN 301 549, es decir, **WCAG 2.1 AA**, con declaración de accesibilidad y mecanismo de reclamación. Recomiendo apuntar ya a WCAG 2.2.
- **i18n de la interfaz:** la spec cubre los idiomas del contenido, no los de la interfaz. Falta decidir idiomas, idioma de reserva y quién traduce (por ejemplo, con Weblate).
- **Datos abiertos y SEO:** exponer una **API pública de lectura compatible con OEAPI v5** para que eduXchange, SURFeduhub u otras alianzas recolecten el catálogo. Valorar exportación ELM y la *Courses API* de EWP. Añadir JSON-LD schema.org/Course y un sitemap.
- **Seguridad:** objetivo OWASP ASVS L2; claves de partners cifradas (OpenBao o pgcrypto); límites al CSV y protección contra inyección CSV; *rate limiting* del buscador en Traefik; SBOM, Renovate y SAST.
- **Calidad:** tests unitarios de los *transformers*, tests de contrato contra el OpenAPI de OEAPI, E2E y a11y con axe; CI/CD con firma de imágenes.

## 4. Alcance por fases

| Fase | Incluye | Se aplaza porque… |
|---|---|---|
| **MVP** | Catálogo público (búsqueda con PG FTS, filtros, ficha); panel con formulario (C) y CSV (B); Keycloak con login institucional SAML/eduGAIN y RBAC por organización; API pública OEAPI v5 (lectura); Compose; WCAG AA; interfaz en EN y un idioma más | — |
| **v1** | *Ingest* OEAPI **v5** (pull + push); monitor de sincronización; gestión de organizaciones; observabilidad; Helm; motor de búsqueda dedicado si PG no basta | Depende de que los partners tengan API real |
| **v2** | Wallet EUDI/OID4VP; OEAPI **v4**; consola de versiones; dashboard de analítica; exportación ELM/EWP | El **wallet** aporta poco a un panel de *staff* que ya tiene IdP institucional, y el ecosistema de atestaciones académicas aún madura. **v4** es una versión anterior a la actual (v5): solo se justifica si un partner concreto la necesita. La **analítica** no bloquea a nadie |

## 5. Definición del repositorio y del proyecto

- **Monorepo:** `apps/api`, `apps/web` (Nuxt con *layers* público y admin), `packages/schemas` (modelo canónico, DTO de OEAPI, plantilla CSV), `identity/keycloak`, `identity/simplesamlphp` (solo configuración), `deploy/compose`, `deploy/helm`, `docs/adr`. El módulo OID4VP sigue en su propio repositorio.
- **ADR** con formato MADR; las tres decisiones de la sección 1 serían las ADR-0001 a 0003.
- **Idioma:** **inglés** en el código, la documentación, los ADR y los *issues*, porque es lo que hace transferible un proyecto EUPL. Las guías de usuario pueden traducirse después.
- **Nomenclatura:** el estándar se llama ahora **Open Education API (OEAPI)**, antes OOAPI. El documento mezcla ambos nombres, incluidos el enum `ooapi_v4` y las rutas `/ooapi/`: hay que unificar en "OEAPI". También mezcla "W3C-VC" con SD-JWT.
- **Faltan:** *product owner*, equipo, presupuesto, calendario, inventario de partners (quién tiene API y de qué versión), métricas de éxito, modelo de soporte y responsabilidad sobre la exactitud de los contenidos.

## 6. Preguntas que el propietario debe responder antes de programar

1. ¿Qué entidad jurídica es titular del código, del repositorio y de la marca OECP, y quién actúa como responsable del tratamiento según el RGPD?
2. ¿Quién aloja y opera la instancia de producción, con qué presupuesto y con qué SLO, RPO y RTO?
3. ¿Qué perfil técnico tiene el equipo real, para confirmar NestJS + Vue/Nuxt + Traefik?
4. ¿Cuántos partners exponen hoy una API OEAPI, de qué versión, y quiénes usarán CSV o el formulario?
5. ¿El OECP debe publicar su propio catálogo como API OEAPI v5 de lectura para que otros lo recolecten?
6. ¿Puede el MVP prescindir del wallet EUDI y de OEAPI v4?
7. ¿Qué frescura de datos se exige, sobre todo para las plazas, y quién responde de su exactitud?
8. ¿Qué idiomas de interfaz son obligatorios en el lanzamiento y quién mantiene las traducciones?
9. ¿Hace falta un flujo de borrador, revisión y publicación, o cada partner publica directamente?
10. ¿Se acepta DCO con *inbound = outbound* EUPL-1.2 e inglés como idioma del proyecto?

---

**Fuentes:** [Kong #14405](https://github.com/Kong/kong/discussions/14405) · [Supabase changelog](https://supabase.com/changelog/48048-self-hosted-supabase-envoy-becomes-the-default-api-gateway-breaking-change.md) · [FOLIO DR-000045](https://folio-org.atlassian.net/wiki/spaces/TC/pages/1464008822) · [simpleSAMLphp COPYING](https://e.math.cornell.edu/lib/simplesamlphp/COPYING) · [oid4vp en Packagist](https://packagist.org/packages/laarino/simplesamlphp-module-oid4vp) · [EUPL v1.2](https://interoperable-europe.ec.europa.eu/sites/default/files/distribution/access_url/2024-10/e5101c2c-40b6-428e-a16e-a6ac9ade8a01/EUPL_v1.2.pdf) · [EUPL overview 2020](https://interoperable-europe.ec.europa.eu/sites/default/files/news/2020-12/EUPL%20overview%202020.pdf) · [UOC, accesibilidad](https://www.uoc.edu/en/accessibility) · [Especificación OEAPI](https://github.com/open-education-api/specification) · [GÉANT](https://connect.geant.org/2026/06/17/towards-an-interoperable-european-education-area)
