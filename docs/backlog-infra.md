# Backlog de infraestructura y puesta en marcha

Estado al 2026-10-03. Cada punto lleva su responsable; los de Cloudflare y Resend los hace una persona del equipo (Claude no tiene acceso a esas cuentas). Los pasos de detalle están en `docs/seguridad/operacion.md`.

## Hecho

- Neon: proyecto `fluvia-ads` con ramas `staging` y `production` (cada una con su propia `DATABASE_URL`), migraciones 0000 a 0004 aplicadas y 17 tablas verificadas en ambas.
- Neon: administrador `carlos@fluviapay.com` (rol `admin`) creado en las dos ramas.
- Cloudflare: `fluviapay.com` activo; SSL/TLS Full (strict), Always Use HTTPS y HSTS.
- Cloudflare: cola `fluvia-events-staging` creada.
- Repo: dominios por ambiente en `apps/api/wrangler.toml` (ruta de la API, `WEB_BASE_URL`, `API_BASE_URL`, `EMAIL_FROM`).

## Pendiente, en orden

1. **Resend** (gratis para empezar). Crear la cuenta, verificar `fluviapay.com` con SPF, DKIM y DMARC en Cloudflare DNS (modo «DNS only») y generar una llave de API de solo envío por ambiente.
2. **R2** (requiere saldo y método de pago). Activar R2 y crear los buckets `fluvia-assets-staging` y `fluvia-assets`. Sin el bucket falla el primer deploy.
3. **Cola de producción.** Crear `fluvia-events` (`wrangler queues create fluvia-events`).
4. **Primer deploy de staging.** Con `main` actualizado: `pnpm exec wrangler login` y `pnpm run deploy`. Crea el Worker `fluvia-api-staging` y el dominio `api-staging.fluviapay.com`.
5. **Secretos del Worker**, por ambiente (`wrangler secret put <NOMBRE> --env staging|production`), con valores distintos en cada uno: `AUTH_SECRET`, `RESEND_API_KEY`, `TOKEN_ENCRYPTION_KEY` y `DATABASE_URL` (la de cada rama de Neon, copiada de su consola; no va al repo ni al chat). Los demás secretos (Meta, Coloca, Kapso, Alegra, Anthropic, `OAUTH_STATE_SECRET`, `INTERNAL_API_TOKEN`) se cargan cuando se usen.
6. **Web (Pages).** Crear el proyecto y asociar `app-staging.fluviapay.com`; construir con `VITE_API_BASE_URL=https://api-staging.fluviapay.com`.
7. **Probar el ingreso en staging.** Entrar a `/console` con `carlos@fluviapay.com`, recibir el código y registrar una passkey (mejor dos dispositivos). Guardar los 10 códigos de recuperación en un gestor de contraseñas.
8. **Repetir 4 a 7 en producción** (`pnpm run deploy:production`, `api.` y `app.fluviapay.com`).
9. **Limpiar la copia local duplicada.** En el computador de Carlos el repo quedó clonado dentro de otro clon (`fluvia-ads/fluvia-ads`); conservar una sola copia.

## Decisiones y mejoras abiertas

- **Retención de Neon.** Hoy es de 6 horas; recomendado unos 7 días antes de tener clientes reales (el máximo depende del plan). Protege `ledger` y `audit_log` contra errores descubiertos tarde.
- **Neon Auth.** Está activo en la rama `production` (y se copió a `staging`), pero el ingreso del equipo es propio. Decidir si se desactiva.
- **Rol de la aplicación en Neon** sin `UPDATE` ni `DELETE` sobre `audit_log` y `ledger` (ya listado en `operacion.md`).
- **Rate limiting de Cloudflare (WAF):** `/auth/*` a 20 por minuto por IP y `/console/*` a 120 por minuto por IP.
- **Cloudflare:** autenticación en dos pasos en todas las cuentas; bucket de R2 sin acceso público.
- **Remitente de correo.** Se fijó `no-reply@fluviapay.com`; confirmar o cambiar antes de producción.
- **`WEBAUTHN_RP_ID`.** Dejar el valor por defecto (host de `WEB_BASE_URL`) y no cambiarlo después de registrar passkeys.
- **Migraciones aplicadas por SQL.** Las 0000 a 0004 se aplicaron con SQL directo y se registraron en `drizzle.__drizzle_migrations` (mismo hash y fecha que usa Drizzle). Antes de la primera migración nueva, correr `pnpm db:generate` y `pnpm db:migrate` en `staging` y comprobar que solo aplica la nueva.
