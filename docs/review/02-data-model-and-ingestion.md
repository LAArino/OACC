# Revisión crítica OECP v3.0: ingesta (§3), modelo de datos (§4) y su impacto en §5.1

## 1. Comprobaciones factuales

- **OEAPI y OOAPI no son una errata.** Son el mismo estándar, la *Open Education API* de SURF (antes "Open Onderwijs API"). La documentación actual (oeapi.eu y la v6) usa "OEAPI". Conviene escribir "OEAPI (antes OOAPI)" una sola vez.
- **Versiones a octubre de 2026.** La versión estable es la **v5.0** (etiquetada en enero de 2026 y en uso desde mucho antes). La **v6.0 sigue en release candidate**: `v6.0-rc.3`, publicada el 30-09-2026. La v4 es *legacy*. El "Ingestor v4/v5" debería planificarse como **v5 + v6**, con la v4 opcional.
- **Modelo de recursos.**
  - **v5:** `organizations`, `educationSpecifications`, `programs`, `courses`, `components`, `offerings` (de programa, curso y componente), `academicSessions`, `persons`, `associations` (inscripciones), `groups`, `buildings`/`rooms` y `news`.
  - **v6-rc.3 rompe la compatibilidad:** elimina `educationSpecifications`, pasa a la grafía británica (`organisations`, `programmes`), separa los componentes en `learning-components` y `test-components`, da a cada tipo de oferta su propio endpoint (`/course-offerings`…), añade `offeringState` (`concept`/`active`/`inactive`/`cancelled`), `learning-outcomes` como recurso propio y `validFrom`/`validTo` en el curso.
  - Esto justifica tener una ACL, pero el canónico debería seguir la estructura **curso → oferta → sesión académica**.
- **Es una API de tipo pull.** OEAPI la sirve cada universidad mediante GET paginados.
  - La v5 solo permite escribir `persons` y `associations`. La v6 añade PUT/PATCH sobre las ofertas.
  - No hay **webhooks, callbacks ni parámetro de delta** (tipo `modifiedSince`).
  - El parámetro `since` filtra por la fecha de inicio de la sesión y **por defecto devuelve solo ofertas futuras**.
- **Idiomas.** En la v5, `teachingLanguage` es un código **ISO 639-2 de 3 letras** (`nld`). Los textos son arrays `LanguageTypedString {language:"en-GB", value}`. El spec usa ISO 639-1, así que hace falta un mapeo explícito.
- **Modalidad.**
  - **v5:** `distance-learning`, `on campus`, `online`, `hybrid`, `situated`.
  - **v6:** `blended`, `coil`, `hybrid`, `joint_delivery`, `online`, `presential`… y es extensible con `x-`.
  - El ENUM del spec (`online-sync`/`online-async`…) **no coincide con ninguna de las dos**. Ninguna fuente distingue síncrono de asíncrono, así que el filtro de §5.1 no tiene datos de origen. Además, un ENUM de PostgreSQL no encaja con enumeraciones extensibles.
- **eduXchange, EWP y ESCI.**
  - **eduXchange** es una plataforma de SURF que *consume* OEAPI (la spec incluye un perfil de consumidor `EDUXCHANGE`) y la usan alianzas como EuroTeQ. Independizarse de eduXchange es viable, pero el portal sigue dependiendo de OEAPI. Los socios que ya exponen OEAPI para eduXchange son los candidatos naturales al Canal A.
  - **EWP** forma parte de la *European Student Card Initiative*, junto con ESI, MyAcademicID y la Erasmus+ App. Ofrece una **Courses API** y una **Simple Course Replication API**: es un canal de catálogo que el spec ignora, y muchos socios tienen nodo EWP pero no OEAPI.
- **ELM.** El planteamiento de que ELM solo modela credenciales es inexacto. ELM v3 cubre también oportunidades de aprendizaje y cualificaciones mediante el perfil de aplicación **LOQ** (*Learning Opportunities and Qualifications*) que usa Europass. Aun así, la "alineación semántica" solo tiene sentido si se define y valida un mapeo o export a LOQ (`LearningOpportunity` / `LearningAchievementSpecification`). Un comentario en el SQL no la acredita.
- **ISCED-F 2013.**
  - Son códigos de 2, 3 o 4 dígitos (amplio, estrecho, detallado) con cero inicial (`0613`), así que deben guardarse como texto. `VARCHAR(10)` cabe pero no valida nada.
  - OEAPI v5 limita el código a 4 caracteres; la v6 admite hasta 6 (extensión neerlandesa SOI 2021).
  - Faltan tres cosas:
    - un `CHECK (isced_code ~ '^\d{2,6}$')`;
    - una tabla de referencia con etiquetas multilingües (el filtro "Humanidades, TIC…" corresponde al nivel de 2 dígitos);
    - soporte de varios códigos por curso para la oferta interdisciplinar.

## 2. Defectos del modelo de datos

**Bloqueantes**

1. **No hay tabla `organizations`.** `organization_id` es NOT NULL sin FK, y §5.2-B3 gestiona universidades, facultades y campus, lo que implica una jerarquía (`parent_id`). Sin esa tabla no tienen ancla ni el filtro "Por Partner" ni el RBAC. Debe incluir identificadores SCHAC, código Erasmus y PIC, y un nombre multilingüe.
2. **Faltan las claves naturales únicas.** No hay `UNIQUE (organization_id, ext_id)` en `courses` ni `UNIQUE (course_id, ext_offering_id)` en `course_offerings`. Sin ellas no hay upsert idempotente y cada reingesta duplica registros.
3. **No hay estrategia para generar las PK.** `course_id`/`offering_id` son `VARCHAR(100)` sin regla de generación. Conviene usar UUID (la v6 usa `uuid`) o `bigint identity` y dejar `ext_id` como clave natural.
4. **No hay ciclo de vida.** Sin `status` (draft/published/withdrawn/cancelled) ni `deleted_at`, un socio no puede despublicar un curso. Además, `ON DELETE CASCADE` borra en silencio ofertas e historial lógico. Recomiendo borrado lógico y `ON DELETE RESTRICT`.
5. **El multilingüismo es rígido.** `title_en NOT NULL` excluye a los socios sin inglés o les empuja a usar traducción automática. Tampoco admite más de dos idiomas (catalán/castellano, regiones belgas). OEAPI usa arrays por idioma. Las opciones son una tabla `course_texts(course_id, field, lang BCP47, value)` o JSONB `{lang: text}`, más una política de *fallback* documentada.

**Importantes**

6. **Calendario.** `semester INT` no modela trimestres, cuatrimestres, bloques ni cursos intensivos o de verano, y `academic_year VARCHAR(9)` no tiene CHECK. Propongo una tabla `academic_sessions` (tipo, padre, fechas) como la de OEAPI. Faltan también estos CHECK: `end_date >= start_date`, `ects_credits > 0` y `alliance_seats <= max_students`.
7. **`language_of_instruction VARCHAR(10)[]`.** Sirve con un índice GIN, pero no valida los códigos. La ACL debe normalizar entre ISO 639-1 y 639-2.
8. **Plazas remanentes.** §5.1 las muestra, pero no existe inscripción ni contador. OEAPI ofrece `enrolledNumberStudents` y `pendingNumberStudents`: hay que añadirlos con un timestamp de frescura o retirar la promesa.
9. **Faltan campos que necesita §5.1:**
   - URL de solicitud (`link` en OEAPI);
   - palabras clave (el buscador indexa "palabras clave" que no existen);
   - nivel bachelor/master/doctorado (`level`) y nivel EQF;
   - evaluación (`assessment`);
   - horas lectivas;
   - coordinador o contacto;
   - coste;
   - campus o ubicación;
   - `enrollStartDate`;
   - zona horaria, necesaria para las modalidades síncronas.
10. **`ext_metadata_history` está incompleta.** `entity_id` no tiene FK y `entity_type` es texto libre. Faltan `organization_id`, `sync_run_id`, un hash del payload (para deduplicar), la versión del esquema de origen y el resultado de validación. Crecerá sin límite, así que necesita retención y particionado mensual. Si guarda `persons` o coordinadores, aplica el RGPD.
11. **No existen las tablas que la UI de §5.2 presupone:**
    - `partner_integrations`: canal activo, endpoint, versión OEAPI, parámetro `consumer`, frecuencia y referencia a credenciales en un vault, nunca en claro.
    - `sync_runs`: estado y contadores de creados, actualizados, sin cambios, rechazados y retirados.
    - `sync_errors`: fila o JSON Pointer, código y mensaje.

    Sin ellas no hay "Monitor de Historial", ni "Configuración de Sincronización", ni semáforo de conectividad, ni deprecación por versión (§5.2-B2).
12. **No hay versionado ni auditoría de los registros canónicos** (quién cambió qué), algo imprescindible si el CRUD corrige datos ingeridos. Además, `updated_at` no tiene trigger y `course_offerings` no tiene `updated_at`.

**Búsqueda (§5.1).** El autocompletado multilingüe requiere una decisión explícita entre dos opciones:

- **PostgreSQL:** `tsvector` por idioma, con una configuración de *stemming* por lengua (algunas, como el catalán, no vienen de serie), más `pg_trgm` para prefijos y errores tipográficos, y `unaccent`. Basta para decenas de miles de cursos.
- **OpenSearch/Meilisearch:** mejora las facetas y la relevancia, pero añade un servicio y su sincronización.

El esquema actual, con dos columnas de texto fijas, condiciona ambas opciones.

## 3. Huecos en el diseño de ingesta

- **¿Push o pull?** OEAPI se cosecha (pull). Una ruta `/api/v1/ingest/ooapi/v5` implica que *alguien* envía payloads al portal, pero ¿quién: el SIS, un middleware del socio? Eso sería un contrato propio "con forma de OEAPI" que habría que especificar: lote o entidad, autenticación, verbos. Recomiendo que el Canal A sea un *harvester* programado y que el push quede, como mucho, como notificación que dispara un harvest.
- **Idempotencia.** La clave natural (organización + `primaryCode`/`ext_id`) más un hash de contenido evita escrituras sin cambios. En el push hace falta una cabecera `Idempotency-Key`.
- **Bajas.** Sin delta ni webhooks, solo se detectan por ausencia en un harvest completo. Recomiendo marcar `withdrawn` tras N ausencias y nunca cuando el harvest ha fallado o vino vacío. Hay que tener en cuenta el `since` por defecto (solo ofertas futuras).
- **Fallos parciales.** Hay que decidir si cada run es atómico o se procesa entidad a entidad. Recomiendo entidad a entidad con estado `partial`; una oferta cuyo curso se rechaza también se rechaza.
- **CSV.** Falta una plantilla versionada que fije:
  - las columnas y su mapeo al canónico;
  - UTF-8, el separador y el formato ISO 8601;
  - la codificación de multivalores e idiomas;
  - si se usa un fichero o dos (curso y oferta).

  El validador del navegador y el del servidor deben compartir **un único JSON Schema**, y el servidor revalida siempre.
- **Cambio de canal o canales mixtos.** Hace falta registrar `source_channel` por registro, tener un canal autoritativo por organización y fijar reglas para las ediciones manuales sobre datos de API: se sobrescriben, se bloquean o se marcan como *overrides*. Al migrar de canal hay que conservar los `ext_id`.
- **Contrato de errores.** Propongo RFC 9457 (`problem+json`) con ubicación (fila/columna o JSON Pointer), severidad y código estable.
- **Límites.** Hay que fijar el tamaño de CSV y payload, el máximo de filas, el *rate limit* **hacia** el SIS del socio, timeouts y reintentos con *backoff*.
- **Seguridad.** Los endpoints configurables por los socios abren riesgo de SSRF: hace falta una lista de destinos permitidos.

## 4. Preguntas que el owner debe responder antes de programar

1. ¿El Canal A es pull (harvest de la OEAPI de cada socio) o push, y en ese caso quién envía y con qué contrato?
2. ¿El MVP soporta v5 y v6 (todavía en RC) y descarta la v4?
3. ¿Cuál es la clave natural única de curso y de oferta por organización, y es estable entre cursos académicos?
4. ¿El inglés es obligatorio o se publican cursos solo en el idioma local, y con qué *fallback*?
5. ¿Qué estados de ciclo de vida existen y cómo despublica o cancela un socio desde cada canal?
6. ¿Puede una organización combinar canales y qué prevalece cuando se edita a mano un dato ingerido?
7. ¿Las plazas remanentes salen del SIS, las gestiona el portal o quedan fuera del alcance?
8. ¿Qué vocabulario de modalidad se adopta (el de OEAPI v6 o uno propio) y de dónde sale la distinción síncrono/asíncrono?
9. ¿EWP Courses API será un cuarto canal o queda explícitamente fuera?
10. ¿La búsqueda se hace en PostgreSQL o con un motor dedicado, y en qué idiomas debe funcionar el *stemming*?

---
Fuentes: [OEAPI spec (GitHub)](https://github.com/open-education-api/specification) · [releases](https://api.github.com/repos/open-education-api/specification/releases) · [OEAPI v6 docs](https://oeapi.eu/specification/v6.0/index.html) · [EuroTeQ/eduXchange](https://euroteq.eurotech-universities.eu/news/euroteq-course-catalogue-making-studying-abroad-easier-with-myacademicid-and-eduxchange/) · [EWP APIs overview](https://esci-sd.atlassian.net/wiki/spaces/ITSC/pages/111509524/APIs+-+overview) · [ELM v3 launch](https://europass.europa.eu/en/news/launch-european-learning-model-new-step-interoperability-learning) · [QDR/LOQ docs](https://europass.europa.eu/en/stakeholders/qdr/documentlibrary)
