import { useCallback, useEffect, useState } from 'react';
import {
  createConsoleApi,
  type ConsoleApi,
  type Me,
  type Task,
  type TaskAction,
  type TaskStatus,
} from './api';
import { STATUS_LABEL, errorText, formatSecret, payloadLines } from './text';

type Step =
  | { name: 'loading' }
  | { name: 'email' }
  | { name: 'code'; email: string }
  | { name: 'enroll'; secret: string; uri: string }
  | { name: 'recovery-codes'; codes: string[] }
  | { name: 'totp' }
  | { name: 'use-recovery' }
  | { name: 'app'; me: Me };

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: 'numeric' | 'email' | 'text';
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        value={props.value}
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        maxLength={props.maxLength}
        onChange={(e) => props.onChange(e.target.value)}
        required
      />
    </label>
  );
}

/** One small form: a field, a button, the error. Used by every login step. */
export function StepForm(props: {
  title: string;
  intro?: string;
  label: string;
  button: string;
  type?: string;
  inputMode?: 'numeric' | 'email' | 'text';
  autoComplete?: string;
  maxLength?: number;
  error: string | null;
  busy: boolean;
  onSubmit: (value: string) => void;
  extra?: React.ReactNode;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(value.trim());
      }}
    >
      <h1>{props.title}</h1>
      {props.intro && <p>{props.intro}</p>}
      <Field
        label={props.label}
        value={value}
        onChange={setValue}
        {...(props.type ? { type: props.type } : {})}
        {...(props.inputMode ? { inputMode: props.inputMode } : {})}
        {...(props.autoComplete ? { autoComplete: props.autoComplete } : {})}
        {...(props.maxLength ? { maxLength: props.maxLength } : {})}
      />
      {props.error && (
        <p className="notice notice-error" role="alert">
          {props.error}
        </p>
      )}
      <button className="button" type="submit" disabled={props.busy}>
        {props.button}
      </button>
      {props.extra}
    </form>
  );
}

export function TaskDetail(props: {
  task: Task;
  me: Me;
  busy: boolean;
  onAction: (action: TaskAction, note: string) => void;
}) {
  const { task, me } = props;
  const [note, setNote] = useState('');
  const mine = task.assignedTo === `staff:${me.id}`;
  const closed = task.status === 'done' || task.status === 'dismissed';
  const takenByOther = task.status === 'in_progress' && !mine && me.role !== 'admin';
  return (
    <section className="task-detail" aria-label="Detalle de la tarea">
      <h2>{task.title}</h2>
      <p className="muted">
        {task.clientName ?? 'Sin cliente'} · {task.type} · {STATUS_LABEL[task.status]}
      </p>
      <dl>
        {payloadLines(task.payload).map((line) => (
          <div key={line.label}>
            <dt>{line.label === 'instruction' ? 'Qué hacer' : line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
      {!closed && (
        <>
          <label className="field">
            <span>Nota (opcional)</span>
            <textarea
              value={note}
              maxLength={500}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="actions">
            {task.status === 'open' && (
              <button
                className="button"
                disabled={props.busy}
                onClick={() => props.onAction('claim', note)}
              >
                Tomar
              </button>
            )}
            <button
              className="button"
              disabled={props.busy || takenByOther}
              onClick={() => props.onAction('resolve', note)}
            >
              Resolver
            </button>
            <button
              className="button button-secondary"
              disabled={props.busy || takenByOther}
              onClick={() => props.onAction('dismiss', note)}
            >
              Descartar
            </button>
          </div>
          {takenByOther && <p className="muted">Otra persona tiene esta tarea.</p>}
        </>
      )}
    </section>
  );
}

export function TaskList(props: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (props.tasks.length === 0) return <p className="muted">No hay tareas pendientes. 🎉</p>;
  return (
    <ul className="task-list">
      {props.tasks.map((task) => (
        <li key={task.id}>
          <button
            className={task.id === props.selectedId ? 'task-item selected' : 'task-item'}
            onClick={() => props.onSelect(task.id)}
          >
            <strong>{task.title}</strong>
            <span className="muted">
              {task.clientName ?? 'Sin cliente'} · {STATUS_LABEL[task.status]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Tasks({ api, me, onLogout }: { api: ConsoleApi; me: Me; onLogout: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (cursor?: string | null) => {
      try {
        const statuses: TaskStatus[] = showClosed
          ? ['open', 'in_progress', 'done', 'dismissed']
          : ['open', 'in_progress'];
        const page = await api.listTasks({ status: statuses, cursor: cursor ?? null });
        setTasks((current) => (cursor ? [...current, ...page.tasks] : page.tasks));
        setNext(page.nextCursor);
        setError(null);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [api, showClosed],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  const act = async (action: TaskAction, note: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await api.taskAction(selected.id, action, note.trim() || undefined);
      setTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
      setError(null);
    } catch (e) {
      setError(errorText(e));
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="console-header">
        <h1>Tareas</h1>
        <span className="muted">
          {me.name} · {me.role === 'admin' ? 'Administrador' : 'Operación'}
        </span>
        <button className="button button-secondary" onClick={onLogout}>
          Salir
        </button>
      </header>
      <label className="check">
        <input
          type="checkbox"
          checked={showClosed}
          onChange={(e) => setShowClosed(e.target.checked)}
        />{' '}
        Ver también las cerradas
      </label>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="console-grid">
        <div>
          <TaskList tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
          {next && (
            <button className="button button-secondary" onClick={() => void load(next)}>
              Ver más
            </button>
          )}
        </div>
        {selected && <TaskDetail task={selected} me={me} busy={busy} onAction={act} />}
      </div>
    </>
  );
}

export function Console({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [api] = useState(() => createConsoleApi(apiBaseUrl));
  const [step, setStep] = useState<Step>({ name: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((me) => setStep({ name: 'app', me }))
      .catch(() => setStep({ name: 'email' }));
  }, [api]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const enterApp = () => api.me().then((me) => setStep({ name: 'app', me }));
  const common = { error, busy };

  switch (step.name) {
    case 'loading':
      return <p className="muted">Cargando…</p>;
    case 'email':
      return (
        <StepForm
          {...common}
          title="Ingreso del equipo"
          intro="Te enviaremos un código a tu correo."
          label="Correo"
          type="email"
          inputMode="email"
          autoComplete="email"
          button="Enviar código"
          onSubmit={(email) =>
            void run(async () => {
              await api.requestCode(email);
              setStep({ name: 'code', email });
            })
          }
        />
      );
    case 'code':
      return (
        <StepForm
          {...common}
          title="Revisa tu correo"
          intro={`Si ${step.email} tiene acceso, le llegó un código de 6 dígitos. Vence en 10 minutos.`}
          label="Código del correo"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          button="Continuar"
          onSubmit={(code) =>
            void run(async () => {
              const { next } = await api.verifyCode(step.email, code);
              if (next === 'totp') return setStep({ name: 'totp' });
              const enrollment = await api.startEnrollment();
              setStep({ name: 'enroll', secret: enrollment.secret, uri: enrollment.otpauthUri });
            })
          }
        />
      );
    case 'enroll':
      return (
        <StepForm
          {...common}
          title="Activa tu app de autenticación"
          intro="Abre Google Authenticator, Authy o similar, agrega una cuenta con esta clave y escribe el código de 6 dígitos que muestra."
          label="Código de la app"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          button="Activar"
          extra={
            <p>
              Clave: <code className="secret">{formatSecret(step.secret)}</code>
              <br />
              <a href={step.uri}>Abrir en mi app de autenticación</a>
            </p>
          }
          onSubmit={(code) =>
            void run(async () => {
              const { recoveryCodes } = await api.confirmEnrollment(code);
              setStep({ name: 'recovery-codes', codes: recoveryCodes });
            })
          }
        />
      );
    case 'recovery-codes':
      return (
        <section>
          <h1>Guarda tus códigos de recuperación</h1>
          <p>
            Sirven si pierdes tu teléfono. Cada uno funciona una sola vez y no los volveremos a
            mostrar. Guárdalos en un lugar seguro, como un gestor de contraseñas.
          </p>
          <ul className="recovery">
            {step.codes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
          <button className="button" onClick={() => void run(enterApp)}>
            Ya los guardé, entrar
          </button>
        </section>
      );
    case 'totp':
      return (
        <StepForm
          {...common}
          title="Código de tu app"
          label="Código de 6 dígitos"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          button="Entrar"
          extra={
            <p>
              <button
                type="button"
                className="link"
                onClick={() => setStep({ name: 'use-recovery' })}
              >
                Perdí mi teléfono
              </button>
            </p>
          }
          onSubmit={(code) =>
            void run(async () => {
              await api.verifyTotp(code);
              await enterApp();
            })
          }
        />
      );
    case 'use-recovery':
      return (
        <StepForm
          {...common}
          title="Código de recuperación"
          intro="Escribe uno de los códigos que guardaste al activar tu app."
          label="Código de recuperación"
          autoComplete="off"
          maxLength={16}
          button="Entrar"
          onSubmit={(code) =>
            void run(async () => {
              await api.useRecoveryCode(code);
              await enterApp();
            })
          }
        />
      );
    case 'app':
      return (
        <Tasks
          api={api}
          me={step.me}
          onLogout={() => void api.logout().finally(() => setStep({ name: 'email' }))}
        />
      );
  }
}
