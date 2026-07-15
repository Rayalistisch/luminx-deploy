import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ensureGraphqlRoute } from './adapter.js';

/**
 * The three states of `config/routes.php`, and the middle one is the bug.
 *
 * `luminx client` needs Craft to serve GraphQL, and Craft only does where this file routes to it.
 * The first draft treated any existing file as untouchable — but every Craft ships a default
 * `routes.php` that returns `[]`, so a fresh scaffold hit "already there, refusing" and told the
 * user to hand-edit a file LuminX had just created. Found only by running `client` against a Craft
 * whose route had *not* already been set by hand.
 */
const project = () => mkdtemp(join(tmpdir(), 'luminx-routes-'));

const routesAt = (root: string) => join(root, 'config', 'routes.php');

const write = async (root: string, contents: string) => {
  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(routesAt(root), contents, 'utf8');
};

describe('ensureGraphqlRoute', () => {
  it('writes the file when there is none', async () => {
    const root = await project();

    const result = await ensureGraphqlRoute(root);

    expect(result.ok).toBe(true);
    expect(await readFile(routesAt(root), 'utf8')).toContain("'api' => 'graphql/api'");
  });

  // Craft's own default: boilerplate and `return [];`. Adding a route takes nothing away.
  it('fills in the default file that returns an empty array', async () => {
    const root = await project();
    await write(root, `<?php\n// Site URL Rules\n\nreturn [];\n`);

    const result = await ensureGraphqlRoute(root);

    expect(result.ok).toBe(true);
    expect(await readFile(routesAt(root), 'utf8')).toContain("'api' => 'graphql/api'");
  });

  it('is a no-op when the route is already there', async () => {
    const root = await project();
    const contents = `<?php\nreturn [\n    'api' => 'graphql/api',\n    'blog/<slug>' => 'templates/blog/_entry',\n];\n`;
    await write(root, contents);

    const result = await ensureGraphqlRoute(root);

    expect(result.ok).toBe(true);
    // Untouched — including the user's own route.
    expect(await readFile(routesAt(root), 'utf8')).toBe(contents);
  });

  /**
   * A file with real routes and no GraphQL is someone's, and may hold routes this project needs.
   * We do not rewrite it — we say what to add and stop.
   */
  it('refuses a file that already has other routes, rather than rewriting it', async () => {
    const root = await project();
    const contents = `<?php\nreturn [\n    'sitemap.xml' => 'templates/sitemap',\n];\n`;
    await write(root, contents);

    const result = await ensureGraphqlRoute(root);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.hint).toContain("'api' => 'graphql/api'");
    // And it left the file exactly as it was.
    expect(await readFile(routesAt(root), 'utf8')).toBe(contents);
  });
});
