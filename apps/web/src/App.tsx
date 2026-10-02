import { loginHref, resolveRoute } from './route';
import { resultView } from './messages';

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="card">
      <p className="brand">Fluvia Ads</p>
      {children}
    </main>
  );
}

function ConnectPage({ state }: { state: string | null }) {
  if (!state) {
    return (
      <Card>
        <h1>Este enlace no es válido</h1>
        <p>Pídenos un enlace nuevo por WhatsApp y seguimos.</p>
      </Card>
    );
  }
  return (
    <Card>
      <h1>Conecta tu Facebook e Instagram</h1>
      <p>
        Para montar tu pauta necesitamos que autorices a Fluvia en Facebook. Solo usamos tu página y
        tu cuenta de Instagram para publicar tus anuncios.
      </p>
      <ul>
        <li>Facebook te va a pedir permiso para ver tu página y administrar tus anuncios.</li>
        <li>Debes ser administrador de la página y tener tu Instagram como cuenta profesional.</li>
      </ul>
      <a className="button" href={loginHref(API_BASE_URL, state)}>
        Conectar con Facebook
      </a>
    </Card>
  );
}

function ResultPage({ search }: { search: string }) {
  const route = resolveRoute('/connect/result', search);
  if (route.name !== 'result') return null;
  const view = resultView(route.result);
  const retryState = route.result.retryState;
  return (
    <Card>
      <div
        className={`notice notice-${view.tone}`}
        role={view.tone === 'error' ? 'alert' : 'status'}
      >
        <h1>{view.title}</h1>
        <p>{view.body}</p>
        {view.items.length > 0 && (
          <ul>
            {view.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
      {view.canRetry && retryState && (
        <a className="button" href={loginHref(API_BASE_URL, retryState)}>
          Volver a conectar
        </a>
      )}
    </Card>
  );
}

export function App() {
  const { pathname, search } = window.location;
  const route = resolveRoute(pathname, search);

  switch (route.name) {
    case 'connect':
      return <ConnectPage state={route.state} />;
    case 'result':
      return <ResultPage search={search} />;
    case 'home':
      return (
        <Card>
          <h1>Fluvia Ads</h1>
          <p>Tu pauta en Meta, montada en menos de 24 horas.</p>
        </Card>
      );
  }
}
