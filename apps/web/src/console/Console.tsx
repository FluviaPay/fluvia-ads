import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useCallback, useEffect, useState } from 'react';
import {
  createConsoleApi,
  type ConsoleApi,
  type Me,
  type Methods,
  type Passkey,
  type Task,
  type TaskAction,
  type TaskStatus,
} from './api';
import {
  STATUS_LABEL,
  errorText,
  formatSecret,
  passkeysSupported,
  payloadLines,
  suggestDeviceName,
} from './text';

type Step =
  | { name: 'loading' }
  | { name: 'email' }
  | { name: 'code'; email: string }
  | { name: 'choose-enroll' }
  | { name: 'passkey-name' }
  | { name: 'enroll'; secret: string; uri: string }
  | { name: 'recovery-codes'; codes: string[] }
  | { name: 'totp'; methods: Methods }
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

export function Devices(props: {
  passkeys: Passkey[];
  busy: boolean;
  supported: boolean;
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState(
    suggestDeviceName(typeof navigator === 'undefined' ? '' : navigator.userAgent),
  );
  return (
    <section className="devices" aria-label="Mis dispositivos">
      <h2>Mis dispositivos</h2>
      {props.passkeys.length === 0 ? (
        <p className="muted">Aún no tienes ninguna passkey.</p>
      ) : (
        <ul className="task-list">
          {props.passkeys.map((p) => (
            <li key={p.id} className="device">
              <strong>{p.deviceName}</strong>
              <span className="muted">
                {p.backedUp ? 'Sincronizada' : 'Solo en este dispositivo'} · último uso:{' '}
                {p.lastUsedAt ? new Date(p.lastUsedAt).toLocaleDateString('es-CO') : 'nunca'}
              </span>
              <button
                className="button button-secondary"
                disabled={props.busy}
                onClick={() => props.onRemove(p.id)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {props.supported ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            props.onAdd(name.trim());
          }}
        >
          <label className="field">
            <span>Nombre del nuevo dispositivo</span>
            <input value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="button" type="submit" disabled={props.busy}>
            Agregar passkey
          </button>
        </form>
      ) : (
        <p className="muted">Este navegador no admite passkeys.</p>
      )}
    </section>
  );
}

function Tasks({
  api,
  me,
  onLogout,
  onRefreshMe,
  onRecoveryCodes,
}: {
  api: ConsoleApi;
  me: Me;
  onLogout: () => void;
  onRefreshMe: () => Promise<void>;
  onRecoveryCodes: (codes: string[]) => void;
}) {
  const [showDevices, setShowDevices] = useState(false);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
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

  const loadPasskeys = useCallback(async () => {
    try {
      setPasskeys((await api.listPasskeys()).passkeys);
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);

  useEffect(() => {
    if (showDevices) void loadPasskeys();
  }, [showDevices, loadPasskeys]);

  const addPasskey = async (deviceName: string) => {
    setBusy(true);
    try {
      const { challengeId, options } = await api.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON: options });
      const { recoveryCodes } = await api.passkeyRegisterVerify(challengeId, deviceName, response);
      await Promise.all([loadPasskeys(), onRefreshMe()]);
      setError(null);
      if (recoveryCodes) onRecoveryCodes(recoveryCodes);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const removePasskey = async (id: string) => {
    setBusy(true);
    try {
      await api.deletePasskey(id);
      await Promise.all([loadPasskeys(), onRefreshMe()]);
      setError(null);
    } catch (e) {
      setError(errorText(e));
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
        <button className="button button-secondary" onClick={() => setShowDevices((open) => !open)}>
          Mis dispositivos
        </button>
        <button className="button button-secondary" onClick={onLogout}>
          Salir
        </button>
      </header>
      {me.role === 'admin' && !me.hasPasskey && (
        <p className="notice notice-warning" role="status">
          Para administrar personas necesitas registrar una passkey. Hazlo en «Mis dispositivos».
        </p>
      )}
      {showDevices && (
        <Devices
          passkeys={passkeys}
          busy={busy}
          supported={passkeysSupported()}
          onAdd={(name) => void addPasskey(name)}
          onRemove={(id) => void removePasskey(id)}
        />
      )}
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

  /** One gesture with a passkey: no email, no code. */
  const loginWithPasskey = () =>
    run(async () => {
      const { challengeId, options } = await api.passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: options });
      await api.passkeyLoginVerify(challengeId, response);
      await enterApp();
    });

  /** Registers this device. On the first enrollment it also finishes the login. */
  const registerPasskey = (deviceName: string) =>
    run(async () => {
      const { challengeId, options } = await api.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON: options });
      const { recoveryCodes } = await api.passkeyRegisterVerify(challengeId, deviceName, response);
      if (recoveryCodes) return setStep({ name: 'recovery-codes', codes: recoveryCodes });
      await enterApp();
    });

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
          extra={
            passkeysSupported() ? (
              <p>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void loginWithPasskey()}
                >
                  Entrar con passkey
                </button>
              </p>
            ) : undefined
          }
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
              const { next, methods } = await api.verifyCode(step.email, code);
              if (next === 'second_factor') return setStep({ name: 'totp', methods });
              setStep({ name: 'choose-enroll' });
            })
          }
        />
      );
    case 'choose-enroll':
      return (
        <section>
          <h1>Protege tu cuenta</h1>
          <p>Elige cómo quieres confirmar que eres tú cada vez que entres.</p>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          {passkeysSupported() && (
            <p>
              <button
                className="button"
                disabled={busy}
                onClick={() => setStep({ name: 'passkey-name' })}
              >
                Usar una passkey (recomendado)
              </button>
              <br />
              <span className="muted">
                Huella, rostro o llave física. No hay códigos que escribir y no se puede robar con
                una página falsa.
              </span>
            </p>
          )}
          <p>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const enrollment = await api.startEnrollment();
                  setStep({
                    name: 'enroll',
                    secret: enrollment.secret,
                    uri: enrollment.otpauthUri,
                  });
                })
              }
            >
              Usar una app de autenticación
            </button>
          </p>
        </section>
      );
    case 'passkey-name':
      return (
        <StepForm
          {...common}
          title="Registra tu passkey"
          intro="Ponle un nombre para reconocer este dispositivo. Después tu navegador te pedirá la huella, el rostro o el PIN."
          label="Nombre del dispositivo"
          maxLength={60}
          button="Continuar"
          onSubmit={(name) => void registerPasskey(name)}
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
    case 'totp': {
      const passkeyButton =
        step.methods.passkey && passkeysSupported() ? (
          <p>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void loginWithPasskey()}
            >
              Confirmar con mi passkey
            </button>
          </p>
        ) : null;
      const recoveryLink = (
        <p>
          <button type="button" className="link" onClick={() => setStep({ name: 'use-recovery' })}>
            Perdí mi teléfono o mi dispositivo
          </button>
        </p>
      );
      if (!step.methods.totp) {
        return (
          <section>
            <h1>Confirma que eres tú</h1>
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            {passkeyButton ?? <p className="muted">Este navegador no admite passkeys.</p>}
            {recoveryLink}
          </section>
        );
      }
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
            <>
              {passkeyButton}
              {recoveryLink}
            </>
          }
          onSubmit={(code) =>
            void run(async () => {
              await api.verifyTotp(code);
              await enterApp();
            })
          }
        />
      );
    }
    case 'use-recovery':
      return (
        <StepForm
          {...common}
          title="Código de recuperación"
          intro="Escribe uno de los códigos de recuperación que guardaste al activar tu protección."
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
          onRefreshMe={() => api.me().then((me) => setStep({ name: 'app', me }))}
          onRecoveryCodes={(codes) => setStep({ name: 'recovery-codes', codes })}
        />
      );
  }
}
