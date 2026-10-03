# Operación segura — guía paso a paso

Para quien administra la plataforma. Los comandos se ejecutan desde la raíz del repositorio salvo que se indique otra cosa.

## 1. Dominios (obligatorio para que el ingreso funcione)

La cookie de sesión es `SameSite=Lax` y va a la API. El navegador solo la envía si la web y la API son del **mismo sitio** (mismo dominio registrable). Por eso:

- Web: `https://app.<tudominio>` (Cloudflare Pages)
- API: `https://api.<tudominio>` (Worker con ruta de dominio propio)
- ❌ `*.pages.dev` + `*.workers.dev` son sitios distintos: el ingreso no funcionaría.

Variables por ambiente en `apps/api/wrangler.toml`: `WEB_BASE_URL=https://app.<tudominio>`, `API_BASE_URL=https://api.<tudominio>`, `EMAIL_FROM`. En el build de la web, `VITE_API_BASE_URL=https://api.<tudominio>` (de él sale la política CSP de `connect-src`).

## 2. Correo de envío (Resend)

1. Crea la cuenta y agrega tu dominio de envío.
2. Publica en el DNS los registros que indique Resend: SPF, DKIM y además un DMARC (`v=DMARC1; p=quarantine; rua=mailto:…`). Sin ellos los códigos terminan en spam y cualquiera puede suplantar el dominio.
3. Crea una llave de API con permiso solo de envío y cárgala: `wrangler secret put RESEND_API_KEY --env staging` (y `production`).

## 3. Secretos nuevos del ingreso

```bash
openssl rand -base64 32          # genera el valor
cd apps/api
pnpm exec wrangler secret put AUTH_SECRET --env staging
pnpm exec wrangler secret put RESEND_API_KEY --env staging
```

`AUTH_SECRET` debe tener al menos 32 caracteres. `TOKEN_ENCRYPTION_KEY` ya existe (también cifra los secretos TOTP). Usa valores distintos en staging y producción.

## 4. Crear el primer administrador

No hay registro público. La primera persona se crea una sola vez con SQL (en el editor SQL de Neon, en la rama del ambiente):

```sql
insert into staff_users (email, name, role)
values ('correo@dominio.com', 'Nombre Apellido', 'admin');
```

Luego esa persona entra en `/console`, recibe el código por correo y activa su app de autenticación. Guarda los 10 códigos de recuperación en un gestor de contraseñas. Las demás personas se invitan desde la consola con rol `operator` o `admin`.

## 5. Altas, bajas y cambios de personas

- **Alta:** un administrador crea a la persona (correo y rol). La primera vez que entre, activa su TOTP.
- **Baja o pérdida del teléfono:** un administrador usa "deshabilitar" (cierra sus sesiones al instante) o "restablecer TOTP" (cierra sus sesiones y le obliga a activar otra vez).
- Quien salga del equipo se deshabilita **el mismo día**; no se borra, para conservar la auditoría.
- Si el que pierde el teléfono es el **único administrador** y no tiene códigos de recuperación, se restablece por SQL: `update staff_users set totp_secret_enc=null, totp_enrolled_at=null, totp_last_step=null, recovery_code_hashes='[]' where email='…';`

## 6. Rotación de secretos

| Secreto                                           | Cuándo                                           | Efecto                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                                     | sospecha de fuga o cada 12 meses                 | Invalida los códigos pendientes y **los códigos de recuperación existentes** (se calculan con él): hay que restablecer el TOTP de todos. |
| `INTERNAL_API_TOKEN`                              | salida de alguien que lo conocía, o cada 6 meses | Actualizar a quienes lo usan.                                                                                                            |
| `OAUTH_STATE_SECRET`                              | sospecha de fuga                                 | Invalida enlaces de conexión en curso (inocuo).                                                                                          |
| `TOKEN_ENCRYPTION_KEY`                            | sospecha de fuga                                 | **No rotar sin procedimiento**: cifra los tokens de Meta y los secretos TOTP; requiere re-cifrar ⏳.                                     |
| `META_*`, `COLOCA_*`, `KAPSO_*`, `RESEND_API_KEY` | según el proveedor                               | Generar la nueva llave, cargar con `wrangler secret put`, revocar la anterior.                                                           |

Procedimiento: generar el valor nuevo → `wrangler secret put` en staging → probar → producción → revocar el anterior → anotarlo en el registro de cambios.

## 7. Configuración recomendada en proveedores

**Cloudflare**

- Reglas de límite de peticiones (WAF → Rate limiting) sobre `api.<tudominio>/auth/*`: 20 peticiones por minuto por IP; y sobre `/console/*`: 120 por minuto por IP. Complementan las del código.
- SSL/TLS en modo "Full (strict)", "Always use HTTPS" y HSTS activos.
- Autenticación en dos pasos obligatoria para todas las cuentas de Cloudflare.
- Bucket de R2 **sin** acceso público.

**GitHub**

- Protección de la rama `main`: PR obligatorio, CI en verde (`checks` y `audit`), sin pushes forzados.
- Activar _Secret scanning_ y _Push protection_ (Settings → Code security).
- Autenticación en dos pasos para todos los miembros de la organización.

**Neon**

- Una rama de base de datos por ambiente (nunca compartir `DATABASE_URL`).
- Rol de la aplicación sin permisos de `UPDATE`/`DELETE` sobre `audit_log` y `ledger` ⏳.
- Verificar la ventana de restauración a un punto en el tiempo del plan 🔶.

**Meta / Business**

- Autenticación en dos pasos exigida a todo el portafolio de Fluvia.
- Usuario de sistema con los permisos mínimos; el token se carga solo como secreto.

## 8. Qué mirar en el `audit_log`

- Muchos `auth.login_code_failed` seguidos: alguien está probando códigos.
- `auth.recovery_code_used`: confirmar con la persona que fue ella.
- `staff.created`, `staff.disabled`, `staff.totp_reset`: deben coincidir con lo que pidió un administrador.

```sql
select created_at, action, actor_id, entity_id
from audit_log
where action like 'auth.%' or action like 'staff.%'
order by created_at desc limit 100;
```

## 9. Respuesta a un incidente (sospecha de acceso indebido)

1. **Contener:** deshabilitar a la persona afectada (cierra sus sesiones). Si no se sabe quién: `update auth_sessions set revoked_at = now() where revoked_at is null;` (todos tendrán que entrar de nuevo).
2. **Cerrar la puerta:** rotar `AUTH_SECRET`, `INTERNAL_API_TOKEN` y las llaves que pudieron verse (sección 6).
3. **Revisar:** `audit_log` desde dos días antes de la primera señal; qué tareas y personas cambiaron.
4. **Si hay datos personales involucrados:** avisar a los afectados y evaluar el reporte a la Superintendencia de Industria y Comercio (SIC) 🔶 (lo define el abogado).
5. **Aprender:** anotar qué falló y qué control se agrega; actualizar `modelo-de-amenazas.md`.
