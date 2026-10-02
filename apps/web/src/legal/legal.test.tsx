import { REQUIRED_PERMISSIONS, WHATSAPP_PERMISSION } from '@fluvia/meta';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import appReview from '../../../../docs/app-review.md?raw';
import { dataDeletion } from './deletion';
import { LEGAL_LINKS, Footer } from './Footer';
import { LegalPage, ReviewBanner } from './LegalPage';
import { PERMISSION_USES } from './permissions';
import { countPending, splitPending, withoutPending } from './pending';
import { privacyPolicy } from './privacy';
import { resolveRoute } from '../route';
import { LEGAL_REVIEW_PENDING } from './status';
import { allText, pendingCount, type Block, type LegalDoc } from './types';

const docs: [string, LegalDoc][] = [
  ['privacy policy', privacyPolicy],
  ['data deletion', dataDeletion],
];

const factsOf = (doc: LegalDoc) => allText(doc).map(withoutPending).join('\n');

describe.each(docs)('%s: structure', (_name, doc) => {
  it('has numbered, unique, non-empty sections', () => {
    const ids = doc.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    doc.sections.forEach((section, index) => {
      expect(section.heading.startsWith(`${index + 1}. `), section.heading).toBe(true);
      expect(section.blocks.length, section.id).toBeGreaterThan(0);
      expect(section.id).toMatch(/^[a-z0-9-]+$/);
    });
  });

  it('is written in Spanish for the client (no English boilerplate headings)', () => {
    for (const section of doc.sections) {
      expect(section.heading).not.toMatch(/\b(privacy|policy|terms|rights|contact us)\b/i);
    }
  });
});

describe('placeholders for the lawyer and the team', () => {
  it('both pages have open points to complete', () => {
    for (const [, doc] of docs) expect(pendingCount(doc)).toBeGreaterThan(0);
  });

  it('never invents contact data: the company, e-mail, phone and address are markers', () => {
    for (const [name, doc] of docs) {
      const facts = factsOf(doc);
      expect(facts, name).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/); // e-mail addresses
      expect(facts, name).not.toMatch(/\+?\d[\d\s().-]{7,}\d/); // phone numbers
      expect(facts, name).not.toMatch(/\bNIT\s*:?\s*\d/i); // a tax id
      // The only URL-looking thing allowed is Meta's own privacy policy.
      expect(facts.match(/\b[\w-]+\.(com|co|org|net)\b[\w/.-]*/g) ?? [], name).toEqual(
        ['facebook.com/privacy/policy'].filter((url) => facts.includes(url)),
      );
    }

    const markersOf = (doc: LegalDoc) =>
      allText(doc).flatMap((text) =>
        splitPending(text)
          .filter((s) => s.kind === 'pending')
          .map((s) => s.text),
      );
    const privacyMarkers = markersOf(privacyPolicy).join('\n');
    for (const needle of [
      'RAZÓN SOCIAL',
      'NIT',
      'DIRECCIÓN',
      'CORREO DE PRIVACIDAD',
      'WHATSAPP DE PRIVACIDAD',
    ]) {
      expect(privacyMarkers, needle).toContain(needle);
    }
    const deletionMarkers = markersOf(dataDeletion).join('\n');
    expect(deletionMarkers).toContain('CORREO DE PRIVACIDAD');
    expect(deletionMarkers).toContain('WHATSAPP DE PRIVACIDAD');
  });

  it('the "pending review" banner cannot be switched off while markers remain', () => {
    const total = docs.reduce((sum, [, doc]) => sum + pendingCount(doc), 0);
    expect(LEGAL_REVIEW_PENDING || total === 0).toBe(true);
  });

  it('legal figures are never stated as settled fact without the lawyer (deadlines, retention)', () => {
    const all = allText(dataDeletion).concat(allText(privacyPolicy));
    for (const text of all) {
      if (/10 días hábiles|15 días hábiles/.test(text))
        expect(countPending(text), text).toBeGreaterThan(0);
    }
  });
});

describe('privacy policy: content', () => {
  const text = factsOf(privacyPolicy);

  it('cites the Colombian framework and the authority', () => {
    expect(text).toContain('Ley 1581 de 2012');
    expect(text).toContain('Superintendencia de Industria y Comercio');
  });

  it('lists the six rights of the titular', () => {
    const rights = privacyPolicy.sections
      .find((s) => s.id === 'derechos')
      ?.blocks.find((b): b is Extract<Block, { type: 'ul' }> => b.type === 'ul');
    expect(rights?.items).toHaveLength(6);
    for (const keyword of [
      'Conocer',
      'prueba de la autorización',
      'informado',
      'quejas',
      'Revocar',
      'gratuita',
    ]) {
      expect(rights?.items.join(' '), keyword).toContain(keyword);
    }
  });

  it('names every provider the system really sends data to', () => {
    for (const provider of [
      'Meta',
      'Cloudflare',
      'Neon',
      'Coloca',
      'Kapso',
      'Alegra',
      'Anthropic',
    ]) {
      expect(text, provider).toContain(provider);
    }
  });

  it('says what is NOT done: no passwords, no private messages', () => {
    expect(text).toContain('No te pedimos tu contraseña');
    expect(text).toContain('No pedimos permisos para leer tus mensajes privados');
  });

  it('describes how the tokens are protected, and links to the deletion page', () => {
    expect(text).toContain('Los tokens de acceso de Meta se cifran antes de guardarse');
    expect(text).toContain('/data-deletion');
  });
});

describe('data deletion page: content', () => {
  const text = factsOf(dataDeletion);

  it('is honest that deletion is manual today', () => {
    expect(text).toContain('Hoy este proceso es manual');
  });

  it('gives a ready-to-copy message with every field the team needs', () => {
    const section = dataDeletion.sections.find((s) => s.id === 'como-pedirlo');
    const template = section?.blocks.find(
      (b): b is Extract<Block, { type: 'template' }> => b.type === 'template',
    );
    for (const field of [
      'Nombre completo',
      'Número de WhatsApp',
      'Nombre de mi negocio',
      'página de Facebook',
    ]) {
      expect(template?.text, field).toContain(field);
    }
    expect(template?.text).toContain('Asunto: Eliminación de datos');
  });

  it("separates what we delete, what we may keep, and Meta's own data", () => {
    for (const heading of ['Qué borramos', 'Qué podemos conservar', 'Los datos que Meta tiene']) {
      expect(
        dataDeletion.sections.some((s) => s.heading.includes(heading)),
        heading,
      ).toBe(true);
    }
  });

  it('explains that removing the app in Facebook does not delete our data by itself', () => {
    expect(text).toContain('no borra por sí solo los datos');
  });
});

describe('the permissions the policy explains = the permissions the code asks for', () => {
  const codePermissions = [...REQUIRED_PERMISSIONS, WHATSAPP_PERMISSION];

  it('policy list equals the code list (no permission explained but unused, or used but unexplained)', () => {
    expect(PERMISSION_USES.map((u) => u.permission).sort()).toEqual([...codePermissions].sort());
  });

  it('only the WhatsApp permission is conditional', () => {
    expect(PERMISSION_USES.filter((u) => u.conditional).map((u) => u.permission)).toEqual([
      WHATSAPP_PERMISSION,
    ]);
  });

  it('every permission has a plain-language purpose', () => {
    for (const use of PERMISSION_USES) {
      expect(use.purpose.length, use.permission).toBeGreaterThan(30);
      expect(use.purpose, use.permission).not.toMatch(/\b(api|endpoint|token)\b/i);
    }
  });

  it('the privacy policy renders one table row per permission', () => {
    const html = renderToStaticMarkup(<LegalPage doc={privacyPolicy} />);
    for (const permission of codePermissions) {
      expect(html, permission).toContain(`<code>${permission}</code>`);
    }
    expect(html).toContain('Solo si eliges WhatsApp.');
  });

  it('docs/app-review.md justifies each permission, with a paste-ready English text', () => {
    for (const permission of codePermissions) {
      const heading = new RegExp(`^### \`${permission}\``, 'm');
      expect(appReview, permission).toMatch(heading);
      const section = appReview.split(heading)[1]?.split(/^### |^## /m)[0] ?? '';
      expect(section, permission).toContain('Texto para pegar en Meta (EN)');
      expect(section, permission).toContain('Fluvia');
      expect(section, permission).toMatch(/^> .+/m);
    }
  });

  it('docs/app-review.md points at the two URLs and says what is still missing', () => {
    expect(appReview).toContain('/privacy');
    expect(appReview).toContain('/data-deletion');
    expect(appReview).toContain('Lo que falta construir');
    expect(appReview).toContain('LEGAL_REVIEW_PENDING');
  });

  it('does not ask in the doc for a permission the code does not request (section 5 headings)', () => {
    const section5 = appReview.split('## 5. ')[1]?.split('## 6. ')[0] ?? '';
    const headings = [...section5.matchAll(/^### `([a-z_]+)`/gm)].map((m) => m[1]);
    expect(headings.sort()).toEqual([...codePermissions].sort());
  });
});

describe('rendering', () => {
  const html = renderToStaticMarkup(<LegalPage doc={privacyPolicy} />);

  it('shows the draft banner with the exact number of open points', () => {
    expect(LEGAL_REVIEW_PENDING).toBe(true);
    expect(html).toContain('BORRADOR — pendiente de revisión legal');
    expect(html).toContain(`(${pendingCount(privacyPolicy)})`);
  });

  it('highlights every marker and never leaks the raw [[ ]] syntax', () => {
    expect((html.match(/<mark class="pending"/g) ?? []).length).toBe(pendingCount(privacyPolicy));
    expect(html).not.toContain('[[');
    expect(html).not.toContain(']]');
  });

  it('has an index that links to every section anchor', () => {
    for (const section of privacyPolicy.sections) {
      expect(html).toContain(`href="#${section.id}"`);
      expect(html).toContain(`id="${section.id}"`);
    }
  });

  it('renders the deletion template as preformatted text', () => {
    const page = renderToStaticMarkup(<LegalPage doc={dataDeletion} />);
    expect(page).toContain('<pre class="template">');
    expect(page).toContain('Asunto: Eliminación de datos');
  });

  it('uses table headers with a scope (accessible)', () => {
    expect(html).toContain('<th scope="col">Permiso</th>');
    expect(html).toContain('<th scope="row">');
  });

  it('the banner is a standalone note', () => {
    expect(renderToStaticMarkup(<ReviewBanner count={3} />)).toContain('(3)');
  });
});

describe('footer', () => {
  it('links to both legal pages, and the links resolve to those pages', () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual(['/privacy', '/data-deletion']);
    for (const link of LEGAL_LINKS) {
      expect(html).toContain(`href="${link.href}"`);
      expect(html).toContain(link.label);
    }
    expect(resolveRoute('/privacy', '').name).toBe('privacy');
    expect(resolveRoute('/data-deletion', '').name).toBe('deletion');
  });
});
