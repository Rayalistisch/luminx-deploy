# Config reference

`luminx.config.json` describes the content model you want. JSON, or JSONC — comments and trailing
commas are accepted, and they survive, because nothing rewrites the file after `init`.

Two rules run through everything below:

- **`handle` is the key; `name` is a label.** The handle identifies a resource across the config,
  the lockfile and the CMS, so it must be a valid identifier (`^[a-z][a-zA-Z0-9_]*$`). The name is
  free text for editors, and renaming it is safe. Omit the name and it is derived from the handle
  (`sitePages` → `Site Pages`).
- **One handle, one definition.** A field or entry type may be referenced many times, but two
  definitions of one handle that disagree are an error — never "last one wins".

## Top level

```jsonc
{
  "$schema": "https://luminx.dev/schema/v1.json",
  "version": 1,
  "cms": "craft",
  "siteName": "Demo",

  "fields":      { /* reusable field definitions, keyed by handle */ },
  "entryTypes":  { /* reusable entry types, keyed by handle */ },
  "filesystems": [ /* … */ ],
  "volumes":     [ /* … */ ],
  "categories":  [ /* … */ ],
  "sections":    [ /* … */ ],
  "globals":     [ /* … */ ],
  "userGroups":  [ /* … */ ]
}
```

`cms` names the adapter (`craft`). The core never interprets it; it hands it to the registry.

## References

A field or entry type defined in the reusable maps is used elsewhere with `$ref`:

```jsonc
{ "$ref": "#/fields/seoTitle", "required": true, "tab": "Content" }
```

`required` and `tab` describe *this use* of the field, not the field itself — the same field can
be required in one entry type and optional in another. Omit `tab` for the CMS's default tab;
naming it explicitly (`"Content"` in Craft) is redundant and will read back as omitted, so leave
it out. Entry types may also be written inline; the
compiler hoists them to the top level and deduplicates them by handle, because in Craft 5 entry
types are global and reusable.

Relation fields (`assets`, `entries`, `categories`, `users`) name their targets by handle:

```jsonc
{ "type": "entries", "name": "Related", "sources": ["blog"] }
```

## Field types

A closed set of abstract types, poorer than any one CMS on purpose:

| Type | Settings |
|---|---|
| `text` | `max`, `multiline` |
| `richtext` | — (needs a rich-text plugin on the adapter side) |
| `number` | `min`, `max`, `decimals` |
| `boolean` | `default` |
| `date` | `showTime` |
| `dropdown`, `multiselect` | `options: [{ value, label, default? }]` |
| `assets`, `entries`, `categories`, `users` | `sources: [handle]`, `maxRelations` |
| `matrix` | `entryTypes: [$ref]`, `minEntries`, `maxEntries` |
| `table` | `columns: [{ handle, heading, type }]` |
| `color`, `link` | — |
| `money` | `currency` (ISO 4217, three letters) |
| `raw` | `cms: { <adapter>: { … } }` — the escape hatch, §6 |

`raw` is handed to the adapter untouched and is deliberately unpleasant to write: reach for it
only when the abstract set genuinely cannot say what you mean.

## Renaming

To rename a resource without losing content, keep the new handle and point back at the old one:

```jsonc
{ "handle": "sitePages", "previousHandle": "pages", "name": "Site Pages" }
```

LuminX resolves the old handle to the existing resource and emits an update, not a
delete-and-create. Remove `previousHandle` once the rename has been applied — it is an
instruction, not state.

## What is not the config's job

- No `id` or `uid`. Those live in `luminx.lock.json`, which is machine-written and committed.
- No field groups. Fields are flat in Craft 5.
- No per-site settings yet. `uriFormat` and `template` sit on the section; v1 applies them to
  every site.

See [`examples/config-samples`](../examples/config-samples) for configs that compile, and
[`architecture.md`](architecture.md) for why the shape is what it is.
