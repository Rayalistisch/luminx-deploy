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
| `luminx init` | Write a minimal config. `--from-existing` writes one from a CMS that already has a model. |
| `luminx doctor` | Check the environment and the config. Never mutates. |
| `luminx generate` | Bring the CMS up to the config. `--dry-run` shows the plan and writes nothing. |
| `luminx sync` | Reconcile both sides. `--check` fails CI on any divergence; `--prune` deletes what the config dropped. |
| `luminx undo` | Restore the snapshot taken before the last apply. |

Every mutating command takes a snapshot before its first write, and reports drift — anything
changed in the control panel since the last apply — before it writes over it.

## A first run

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
