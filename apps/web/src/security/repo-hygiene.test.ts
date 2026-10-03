import { describe, expect, it } from 'vitest';

// Vite reads the files as text at test time: no Node APIs, so it type-checks with the web config.
const files: Record<string, string> = {
  ...import.meta.glob(
    [
      '../../../**/*.{ts,tsx,toml,json,md,yml,example}',
      '!../../../**/node_modules/**',
      '!../../../**/dist/**',
      '!../../../../packages/db/migrations/**',
    ],
    { query: '?raw', import: 'default', eager: true },
  ),
  ...import.meta.glob(
    [
      '../../../../packages/**/*.{ts,tsx,json,md}',
      '!../../../../**/node_modules/**',
      '!../../../../**/dist/**',
    ],
    { query: '?raw', import: 'default', eager: true },
  ),
  ...import.meta.glob(
    ['../../../../docs/**/*.md', '../../../../*.md', '../../../../.github/**/*.yml'],
    { query: '?raw', import: 'default', eager: true },
  ),
  ...import.meta.glob('../../../../.dev.vars.example', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('../../../../.gitignore', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

const textFiles = Object.keys(files);
const read = (name: string): string => {
  const key = textFiles.find((f) => f.endsWith(name));
  if (key === undefined) throw new Error(`file not found by the test: ${name}`);
  return files[key] ?? '';
};

/** Shapes of real credentials. The tests below prove the repo contains none. */
const SECRET_PATTERNS: [string, RegExp][] = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Stripe/Resend-style live key', /\b(?:sk_live|rk_live|re_)[A-Za-z0-9]{20,}\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Meta/Facebook access token', /\bEAA[A-Za-z0-9]{40,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  [
    'Postgres URL with password',
    /postgres(?:ql)?:\/\/[^\s:@/]+:(?!pass\b|password\b|secret\b|\*+)[^\s@/]{6,}@(?!localhost)/,
  ],
];

describe('repository hygiene', () => {
  it.each(SECRET_PATTERNS)('has no %s in tracked files', (_name, pattern) => {
    const hits = textFiles.filter((f) => pattern.test(files[f] ?? ''));
    expect(hits).toEqual([]);
  });

  it('ignores local environment files in git', () => {
    const ignore = read('/.gitignore');
    expect(ignore).toMatch(/^\.dev\.vars$/m);
    expect(ignore).toMatch(/^\.env\*$/m);
    expect(textFiles.some((f) => /(^|\/)\.env/.test(f))).toBe(false);
  });

  it('keeps every value empty in .dev.vars.example', () => {
    const lines = read('/.dev.vars.example')
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l));
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.filter((l) => !/^[A-Z_]+=$/.test(l))).toEqual([]);
  });

  it('declares no secret value in wrangler.toml vars', () => {
    const toml = read('/api/wrangler.toml');
    for (const name of [
      'AUTH_SECRET',
      'TOKEN_ENCRYPTION_KEY',
      'OAUTH_STATE_SECRET',
      'INTERNAL_API_TOKEN',
      'RESEND_API_KEY',
      'DATABASE_URL',
      'META_APP_SECRET',
      'COLOCA_API_KEY',
    ]) {
      expect(toml, name).not.toMatch(new RegExp(`^\\s*${name}\\s*=\\s*"[^"]+"`, 'm'));
    }
  });

  it('keeps production off unsafe modes in wrangler.toml', () => {
    const toml = read('/api/wrangler.toml');
    expect(toml).not.toMatch(
      /ENVIRONMENT = "development"[\s\S]*\[env\.production\][\s\S]*META_MODE = "sandbox"/,
    );
  });
});

describe('API source hygiene', () => {
  const source = textFiles.filter(
    (f) => /\/api\/src\/.*\.ts$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('test-utils.ts'),
  );

  it('actually finds the API source files (the scan is not vacuous)', () => {
    expect(source.length).toBeGreaterThan(20);
  });

  it('never logs request headers, cookies or bodies', () => {
    for (const file of source) {
      const code = files[file] ?? '';
      expect(code, file).not.toMatch(/log\([^)]*(headers|cookie|authorization)/i);
    }
  });

  it('only the development mailer prints login codes', () => {
    const offenders = source.filter(
      (f) => /log\([^)]*\bcode\b/.test(files[f] ?? '') && !f.endsWith('auth/mailer.ts'),
    );
    expect(offenders).toEqual([]);
  });

  it('compares secrets in constant time, never with === on tokens', () => {
    const offenders = source.filter((f) =>
      /(token|secret|signature)\w*\s*===\s*\w+/i.test(files[f] ?? ''),
    );
    expect(offenders).toEqual([]);
  });
});
