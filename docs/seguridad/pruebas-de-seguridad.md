# Pruebas de seguridad

A esta actividad se le llama **pruebas de seguridad de aplicaciones (AppSec)**; cuando se hace atacando el sistema a propósito, con permiso y alcance definido, es **hacking ético** o **prueba de intrusión (pentest)**.

## 1. Lo que ya corre solo (en cada `pnpm test` y en CI)

| Prueba                  | Dónde                                        | Qué comprueba                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matriz de autorización  | `apps/api/src/routes/console.test.ts`        | Cada ruta de `/console` responde 401 sin sesión y con sesión a medias; los operadores reciben 403 en rutas de administración.                                                                      |
| Flujo de ingreso        | `apps/api/src/auth/flow.test.ts`             | Códigos de un solo uso, vencimiento, bloqueo tras 5 intentos, respuestas idénticas (sin enumeración), anti-repetición TOTP, rotación de sesión, expiración por inactividad y absoluta, revocación. |
| Navegador               | `flow.test.ts`                               | CSRF (origen y encabezado), CORS solo para la web, cabeceras de seguridad, tamaño máximo de cuerpo, cookie `__Host-` con `HttpOnly; Secure; SameSite=Lax`.                                         |
| Entradas hostiles       | `console.test.ts`                            | Filtros con intento de inyección SQL, cursores y ids inválidos, campos desconocidos.                                                                                                               |
| SQL atómico             | `apps/api/src/auth/store.test.ts`            | Las operaciones de "verificar y cambiar" son una sola sentencia (sin carreras).                                                                                                                    |
| Criptografía            | `totp.test.ts`, `secrets.test.ts`            | Vectores oficiales de la RFC 6238, hashes y códigos.                                                                                                                                               |
| Interfaz                | `apps/web/src/console/console.test.tsx`      | El texto de tareas se escapa (no se interpreta como HTML); CSP sin `unsafe-inline`.                                                                                                                |
| Higiene del repositorio | `apps/web/src/security/repo-hygiene.test.ts` | Ninguna credencial real en el repo, `.dev.vars.example` vacío, `wrangler.toml` sin secretos, sin logs de cabeceras.                                                                                |
| Dependencias            | `.github/workflows/ci.yml`                   | `pnpm audit` en cada PR y cada semana; Dependabot.                                                                                                                                                 |

## 2. Pentest propio (checklist antes de cada lanzamiento importante)

**Reglas:** solo contra **staging** o local; nunca contra producción, cuentas reales de clientes ni servicios de terceros (Meta, Coloca, Kapso). Con la base de datos de staging, no con datos reales (regla 7 de CLAUDE.md).

Basado en OWASP ASVS / Top 10. Marcar cada punto con fecha y quién lo hizo.

1. **Autenticación:** con un administrador sin passkey, comprobar que `/console/staff` responde 403; probar una passkey desde un dominio distinto (por ejemplo vía `/etc/hosts`) y confirmar que el navegador no la ofrece; probar 6 códigos distintos y verificar el bloqueo; reutilizar un código; reutilizar un TOTP en menos de 30 s; usar la cookie después de cerrar sesión; usar la cookie de una sesión a medias en `/console/tasks`.
2. **Autorización:** con una cuenta `operator`, llamar a todas las rutas de `/console/staff`; cambiar ids en `/console/tasks/:id`; intentar resolver una tarea que otra persona tomó.
3. **Sesión y navegador:** revisar en las herramientas del navegador que la cookie sea `HttpOnly` y `Secure`; desde otra página probar un `fetch` con credenciales hacia la API (debe fallar por CORS); probar sin el encabezado `x-fluvia-csrf`.
4. **Entradas:** caracteres especiales, textos muy largos, JSON mal formado, tipos incorrectos en cada campo.
5. **Cabeceras:** revisar con `curl -I` la API y la web (CSP, HSTS, `nosniff`, `X-Frame-Options`).
6. **Secretos:** `git log -p | grep -iE 'secret|token|key'`, revisar los logs de `wrangler tail` mientras se hacen pruebas: no debe aparecer ningún código ni token.
7. **Infraestructura:** bucket R2 sin acceso público; ninguna ruta de depuración expuesta; revisar qué expone `/health` (hoy solo estado y versión de la app).
8. **Webhooks (cuando existan):** firma inválida, cuerpo modificado, evento repetido, firma correcta con cuerpo reordenado.

Herramientas gratuitas útiles: OWASP ZAP (escaneo contra staging), `curl`, las herramientas del navegador, `trufflehog`/`gitleaks` para historial de git.

## 3. Pentest externo

Antes de recibir dinero real contratar una prueba de intrusión a una firma o profesional independiente, con un acuerdo escrito de **alcance** (qué dominios y ambientes), **ventana** (fechas), **reglas** (sin denegación de servicio, sin datos reales) y entrega de un informe con hallazgos priorizados. Los hallazgos se corrigen y se anotan en `modelo-de-amenazas.md`.

## 4. Reporte de vulnerabilidades

Si alguien externo encuentra un problema, debe poder avisar sin hacerlo público. El canal está en `SECURITY.md`.
