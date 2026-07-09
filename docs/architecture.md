# LuminX — Technisch Ontwerp

> Status: **concept, ter goedkeuring**. Nog geen implementatie.
> Doel: de ontbrekende schakel tussen moderne frontend-frameworks en CMS'en.
> Eerste doel-CMS: Craft CMS 5. CLI-first. Volledig deterministisch. Geen AI, geen LLM's, geen externe API's.

---

## 1. Kernprincipes

Deze principes zijn niet onderhandelbaar en sturen elke architectuurbeslissing hieronder.

1. **Deterministisch.** Dezelfde config + dezelfde CMS-staat ⇒ exact hetzelfde plan. Geen heuristiek, geen inferentie, geen netwerkafhankelijkheid buiten de CMS-bridge zelf.
2. **Config is de bron van waarheid.** `luminx.config.json` beschrijft het gewenste contentmodel. Het CMS is een projectie daarvan.
3. **De core kent geen CMS.** `@luminx/core` mag het woord "Craft" nergens bevatten. Alles loopt via adapters.
4. **Idempotent.** `generate` is onbeperkt herhaalbaar. Nooit dubbele objecten, nooit dubbele velden. Alleen creates, updates en skips.
5. **Plan vóór apply.** Elke mutatie wordt eerst als expliciet, inspecteerbaar plan berekend. `--dry-run` toont dat plan en schrijft niets.
6. **Omkeerbaar.** Elke apply schrijft eerst een snapshot. `luminx undo` herstelt de vorige staat.
7. **Geen businesslogica in controllers.** Controllers parsen input en delegeren naar services.

---

## 2. Monorepo-structuur

```
luminx/
├── package.json                  # workspace root (pnpm workspaces)
├── pnpm-workspace.yaml
├── turbo.json                    # taakorchestratie + caching
├── tsconfig.base.json
├── .dependency-cruiser.cjs       # afdwingen van de dependency graph
├── composer.json                 # root composer (alleen voor plugin-dev tooling)
│
├── packages/
│   ├── shared/                   # @luminx/shared      — types, IR, protocol, schema
│   ├── core/                     # @luminx/core        — compiler, differ, planner, executor
│   ├── parsers/                  # @luminx/parsers     — projectdetectie & bestandsparsers
│   ├── adapter-craft/            # @luminx/adapter-craft — TS-zijde van de Craft-bridge
│   ├── cli/                      # luminx              — het uitvoerbare CLI-pakket
│   └── craft-plugin/             # luminx/craft-luminx — PHP, Craft CMS 5 plugin
│
├── docs/
│   ├── architecture.md           # dit document
│   ├── config-reference.md
│   ├── adapter-authoring.md
│   └── protocol.md
│
└── examples/
    ├── craft-nextjs/
    ├── craft-nuxt/
    └── config-samples/
```

### 2.1 Afwijking van de opgegeven structuur

Je opzet noemde `craft-plugin` als één pakket. In de praktijk zijn dat **twee** artefacten met een verschillende runtime, taal en distributiekanaal:

| | Runtime | Taal | Distributie |
|---|---|---|---|
| `adapter-craft` | Node (bij de developer) | TypeScript | npm |
| `craft-plugin` | PHP (in het project) | PHP 8.3+ | Packagist / Composer |

Ze in één pakket proppen zou de core dwingen om PHP-kennis te hebben of de CLI om via de plugin te introspecteren zónder abstractie. Gescheiden houden ze het contract expliciet: **de adapter praat protocol, de plugin implementeert het.**

---

## 3. Packages & verantwoordelijkheden

### 3.1 `@luminx/shared`

Nul dependencies. Wordt door élk ander pakket geïmporteerd en importeert zelf niets uit de monorepo.

**Bevat:**

- De **Intermediate Representation (IR)** — de CMS-neutrale beschrijving van een contentmodel (§6).
- De **operatie- en plan-types** (`Operation`, `Plan`, `OperationResult`).
- Het **wire-protocol** tussen CLI en CMS (`IntrospectRequest`, `ApplyRequest`, `Envelope`, `ProtocolVersion`).
- **Foutcodes** als gesloten enum (`LX1001` … `LX5xxx`), zodat elke fout machine-leesbaar én documenteerbaar is.
- Het `Result<T, E>`-type. LuminX gooit geen exceptions over pakketgrenzen heen; verwachte fouten zijn waardes.

**Bevat nadrukkelijk niet:** I/O, filesystem, netwerk, logging.

### 3.2 `@luminx/core`

Het hart. Kent geen CMS, geen bestandsformaten van derden, geen terminal.

**Verantwoordelijkheden:**

| Module | Taak |
|---|---|
| `config/loader` | `luminx.config.json` inlezen, `$schema`-verwijzing oplossen, `extends` afhandelen |
| `config/validator` | Validatie met Zod → precieze, gelokaliseerde foutmeldingen met JSON-pointer |
| `config/compiler` | Config → `DesiredModel` (IR). Lost referenties op, expandeert reusable fields, kent stabiele logische ID's toe |
| `diff/differ` | `DesiredModel` × `CurrentModel` → `Plan` |
| `plan/orderer` | Topologische sortering van operaties + twee-fasen-splitsing (§8.3) |
| `plan/executor` | Voert het plan uit via de adapter, verzamelt resultaten, is verantwoordelijk voor abort-on-error |
| `state/lockfile` | Lezen/schrijven van `luminx.lock.json` (logische ID → CMS-UID) |
| `adapter/registry` | Registratie en resolutie van adapters op `cms`-key |
| `adapter/contract` | De `CmsAdapter`-interface (§7) |
| `logging` | `Logger`-interface + structured events. Geen `console.log`. |

Afhankelijk van: `@luminx/shared`. Verder niets.

### 3.3 `@luminx/parsers`

Deterministische lezers van bestanden die LuminX aantreft. Geen inferentie, geen raden — een parser geeft óf een geparseerd feit, óf `null`.

- `ComposerJsonParser` / `ComposerLockParser` — Craft-versie, PHP-constraint, geïnstalleerde plugins en hun versies.
- `DotEnvParser` — leest `.env` **zonder** waardes te loggen; alleen aanwezigheid van keys.
- `PackageJsonParser` — detecteert frontend-framework (Next.js, Nuxt, Astro, SvelteKit, Remix).
- `ProjectConfigYamlParser` — leest `config/project/*.yaml` voor offline introspectie en drift-detectie.
- `RunnerDetector` — detecteert DDEV (`.ddev/config.yaml`), Lando, Docker Compose, of kaal PHP.
- `ProjectProbe` — orkestreert bovenstaande tot één `ProjectFacts`-object.

`ProjectFacts` is puur data en voedt zowel `generate` (welke runner, welke adapter) als `doctor` (welke checks falen).

### 3.4 `@luminx/adapter-craft`

Implementeert `CmsAdapter` voor Craft 5. Bevat de **Runner**-abstractie (§7.3) die bepaalt *hoe* PHP wordt aangeroepen — lokaal, via DDEV, via `docker compose exec`, of later via SSH/HTTP.

Weet alles van: de Craft-plugin, het protocol, versiecompatibiliteit, en de vertaling IR ⇄ Craft-begrippen.

### 3.5 `luminx` (CLI)

Het enige pakket met een `bin`. Dun. Bevat:

- Command-definities (`init`, `generate`, `sync`, `doctor`, `plan`, `undo`; `deploy` gereserveerd).
- Rendering: preview-tabel, spinners, diff-kleuring, `--json`-output.
- Prompts (bevestiging, `init`-wizard).
- Exit-code-mapping.

**Geen** planlogica, geen diffing, geen adapter-kennis buiten `registry.resolve(config.cms)`.

### 3.6 `craft-luminx` (PHP-plugin)

Craft 5 plugin, `composer type: craft-plugin`. **Zonder settings-model en zonder settings-view** — conform de eis. De plugin is een *executor*, geen configuratieopslag.

---

## 4. Dependency graph

```
                     ┌──────────────────┐
                     │  @luminx/shared  │   (types, IR, protocol, errors)
                     └────────┬─────────┘
              ┌───────────────┼────────────────┐
              │               │                │
      ┌───────▼──────┐ ┌──────▼───────┐ ┌──────▼──────────────┐
      │ @luminx/core │ │@luminx/parsers│ │@luminx/adapter-craft│
      └───────┬──────┘ └──────┬───────┘ └──────┬──────────────┘
              │               │                │
              │      implements CmsAdapter ────┘
              │               │                │
              └───────────────┼────────────────┘
                              │
                     ┌────────▼─────────┐
                     │      luminx      │  (CLI — compositieroot)
                     └────────┬─────────┘
                              │  proces / protocol (JSON over stdio)
                     ┌────────▼─────────┐
                     │   craft-luminx   │  (PHP, in het Craft-project)
                     └──────────────────┘
```

**Regels, afgedwongen met `dependency-cruiser` in CI:**

- `shared` → niets.
- `core` → alleen `shared`.
- `parsers` → alleen `shared`.
- `adapter-craft` → `shared` + `core` (uitsluitend voor de `CmsAdapter`-interface).
- `cli` → alles. De CLI is de **enige** compositieroot; hier worden adapters geregistreerd en dependencies bedraad.
- Niemand importeert `cli`.
- Cycli: verboden, build faalt.

De adapter is de enige plek waar het woord `Craft` in TypeScript voorkomt. Een grep op `craft` in `core/` is een CI-check.

---

## 5. Configuratie

### 5.1 `luminx.config.json`

```jsonc
{
  "$schema": "https://luminx.dev/schema/v1.json",
  "version": 1,
  "cms": "craft",
  "siteName": "Demo",

  "sites": [
    { "handle": "default", "language": "nl", "primary": true }
  ],

  // Herbruikbare velddefinities. Elders te refereren met "$ref".
  "fields": {
    "seoTitle": { "type": "text", "name": "SEO Title", "max": 60 },
    "heroImage": {
      "type": "assets",
      "name": "Hero Image",
      "sources": ["images"],
      "maxRelations": 1
    }
  },

  "filesystems": [
    { "handle": "local", "type": "local", "path": "@webroot/uploads", "url": "@web/uploads" }
  ],

  "volumes": [
    { "handle": "images", "name": "Images", "fs": "local" }
  ],

  "categories": [
    { "handle": "topics", "name": "Topics", "maxLevels": 1, "uriFormat": "topics/{slug}" }
  ],

  "sections": [
    {
      "handle": "pages",
      "name": "Pages",
      "type": "structure",
      "maxLevels": 3,
      "uriFormat": "{parent.uri}/{slug}",
      "template": "pages/_entry",
      "entryTypes": [
        {
          "handle": "default",
          "name": "Default",
          "fields": [
            { "$ref": "#/fields/seoTitle" },
            { "$ref": "#/fields/heroImage" },
            {
              "handle": "content",
              "type": "matrix",
              "name": "Content",
              // Craft 5: matrix nest Entry Types, geen block types meer.
              "entryTypes": [
                {
                  "handle": "heroBlock",
                  "name": "Hero",
                  "fields": [
                    { "handle": "heading", "type": "text" },
                    { "$ref": "#/fields/heroImage" }
                  ]
                },
                {
                  "handle": "faqBlock",
                  "name": "FAQ",
                  "fields": [
                    { "handle": "question", "type": "text" },
                    { "handle": "answer", "type": "richtext" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ],

  "globals": [
    { "handle": "siteSettings", "name": "Site Settings",
      "fields": [{ "handle": "phone", "type": "text" }] }
  ],

  "userGroups": [
    { "handle": "editors", "name": "Editors", "permissions": ["accessCp", "viewEntries:pages"] }
  ],

  // Optioneel, vereist een navigatie-provider (§9.4)
  "navigation": [
    { "handle": "main", "name": "Main Menu" }
  ]
}
```

### 5.2 Ontwerpbeslissingen in de config

**`handle` is verplicht, `name` optioneel.** Jouw voorbeeld gebruikte alleen `name: "Pages"`. Een `name` is een label voor redacteuren en móet vrij hernoembaar zijn. Als het label tegelijk de sleutel is, is hernoemen niet te onderscheiden van "verwijder + maak nieuw" — en dan verliest de klant content. Dus: `handle` is de sleutel, `name` is cosmetisch en vrij te wijzigen. Ontbreekt `name`, dan wordt hij afgeleid uit de handle (`pages` → `Pages`).

**`$ref` voor herbruikbare velden.** Zonder dit dupliceer je velddefinities over entry types heen en gaan ze uiteenlopen. De compiler expandeert `$ref` en garandeert dat één handle exact één definitie heeft — conflicterende definities zijn een validatiefout, geen "laatste wint".

**Geen `id`, geen `uid` in de config.** Die horen in het lockfile.

### 5.3 `luminx.lock.json` — gecommit, machine-geschreven

```jsonc
{
  "version": 1,
  "cms": "craft",
  "generatedAt": "2026-07-09T00:00:00Z",
  "resources": {
    "section:pages":            { "uid": "a1b2…", "hash": "sha256:…" },
    "entryType:pages.default":  { "uid": "c3d4…", "hash": "sha256:…" },
    "field:content":            { "uid": "e5f6…", "hash": "sha256:…" }
  }
}
```

Dit bestand doet drie dingen:

1. **Hernoemen mogelijk maken.** Verandert `handle` van `pages` → `sitePages`, dan vindt de differ via het lockfile de bestaande UID en genereert een *update*, geen destructieve recreate.
2. **Snelle skip-detectie.** De `hash` is de canonieke hash van de gecompileerde resource. Gelijk aan wat er staat ⇒ `Skipped`, zonder round-trip naar PHP voor die resource.
3. **Drift zichtbaar maken.** Wijkt de CMS-staat af van de hash terwijl de config niet veranderde, dan is er handmatig in de CP gerommeld. `doctor` rapporteert dat.

Het lockfile hoort in git. Het is nooit de bron van waarheid — bij verlies is het reconstrueerbaar uit CMS-introspectie, met verlies van rename-detectie.

---

## 6. De Intermediate Representation (IR)

De IR is het contract tussen core en adapters. Hij is bewust *armer* dan Craft: alleen wat elk serieus CMS kan uitdrukken.

```ts
type ResourceKind =
  | 'filesystem' | 'volume' | 'field' | 'entryType'
  | 'section' | 'category' | 'globalSet' | 'userGroup' | 'navigation';

interface Resource {
  kind: ResourceKind;
  logicalId: string;          // 'section:pages' — stabiel, uit de config
  handle: string;
  name: string;
  spec: ResourceSpec;         // discriminated union per kind
  dependsOn: string[];        // logicalIds
  hash: string;               // canonieke sha256 van spec
}

interface ContentModel {
  resources: Map<string, Resource>;
}
```

Velden zijn **abstracte types** met een gesloten set: `text`, `richtext`, `number`, `boolean`, `date`, `dropdown`, `multiselect`, `assets`, `entries`, `categories`, `users`, `matrix`, `table`, `color`, `money`, `link`, `raw`.

`raw` is de ontsnappingsklep: `{ "type": "raw", "cms": { "craft": { "class": "verbb\\supertable\\fields\\SuperTableField", "settings": { … } } } }`. Hij is CMS-specifiek, wordt niet vertaald, en is bewust lelijk zodat je hem alleen gebruikt als het moet.

**Waarom een IR en niet direct Craft-JSON?** Omdat de differ anders Craft-semantiek moet kennen (Craft 5's matrix ≠ Craft 4's matrix ≠ ACF's repeater), en je bij CMS nummer twee de hele differ opnieuw schrijft. De IR is de reden dat WordPress/Statamic later een adapter zijn en geen fork.

---

## 7. De adapter

### 7.1 Contract

```ts
interface CmsAdapter {
  readonly id: string;                    // 'craft'
  readonly protocolVersion: number;

  /** Detecteert of dit CMS in het project aanwezig is + verzamelt versies. */
  detect(cwd: string, facts: ProjectFacts): Promise<Result<CmsInfo, DetectError>>;

  /** Leest de huidige staat en normaliseert naar IR. Zijeffectvrij. */
  introspect(ctx: AdapterContext): Promise<Result<ContentModel, AdapterError>>;

  /** Voert één operatie uit. Idempotent. Retourneert de resulterende UID. */
  apply(op: Operation, ctx: AdapterContext): Promise<Result<OperationResult, AdapterError>>;

  /** Maakt een herstelbaar snapshot vóór de eerste apply. */
  snapshot(ctx: AdapterContext): Promise<Result<SnapshotRef, AdapterError>>;
  restore(ref: SnapshotRef, ctx: AdapterContext): Promise<Result<void, AdapterError>>;

  /** CMS-specifieke doctor-checks, aanvullend op de generieke. */
  healthChecks(ctx: AdapterContext): Promise<HealthCheck[]>;

  /** Vertaalt abstracte veldtypes; gooit op onbekende types tenzij `raw`. */
  readonly capabilities: Capabilities;
}
```

`capabilities` maakt vriendelijk falen mogelijk: gebruikt de config `money` maar ondersteunt de adapter dat niet, dan is dat een **validatiefout vóór het plan**, niet een crash halverwege een apply.

### 7.2 Waarom de adapter geen mutaties bedenkt

De adapter **voert operaties uit die de core heeft bedacht**. Hij mag nooit zelf besluiten iets aan te maken. Dat houdt `--dry-run` eerlijk: het plan dat je ziet is exact het plan dat draait.

### 7.3 De Runner-abstractie

Het lastigste praktische probleem: de CLI draait in Node, Craft draait in PHP, en dat PHP zit vaak in een container.

```ts
interface Runner {
  exec(argv: string[], stdin?: string): Promise<ExecResult>;
}
```

Implementaties in `adapter-craft`:

| Runner | Commando | Wanneer |
|---|---|---|
| `LocalPhpRunner` | `php craft luminx/…` | kaal PHP op PATH |
| `DdevRunner` | `ddev exec php craft luminx/…` | `.ddev/config.yaml` aanwezig |
| `DockerComposeRunner` | `docker compose exec -T <svc> php craft …` | `--runner=docker` |
| `SshRunner` | `ssh host 'cd path && php craft …'` | **gereserveerd voor `deploy`** |

Auto-detectie via `RunnerDetector`, altijd overrulebaar met `--runner`. Dit is één van de weinige plekken met omgevingsafhankelijk gedrag, dus het is expliciet, gelogd, en toonbaar met `luminx doctor`.

### 7.4 Het protocol

JSON over een **bestand**, niet over stdout. Reden: Craft, Yii en willekeurige plugins schrijven ongevraagd naar stdout (deprecation notices, Xdebug-waarschuwingen). Stdout parsen is fragiel.

```
CLI                                          PHP-plugin
 │                                                │
 ├─ schrijf request → .luminx/req-<id>.json       │
 ├─ exec: php craft luminx/introspect \           │
 │        --request=… --response=…  ─────────────►│
 │                                                ├─ lees request
 │                                                ├─ valideer protocolVersion
 │                                                ├─ voer uit
 │                                                └─ schrijf response
 │◄───────────────────────────────────────────────┘
 ├─ lees .luminx/res-<id>.json
 └─ exit-code = transportfout; envelope.errors = domeinfout
```

Envelope:

```jsonc
{
  "protocolVersion": 1,
  "ok": true,
  "data": { /* … */ },
  "errors": [],
  "warnings": [],
  "diagnostics": { "craftVersion": "5.6.0", "phpVersion": "8.3.14", "pluginVersion": "0.1.0" }
}
```

**Versiepolitiek:** de adapter weigert te draaien als `plugin.protocolVersion` afwijkt van de zijne, met een concreet `composer require`-advies. Geen impliciete compatibiliteit.

---

## 8. CLI-flow

### 8.1 De pijplijn

Elk mutatiecommando doorloopt exact dezelfde acht stappen. `generate`, `sync` en `deploy` verschillen alleen in configuratie van die pijplijn.

```
 1. LOAD       luminx.config.json + luminx.lock.json inlezen
 2. VALIDATE   Zod-schema + semantische checks (dubbele handles, kapotte $refs, cycli)
 3. PROBE      ProjectFacts verzamelen (framework, PHP, Craft, plugin, runner)
 4. COMPILE    config → DesiredModel (IR), $refs expanderen, hashes berekenen
 5. INTROSPECT adapter.introspect() → CurrentModel (IR)
 6. DIFF       DesiredModel × CurrentModel × lockfile → Plan
 7. PREVIEW    plan tonen; --dry-run stopt hier; anders bevestiging
 8. APPLY      snapshot → operaties uitvoeren → lockfile schrijven → rapport
```

Stap 1–6 zijn puur en zijeffectvrij. Alles wat schrijft zit in stap 8. Dat maakt de hele planningsfase unit-testbaar zonder Craft, zonder PHP, zonder database.

### 8.2 De operaties

```ts
type Operation =
  | { kind: 'create';  resource: Resource; phase: 1 | 2 }
  | { kind: 'update';  resource: Resource; uid: string; changes: FieldChange[]; phase: 1 | 2 }
  | { kind: 'skip';    resource: Resource; reason: 'unchanged' }
  | { kind: 'delete';  resource: Resource; uid: string };   // alleen met --prune
```

**`delete` staat standaard uit.** Een verwijderde section betekent verwijderde content. Weglaten uit de config verwijdert dus niets; het wordt gerapporteerd als `Orphaned`. Wil je opruimen, dan expliciet:

```bash
npx luminx sync --prune          # vraagt per resource om bevestiging
npx luminx sync --prune --yes    # alleen voor CI, en het logt luid
```

Dit is het verschil tussen "een tool die je vertrouwt" en "een tool die ooit een keer een productie-section sloopte".

### 8.3 Twee-fasen-apply

Contentmodellen zijn cyclisch. Een `entries`-veld in *Pages* wijst naar section *Blog*; een `entries`-veld in *Blog* wijst terug naar *Pages*. Topologisch sorteren lost dat niet op — de graaf heeft een cyclus.

Oplossing: elke operatie wordt gesplitst.

- **Fase 1 — structuur.** Maak/actualiseer resources zónder cross-referenties. Velden krijgen lege `sources`, matrix krijgt nog geen entry types. Na fase 1 bestaat elke resource en heeft elke resource een UID.
- **Fase 2 — bedrading.** Vul alle referenties in, nu elke UID bekend is: veldbronnen, matrix-entry-types, field layouts van entry types, section↔entryType-koppelingen.

Binnen elke fase geldt nog steeds topologische ordening (filesystem → volume; field → entryType → section). De cyclus zit uitsluitend in referenties, en die zijn per definitie fase 2.

### 8.4 De commando's

#### `luminx init`

Interactief (of `--yes` + flags). Detecteert het project, schrijft `luminx.config.json` met een minimale, geldige start. **Schrijft niets naar het CMS.** Als er al een Craft-installatie met content staat, biedt hij `luminx init --from-existing` aan: introspecteer en genereer een config die de huidige staat exact beschrijft. Dat is de migratiepad-in voor bestaande projecten en meteen de beste test van de introspectie (round-trip: introspect → config → compile → diff moet leeg zijn).

#### `luminx generate`

De volle pijplijn, `create` + `update` + `skip`. Geen deletes.

```
Project      /Users/…/demo        Next.js 15
CMS          Craft CMS 5.6.0      PHP 8.3.14   runner: ddev
Plugin       craft-luminx 0.1.0   protocol v1

  create   section     Pages
  create   entryType   Pages / Default
  create   field       Hero Matrix           (3 entry types)
  update   field       FAQ Matrix            name, +1 entry type
  skip     section     Blog                  unchanged
  update   globalSet   Site Settings         +1 field
  create   volume      Images

  7 operations   3 create   2 update   2 skip   0 delete

? Apply these changes? (y/N)
```

#### `luminx generate --dry-run`

Stopt na stap 7. Schrijft geen snapshot, geen lockfile, raakt de database niet aan. `--json` geeft het plan als machine-leesbare JSON — dat is meteen de basis voor `deploy` (§11).

#### `luminx sync`

Zelfde pijplijn, andere houding. `generate` is *"breng het CMS naar de config toe"*. `sync` is *"verzoen beide kanten en laat me de drift zien"*:

- Toont **drift**: resources die in het CMS afwijken van hun lockfile-hash terwijl de config niet wijzigde ⇒ iemand heeft in de CP gewerkt.
- `--prune` beschikbaar.
- `--check` (CI-modus): exit `1` als er íets zou wijzigen. Zo bewaakt je pipeline dat productie en config identiek zijn.

#### `luminx doctor`

Muteert nooit. Draait onafhankelijke checks en rapporteert per check `pass / warn / fail` met een `fix`-suggestie.

| Categorie | Check |
|---|---|
| Omgeving | PHP ≥ 8.3 · PHP-extensies · `php craft` uitvoerbaar · runner gedetecteerd |
| Craft | Craft ≥ 5.0 · Craft-versie ≥ door plugin vereiste minimum |
| Plugin | `craft-luminx` geïnstalleerd · geïnstalleerd **én geactiveerd** · protocolversie komt overeen |
| Project config | `allowAdminChanges` staat aan (anders is elke apply zinloos — Craft weigert schrijven) |
| Project config | Geen pending project-config-changes (`project.yaml` out of sync met DB) |
| Config | `luminx.config.json` valide · geen dubbele handles · geen kapotte `$ref` · geen onbekende veldtypes voor deze adapter |
| Model | Ontbrekende sections · ontbrekende fields · ontbrekende entry types |
| Drift | Lockfile-hashes vs. werkelijke CMS-staat |
| Lockfile | Aanwezig · verwijst niet naar verwijderde UID's |

`luminx doctor --json` voor CI. Exit-codes: §8.6.

#### `luminx plan` *(nieuw — niet in je opzet)*

`generate --dry-run --json -o plan.json`, maar als eersterangs commando. Scheidt planning van uitvoering, zoals Terraform. Dit is het fundament waarop `deploy` rust: **plan in CI, review in de PR, apply op productie**. Ik voeg hem nu toe omdat de plan-als-artefact-vorm het ontwerp stuurt; hem later erbij verzinnen kost een refactor.

#### `luminx undo`

Herstelt het laatste snapshot. §10.

#### `luminx deploy` *(gereserveerd, niet geïmplementeerd)*

Command wordt geregistreerd en print: *"`deploy` is planned for LuminX 1.x. See docs/deploy.md."* Zo is de naam bezet en het pad zichtbaar. §11.

### 8.5 Globale flags

```
--config <path>     pad naar luminx.config.json
--cwd <path>        projectroot
--runner <name>     local | ddev | docker | auto (default)
--only <kinds>      sections,fields,globals — beperkt het plan
--dry-run           plan tonen, niets schrijven
--yes / -y          geen prompts (CI)
--json              machine-leesbare output op stdout
--verbose / -v      protocol-payloads en runner-commando's loggen
--no-color
```

### 8.6 Exit-codes

| Code | Betekenis |
|---|---|
| `0` | Succes; bij `--check`/`--dry-run`: geen wijzigingen |
| `1` | Wijzigingen gedetecteerd in `--check`-modus (geen fout, wél actiesignaal) |
| `2` | Configuratiefout (validatie) |
| `3` | Omgevingsfout (geen PHP, geen Craft, plugin ontbreekt, protocol-mismatch) |
| `4` | Apply gefaald; snapshot beschikbaar, `luminx undo` aangeraden |
| `5` | Interne fout (bug) — met issue-link en correlation-id |

---

## 9. De Craft-plugin

### 9.1 Structuur

```
packages/craft-plugin/
├── composer.json                   # type: craft-plugin, php ^8.3, craftcms/cms ^5.0
└── src/
    ├── Plugin.php                  # bootstrap; géén Settings, géén CP-routes
    ├── Protocol/
    │   ├── Envelope.php
    │   ├── RequestReader.php
    │   └── ResponseWriter.php
    ├── console/controllers/
    │   ├── IntrospectController.php
    │   ├── ApplyController.php
    │   ├── SnapshotController.php
    │   └── DoctorController.php    # dun: parse args → service → schrijf envelope
    ├── generators/
    │   ├── GeneratorInterface.php
    │   ├── AbstractGenerator.php
    │   ├── SectionGenerator.php
    │   ├── EntryTypeGenerator.php
    │   ├── FieldGenerator.php
    │   ├── MatrixGenerator.php
    │   ├── CategoryGenerator.php
    │   ├── AssetGenerator.php       # filesystems + volumes
    │   ├── GlobalSetGenerator.php
    │   ├── UserGroupGenerator.php
    │   └── NavigationGenerator.php  # provider-gebaseerd, zie §9.4
    ├── services/
    │   ├── GeneratorRegistry.php
    │   ├── Introspector.php
    │   ├── Applier.php
    │   ├── SnapshotService.php
    │   ├── FieldTypeResolver.php
    │   └── FieldLayoutBuilder.php
    ├── events/
    │   ├── RegisterGeneratorsEvent.php
    │   ├── RegisterFieldTypesEvent.php
    │   ├── BeforeApplyOperationEvent.php
    │   └── AfterApplyOperationEvent.php
    └── models/                      # typed DTO's, readonly waar mogelijk
```

### 9.2 De generator-interface

Elke generator is onafhankelijk, heeft geen kennis van andere generators, en is via de registry opvraagbaar op `kind`.

```php
<?php
declare(strict_types=1);

namespace luminx\craft\generators;

interface GeneratorInterface
{
    /** De ResourceKind die deze generator afhandelt. */
    public function kind(): string;

    /** Leest de huidige staat en normaliseert naar IR-vorm. Zijeffectvrij. */
    public function introspect(): ResourceCollection;

    /** Voert één operatie uit. MOET idempotent zijn. */
    public function apply(Operation $operation, ApplyContext $context): OperationResult;

    /** Fase-1 en fase-2 ondersteuning (zie §8.3). */
    public function supportsPhase(int $phase): bool;
}
```

`AbstractGenerator` biedt: UID-resolutie (`uid` uit de operatie, anders lookup op handle), logging, en de `muteEvents`-wrapper.

**Geen enkele generator roept een andere generator aan.** Wil `SectionGenerator` een entry type koppelen, dan krijgt hij de UID via `ApplyContext` — die de core in fase 2 heeft ingevuld. Dat is precies waarom fase 2 bestaat.

### 9.3 Craft 5-realiteiten die het ontwerp raken

Dit zijn geen details; dit zijn de dingen die een Craft-4-ontwerp stukmaken op Craft 5.

**Matrix heeft geen block types meer.** In Craft 5 nest een Matrix-veld *Entries*, en de voormalige block types zijn gewone **Entry Types**. Gevolg: `MatrixGenerator` maakt geen eigen elementtype aan; hij delegeert de entry types naar `EntryTypeGenerator` (via de core, niet via directe aanroep) en koppelt in fase 2 de UID's aan de Matrix-veldinstellingen. Entry types zijn in Craft 5 bovendien **globaal en herbruikbaar** — één `heroBlock` kan in meerdere matrixvelden én als section-entry-type dienen. De IR modelleert entry types dus als top-level resources, niet als kinderen van een section. Je config mag ze genest schrijven; de compiler hijst ze naar boven en dedupliceert op handle.

**Field groups bestaan niet meer.** Velden zijn plat in Craft 5. Er komt geen `fieldGroup` in de config. Dat is meteen een reden waarom `luminx.config.json` niet zomaar Craft-4-YAML kan spiegelen.

**De `Sections`-service is opgegaan in `Entries`.** `Craft::$app->entries->saveSection()` / `saveEntryType()`. De plugin isoleert dit achter eigen services, zodat een toekomstige Craft 6 alleen die laag raakt.

**Field layouts.** Entry types dragen hun eigen field layout. `FieldLayoutBuilder` bouwt tabs + `CustomField`-layout-elementen uit de IR en zet ze in één keer, zodat het layout deterministisch is (stabiele volgorde, stabiele UID's uit het lockfile).

**`allowAdminChanges = false`.** Op productie staat dit meestal uit en weigert Craft elke schrijfactie op project config. Dit is geen edge case maar de normale productiestand — vandaar `doctor`'s expliciete check en vandaar dat `deploy` (§11) langs de project-config-YAML gaat en niet langs de service-API.

### 9.4 Navigation

Craft heeft **geen navigatie in core**. `NavigationGenerator` is daarom provider-gebaseerd:

- Is `verbb/navigation` geïnstalleerd → de generator gebruikt die API.
- Zo niet, en de config bevat `navigation` → `doctor` en de validator geven een duidelijke fout met installatie-instructie; het plan wordt niet uitgevoerd.
- Bevat de config geen `navigation` → de generator wordt niet eens geregistreerd.

Dit maakt hem het referentievoorbeeld voor **optionele, plugin-backed generators**, en dus het model voor SEOmatic, Neo, Super Table en Vizy.

### 9.5 Transactionaliteit

Eén apply-run = één DB-transactie per operatie, plus Craft's project-config-`defer`-mechanisme voor de hele run. Craft schrijft project config asynchroon; de plugin forceert een flush aan het eind en verifieert het resultaat.

Faalt operatie *n*, dan:

1. Operatie *n* rolt terug (DB-transactie).
2. Operaties `1..n-1` blijven staan — Craft's project config is niet globaal transactioneel.
3. De plugin retourneert `ok: false` met de resultaten van `1..n-1`.
4. De CLI meldt exit `4` en wijst naar `luminx undo`, dat wél alles terugdraait via het snapshot.

Dit eerlijk documenteren is belangrijker dan doen alsof er een globale transactie is.

---

## 10. Rollback

**Vóór** de eerste schrijfactie schrijft `SnapshotService` een volledige kopie van de relevante project-config-subbomen:

```
storage/luminx/snapshots/
  2026-07-09T14-22-05Z-a1b2c3/
    manifest.json     # tijdstip, luminx-versie, protocol, plan-hash, craft-versie
    projectConfig.json  # subbomen: sections, entryTypes, fields, categoryGroups,
                        #           globalSets, volumes, fs, userGroups
```

We snapshotten hele subbomen, niet alleen aangeraakte paden. Reden: een *delete* is niet te herstellen uit een diff van aangeraakte paden — je moet weten wat er was. Subbomen zijn klein (kilobytes) en de volledigheid is de hele waarde van de functie.

```bash
npx luminx undo              # laatste snapshot, met bevestiging + diff-preview
npx luminx undo --list
npx luminx undo --id a1b2c3
```

**Grenzen, expliciet:** rollback herstelt het *contentmodel*, niet de *content*. Is een section verwijderd en zijn de entries weg, dan brengt `undo` de section terug, leeg. Daarom staat `delete` standaard uit (§8.2). De CLI zegt dit hardop bij elke `--prune`.

Retentie: laatste 10 snapshots, `luminx undo --prune-snapshots` ruimt op. `storage/` staat in Craft's `.gitignore` — snapshots zijn lokaal, niet gedeeld.

---

## 11. Toekomstige deploy-architectuur

Niet implementeren. Wel nu voorbereiden, want de vorm van `deploy` bepaalt of `generate` de juiste abstracties heeft.

### 11.1 Het model: plan / apply-scheiding

```
  develop (lokaal)          CI (pull request)              productie
 ─────────────────      ────────────────────────      ────────────────────
  luminx generate   →    luminx plan --json      →     luminx deploy
  (service-API,          -o plan.json                  --plan plan.json
   snel, muteert                                       (project-config-YAML,
   lokale DB)            plan.json in de PR             read-only-safe)
                         → mens reviewt de diff
```

De drie bouwstenen bestaan al in dit ontwerp:

1. **`Plan` is een serialiseerbaar artefact** (§8.2). Daarom is `luminx plan` nu al een commando en niet alleen een flag.
2. **`Runner` is een abstractie** (§7.3). `SshRunner` is de vierde implementatie; verder verandert niets aan de adapter.
3. **`snapshot`/`restore` zitten in het adapter-contract** (§7.1), niet in de generate-flow. Deploy hergebruikt ze ongewijzigd.

### 11.2 Wat `deploy` extra nodig heeft

| Onderwerp | Ontwerprichting |
|---|---|
| Read-only project config | Op productie staat `allowAdminChanges = false`. `deploy` schrijft daarom `config/project/*.yaml` en draait `php craft project-config/apply`, in plaats van de service-API. Dit is de `ProjectConfigWriteStrategy` naast de bestaande `ServiceApiWriteStrategy` — de `WriteStrategyInterface` reserveer ik nú in de plugin. |
| Environments | `luminx.config.json` blijft één bestand; omgevingen komen uit `luminx.environments.json` (hosts, paden, runner, strategie). Config beschrijft *wat*, environments beschrijven *waar*. |
| Plan-verificatie | `plan.json` draagt een `sourceHash` (config) en `baseHash` (CMS-staat waartegen gepland is). Wijkt de productiestaat af van `baseHash` ⇒ weigeren, tenzij `--force`. Dit is Terraform's `refresh`-check en het is de reden dat de differ het lockfile mag lezen maar er nooit blind op vertrouwt. |
| Atomiciteit | Craft's project config is niet globaal transactioneel (§9.5). `deploy` doet daarom: snapshot → apply → verify (introspect + hash-vergelijking met plan) → bij mismatch automatisch `restore`. |
| Auth | Geen tokens, geen HTTP-endpoint. `SshRunner` erft de bestaande SSH-trust van de developer/CI. **Geen inkomend endpoint openen is een security-feature, geen beperking.** |

### 11.3 Licentie-oppervlak

`deploy` is de natuurlijke commerciële grens: `shared`, `core`, `parsers`, `cli`, `adapter-craft` en de plugin zijn open source (MIT). `@luminx/deploy` en de environment-orchestratie kunnen onder BSL of commercieel. Belangrijk voor het ontwerp: **de open-source CLI moet volledig bruikbaar zijn zonder `deploy`**. Daarom is deploy een apart pakket dat zich via de bestaande command-registry en de bestaande `Runner`-interface inhaakt — geen enkele hook in `core` bestaat uitsluitend voor deploy.

---

## 12. Extensiepunten

| Uitbreiding | Mechanisme | Raakt de core? |
|---|---|---|
| Nieuw CMS (WordPress/ACF, Statamic, Strapi, Contentful, Sanity) | Implementeer `CmsAdapter`, registreer op `cms`-key | Nee |
| Nieuw abstract veldtype | Uitbreiden IR-union + `Capabilities` per adapter | Ja, bewust — het is een contractwijziging |
| CMS-specifiek veldtype (Super Table, Neo, Vizy) | `type: "raw"` + `cms.craft.class`, of `RegisterFieldTypesEvent` in de plugin | Nee |
| Extra Craft-resource (SEOmatic-settings, Formie-forms) | Nieuwe generator + `RegisterGeneratorsEvent` | Nee |
| Nieuwe uitvoeromgeving (Lando, Warden, Kubernetes) | Implementeer `Runner` | Nee |
| Custom validatieregels | `ConfigValidator`-plugin-hook in `core/config` | Nee |
| Andere configbron (YAML, TS-config, .env-driven) | `ConfigLoader`-interface; JSON is de eerste implementatie | Nee |

De lakmoesproef voor de core: **kan ik een WordPress/ACF-adapter schrijven zonder één regel in `core/` te wijzigen?** Zolang het antwoord ja is, is de abstractie gezond. Zodra het nee is, ligt de fout in `core`, niet in de adapter.

---

## 13. Kwaliteit & tooling

**TypeScript.** `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Geen `any`. Publieke API's expliciet getypeerd. Zod voor runtime-validatie aan de rand; binnen de core zijn types te vertrouwen.

**PHP.** 8.3+, `declare(strict_types=1)` overal, typed properties, `readonly` DTO's, constructor property promotion. PHPStan level 8 (Craft's eigen stubs). Craft's DI-container voor services; geen service locator, geen statische state buiten `Plugin::getInstance()`.

**Tests.**

| Laag | Gereedschap | Wat |
|---|---|---|
| `core` | Vitest | Compiler, differ, orderer, lockfile — pure functies, geen mocks nodig |
| `core` | Vitest + golden files | Plan-snapshots: config in, `plan.json` uit. Elke regressie is zichtbaar in de diff |
| `parsers` | Vitest + fixtures | Echte `composer.lock`s, echte `.ddev/config.yaml`s |
| `adapter-craft` | Vitest + fake Runner | Protocol-serialisatie zonder PHP |
| `craft-plugin` | Pest | Generators tegen een echte Craft-testinstallatie |
| e2e | Vitest + DDEV | `init → generate → generate` (tweede run: **alles skip** — dit is de idempotentietest) |

Die laatste is de belangrijkste test in het project. Een tweede `generate` die ook maar één `update` produceert, is een bug.

**Determinisme afdwingen.** Canonieke JSON-serialisatie (gesorteerde keys) vóór elke hash. Geen `Date.now()` in gehashte data. Geen `Math.random()`. Geen `Map`-iteratievolgorde-afhankelijkheid in output. Een test draait de hele pijplijn tweemaal en vergelijkt de plannen byte voor byte.

---

## 14. Implementatievolgorde

Iteratief, elke stap is een logische commit en levert iets bruikbaars op.

| # | Milestone | Deliverable | Waarom hier |
|---|---|---|---|
| **M0** | Fundament | pnpm workspace, turbo, tsconfig, dependency-cruiser, CI | De graaf-regels bestaan vóór de eerste import die ze kan breken |
| **M1** | `shared` | IR, Operation, Plan, Envelope, foutcodes | Het contract eerst |
| **M2** | `core` — config | Loader, Zod-schema, validator, compiler, `$ref`-expansie | Testbaar zonder CMS |
| **M3** | `cli` — skelet | `init`, `doctor` (alleen generieke checks), rendering, exit-codes | Eerste werkende `npx luminx` |
| **M4** | `parsers` | `ProjectProbe`, composer/ddev/package.json | `doctor` wordt nuttig |
| **M5** | `core` — diff | Differ, orderer, twee-fasen-splitsing, lockfile | Volledig plan tegen een **in-memory fake adapter**. `--dry-run` werkt end-to-end zonder PHP |
| **M6** | `craft-plugin` — introspectie | Plugin-bootstrap, protocol, `Introspector`, alle `introspect()`-implementaties | Read-only: onmogelijk om iets te breken |
| **M7** | `adapter-craft` | Runners, protocol-client, IR-vertaling, `detect()` | Nu is `luminx generate --dry-run` echt |
| **M8** | Apply, fase 1 | `Applier`, generators (create/update), snapshot, `undo` | Eerste schrijfactie — mét rollback vanaf dag één |
| **M9** | Apply, fase 2 | Referentiebedrading, matrix, field layouts | Het contentmodel is compleet |
| **M10** | `sync` | Drift-detectie, `--check`, `--prune` achter bevestiging | CI-bewaking |
| **M11** | Hardening | e2e-idempotentietest, `init --from-existing` round-trip, docs, examples | Round-trip bewijst de introspectie |
| **M12** | Deploy-voorbereiding | `luminx plan`, `WriteStrategyInterface`, `SshRunner`-stub, `docs/deploy.md` | Alleen architectuur, geen deploy |

M8 en M10 zijn de risicomomenten: dáár schrijft LuminX voor het eerst, en dáár verwijdert het voor het eerst. Snapshot bestaat vóór de eerste schrijfactie (M8), niet erna.

---

## 15. Openstaande beslissingen

Deze horen vóór M1 beantwoord, niet ontdekt tijdens M8.

1. **Config-formaat.** JSON (zoals gespecificeerd) is machine-schrijfbaar en schema-valideerbaar, maar kent geen commentaar. Alternatief: JSON blijft de canonieke vorm, en `luminx.config.jsonc` wordt geaccepteerd. Voorstel: **JSON + JSONC-parser**, `$schema` voor editor-autocomplete.
2. **`handle` vs `name` als sleutel.** Ik stel `handle` verplicht (§5.2). Dit wijkt af van je voorbeeldconfig. Nodig voor veilig hernoemen.
3. **Entry types top-level of genest.** Craft 5 maakt ze herbruikbaar. Voorstel: genest schrijven mag, compiler hijst en dedupliceert; `entryTypes` op top-level is óók toegestaan.
4. **`sync` vs `generate`.** Zijn dit twee commando's of is `sync` een alias met `--prune`-mogelijkheid? Voorstel: aparte commando's, gedeelde pijplijn — `generate` is additief, `sync` is verzoenend.
5. **Navigation in v1?** Vereist een externe plugin. Voorstel: interface en generator bouwen, maar in v1 als `experimental` markeren.
6. **Licentie.** MIT voor alles behalve `@luminx/deploy`. Vastleggen vóór de eerste publieke commit — achteraf herlicentiëren met contributors is pijnlijk.
