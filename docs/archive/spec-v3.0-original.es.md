# Open European Campus Portal (OECP) — Documento Unificado de Especificación Técnica y Funcional (v3.0)

El Open European Campus Portal (OECP) es una solución de software modular, soberana y de código abierto concebida bajo la licencia European Union Public Licence (EUPL v1.2). Su propósito es la federación, gestión y publicación del catálogo formativo global de una alianza de universidades europeas.
El sistema elimina cualquier dependencia técnica o de costes de mantenimiento respecto a infraestructuras externas gestionadas (como SURF eduXchange). Su núcleo lógico está diseñado mediante una Capa Anticorrupción (ACL) para absorber de manera asimétrica tanto la disparidad técnica de las universidades socias (múltiples versiones de OEAPI / OOAPI, CSVs o Formularios) como la convivencia de sistemas de identidad tradicionales (eduGAIN) con las nuevas Carteras de Identidad Digital Europea (EUDI Wallet).

## 1. Arquitectura General en Capas

El sistema se estructura en tres capas desacopladas mediante contenedores independientes, asegurando que un cambio en los estándares de identidad o en las versiones de las APIs no afecte al núcleo del catálogo.

      [ PORTAL PÚBLICO ]               [ PANEL PRIVADO (DASHBOARD) ]
   (Buscador Anónimo, Vue/React)        (Gestión y Cargas, Vue/React)
                │                                    │
                └──────────────────┬─────────────────┘
                                   ▼
                    [ API GATEWAY (Traefik / Kong) ]
                                   │
      ┌────────────────────────────┴────────────────────────────┐
      ▼                                                         ▼
[ CAPA DE IDENTIDAD UNIFICADA ]                 [ BACKEND CORE (NestJS / FastAPI) ]
 ├── Keycloak (RBAC Interno)                       │   (Modelo Canónico Interno)
 └── simpleSAMLphp + OID4VP                        ▼
         ├── Proxy eduGAIN              [ CAPA ANTICORRUPCIÓN (ACL) ]
         └── EUDI Wallet (W3C-VC)          ├──► Ingestor OEAPI v4 / v5
                                           ├──► Procesador Batch CSV
                                           └──► Controlador CRUD Formulario
                                                   │
                                                   ▼
                                        [ BASE DE DATOS CENTRAL ]
                                         (PostgreSQL + Extensiones)

## 2. Capa de Identidad Unificada e Infraestructura eIDAS2

Para evitar las limitaciones nativas de Keycloak al gestionar archivos masivos de metadatos federados o flujos criptográficos descentralizados, se despliega una arquitectura híbrida de Proxy de Identidad basada en Keycloak + simpleSAMLphp equipada con el módulo open-source simplesamlphp-module-oid4vp.

### A. Flujo de Autenticación Coexistente (eduGAIN + EUDI Wallet)

Al acceder a la zona de gestión privada, el usuario interactúa con la capa de identidad que unifica el presente y el futuro de la UE:
1. Acceso Tradicional (eduGAIN): El usuario se autentica mediante SAML 2.0 a través del Proxy hacia su Proveedor de Identidad (IdP) institucional clásico.
2. Acceso Descentralizado (EUDI Wallet - OID4VP): simpleSAMLphp genera un código QR dinámico basado en el estándar OpenID for Verifiable Presentations (OID4VP). El usuario escanea el código con su billetera digital (Wallet), la cual transmite de forma segura una atestación electrónica de atributos (EAA) en formato W3C Verifiable Credential (SD-JWT / JWT). El módulo ejecuta un pipeline de verificación criptográfica de 12 pasos y entrega los atributos validados al sistema.

### B. Flexibilidad del Modelo de Identidad Sectorial (Alineación con DC4EU)

Gracias al desacoplamiento en simpleSAMLphp, la alianza puede configurar el mapeo de atributos (vía attribute_map) para soportar cualquiera de los tres marcos de identidad promovidos por el catálogo de DC4EU:
- MyAcademicID: Enfocado en la movilidad tradicional a corto plazo, transportando el identificador único europeo del estudiante (ESI).
- EducationalID: Modelo persistente de afiliación institucional que vincula al alumno con su ecosistema universitario.
- AllianceID: El grado máximo de integración, diseñado específicamente para demostrar la membresía directa del estudiante o investigador en la propia alianza de universidades europeas.

### C. Control de Acceso Interno (RBAC)

Independientemente de si el usuario accedió por eduGAIN o por su EUDI Wallet, Keycloak intercepta los atributos normalizados de la sesión y emite un token JWT con roles estrictos (ej. role:uni_valencia_admin). El Backend Core utiliza este token para garantizar que cada universidad solo manipule su catálogo local.

## 3. Capa Anticorrupción (ACL) e Ingesta Multiversión

El backend implementa un patrón Anti-Corruption Layer (ACL) para aislar la base de datos central de las alteraciones externas del estándar OEAPI / OOAPI. El portal se alimenta a través de tres canales paralelos:
- Canal A: Automatizado OEAPI/OOAPI (Push & Pull): El API Gateway expone rutas aisladas por versión (/api/v1/ingest/ooapi/v4/... y /api/v1/ingest/ooapi/v5/...). Librerías de validación como Zod o Pydantic comprueban la integridad del formato de origen. Posteriormente, un servicio traductor (Transformer) adapta el objeto de transferencia de datos (DTO) al modelo canónico común.
- Canal B: Carga Masiva (Batch CSV): Un procesador asíncrono para universidades sin APIs expuestas. Valida listas de cursos a partir de plantillas CSV estandarizadas y estructuradas bajo la semántica elemental de OEAPI.
- Canal C: Formulario Web (UI Manual): Un panel administrativo CRUD que permite la creación manual de asignaturas y periodos lectivos (offerings), abstrayendo las complejidades técnicas de las APIs.

## 4. Modelo Canónico de Datos (Esquema de Producción OEAPI)

La base de datos relacional (PostgreSQL) implementa una abstracción del estándar oficial OEAPI, añadiendo soporte multilingüe nativo y una capa híbrida NoSQL (JSONB) para almacenar el historial de cargas originales de los partners sin alterar las tablas de producción:

```sql
-- 1. Tabla Core de Asignaturas (Alineada semánticamente con el European Learning Model - ELM)
CREATE TABLE courses (
    course_id VARCHAR(100) PRIMARY KEY,       -- ID único generado por el portal
    ext_id VARCHAR(100) NOT NULL,             -- ID original en el SIS de la universidad partner
    organization_id VARCHAR(100) NOT NULL,    -- Identificador de la universidad proveedora
    title_en VARCHAR(255) NOT NULL,           -- Título en inglés (Obligatorio en el catálogo)
    title_local VARCHAR(255),                 -- Título en el idioma oficial del partner
    description_en TEXT,                      -- Contenido pedagógico en inglés
    description_local TEXT,                   -- Contenido en idioma local
    ects_credits NUMERIC(4,2) NOT NULL,       -- Créditos ECTS (Soporta decimales, ej: 6.00 o 7.50)
    abbreviation VARCHAR(50),                 -- Código de la asignatura (ej: MAT-101)
    learning_outcomes TEXT,                   -- Resultados de aprendizaje de la asignatura
    requirements TEXT,                        -- Competencias o requisitos previos exigidos
    isced_code VARCHAR(10),                   -- Código de área de conocimiento (Clasificación ISCED-F)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Instancias Temporales / Ediciones (Course Offerings)
CREATE TYPE delivery_mode_enum AS ENUM ('online-sync', 'online-async', 'on-campus', 'hybrid', 'blended');

CREATE TABLE course_offerings (
    offering_id VARCHAR(100) PRIMARY KEY,         -- ID único del periodo ofertado
    ext_offering_id VARCHAR(100) NOT NULL,        -- ID de la instancia de clase en el SIS local del partner
    course_id VARCHAR(100) REFERENCES courses(course_id) ON DELETE CASCADE,
    academic_year VARCHAR(9) NOT NULL,            -- Formato estándar "2026/2027"
    semester INT NOT NULL,                        -- Semestre lectivo (1, 2 o 3)
    start_date DATE NOT NULL,                     -- Fecha de inicio del periodo docente
    end_date DATE NOT NULL,                       -- Fecha de finalización / evaluación
    application_deadline DATE,                    -- Plazo límite de inscripción internacional
    delivery_mode delivery_mode_enum NOT NULL,    -- Modalidad de la impartición
    language_of_instruction VARCHAR(10)[] NOT NULL, -- Array de idiomas ISO 639-1 (ej: {'en', 'de'})
    max_students INT,                             -- Aforo máximo de la edición
    alliance_seats INT,                           -- Plazas reservadas y garantizadas para la alianza
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Historial de Ingesta y Auditoría (Resiliencia NoSQL Multiversión)
CREATE TYPE ingest_channel_enum AS ENUM ('ooapi_v4', 'ooapi_v5', 'csv_batch', 'web_form');

CREATE TABLE ext_metadata_history (
    meta_id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,             -- 'course' o 'course_offering'
    entity_id VARCHAR(100) NOT NULL,              -- Relación con el ID del registro central consolidado
    channel ingest_channel_enum NOT NULL,         -- Origen de la ingesta
    raw_payload JSONB NOT NULL,                   -- Payload JSON íntegro original del partner (sin procesar)
    ingested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## 5. Descripción Funcional del Portal

El OECP se divide operativamente en dos grandes entornos adaptados al perfil del usuario:

### 5.1. Portal Público (Catálogo de Libre Acceso)

Diseñado para estudiantes de la alianza, alumnos externos e investigadores. Su objetivo principal es la transparencia y la minimización del esfuerzo de búsqueda transfronteriza.
- Buscador Global Inteligente: Un motor de búsqueda con autocompletado que indexa en tiempo real los títulos, resúmenes y palabras clave de las asignaturas en inglés y en el idioma local.
- Filtros Técnicos Avanzados:
  - Por Partner: Filtrar la oferta académica de una o varias universidades específicas de la alianza.
  - Por Modalidad de Impartición: Virtual Síncrona, Virtual Asíncrona, Presencial (On-Campus), Híbrida o Blended.
  - Por Carga de Trabajo: Selector por rango de créditos ECTS (ej: de 1 a 3 créditos frente a asignaturas de 6 créditos).
  - Por Idioma: Filtrar por las lenguas oficiales de impartición.
  - Área de Conocimiento (ISCED-F): Clasificación por familias profesionales y científicas de la UE (Humanidades, TIC, Ingeniería, Salud, etc.).
- Ficha Detallada del Curso: Al hacer clic en un curso, se despliega la información unificada bajo el estándar OEAPI:
  - Fechas Críticas: Inicio y fin de las clases, junto con el Application Deadline (fecha límite para solicitar la movilidad virtual).
  - Contenido Académico: Descripción conceptual, requisitos previos de matriculación y los Resultados de Aprendizaje (Learning Outcomes).
  - Disponibilidad de Plazas: Indicador visual del cupo global y de las plazas remanentes reservadas exclusivamente para estudiantes de la alianza (Alliance Seats).
  - Botón de Solicitud Externa: Enlace directo o redirección al proceso de inscripción de la universidad de destino.

### 5.2. Panel de Gestión Privado (Entorno Autenticado)

Reservado para el personal de administración académica, coordinadores de movilidad internacional y personal de soporte técnico de las universidades. El acceso está estrictamente regulado por la segregación de funciones mediante los roles de Keycloak.

#### Perfil A: Administrador de Universidad Partner (Gobernanza Local)

Este usuario solo tiene visibilidad y permisos de escritura sobre la oferta de su propia institución. Al entrar al panel, dispone de tres módulos de gestión:
1. Módulo de Configuración de Sincronización: Permite elegir y cambiar el método de alimentación del catálogo de su universidad (API Automatizada, Carga CSV o Formulario Manual). Si elige API, permite introducir el endpoint local, gestionar las claves de API/Webhooks y configurar la frecuencia del harvesting.
2. Consola de Carga Masiva (Batch CSV): Zona de Arrastrar y Soltar (Drag & Drop) para subir los listados de cursos en formato CSV utilizando la plantilla oficial de la alianza. Incluye un Validador en Tiempo Real que procesa el archivo en el navegador del usuario y muestra un informe inmediato de errores antes de subirlo al servidor.
3. Gestor CRUD Manual (Formulario Web): Un asistente paso a paso para dar de alta asignaturas individuales o editar ofertas existentes (ej: ampliar las plazas reservadas de la alianza o corregir una errata en la descripción en inglés).
4. Monitor de Historial y Logs: Pantalla de auditoría donde el técnico ve el éxito o fracaso de las últimas sincronizaciones automáticas para facilitar el diagnóstico.

#### Perfil B: Administrador Global de la Alianza (Gobernanza Central)

Un perfil técnico/académico de nivel superior encargado de la supervisión de todo el ecosistema del portal.
1. Dashboard de Analítica y Estado de la Red: Métricas agregadas (número total de cursos activos en la alianza, porcentaje de cursos online vs. presenciales) y semáforo de conectividad de las APIs de las universidades socias.
2. Gestión del Ciclo de Vida de Versiones (Aislamiento ACL): Consola para activar o desactivar el soporte de versiones de entrada de la API (ej: marcar la compatibilidad con OOAPI v4 como "Depreciada" y establecer una fecha límite para que los administradores locales migren a la v5).
3. Moderación y Gestión de Organizaciones: Alta y baja de nuevas universidades asociadas, facultades o campus que se adhieran a la alianza.

## 6. Stack Tecnológico y Licenciamiento Open Source

Todos los componentes de la infraestructura son de código abierto y no arrastran costes de licencias comerciales. El software desarrollado de forma nativa para el OECP se publica bajo EUPL v1.2, permitiendo que los entregables sean transferibles a otras alianzas universitarias:

| Componente de Infraestructura | Tecnología Recomendada | Licencia de Origen | Compatibilidad EUPL v1.2 |
|---|---|---|---|
| Enrutamiento y API Gateway | Traefik / Kong | MIT / Apache 2.0 | Totalmente compatible |
| Gobernanza RBAC Interna | Keycloak | Apache 2.0 | Totalmente compatible |
| Federación eduGAIN y OID4VP | simpleSAMLphp + Módulo Wallet | LGPL / EUPL v1.2 | Totalmente compatible |
| Backend Core & Capa ACL | NestJS (TypeScript) o FastAPI (Python) | MIT / MIT | Totalmente compatible |
| Base de Datos Centralizada | PostgreSQL | PostgreSQL License | Totalmente compatible |
| Interfaces de Usuario (UI) | Vue.js / React | MIT | Totalmente compatible |

## 7. Ventajas de la Arquitectura OECP Evolucionada

1. Soberanía y Cumplimiento Normativo (eIDAS2): Al integrar el protocolo OID4VP a través de simpleSAMLphp, el portal de la alianza se sitúa a la vanguardia reglamentaria europea, preparado nativamente para las carteras digitales obligatorias.
2. Invariabilidad del Core: Los debates político-académicos internos de la alianza sobre si implantar EducationalID o AllianceID quedan totalmente aislados del desarrollo de software. El portal está listo para consumir los atributos de cualquiera de estas credenciales en el momento en que se consensúen.
3. Flexibilidad Operativa Total: Las universidades avanzadas interactúan mediante automatizaciones basadas en APIs modernas, mientras que los socios con menor capacidad técnica disponen de herramientas robustas (CSV/Web) para asegurar la integridad de la oferta global de la alianza sin exclusiones.
