/** Linked from every screen (Meta checks that the privacy policy is reachable from the app). */
export const LEGAL_LINKS = [
  { href: '/privacy', label: 'Política de privacidad' },
  { href: '/data-deletion', label: 'Eliminación de datos' },
] as const;

export function Footer() {
  return (
    <footer className="footer">
      <nav aria-label="Información legal">
        {LEGAL_LINKS.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
