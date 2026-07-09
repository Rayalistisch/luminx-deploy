/**
 * File-level graph rules. Package-level boundaries live in scripts/check-boundaries.mjs;
 * this config catches what package.json cannot see: import cycles between modules.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle between modules makes initialisation order significant and defeats tree shaking. ' +
        'Extract the shared piece into its own module.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Module is imported by nothing and imports nothing. Probably dead.',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)index\\.ts$', '(^|/)vitest\\.config\\.ts$'],
      },
      to: {},
    },
    {
      name: 'no-dev-dep-in-src',
      severity: 'error',
      comment: 'Source code must not import a devDependency; it would be missing at runtime.',
      from: { path: '^packages/[^/]+/src', pathNot: '\\.(test|spec)\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|\\.turbo)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
