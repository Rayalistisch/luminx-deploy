/**
 * The way back out: a typed client that reads the CMS.
 *
 * `luminx types` gives a frontend the shape of its content. This gives it the content. Both are
 * emitted from the same `luminx.config.json`, so a field renamed in the config renames in the
 * types, in the query, and in the CMS — or the build fails, which is the point. A client written by
 * hand drifts from the model the day someone edits one and not the other.
 *
 * The query is generated from the IR, and the IR is CMS-neutral — but a *query* cannot be. This
 * file speaks GraphQL as Craft shapes it (`blog_Entry`, inline fragments on matrix blocks), which
 * is knowledge of a CMS, so it is generated from a `dialect` the caller passes in rather than
 * assumed. A second CMS brings its own dialect; the shape of this file does not change.
 *
 * Deterministic (§13): same config, same bytes.
 */

import type { ContentModel, FieldSpec, LogicalId, Resource } from '@luminx/shared';

import { emitTypes } from './types.js';

/** How a CMS names things in its GraphQL schema. Craft's is the only one so far. */
export interface GraphqlDialect {
  /** `blog` → `blog_Entry`. The GraphQL type for an entry type. */
  readonly entryTypeName: (handle: string) => string;
}

export const CRAFT_DIALECT: GraphqlDialect = {
  entryTypeName: (handle) => `${handle}_Entry`,
};

const pascal = (handle: string): string =>
  handle
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_m, next: string | undefined) =>
      next === undefined ? '' : next.toUpperCase(),
    )
    .replace(/^(.)/, (first) => first.toUpperCase());

/**
 * What every entry carries, and what the CMS answers with for the richer field types.
 *
 * These are selection sets, not types: an asset is an object in GraphQL and has to be *asked* for
 * field by field. They mirror the shapes `emitTypes` promises (LuminxAsset, LuminxCategory, …), so
 * what arrives is what the type said would arrive.
 */
/**
 * `__typename` is not decoration.
 *
 * `emitTypes` gives every entry type a `__typename` so a union — the entries of a section, the
 * blocks of a matrix — can be narrowed on it. If the query does not *ask* for it, the field is
 * absent at runtime and the type is a lie: `entry.__typename === 'blog'` is false for every entry,
 * and the narrowing silently drops everything.
 */
const ENTRY_FIELDS = ['__typename', 'id', 'title', 'slug', 'uri', 'postDate'];

const SELECTION: Partial<Record<FieldSpec['type'], string>> = {
  assets: '{ id url filename title width height }',
  categories: '{ id title slug uri }',
  users: '{ id email fullName }',
  entries: '{ id title slug uri }',
  link: '{ url label }',
  money: '{ amount currency }',
};

/** One field, as it must be asked for. A matrix is asked for by naming each block it may hold. */
const selectionFor = (
  spec: FieldSpec,
  handle: string,
  model: ContentModel,
  dialect: GraphqlDialect,
  depth: number,
): string => {
  if (spec.type === 'matrix') {
    // A matrix block is an entry type: it answers only inside an inline fragment on its own type.
    const blocks = spec.entryTypes.flatMap((id) => {
      const block = model.resources.get(id);
      if (block?.kind !== 'entryType') return [];

      const inner = fieldsOf(block, model, dialect, depth + 1);
      return [`... on ${dialect.entryTypeName(block.handle)} { ${inner} }`];
    });

    // Nothing to select from is not an empty selection — it is a syntax error. Ask for the id.
    return blocks.length === 0 ? `${handle} { id }` : `${handle} { ${blocks.join(' ')} }`;
  }

  const selection = SELECTION[spec.type];
  return selection === undefined ? handle : `${handle} ${selection}`;
};

/** Every field of an entry type, as a selection set. */
const fieldsOf = (
  entryType: Resource,
  model: ContentModel,
  dialect: GraphqlDialect,
  depth: number,
): string => {
  if (entryType.kind !== 'entryType') return '';

  // A matrix inside a matrix inside a matrix is a query that never ends. Craft allows the nesting;
  // a generator that follows it forever does not. Three levels is deeper than any real model.
  if (depth > 3) return 'id';

  const parts = entryType.spec.fields.flatMap((entry) => {
    const field = model.resources.get(entry.field);
    if (field?.kind !== 'field') return [];

    return [selectionFor(field.spec, field.handle, model, dialect, depth)];
  });

  // `__typename` so a matrix block's union narrows; see the note on ENTRY_FIELDS.
  return ['__typename', 'id', ...parts].join(' ');
};

/** The query for one section: every entry type it holds, each as its own fragment. */
const queryFor = (
  section: Resource,
  model: ContentModel,
  dialect: GraphqlDialect,
): string | null => {
  if (section.kind !== 'section') return null;

  const fragments = section.spec.entryTypes.flatMap((id: LogicalId) => {
    const entryType = model.resources.get(id);
    if (entryType?.kind !== 'entryType') return [];

    const fields = fieldsOf(entryType, model, dialect, 0);
    return [`... on ${dialect.entryTypeName(entryType.handle)} { ${fields} }`];
  });

  if (fragments.length === 0) return null;

  return `{ ${ENTRY_FIELDS.join(' ')} ${fragments.join(' ')} }`;
};

const PREAMBLE = `/**
 * Generated by LuminX from luminx.config.json. Do not edit.
 *
 * Regenerate with \`luminx client\`. The queries below are built from the same config as your types,
 * so a field you rename moves in both — or your build breaks, which is the point.
 *
 * Reads only. The token this uses is scoped to reading, so a leaked one cannot rewrite your content.
 *
 * Set LUMINX_CMS_URL and LUMINX_CMS_TOKEN in your environment. Call it from the server (an Astro
 * component's frontmatter, a Next.js server component, getStaticProps) — the token is not for a
 * browser.
 */

export interface LuminxClientOptions {
  /** Defaults to LUMINX_CMS_URL. */
  url?: string;
  /** Defaults to LUMINX_CMS_TOKEN. */
  token?: string;
  /** Passed to fetch — Next.js reads \`next: { revalidate }\` from here. */
  fetchOptions?: RequestInit;
}

/**
 * Plain, erasable TypeScript — no parameter properties, no enums, nothing that emits runtime code.
 *
 * This file lands in someone else's build. A constructor parameter property (\`readonly detail\`)
 * is TypeScript that *compiles to* something, so it dies under type-stripping: Node's
 * --experimental-strip-types, Bun, and any project with \`erasableSyntaxOnly\`. Generated code that
 * only runs in some toolchains is generated code that will fail in someone's.
 */
class LuminxError extends Error {
  detail: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'LuminxError';
    this.detail = detail;
  }
}

/**
 * Read through globalThis, not the \`process\` global.
 *
 * Naming \`process\` directly needs @types/node, and a frontend is not obliged to have it — the
 * generated file would fail to typecheck in a project that never asked for Node's types. Declaring
 * it here instead collides with the projects that *do* have them. Reaching through globalThis needs
 * neither, and works in both.
 */
const env = (name: string): string | undefined => {
  const global = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return global.process?.env?.[name];
};

/**
 * The CMS's name for an entry type, back to yours.
 *
 * Craft answers \`__typename: "blog_Entry"\`. The generated types say \`__typename: 'blog'\` — they
 * are built from the config and know no CMS, which is the whole reason they are portable. Left
 * alone, the type would be a lie in the one place a lie costs most: \`isType(entry, 'blog')\` would
 * be false for every entry, every narrowing would silently drop everything, and nothing would
 * throw. So the answer is normalised on the way in, and the runtime matches the type exactly.
 */
const normalize = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(normalize) as T;
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};

  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      key === '__typename' && typeof inner === 'string'
        ? (TYPENAMES[inner] ?? inner)
        : normalize(inner);
  }

  return out as T;
};

const request = async <T>(
  query: string,
  variables: Record<string, unknown>,
  options: LuminxClientOptions,
): Promise<T> => {
  const url = options.url ?? env('LUMINX_CMS_URL');
  const token = options.token ?? env('LUMINX_CMS_TOKEN');

  if (url === undefined || url === '') {
    throw new LuminxError('No CMS url. Set LUMINX_CMS_URL, or pass { url }.');
  }
  if (token === undefined || token === '') {
    throw new LuminxError('No CMS token. Set LUMINX_CMS_TOKEN, or pass { token }.');
  }

  const response = await fetch(url, {
    method: 'POST',
    ...options.fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      Authorization: \`Bearer \${token}\`,
      ...options.fetchOptions?.headers,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new LuminxError(\`The CMS answered \${response.status}\`, await response.text());
  }

  const payload = (await response.json()) as { data?: unknown; errors?: unknown[] };

  // A GraphQL error arrives with HTTP 200. Returning half an answer as if it were whole is how a
  // frontend renders an empty page and nobody knows why.
  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw new LuminxError('The CMS rejected the query', payload.errors);
  }

  return normalize(payload.data) as T;
};

/** Narrow a list of entries, or one entry, to a single entry type. */
export const isType = <T extends { __typename?: string }, K extends string>(
  entry: T,
  typename: K,
): entry is T & { __typename: K } => entry.__typename === typename;`;

/**
 * One file: the types *and* the client that returns them.
 *
 * They could be two, with the client importing the types — and then the import path depends on where
 * the user put each, and a stale types file next to a fresh client compiles fine and lies at
 * runtime. Emitting them together makes drifting apart impossible. `luminx types` still exists for
 * a frontend that only wants the shapes and reads its content some other way.
 */
export const emitClient = (
  model: ContentModel,
  dialect: GraphqlDialect = CRAFT_DIALECT,
): string => {
  // Sorted, so the same config emits the same bytes (§13).
  const sections = [...model.resources.values()]
    .filter((resource) => resource.kind === 'section')
    .sort((a, b) => (a.logicalId < b.logicalId ? -1 : 1));

  // Every entry type, under the name the CMS answers with — so `normalize` can undo it.
  const typenames = [...model.resources.values()]
    .filter((resource) => resource.kind === 'entryType')
    .sort((a, b) => (a.logicalId < b.logicalId ? -1 : 1))
    .map(
      (resource) =>
        `  ${JSON.stringify(dialect.entryTypeName(resource.handle))}: '${resource.handle}',`,
    );

  const table =
    `/** The CMS's name for each entry type → yours. See \`normalize\`. */\n` +
    `const TYPENAMES: Record<string, string> = {\n${typenames.join('\n')}\n};`;

  const blocks: string[] = [emitTypes(model), PREAMBLE, table];
  const methods: string[] = [];

  for (const section of sections) {
    if (section.kind !== 'section') continue;

    const selection = queryFor(section, model, dialect);
    if (selection === null) continue;

    const name = pascal(section.handle);
    const types = section.spec.entryTypes
      .flatMap((id) => {
        const entryType = model.resources.get(id);
        return entryType?.kind === 'entryType' ? [pascal(entryType.handle)] : [];
      })
      .sort();

    const returned = types.length === 0 ? 'LuminxEntry' : types.join(' | ');

    blocks.push(
      `const ${section.handle}Query = \`query ${name}($limit: Int, $offset: Int) {\n` +
        `  entries(section: "${section.handle}", limit: $limit, offset: $offset) ${selection}\n}\`;`,
      `const ${section.handle}OneQuery = \`query ${name}One($slug: [String]) {\n` +
        `  entry(section: "${section.handle}", slug: $slug) ${selection}\n}\`;`,
    );

    methods.push(
      `  /** Every entry in "${section.handle}". */
  ${section.handle}: (options: { limit?: number; offset?: number } = {}) =>
    request<{ entries: (${returned})[] }>(
      ${section.handle}Query,
      { limit: options.limit ?? null, offset: options.offset ?? null },
      client,
    ).then((data) => data.entries),

  /** One entry from "${section.handle}", by slug. Null when there is none. */
  ${section.handle}BySlug: (slug: string) =>
    request<{ entry: ${returned} | null }>(${section.handle}OneQuery, { slug: [slug] }, client).then(
      (data) => data.entry,
    ),`,
    );
  }

  blocks.push(
    `/**\n * The client. Every section it was generated for, typed.\n *\n * \`\`\`ts\n * const posts = await luminx().blog();\n * \`\`\`\n */\nexport const luminx = (client: LuminxClientOptions = {}) => ({\n${methods.join('\n\n')}\n});`,
  );

  return `${blocks.join('\n\n')}\n`;
};
