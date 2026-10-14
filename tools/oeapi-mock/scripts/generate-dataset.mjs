#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
//
// Generates the simulated Universität Innsbruck (UIBK) OEAPI v5.0 datasets
// served by ../server.mjs:
//
//   data/uibk.json           baseline harvest
//   data/uibk-next-run.json  same partner one run later: 2 eduXchange courses
//                            removed (with their offerings) and 1 course changed
//
// Deterministic: identifiers are UUIDv5 of stable names, counters come from a
// seeded PRNG, no clock is read. Re-running produces byte-identical files.
// All course content is synthetic; no real persons are named.
//
//   node tools/oeapi-mock/scripts/generate-dataset.mjs [--out <dir>]

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED = 20261014;
const here = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const OUT_DIR = outArg > 0 ? resolve(process.argv[outArg + 1]) : join(here, '..', 'data');

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** RFC 4122 UUIDv5 (SHA-1, name-based). */
function uuidv5(name, namespace) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const NS = uuidv5('uibk.oeapi-mock.oecp.invalid', DNS_NAMESPACE);
const id = (kind, key) => uuidv5(`${kind}:${key}`, NS);

/** mulberry32: small seeded PRNG, good enough for plausible counters. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(SEED);
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

const EN = 'en-GB';
const DE = 'de-DE';
const lt = (en, de) => {
  const out = [];
  if (en != null) out.push({ language: EN, value: en });
  if (de != null) out.push({ language: DE, value: de });
  return out;
};

// Hosts under the reserved `.example` TLD: the dataset is synthetic and must
// never send a harvester (or a student clicking a link) to a real system.
const LFU = 'https://lfuonline.uibk.example';

// ---------------------------------------------------------------------------
// Organization and academic sessions
// ---------------------------------------------------------------------------

const ORG_ID = id('organization', 'root');
const organization = {
  organizationId: ORG_ID,
  primaryCode: { codeType: 'schacHome', code: 'uibk.ac.at' },
  organizationType: 'root',
  name: lt('University of Innsbruck', 'Universität Innsbruck'),
  shortName: 'UIBK',
  addresses: [
    {
      addressType: 'postal',
      street: 'Innrain',
      streetNumber: '52',
      postalCode: '6020',
      city: 'Innsbruck',
      countryCode: 'AT',
    },
  ],
  link: 'https://www.uibk.ac.at',
  otherCodes: [{ codeType: 'x-erasmusCode', code: 'A  INNSBRU01' }],
  consumers: [{ consumerKey: 'eduxchange', alliances: [{ name: 'aurora' }] }],
  ext: { 'x-oeapi-mock': 'Simulated partner dataset for OECP development; not real UIBK data.' },
};

const AY = id('academic-session', '2026/27');
const WS = id('academic-session', '2026W');
const SS = id('academic-session', '2027S');
const academicSessions = [
  {
    academicSessionId: AY,
    academicSessionType: 'academic year',
    primaryCode: { codeType: 'identifier', code: '2026/27' },
    name: lt('Academic year 2026/27', 'Studienjahr 2026/27'),
    startDate: '2026-10-01',
    endDate: '2027-09-30',
    children: [WS, SS],
  },
  {
    academicSessionId: WS,
    academicSessionType: 'semester',
    primaryCode: { codeType: 'identifier', code: '2026W' },
    name: lt('Winter semester 2026/27', 'Wintersemester 2026/27'),
    startDate: '2026-10-01',
    endDate: '2027-02-28',
    parent: AY,
    year: AY,
  },
  {
    academicSessionId: SS,
    academicSessionType: 'semester',
    primaryCode: { codeType: 'identifier', code: '2027S' },
    name: lt('Summer semester 2027', 'Sommersemester 2027'),
    startDate: '2027-03-01',
    endDate: '2027-09-30',
    parent: AY,
    year: AY,
  },
];

// Default semester calendars. Winter-semester offerings have already started
// on 2026-10-14 (they are hidden by the v5 default `since=<today>`).
const TERMS = {
  W: {
    session: WS,
    suffix: '2026W',
    startDate: '2026-10-05',
    endDate: '2027-01-29',
    enrollStartDate: '2026-09-01',
    enrollEndDate: '2026-09-30',
  },
  S: {
    session: SS,
    suffix: '2027S',
    startDate: '2027-03-01',
    endDate: '2027-06-30',
    enrollStartDate: '2027-02-01',
    enrollEndDate: '2027-02-28',
  },
};

// ---------------------------------------------------------------------------
// Courses (25: 20 tagged for eduXchange / Aurora, 5 internal only)
// ---------------------------------------------------------------------------
//
// Fields per entry:
//   code, abbr, level, ects, lang (ISO 639-2/B on purpose), modes, isced,
//   edux (tagged for consumer=eduxchange), theme, terms (offerings), and texts.
//   `edge` marks deliberate edge cases (listed in data meta.edgeCases).

const COURSES = [
  {
    code: '703001',
    abbr: 'ML-INTRO',
    level: 'bachelor',
    ects: 5,
    lang: 'eng',
    modes: ['on campus'],
    isced: '0613',
    edux: true,
    theme: 'Computer science and AI',
    terms: ['W', 'S'],
    name: ['Introduction to Machine Learning', 'Einführung in maschinelles Lernen'],
    description: [
      'Supervised and unsupervised learning from first principles: linear models, decision trees, ensembles, clustering and an introduction to neural networks. Weekly lab sessions in Python use open datasets from environmental monitoring in the Alps.',
      'Überwachtes und unüberwachtes Lernen von Grund auf: lineare Modelle, Entscheidungsbäume, Ensembles, Clustering und eine Einführung in neuronale Netze. Wöchentliche Übungen in Python arbeiten mit offenen Datensätzen aus dem alpinen Umweltmonitoring.',
    ],
    outcomes: [
      [
        'Explain the bias-variance trade-off and choose a suitable validation strategy.',
        'Den Bias-Varianz-Kompromiss erklären und eine geeignete Validierungsstrategie wählen.',
      ],
      [
        'Train, tune and evaluate standard classifiers and regressors in Python.',
        'Standardklassifikatoren und Regressoren in Python trainieren, abstimmen und bewerten.',
      ],
    ],
    admission: [
      'Linear algebra and basic programming (Python).',
      'Lineare Algebra und Grundkenntnisse im Programmieren (Python).',
    ],
    assessment: [
      'Written exam (60%) and graded lab assignments (40%).',
      'Schriftliche Prüfung (60 %) und benotete Übungsaufgaben (40 %).',
    ],
  },
  {
    code: '703015',
    abbr: 'DIST-SYS',
    level: 'master',
    ects: 7.5,
    edge: 'ECTS 7.5 (non-integer study load)',
    lang: 'eng',
    modes: ['on campus'],
    isced: '0612',
    edux: true,
    theme: 'Computer science and AI',
    terms: ['W', 'S'],
    name: ['Distributed Systems', 'Verteilte Systeme'],
    description: [
      'Consensus, replication, consistency models and fault tolerance in large-scale distributed systems, with a team project that builds a replicated key-value store.',
      'Konsens, Replikation, Konsistenzmodelle und Fehlertoleranz in großen verteilten Systemen, mit einem Teamprojekt zum Bau eines replizierten Key-Value-Speichers.',
    ],
    outcomes: [
      [
        'Compare consistency models and justify the choice for a given workload.',
        'Konsistenzmodelle vergleichen und die Wahl für eine gegebene Last begründen.',
      ],
      [
        'Implement and test a crash-tolerant replication protocol.',
        'Ein absturztolerantes Replikationsprotokoll implementieren und testen.',
      ],
    ],
    admission: [
      'Operating systems and computer networks at bachelor level.',
      'Betriebssysteme und Rechnernetze auf Bachelorniveau.',
    ],
    assessment: [
      'Project (50%) and oral exam (50%).',
      'Projekt (50 %) und mündliche Prüfung (50 %).',
    ],
  },
  {
    code: '703022',
    abbr: 'SE-PROJ',
    level: 'bachelor',
    ects: 10,
    lang: 'ger',
    modes: ['on campus'],
    isced: '0613',
    edux: true,
    theme: 'Computer science and AI',
    terms: ['S'],
    name: ['Software Engineering Project', 'Softwaretechnik-Projekt'],
    description: [
      'Teams of five develop a software product for an external client over one semester, applying agile methods, code review, continuous integration and release management.',
      'Teams zu fünft entwickeln über ein Semester ein Softwareprodukt für einen externen Auftraggeber und wenden agile Methoden, Code-Reviews, Continuous Integration und Release-Management an.',
    ],
    outcomes: [
      [
        'Plan and run iterative development with a real stakeholder.',
        'Iterative Entwicklung mit einem realen Auftraggeber planen und durchführen.',
      ],
    ],
    admission: [
      'Completed introductory programming and software engineering courses.',
      'Abgeschlossene Einführungen in Programmierung und Softwaretechnik.',
    ],
    assessment: [
      'Continuous assessment of the project deliverables and a final presentation.',
      'Laufende Beurteilung der Projektergebnisse und eine Abschlusspräsentation.',
    ],
  },
  {
    code: '703040',
    abbr: 'PRIV-SEC',
    level: 'master',
    ects: 5,
    lang: 'eng',
    modes: ['hybrid'],
    isced: '0612',
    edux: true,
    theme: 'Computer science and AI',
    terms: ['W', 'S'],
    name: ['Data Privacy and Security Engineering', 'Datenschutz- und Sicherheitstechnik'],
    description: [
      'Threat modelling, privacy by design, applied cryptography and secure software development, with case studies drawn from the GDPR and the NIS2 Directive.',
      'Bedrohungsmodellierung, Privacy by Design, angewandte Kryptographie und sichere Softwareentwicklung, mit Fallstudien zur DSGVO und zur NIS2-Richtlinie.',
    ],
    outcomes: [
      [
        'Produce a threat model and a data protection impact assessment for a web application.',
        'Ein Bedrohungsmodell und eine Datenschutz-Folgenabschätzung für eine Webanwendung erstellen.',
      ],
    ],
    admission: [
      'Basic knowledge of networks and programming.',
      'Grundkenntnisse in Netzwerken und Programmierung.',
    ],
    assessment: [
      'Written assignments (40%) and final exam (60%).',
      'Schriftliche Arbeiten (40 %) und Abschlussprüfung (60 %).',
    ],
  },
  {
    code: '702110',
    abbr: 'NUM-CLIM',
    level: 'master',
    ects: 5,
    lang: 'eng',
    modes: ['online'],
    isced: '0541',
    edux: true,
    theme: 'Climate and mountains',
    terms: ['W', 'S'],
    name: ['Numerical Methods for Climate Models', 'Numerische Methoden für Klimamodelle'],
    description: [
      'Finite-difference and finite-volume schemes, stability analysis and time stepping as used in atmospheric and ocean models, with exercises on a simplified shallow-water model.',
      'Finite-Differenzen- und Finite-Volumen-Verfahren, Stabilitätsanalyse und Zeitintegration in Atmosphären- und Ozeanmodellen, mit Übungen an einem vereinfachten Flachwassermodell.',
    ],
    outcomes: [
      [
        'Analyse the stability and accuracy of a discretisation scheme.',
        'Stabilität und Genauigkeit eines Diskretisierungsverfahrens analysieren.',
      ],
    ],
    admission: [
      'Partial differential equations and programming experience.',
      'Partielle Differentialgleichungen und Programmiererfahrung.',
    ],
    assessment: [
      'Programming assignments and an oral exam.',
      'Programmieraufgaben und eine mündliche Prüfung.',
    ],
  },
  {
    code: '609010',
    abbr: 'GLACIO',
    level: 'master',
    ects: 5,
    lang: 'eng',
    modes: ['situated'],
    isced: '0532',
    edux: true,
    theme: 'Climate and mountains',
    terms: ['S'],
    termOverride: {
      S: {
        startDate: '2027-07-05',
        endDate: '2027-07-16',
        enrollStartDate: '2027-03-01',
        enrollEndDate: '2027-04-30',
      },
    },
    name: ['Alpine Glaciology Field Course', 'Geländekurs Alpine Glaziologie'],
    description: [
      'Two-week field course on a glacier in the Ötztal Alps: mass-balance measurements, ablation stakes, ground-penetrating radar and data processing at a high-altitude research station.',
      'Zweiwöchiger Geländekurs auf einem Gletscher in den Ötztaler Alpen: Massenbilanzmessungen, Ablationspegel, Georadar und Datenauswertung an einer hochalpinen Forschungsstation.',
    ],
    outcomes: [
      [
        'Carry out and document glaciological field measurements safely.',
        'Glaziologische Feldmessungen sicher durchführen und dokumentieren.',
      ],
    ],
    admission: [
      'Physical fitness for high-mountain fieldwork; introductory glaciology.',
      'Körperliche Eignung für Arbeit im Hochgebirge; Grundlagen der Glaziologie.',
    ],
    assessment: ['Field report.', 'Feldbericht.'],
  },
  {
    code: '609025',
    abbr: 'MTN-HAZ',
    level: 'master',
    ects: 5,
    lang: 'ger',
    modes: ['hybrid'],
    isced: '0532',
    edux: true,
    theme: 'Climate and mountains',
    terms: ['W', 'S'],
    name: ['Mountain Hazards and Risk', 'Naturgefahren im Gebirge'],
    description: [
      'Avalanches, debris flows, rockfall and floods: process understanding, hazard mapping and risk management practice in Tyrol.',
      'Lawinen, Muren, Steinschlag und Hochwasser: Prozessverständnis, Gefahrenzonenplanung und Praxis des Risikomanagements in Tirol.',
    ],
    outcomes: [
      [
        'Interpret a hazard zone map and assess residual risk.',
        'Einen Gefahrenzonenplan interpretieren und das Restrisiko beurteilen.',
      ],
    ],
    admission: [
      'Bachelor in geography, geology or civil engineering.',
      'Bachelor in Geographie, Geologie oder Bauingenieurwesen.',
    ],
    assessment: ['Written exam.', 'Schriftliche Prüfung.'],
  },
  {
    code: '650100',
    abbr: 'SUST-TOUR',
    level: 'bachelor',
    ects: 5,
    lang: 'eng',
    modes: ['online'],
    isced: '1015',
    edux: true,
    theme: 'Society and economy',
    terms: ['W', 'S'],
    name: ['Sustainable Tourism in Alpine Regions', 'Nachhaltiger Tourismus im Alpenraum'],
    description: [
      'Overtourism, climate adaptation of ski resorts and community-based tourism, examined through case studies from Austria, Switzerland and Italy.',
      'Overtourism, Klimaanpassung von Skigebieten und gemeinschaftsbasierter Tourismus anhand von Fallstudien aus Österreich, der Schweiz und Italien.',
    ],
    outcomes: [
      [
        'Evaluate the sustainability of a destination with standard indicators.',
        'Die Nachhaltigkeit einer Destination mit Standardindikatoren bewerten.',
      ],
    ],
    admission: ['None.', 'Keine.'],
    assessment: ['Case study report and online quiz.', 'Fallstudienbericht und Online-Quiz.'],
  },
  {
    code: '401210',
    abbr: 'BEH-ECON',
    level: 'master',
    ects: 6,
    lang: 'eng',
    modes: ['on campus'],
    isced: '0311',
    edux: true,
    theme: 'Society and economy',
    terms: ['W', 'S'],
    termOverride: {
      // Edge case: summer offering whose pre-registration already closed.
      S: { enrollStartDate: '2026-09-01', enrollEndDate: '2026-09-15' },
    },
    name: ['Behavioural Economics', 'Verhaltensökonomik'],
    description: [
      'Bounded rationality, social preferences and nudging, with laboratory experiments run in the Innsbruck EconLab.',
      'Begrenzte Rationalität, soziale Präferenzen und Nudging, mit Laborexperimenten im Innsbrucker EconLab.',
    ],
    outcomes: [
      [
        'Design an incentivised economic experiment.',
        'Ein anreizkompatibles ökonomisches Experiment entwerfen.',
      ],
    ],
    admission: ['Intermediate microeconomics.', 'Mikroökonomik auf mittlerem Niveau.'],
    assessment: [
      'Experiment proposal (40%) and written exam (60%).',
      'Experimententwurf (40 %) und schriftliche Prüfung (60 %).',
    ],
  },
  {
    code: '401330',
    abbr: 'EU-ECON',
    level: 'bachelor',
    ects: 4,
    lang: 'ger',
    modes: ['distance-learning'],
    isced: '0311',
    edux: true,
    theme: 'Society and economy',
    terms: ['W', 'S'],
    // Edge case: the summer offering is taught in English (offering value wins).
    offeringLang: { S: 'eng' },
    name: ['European Economic Integration', 'Europäische Wirtschaftsintegration'],
    description: [
      'Customs union, single market, monetary union and the EU budget, studied through self-paced materials and monthly online tutorials.',
      'Zollunion, Binnenmarkt, Währungsunion und EU-Haushalt, erarbeitet mit Selbstlernmaterialien und monatlichen Online-Tutorien.',
    ],
    outcomes: [
      [
        'Explain the economic effects of each stage of integration.',
        'Die wirtschaftlichen Effekte jeder Integrationsstufe erklären.',
      ],
    ],
    admission: ['Introductory economics.', 'Grundlagen der Volkswirtschaftslehre.'],
    assessment: ['Online exam.', 'Online-Prüfung.'],
  },
  {
    code: '432005',
    abbr: 'ENTRE',
    level: 'master',
    ects: 6,
    lang: 'eng',
    modes: ['hybrid'],
    isced: '0413',
    edux: true,
    theme: 'Society and economy',
    terms: ['S'],
    name: ['Entrepreneurship and Innovation', 'Entrepreneurship und Innovation'],
    description: [
      'From idea to validated business model: customer discovery, lean experimentation, intellectual property and financing of start-ups.',
      'Von der Idee zum validierten Geschäftsmodell: Kundenentdeckung, Lean-Experimente, geistiges Eigentum und Finanzierung von Start-ups.',
    ],
    outcomes: [
      [
        'Validate a business model with structured customer interviews.',
        'Ein Geschäftsmodell mit strukturierten Kundeninterviews validieren.',
      ],
    ],
    admission: ['None.', 'Keine.'],
    assessment: [
      'Team pitch and written business plan.',
      'Team-Pitch und schriftlicher Businessplan.',
    ],
  },
  {
    code: '300120',
    abbr: 'EU-LAW',
    level: 'bachelor',
    ects: 6,
    lang: 'ger',
    modes: ['on campus'],
    isced: '0421',
    edux: true,
    theme: 'Law and governance',
    terms: ['W', 'S'],
    name: ['European Union Law', 'Europarecht'],
    description: [
      'Institutions, sources and principles of EU law, fundamental freedoms and the preliminary reference procedure before the Court of Justice.',
      'Organe, Rechtsquellen und Grundsätze des Unionsrechts, Grundfreiheiten und das Vorabentscheidungsverfahren vor dem Gerichtshof.',
    ],
    outcomes: [
      [
        'Solve a case on the free movement of goods.',
        'Einen Fall zur Warenverkehrsfreiheit lösen.',
      ],
    ],
    admission: ['Introduction to law.', 'Einführung in die Rechtswissenschaften.'],
    assessment: ['Written exam.', 'Schriftliche Prüfung.'],
  },
  {
    code: '300250',
    abbr: 'HR-LAW',
    level: 'master',
    ects: 4,
    lang: 'eng',
    modes: ['online'],
    isced: '0421',
    edux: true,
    theme: 'Law and governance',
    terms: [],
    edge: 'eduXchange course without any offering',
    name: ['International Human Rights Law', 'Internationaler Menschenrechtsschutz'],
    description: [
      'Universal and regional human rights systems, with a focus on the European Convention on Human Rights and its case law.',
      'Universelle und regionale Menschenrechtssysteme mit Schwerpunkt auf der Europäischen Menschenrechtskonvention und ihrer Rechtsprechung.',
    ],
    outcomes: [
      [
        'Analyse a judgment of the European Court of Human Rights.',
        'Ein Urteil des Europäischen Gerichtshofs für Menschenrechte analysieren.',
      ],
    ],
    admission: [
      'Bachelor in law or political science.',
      'Bachelor in Rechtswissenschaften oder Politikwissenschaft.',
    ],
    assessment: ['Seminar paper.', 'Seminararbeit.'],
  },
  {
    code: '201420',
    abbr: 'PSY-METH',
    level: 'master',
    ects: 5,
    lang: 'eng',
    modes: ['hybrid'],
    isced: '0313',
    edux: true,
    theme: 'Health and life sciences',
    terms: ['W', 'S'],
    name: [
      'Advanced Research Methods in Psychology',
      'Fortgeschrittene Forschungsmethoden der Psychologie',
    ],
    description: [
      'Preregistration, power analysis, mixed models and open science practices, applied to the students’ own research questions.',
      'Präregistrierung, Poweranalyse, gemischte Modelle und Open-Science-Praktiken, angewandt auf eigene Forschungsfragen.',
    ],
    outcomes: [
      [
        'Preregister a study and fit a mixed-effects model in R.',
        'Eine Studie präregistrieren und ein gemischtes Modell in R schätzen.',
      ],
    ],
    admission: ['Statistics at bachelor level.', 'Statistik auf Bachelorniveau.'],
    assessment: [
      'Preregistration report and data analysis project.',
      'Präregistrierungsbericht und Datenanalyseprojekt.',
    ],
  },
  {
    code: '710450',
    abbr: 'QIS',
    level: 'master',
    ects: 5,
    lang: 'eng',
    modes: ['on campus'],
    isced: '0533',
    edux: true,
    theme: 'Physics and quantum technologies',
    terms: ['W', 'S'],
    name: ['Quantum Information Science', 'Quanteninformation'],
    description: [
      'Qubits, entanglement, quantum gates and error correction, with an introduction to trapped-ion quantum computing.',
      'Qubits, Verschränkung, Quantengatter und Fehlerkorrektur, mit einer Einführung in Quantencomputer mit gefangenen Ionen.',
    ],
    outcomes: [
      [
        'Simulate small quantum circuits and analyse their noise.',
        'Kleine Quantenschaltkreise simulieren und ihr Rauschen analysieren.',
      ],
    ],
    admission: ['Quantum mechanics at bachelor level.', 'Quantenmechanik auf Bachelorniveau.'],
    assessment: [
      'Problem sets (30%) and oral exam (70%).',
      'Übungsblätter (30 %) und mündliche Prüfung (70 %).',
    ],
  },
  {
    code: '620050',
    abbr: 'ALP-SUMMER',
    level: 'bachelor',
    ects: 3,
    lang: 'mul',
    edge: 'teachingLanguage "mul" (multiple languages)',
    modes: ['situated', 'on campus'],
    isced: '0588',
    edux: true,
    theme: 'Climate and mountains',
    terms: ['S'],
    termOverride: {
      S: {
        startDate: '2027-07-19',
        endDate: '2027-07-30',
        enrollStartDate: '2027-02-01',
        enrollEndDate: '2027-05-31',
      },
    },
    name: ['Interdisciplinary Alpine Summer School', 'Interdisziplinäre Alpine Sommerschule'],
    description: [
      'Two weeks on climate change in the Alps, taught in English and German by geographers, ecologists and economists, with excursions to Obergurgl.',
      'Zwei Wochen zum Klimawandel in den Alpen, unterrichtet auf Englisch und Deutsch von Geographie, Ökologie und Wirtschaft, mit Exkursionen nach Obergurgl.',
    ],
    outcomes: [
      [
        'Integrate perspectives from several disciplines on one regional problem.',
        'Perspektiven mehrerer Disziplinen auf ein regionales Problem integrieren.',
      ],
    ],
    admission: [
      'At least two semesters of any bachelor programme.',
      'Mindestens zwei Semester eines beliebigen Bachelorstudiums.',
    ],
    assessment: ['Group poster and reflective essay.', 'Gruppenposter und Reflexionsessay.'],
  },
  {
    code: '150300',
    abbr: 'ARCH-CLIM',
    level: 'master',
    ects: 5,
    lang: 'ger',
    modes: ['on campus'],
    isced: '0731',
    edux: true,
    theme: 'Engineering and architecture',
    terms: ['W', 'S'],
    name: ['Architecture and Climate', 'Architektur und Klima'],
    description: [
      'Passive design, embodied carbon and timber construction for alpine climates, with a design studio on a public building.',
      'Passives Entwerfen, graue Energie und Holzbau für das alpine Klima, mit einem Entwurfsstudio zu einem öffentlichen Gebäude.',
    ],
    outcomes: [
      [
        'Assess the life-cycle carbon of a building design.',
        'Die Lebenszyklus-Emissionen eines Gebäudeentwurfs bewerten.',
      ],
    ],
    admission: ['Bachelor in architecture.', 'Bachelor in Architektur.'],
    assessment: ['Design project and presentation.', 'Entwurfsprojekt und Präsentation.'],
  },
  {
    code: '610200',
    abbr: 'REG-ALP',
    level: 'bachelor',
    ects: 5,
    lang: 'ger',
    modes: ['on campus'],
    isced: '0314',
    edux: true,
    theme: 'Society and economy',
    terms: ['W'],
    germanOnly: true,
    edge: 'No English text at all: name, description, outcomes, admission and assessment in de-DE only',
    name: [null, 'Regionalentwicklung im Alpenraum'],
    description: [
      null,
      'Demographischer Wandel, Erreichbarkeit und Daseinsvorsorge in peripheren Alpentälern; Projektarbeit mit Gemeinden im Tiroler Oberland.',
    ],
    outcomes: [[null, 'Ein Entwicklungskonzept für eine Talgemeinde erarbeiten.']],
    admission: [null, 'Einführung in die Humangeographie.'],
    assessment: [null, 'Projektbericht und Präsentation.'],
  },
  {
    code: '816010',
    abbr: 'DH-METH',
    level: 'master',
    ects: 5,
    lang: 'eng',
    modes: ['online'],
    isced: '0288',
    edux: true,
    theme: 'Humanities',
    terms: ['W', 'S'],
    httpLink: true,
    edge: 'course link uses http:// (not https)',
    name: ['Digital Humanities Methods', 'Methoden der Digital Humanities'],
    description: [
      'Text encoding with TEI, named-entity recognition, network analysis and digital editions, using historical sources from Tyrolean archives.',
      'Textauszeichnung mit TEI, Named-Entity-Erkennung, Netzwerkanalyse und digitale Editionen anhand historischer Quellen aus Tiroler Archiven.',
    ],
    outcomes: [
      [
        'Build a small TEI-encoded digital edition.',
        'Eine kleine TEI-kodierte digitale Edition erstellen.',
      ],
    ],
    admission: ['None.', 'Keine.'],
    assessment: ['Portfolio of exercises.', 'Übungsportfolio.'],
  },
  {
    code: '660010',
    abbr: 'SPORT-MED',
    level: 'bachelor',
    ects: 5,
    lang: 'ger',
    modes: ['on campus'],
    isced: 'ABCD',
    edge: 'fieldsOfStudy "ABCD" is not an ISCED-F 2013 code',
    edux: true,
    theme: 'Health and life sciences',
    terms: ['W', 'S'],
    name: ['Sport Science and Mountain Medicine', 'Sportwissenschaft und Bergmedizin'],
    description: [
      'Exercise physiology at altitude, hypoxia, prevention of mountain sports injuries and first response in alpine terrain.',
      'Leistungsphysiologie in der Höhe, Hypoxie, Prävention von Bergsportverletzungen und Erstversorgung im alpinen Gelände.',
    ],
    outcomes: [
      [
        'Explain the physiological response to acute and chronic hypoxia.',
        'Die physiologische Reaktion auf akute und chronische Hypoxie erklären.',
      ],
    ],
    admission: ['None.', 'Keine.'],
    assessment: ['Written exam.', 'Schriftliche Prüfung.'],
  },
  // ---- internal courses: no eduXchange consumer, hidden by consumer=eduxchange
  {
    code: '703900',
    abbr: 'BA-SEM-CS',
    level: 'bachelor',
    ects: 10,
    lang: 'ger',
    modes: ['on campus'],
    isced: '0613',
    edux: false,
    terms: ['W', 'S'],
    name: ['Bachelor Thesis Seminar in Computer Science', 'Bachelorarbeitsseminar Informatik'],
    description: [
      'Supervised seminar accompanying the bachelor thesis; reserved for students of the local bachelor programme.',
      'Betreutes Seminar zur Bachelorarbeit; nur für Studierende des eigenen Bachelorstudiums.',
    ],
    outcomes: [
      ['Write and defend a bachelor thesis.', 'Eine Bachelorarbeit verfassen und verteidigen.'],
    ],
    admission: [
      'At least 120 ECTS in the bachelor programme.',
      'Mindestens 120 ECTS im Bachelorstudium.',
    ],
    assessment: ['Thesis and presentation.', 'Arbeit und Präsentation.'],
  },
  {
    code: '300900',
    abbr: 'AT-CONST',
    level: 'bachelor',
    ects: 6,
    lang: 'ger',
    modes: ['on campus'],
    isced: '0421',
    edux: false,
    terms: ['W', 'S'],
    name: ['Austrian Constitutional Law', 'Österreichisches Verfassungsrecht'],
    description: [
      'Federal constitution, fundamental rights and the Constitutional Court of Austria.',
      'Bundesverfassung, Grundrechte und der Verfassungsgerichtshof.',
    ],
    outcomes: [
      [
        'Solve cases in Austrian constitutional law.',
        'Fälle im österreichischen Verfassungsrecht lösen.',
      ],
    ],
    admission: ['Introduction to law.', 'Einführung in die Rechtswissenschaften.'],
    assessment: ['Written exam.', 'Schriftliche Prüfung.'],
  },
  {
    code: '201900',
    abbr: 'CLIN-PRAC',
    level: 'master',
    ects: 10,
    lang: 'ger',
    modes: ['situated'],
    isced: '0313',
    edux: false,
    terms: ['S'],
    name: ['Internship in Clinical Psychology', 'Praktikum Klinische Psychologie'],
    description: [
      'Supervised placement in a clinical setting in Tyrol; places are allocated to local master students only.',
      'Betreutes Praktikum in einer klinischen Einrichtung in Tirol; Plätze nur für Masterstudierende der eigenen Universität.',
    ],
    outcomes: [
      [
        'Apply diagnostic procedures under supervision.',
        'Diagnostische Verfahren unter Supervision anwenden.',
      ],
    ],
    admission: [
      'Admission to the master programme in psychology.',
      'Zulassung zum Masterstudium Psychologie.',
    ],
    assessment: ['Internship report.', 'Praktikumsbericht.'],
  },
  {
    code: '401999',
    abbr: 'TUT-MICRO',
    level: 'bachelor',
    ects: 2,
    lang: 'ger',
    modes: ['on campus'],
    isced: '0311',
    edux: false,
    terms: ['W', 'S'],
    name: ['Tutorial in Microeconomics', 'Tutorium Mikroökonomik'],
    description: [
      'Exercise sessions for first-year students, run by senior students.',
      'Übungseinheiten für Studierende im ersten Jahr, geleitet von Studierenden höherer Semester.',
    ],
    outcomes: [
      [
        'Solve standard problems in consumer and producer theory.',
        'Standardaufgaben der Haushalts- und Unternehmenstheorie lösen.',
      ],
    ],
    admission: ['None.', 'Keine.'],
    assessment: ['Pass or fail on participation.', 'Mit oder ohne Erfolg nach Teilnahme.'],
  },
  {
    code: '609999',
    abbr: 'EXC-TYROL',
    level: 'bachelor',
    ects: 3,
    lang: 'ger',
    modes: ['situated'],
    isced: '0532',
    edux: false,
    terms: [],
    name: ['Field Trip Tyrol', 'Exkursion Tirol'],
    description: [
      'Three-day field trip for local geography students; not open to exchange students.',
      'Dreitägige Exkursion für Geographiestudierende der eigenen Universität; nicht für Austauschstudierende.',
    ],
    outcomes: [
      [
        'Describe the landscapes of North and East Tyrol.',
        'Die Landschaften Nord- und Osttirols beschreiben.',
      ],
    ],
    admission: ['None.', 'Keine.'],
    assessment: ['Field diary.', 'Exkursionstagebuch.'],
  },
];

// Offerings with deliberate per-offering edge cases, keyed `${code}-${term}`.
const OFFERING_EDGES = {
  '703040-W': {
    omitEnrolled: true,
    edge: 'maxNumberStudents present but no enrolledNumberStudents (seats unknown)',
  },
  '703040-S': {
    modes: ['online'],
    edge: 'offering modeOfDelivery ("online") overrides the course value ("hybrid")',
  },
  '401330-S': { edge: 'offering teachingLanguage "eng" overrides the course value "ger"' },
  '401210-S': {
    edge: 'enrollEndDate 2026-09-15 is in the past although the offering starts 2027-03-01',
  },
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function buildCourse(c) {
  const courseId = id('course', c.code);
  const link = `${c.httpLink ? 'http' : 'https'}://lfuonline.uibk.example/courses/${c.code}`;
  const course = {
    courseId,
    primaryCode: { codeType: 'identifier', code: c.code },
    name: lt(...c.name),
    abbreviation: c.abbr,
    description: lt(...c.description),
    teachingLanguage: c.lang,
    level: c.level,
    studyLoad: { studyLoadUnit: 'ects', value: c.ects },
    modeOfDelivery: c.modes,
    fieldsOfStudy: c.isced,
    learningOutcomes: c.outcomes.map((o) => lt(...o)),
    admissionRequirements: lt(...c.admission),
    assessment: lt(...c.assessment),
    link,
    organization: ORG_ID,
  };
  if (c.edux) {
    course.consumers = [
      {
        consumerKey: 'eduxchange',
        alliances: [
          {
            name: 'aurora',
            theme: c.theme,
            selection: false,
            type: c.level === 'master' ? 'deepening' : 'broadening',
            visibleForOwnStudents: false,
          },
        ],
      },
    ];
  }
  return course;
}

function buildOffering(c, course, term) {
  const key = `${c.code}-${term}`;
  const edge = OFFERING_EDGES[key] ?? {};
  const t = { ...TERMS[term], ...(c.termOverride?.[term] ?? {}) };
  const max = int(2, 12) * 5;
  const enrolled = Math.min(max, int(0, max));
  const pending = int(0, 4);
  const lang = c.offeringLang?.[term] ?? c.lang;
  const termLabel =
    term === 'W'
      ? ['Winter semester 2026/27', 'Wintersemester 2026/27']
      : ['Summer semester 2027', 'Sommersemester 2027'];
  const offering = {
    offeringId: id('offering', key),
    primaryCode: { codeType: 'offeringCode', code: `${c.code}-${t.suffix}` },
    offeringType: 'course',
    academicSession: t.session,
    name: lt(...c.name),
    description: lt(
      c.germanOnly ? null : `${termLabel[0]} edition of ${c.name[0]}.`,
      `${termLabel[1]}: ${c.name[1]}.`,
    ),
    teachingLanguage: lang,
    modeOfDelivery: edge.modes ?? c.modes,
    maxNumberStudents: max,
    enrolledNumberStudents: enrolled,
    pendingNumberStudents: pending,
    resultExpected: true,
    resultValueType: '1-10',
    link: `${LFU}/courses/${c.code}/${t.suffix}`,
    startDate: t.startDate,
    endDate: t.endDate,
    enrollStartDate: t.enrollStartDate,
    enrollEndDate: t.enrollEndDate,
    course: course.courseId,
  };
  if (edge.omitEnrolled) delete offering.enrolledNumberStudents;
  if (c.edux) {
    offering.consumers = [
      {
        consumerKey: 'eduxchange',
        alliances: [{ name: 'aurora', enrollmentUrl: `${LFU}/apply/${c.code}/${t.suffix}` }],
      },
    ];
  }
  return { offering, edge: edge.edge };
}

function build(courseDefs, variant) {
  const courses = [];
  const offerings = [];
  const edgeCases = [];
  for (const c of courseDefs) {
    const course = buildCourse(c);
    courses.push(course);
    if (c.edge)
      edgeCases.push({
        kind: 'course',
        courseId: course.courseId,
        primaryCode: c.code,
        case: c.edge,
      });
    if (!c.edux) {
      edgeCases.push({
        kind: 'course',
        courseId: course.courseId,
        primaryCode: c.code,
        case: 'not tagged for eduXchange: absent from consumer=eduxchange listings',
      });
    }
    for (const term of c.terms) {
      const { offering, edge } = buildOffering(c, course, term);
      offerings.push(offering);
      if (edge) {
        edgeCases.push({
          kind: 'offering',
          offeringId: offering.offeringId,
          primaryCode: offering.primaryCode.code,
          case: edge,
        });
      }
    }
  }
  return {
    meta: {
      description:
        'Simulated OEAPI v5.0 partner dataset (University of Innsbruck slice) for OECP development. Synthetic content; generated by scripts/generate-dataset.mjs.',
      variant,
      seed: SEED,
      oeapiVersion: '5.0',
      consumer: 'eduxchange',
      counts: {
        courses: courses.length,
        eduxchangeCourses: courses.filter((x) => x.consumers).length,
        offerings: offerings.length,
        academicSessions: academicSessions.length,
      },
      edgeCases,
    },
    service: {
      contactEmail: 'oeapi-mock@uibk.example',
      specification: 'https://open-education-api.github.io/specification/v5/docs.html',
      documentation: `${LFU}/oeapi/docs`,
      consumers: [{ consumerKey: 'eduxchange' }],
    },
    organizations: [organization],
    academicSessions,
    courses,
    offerings,
  };
}

// Baseline. Generate once so both variants share the PRNG sequence for the
// courses they have in common (the next run is derived from the baseline,
// not regenerated).
const baseline = build(COURSES, 'baseline');

// Next run: two eduXchange courses disappear, one changes.
const REMOVED = ['702110', '432005'];
const CHANGED = '703001';
const next = structuredClone(baseline);
next.meta.variant = 'next-run';
const removedIds = new Set(
  next.courses.filter((c) => REMOVED.includes(c.primaryCode.code)).map((c) => c.courseId),
);
next.courses = next.courses.filter((c) => !removedIds.has(c.courseId));
next.offerings = next.offerings.filter((o) => !removedIds.has(o.course));
const changed = next.courses.find((c) => c.primaryCode.code === CHANGED);
changed.studyLoad = { studyLoadUnit: 'ects', value: 6 };
changed.description = lt(
  'Supervised and unsupervised learning from first principles: linear models, decision trees, ensembles, clustering and neural networks, now with a module on responsible AI and the EU AI Act. Weekly lab sessions in Python use open datasets from environmental monitoring in the Alps.',
  'Überwachtes und unüberwachtes Lernen von Grund auf: lineare Modelle, Entscheidungsbäume, Ensembles, Clustering und neuronale Netze, jetzt mit einem Modul zu verantwortungsvoller KI und dem EU AI Act. Wöchentliche Übungen in Python arbeiten mit offenen Datensätzen aus dem alpinen Umweltmonitoring.',
);
next.meta.counts = {
  courses: next.courses.length,
  eduxchangeCourses: next.courses.filter((x) => x.consumers).length,
  offerings: next.offerings.length,
  academicSessions: next.academicSessions.length,
};
next.meta.edgeCases = next.meta.edgeCases.filter(
  (e) => !REMOVED.includes(e.primaryCode?.split('-')[0]),
);
next.meta.changesFromBaseline = {
  removedCourses: baseline.courses
    .filter((c) => removedIds.has(c.courseId))
    .map((c) => ({ courseId: c.courseId, primaryCode: c.primaryCode.code })),
  removedOfferings: baseline.offerings
    .filter((o) => removedIds.has(o.course))
    .map((o) => ({ offeringId: o.offeringId, primaryCode: o.primaryCode.code })),
  changedCourses: [
    {
      courseId: changed.courseId,
      primaryCode: CHANGED,
      fields: ['studyLoad.value (5 -> 6)', 'description (en-GB, de-DE)'],
    },
  ],
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [file, data] of [
  ['uibk.json', baseline],
  ['uibk-next-run.json', next],
]) {
  writeFileSync(join(OUT_DIR, file), JSON.stringify(data, null, 2) + '\n');
  const m = data.meta.counts;
  console.error(
    `wrote ${join(OUT_DIR, file)}: ${m.courses} courses (${m.eduxchangeCourses} eduxchange), ${m.offerings} offerings, ${m.academicSessions} sessions`,
  );
}
