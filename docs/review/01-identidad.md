# Revisión crítica: Capa de Identidad OECP v3.0 (sección 2 y RBAC de 5.2)

*Fecha de verificación: 14-10-2026. Alcance: solo identidad y autorización.*

## 1. Comprobaciones factuales

| Afirmación del spec | Estado | Detalle |
|---|---|---|
| `simplesamlphp-module-oid4vp` es un módulo open-source existente | **Correcto, pero inmaduro** | Repositorio `LAArino/simplesamlphp-module-oid4vp`, EUPL-1.2, mantenido por una sola persona (Lluís Alfons Ariño). v1.0.0 del 09-09-2026, unos 15 commits, 3 instalaciones en Packagist, 0 dependientes. Hay tests PHPUnit y un wallet simulado. Sin auditoría externa. |
| La wallet entrega una EAA "W3C VC (SD-JWT / JWT)" | **Incorrecto** | El módulo solo acepta **W3C VC en JWT** (ES256, DIDs `did:key/jwk/web/ebsi/blue`). SD-JWT VC, DCQL y `direct_post.jwt` figuran como *planned*. Además, SD-JWT VC es un formato IETF y no un W3C VC. |
| "Pipeline de verificación de 12 pasos" | **Existe, pero es incompleto** | Los 12 pasos están en `PresentationVerifier.php`. Faltan: revocación (StatusList, *planned*), vinculación del holder y vinculación de la clave del emisor (ver abajo). |
| "EUDI Wallet" | **Engañoso** | El ARF/HAIP exige **SD-JWT VC y mdoc**, cliente identificado por X.509 (`x509_san_dns`/`x509_hash`), certificado de acceso y certificado de registro del RP. El módulo está pensado para wallets del ecosistema EBSI/BLUE (basadas en DID) y no para las wallets nacionales EUDI. |
| eduGAIN: "limitaciones nativas de Keycloak" | **Correcto** | Keycloak no importa agregados de federación: cada IdP se da de alta por separado, con un ACS por alias. El patrón establecido es poner un proxy delante (SATOSA en CERN, o SSP). Keycloak 26.8 (01-10-2026) no cambia esto. |
| Keycloak no hace OID4VP | **Ya no es cierto** | Keycloak 26.8 trae un verificador OID4VP **experimental** (feature `oid4vc-vp`) con SD-JWT VC, DCQL y `x509_hash`. Según un análisis de terceros, no aplica la consulta DCQL y no está listo para producción. |
| MyAcademicID es un "marco de credencial DC4EU" | **Impreciso** | MyAcademicID es sobre todo el **proxy IAM de GÉANT (eduTEAMS)** para Erasmus+/ESCI, que se apoya en eduGAIN y eIDAS y transporta el ESI. Existe un esquema VC MyAcademicID en EBSI, pero es secundario. |
| EducationalID / AllianceID | **Parcialmente verificado** | Ambos son esquemas EBSI (`VerifiableEducationalID`, "Verifiable AllianceID") definidos con alianzas y GÉANT. **No pude verificar** que DC4EU los presente como "catálogo de tres marcos", ni el ámbito exacto de AllianceID (en EBSI: "persona física que participa en la Alianza"). |
| ESI | **Correcto** | `urn:schac:personalUniqueCode:int:esi:<country-code|sHO>:<code>`. Solo se libera para **estudiantes activos**, así que es irrelevante para el personal que usa el panel. |
| BLUE | **No verificado** | Red BLUE (CRUE/RedIRIS) existe. No encontré documentación pública de `did:blue` ni de su Trusted Issuers Registry. |
| eIDAS2: "carteras obligatorias" | **Exagerado** | Los Estados deben ofrecer una wallet antes del **24-12-2026**. El registro de RPs se rige por el Reglamento de Ejecución (UE) 2025/848. Ningún texto obliga a un portal de catálogo a aceptar wallets para su panel de personal. Las fechas proceden de fuentes secundarias y conviene confirmarlas en el DOUE. |

**Hallazgos de seguridad en el módulo** (lectura de `main` a 14-10-2026; deben confirmarse con tests antes de producción):

1. **La clave del emisor no está ligada a `iss`.** La clave se resuelve desde `kid` en la cabecera del VC, pero la confianza se comprueba sobre el claim `iss`. Nada obliga a que el DID de `kid` coincida con `iss`. Esto permitiría falsificar un VC firmado con un `did:key` propio y con `iss` de una universidad de confianza.
2. **No hay vinculación del holder.** No se comprueba que el firmante del VP sea `credentialSubject.id`, así que un VC robado puede reutilizarse en otro VP.
3. `exp` del VP es opcional. Solo se procesa el primer VC.
4. La resolución `did:web` y el *Universal Resolver* hacen peticiones salientes a URLs controladas por quien presenta la credencial, con riesgo de SSRF y fugas de privacidad.
5. Si no se configura una lista de confianza, el módulo acepta cualquier `did:key` en modo "desarrollo". Esto debe bloquearse en producción.

## 2. Huecos de diseño que bloquean la implementación

- **Quién es el RP o verificador.** La alianza suele carecer de personalidad jurídica. Hay que decidir qué entidad se registra ante el registrador nacional (Reglamento 2025/848), obtiene los certificados de acceso y de registro, y figura como responsable del tratamiento.
- **Marco de confianza de emisores.** El spec no dice si se usará EBSI TIR, BLUE, las Trusted Lists eIDAS o una lista estática. Tampoco quién da de alta a los emisores de cada socio ni cómo se revocan.
- **Ninguna credencial prueba "admin de la Universidad X".** EducationalID, AllianceID y MyAcademicID acreditan identidad o afiliación (en el mejor caso, `staff`). **Roles como `uni_valencia_admin` no pueden derivarse de atributos externos**: deben asignarse localmente.
- **Aprovisionamiento de roles.** Faltan el flujo de invitación o alta, quién asigna los roles (¿el admin global?), el *bootstrap* del primer admin global, la baja automática y la recertificación periódica.
- **Modelo de roles.** Un rol por universidad (`uni_valencia_admin`) no escala. Es mejor un rol `partner_admin` más un claim `organization_id`, usando Keycloak Organizations o grupos. También falta la tabla que mapea `schacHomeOrganization` a `organization_id`.
- **Identificador estable y vinculación de cuentas.** `eduPersonPrincipalName` es reasignable. Es preferible SAML `subject-id`/`pairwise-id`. En el módulo, `eduPersonTargetedID` es un md5 del DID y no es pairwise. Vincular la identidad SAML con la de la wallet debe hacerse de forma **explícita y con sesión activa**: nunca automáticamente por email, porque eso abre la puerta a la toma de cuentas.
- **Registro en eduGAIN.** El SP debe registrarse en una federación nacional (por ejemplo SIR/RedIRIS) con entity categories. R&S probablemente **no aplica** a un panel de gestión. Lo adecuado es **REFEDS Personalized + CoCo v2**, más Sirtfi y una política de privacidad. Sin esto, muchos IdPs no liberarán atributos.
- **MFA y nivel de garantía.** Hay que decidir si se exige la REFEDS MFA Profile (`AuthnContextClassRef`) o un segundo factor local en Keycloak (WebAuthn/TOTP). Para usuarios con permisos de escritura sobre el catálogo, recomiendo hacerlo obligatorio.
- **Sesiones.** Faltan el TTL del access token, el refresh, el SSO idle/max, el logout y su propagación (SLO entre SSP, Keycloak y el SPA) y la revocación inmediata de roles.
- **Portal público.** Debe declararse explícitamente que **no pasa por Keycloak**: sin cookies de sesión y con rutas del gateway separadas.
- **RGPD.** Faltan la RPA, la **DPIA** (por las credenciales verificables y los logs), el acuerdo de **corresponsabilidad** (art. 26) entre socios, la retención de atributos en Keycloak y en los ficheros de sesión de SSP, y la minimización. El ESI no debe almacenarse si no se usa.
- **Una credencial por authsource.** Soportar los tres marcos requiere tres fuentes de autenticación y tres mapeos. La "invariabilidad del core" solo se mantiene si el backend consume únicamente `organization_id` y el rol.

## 3. Simplificación: ¿hace falta simpleSAMLphp en el MVP?

**El problema real es pequeño.** El panel solo lo usa el personal de unos 9–10 socios, no "toda la federación eduGAIN".

- **Opción A (recomendada para el MVP): solo Keycloak.** Se configura un IdP SAML por socio, con metadatos firmados de eduGAIN o de la federación nacional y refresco programado. MFA local, sin wallet. *Pros:* una sola pila (Java), menos superficie de ataque, logout más sencillo. *Contras:* alta manual de cada IdP, ACS por alias (hay que verificar cómo se publica la metadata del SP en la federación) y nada de wallet.
- **Opción B: Keycloak con SSP como IdP-proxy** (el diseño actual). Tiene sentido **solo si el login con wallet es un requisito del MVP**. *Pros:* discovery eduGAIN completo (metarefresh) y el módulo OID4VP ya integrado. *Contras:* dos IAM (PHP y Java), doble sesión, más operación, y la dependencia de un módulo de un solo mantenedor con los fallos de seguridad citados.
- **Opción C: SATOSA delante de Keycloak.** Es el patrón probado en CERN. Solo compensa si se necesitan miles de IdPs, y no aporta OID4VP para EBSI.
- **Alternativa por evaluar:** conectar como un único IdP a **MyAcademicID/eduTEAMS**, que GÉANT ofrece a alianzas. No verifiqué las condiciones de elegibilidad.

**Recomendación:** empezar con la Opción A. El contrato con el backend es el JWT de Keycloak (`organization_id` y el rol), así que el SSP con OID4VP, o el verificador nativo de Keycloak cuando madure, puede añadirse después como un IdP más sin tocar el core. Antes de esa fase 2 hay que corregir los puntos 1 y 2 del módulo y añadir soporte de SD-JWT VC si se quieren wallets EUDI reales.

## 4. Preguntas que el propietario debe responder antes de programar

1. ¿El login con wallet es imprescindible en el MVP, o puede quedar en fase 2 detrás de Keycloak?
2. ¿Qué entidad jurídica actúa como responsable del tratamiento y como RP registrado ante el registrador eIDAS2?
3. ¿Quién asigna y retira los roles de admin de socio y de admin global, y cómo se crea el primer admin global?
4. ¿Qué identificador estable de usuario se usa (`subject-id`, `pairwise-id`, ePPN) y cómo se vinculan explícitamente las identidades SAML y wallet?
5. ¿En qué federación nacional se registra el SP y con qué entity categories (Personalized, CoCo v2, Sirtfi)?
6. ¿Qué atributos mínimos se requieren de cada IdP, y qué ocurre si un socio no los libera?
7. ¿Se exige MFA a todos los administradores, y se acepta la MFA del IdP o se impone una local?
8. ¿Qué marco de confianza de emisores (EBSI, BLUE, Trusted Lists eIDAS) se acepta y quién lo gobierna?
9. ¿Qué formato de credencial se soportará (W3C JWT-VC para EBSI o SD-JWT VC/mdoc para EUDI) y en qué plazo?
10. ¿Quién redacta la DPIA y el acuerdo de corresponsabilidad, y qué retención se aplica a atributos y logs?

---
**Fuentes:** [Packagist del módulo](https://packagist.org/packages/laarino/simplesamlphp-module-oid4vp) · [Repo GitHub](https://github.com/LAArino/simplesamlphp-module-oid4vp) · [Keycloak 26.8](https://www.keycloak.org/2026/10/keycloak-2680-released) · [Skycloak sobre OID4VP en KC 26.8](https://skycloak.io/blog/keycloak-26-8-openid4vp-eudi-relying-party/) · [Foro Keycloak/InCommon](https://forum.keycloak.org/t/integrating-keycloak-with-the-incommon-federation/11061) · [MyAcademicID IAM (GÉANT)](https://trustidentity.geant.org/myacademicid-iam/) · [ESI (SWITCH)](https://help.switch.ch/eduid/docs/unis/idm/identifiers/esi/) · [EducationalID, EBSI](https://ec.europa.eu/digital-building-blocks/sites/download/attachments/737411130/20240507_Educational_Identification_Sprint3_EBSI_BIG_Day_v1.0.pdf) · [Registro de RPs (eID Easy)](https://www.eideasy.com/blog/eudiw-relying-party-registration) · [Plazos eIDAS2 (Garrigues)](https://www.garrigues.com/en_GB/garrigues-digital/european-digital-identity-wallet-now-has-timetable-tasks-be-completed-december)
