# LuminX

The missing link between modern frontend frameworks and CMSes. CLI-first, deterministic, no AI.

You describe your content model once, in `luminx.config.json`. LuminX makes the CMS match it —
idempotently, reversibly, and with a plan you can read before anything is written. The config is
the source of truth; the CMS is a projection of it.

First target CMS: **Craft CMS 5**. The core knows no CMS, so the next one is a new adapter, not a
rewrite. See [`docs/architecture.md`](docs/architecture.md) for the full design.

> Status: in active development. M0–M10 are implemented and proven against a real Craft 5.10
> install; M11–M12 remain. See §14 of the architecture doc for the milestone map.

## How it works

```
luminx.config.json                the model you want
        │  compile                 →  an intermediate representation (IR), one hash per resource
        ▼
   LuminX core                     pure: load · validate · compile · diff · plan
        │  CmsAdapter              the only seam that knows a CMS
        ▼
 craft-luminx (PHP plugin)         reads and applies, over a JSON-over-file protocol
        ▼
     Craft CMS 5
```

Nothing is written without a plan, and nothing is planned without reading the CMS first. The same
config against the same CMS always produces the same plan — that determinism is the whole point.

## Commands

| Command | What it does |
|---|---|
| `luminx new` | Create a CMS project from nothing — DDEV, Craft, the plugin — and apply a starter model. |
| `luminx import` | Read a frontend's content model (Astro today) into a config. |
| `luminx init` | Write a minimal config. `--from-existing` writes one from a CMS that already has a model. |
| `luminx doctor` | Check the environment and the config. Never mutates. |
| `luminx generate` | Bring the CMS up to the config. `--dry-run` shows the plan and writes nothing. |
| `luminx sync` | Reconcile both sides. `--check` fails CI on any divergence; `--prune` deletes what the config dropped. |
| `luminx types` | Emit TypeScript types for your frontend, from the same config. |
| `luminx undo` | Restore the snapshot taken before the last apply. |

Every mutating command takes a snapshot before its first write, and reports drift — anything
changed in the control panel since the last apply — before it writes over it.

## From nothing

```bash
mkdir my-site && cd my-site
npx luminx new                        # DDEV + Craft 5 + the plugin + a starter content model
```

One command, an empty directory, and a running CMS with your model already applied. It needs
[DDEV](https://ddev.com) — that is a decision, not a limitation: standing Craft up on a bare host
means the developer must already have the right PHP, the right extensions and a database, which is
exactly the pain DDEV removes.

The Craft plugin comes from Packagist ([`luminx/craft-luminx`](https://packagist.org/packages/luminx/craft-luminx)); `new` installs it for you. To work against a local checkout of the plugin instead — you are changing it, or pinning to something unreleased — pass
`--plugin-path ../luminx/packages/craft-plugin`.

## From a frontend you already built

If the site exists — an Astro project with content collections — LuminX can read its content model
and stand a matching CMS behind it:

```bash
cd my-astro-site
npx luminx import                     # src/content/config.ts (Zod) → luminx.config.json
mkdir cms
npx luminx new --cwd cms --config ../luminx.config.json   # a Craft holding that model
```

The CMS gets its own directory. Craft brings a `composer.json`, a `web/` root and a database, and
none of that can share a home with your frontend's — so `new` refuses to build on top of files it
did not put there. The config stays where `import` wrote it, at the root of the site it describes,
and both halves read the same one.

`import` reads the Zod schema with a real TypeScript parser and reports every decision it made: a
Zod schema is richer than any CMS model, so an array of objects becomes a matrix, and anything with
no faithful home becomes a `raw` field rather than being guessed at or dropped. It writes one file,
`luminx.config.json`, and never touches your frontend's source.

## A first run on a CMS you already have

```bash
npx luminx init                       # write a starter config
# describe your content model in luminx.config.json
npx luminx doctor                     # is the environment ready?
npx luminx generate --dry-run         # what would change?
npx luminx generate                   # apply it, after a snapshot and a yes
```

Adopting LuminX on a project that already has a content model:

```bash
npx luminx init --from-existing       # introspect the CMS, write the config that describes it
npx luminx generate --dry-run         # should report nothing to change
```

In CI:

```bash
npx luminx sync --check               # exit 1 if the CMS and the config have diverged
```

## One source of truth, both halves

The config describes your content model. The CMS is a projection of it — and so is your frontend:

```bash
npx luminx types -o src/luminx.ts
```

```ts
import type { Page, LuminxSections } from './luminx.js';

const render = (page: Page) => `<h1>${page.heading}</h1>`;   // heading: string
```

Rename `heading` in `luminx.config.json`, run `luminx generate` and `luminx types`, and Craft moves
— while your Astro build fails until the component moves with it:

```
page.ts(7,22): error TS2339: Property 'heading' does not exist on type 'Page'.
```

That is the point. The types are generated from the *config*, not from a running CMS, so they can
be produced and typechecked in CI with no Docker, no PHP and no database. A frontend that cannot
typecheck without a live CMS is a frontend that cannot typecheck.

## Configuration

The config is JSON (JSONC accepted — comments survive, because nothing rewrites the file). A
handle is the stable key; a name is a free label. See
[`docs/config-reference.md`](docs/config-reference.md) and
[`examples/config-samples`](examples/config-samples).

## Packages

| Package | Role |
|---|---|
| `@luminx/shared` | The IR, operations, plan, wire protocol, error codes. Zero dependencies. |
| `@luminx/core` | Load, validate, compile, diff, plan, execute. Knows no CMS. |
| `@luminx/parsers` | Reads a project: composer, `.env`, `package.json`, the runner. |
| `@luminx/codegen` | The content model, projected into TypeScript. Knows no CMS. |
| `@luminx/adapter-craft` | The Craft side, in TypeScript: runners, the protocol client, IR translation. |
| `luminx` | The CLI. The composition root. |
| `luminx/craft-luminx` | The Craft 5 plugin, in PHP. Reads and applies. |

## Developing

```bash
pnpm install
pnpm run ci          # boundaries, purity, format, typecheck, build, cycles, tests
```

Node 22 or 24 (even-numbered lines only; see `.nvmrc`). The Craft plugin's tests run under
`packages/craft-plugin` with `composer install && ./vendor/bin/pest`.

## Licence

MIT.
