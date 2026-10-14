# OECP: registro de decisiones del propietario

Respuestas a las preguntas de `docs/review/00-consolidado-decisiones-pendientes.md`. Fecha: 14-10-2026.

| # | Decisión | Respuesta |
|---|---|---|
| 1 | Alcance del MVP en identidad | Sin wallet. Autenticación con Keycloak local y federación eduGAIN. |
| 2 | Titularidad y RGPD | El código lo libera el autor (Lluís Alfons Ariño) sin coautores, bajo EUPL v1.2. Primera aplicación: alianza Aurora. La Fundación Aurora es **responsable del tratamiento** (decide qué se publica y gestiona a los administradores). La URV aloja la infraestructura del MVP y actúa como **encargada del tratamiento**; hace falta contrato de encargo (art. 28 RGPD) entre ambas. |
| 3 | Canal A pull o push | **Solo pull** en el MVP: harvester programado contra la OEAPI de cada socio (frecuencia diaria por defecto, botón "sincronizar ahora" en el panel). Bajas por ausencia en un harvest completo. La ruta de aviso ("cosecha ahora") y cualquier push de datos quedan fuera del MVP. |
| 4 | Inventario de socios | Con OEAPI en la última versión: UIBK, UICE, VUA, UDE. Sin OEAPI: URV, UNINA, UP, CBS, UPEC y la propia Fundación Aurora. Varios han declarado no tener capacidad técnica, de ahí el formulario y la carga CSV. |
| 5 | Multilingüismo | MVP en inglés, obligatorio. Desde el diseño, el portal debe poder consultarse en el idioma de cada universidad socia, con el inglés como fallback cuando un contenido no esté alimentado en ese idioma. |
| 6 | Clave natural y ciclo de vida | (por defecto, propuesto 14-10-2026) Clave única por organización + código de curso; estados draft / published / withdrawn / cancelled; el socio despublica cambiando el estado desde cualquier canal. |
| 7 | Vocabulario de modalidad | (por defecto) El de OEAPI v6 (online, presential, hybrid, blended, coil…), sin distinguir síncrono/asíncrono. |
| 8 | Plazas remanentes | (por defecto) Se muestran solo si el socio las informa, con fecha del último dato; si no, solo las plazas reservadas a la alianza. |
| 9 | Roles y altas | (por defecto) Roles `partner_admin` y `alliance_admin` con claim de organización; el admin global invita a los de socio; MFA obligatoria para administradores. |
| 10 | Stack y equipo | Desarrollo por el propietario con asistencia de Claude. NestJS + Vue 3/Nuxt + Traefik + PostgreSQL. Entregables de despliegue: Docker Compose (MVP) y chart de Helm, para que otras alianzas adopten la solución rápidamente. |
| 11 | Idioma y gobernanza | (por defecto) Monorepo, inglés en código y documentación, DCO con inbound = outbound EUPL v1.2. |
| 12 | Canales mixtos | (por defecto) Un canal autoritativo por organización; las ediciones manuales sobre datos cosechados se guardan como overrides explícitos que sobreviven al siguiente harvest. |
| 13 | OEAPI de los socios | Las OEAPI de UIBK, UICE, VUA y UDE son las mismas que cosecha eduXchange (confirmado por el propietario). |
| 14 | Vía de acceso a las OEAPI | **Directo a cada universidad** (UIBK, UICE, VUA, UDE), con credencial y acuerdo bilateral por socio, para minimizar dependencias de SURF. El modo SURFeduhub queda solo como alternativa de respaldo. |
| 15 | Registro del SP en la federación | Confirmado: un único SP registrado en SIR (RedIRIS) con exportación a eduGAIN y metadatos multi-ACS; VUA vía SURFconext, CBS vía WAYF. |
| 16 | Erasmus+ y EUPL | Confirmado por el propietario: las condiciones del grant agreement permiten publicar bajo EUPL v1.2. |
