import { LEGAL_DRAFT_DATE, LEGAL_REVIEW_PENDING } from './status';
import { splitPending } from './pending';
import { pendingCount, type Block, type LegalDoc } from './types';

/** Text with the review markers highlighted, so nobody misses what is still open. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {splitPending(text).map((segment, index) =>
        segment.kind === 'pending' ? (
          <mark key={index} className="pending" title="Pendiente de revisión">
            {`[${segment.text}]`}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'p':
      return (
        <p>
          <Rich text={block.text} />
        </p>
      );
    case 'ul':
      return (
        <ul>
          {block.items.map((item) => (
            <li key={item}>
              <Rich text={item} />
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {block.head.map((cell) => (
                  <th key={cell} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) =>
                    index === 0 ? (
                      <th key={cell} scope="row">
                        <code>{cell}</code>
                      </th>
                    ) : (
                      <td key={cell}>
                        <Rich text={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'template':
      return <pre className="template">{block.text}</pre>;
  }
}

export function ReviewBanner({ count }: { count: number }) {
  return (
    <div className="review-banner" role="note">
      <strong>BORRADOR — pendiente de revisión legal.</strong> Este texto no es la versión final:
      los puntos resaltados ({count}) deben completarse y el contenido debe ser revisado por el
      abogado de Fluvia antes de publicarse o enviarse a Meta.
    </div>
  );
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <>
      {LEGAL_REVIEW_PENDING && <ReviewBanner count={pendingCount(doc)} />}
      <h1>{doc.title}</h1>
      <p className="muted">Versión borrador del {LEGAL_DRAFT_DATE}.</p>
      {doc.intro.map((text) => (
        <p key={text}>
          <Rich text={text} />
        </p>
      ))}
      <nav aria-label="Contenido">
        <ol className="toc">
          {doc.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.heading.replace(/^\d+\.\s*/, '')}</a>
            </li>
          ))}
        </ol>
      </nav>
      {doc.sections.map((section) => (
        <section key={section.id} id={section.id}>
          <h2>{section.heading}</h2>
          {section.blocks.map((block, index) => (
            <BlockView key={index} block={block} />
          ))}
        </section>
      ))}
    </>
  );
}
