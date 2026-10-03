# Modelo de amenazas — Fluvia Ads

Qué protegemos, de quién, qué controles ya existen en el código y qué falta. Se revisa al terminar cada módulo del flujo (cobro, Kapso, reportes).

Leyenda: ✅ implementado y con tests · 🟡 parcial · ⏳ pendiente (depende de un paso por construir) · 🔶 decisión o dato que no está en el repo.

## 1. Qué protegemos (activos)

| Activo                                                                   | Por qué importa                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Dinero de terceros (pauta) y del servicio                                | Cobrar antes de gastar; el mandato de compra es dinero ajeno.          |
| Tokens de Meta de los clientes                                           | Permiten gastar en sus páginas y cuentas.                              |
| Sistema de usuario de Meta de Fluvia                                     | Crea cuentas publicitarias; si se filtra, se compromete el portafolio. |
| Datos personales de clientes (nombre, WhatsApp, correo, fotos, facturas) | Ley 1581 de 2012.                                                      |
| Sesiones y cuentas del equipo                                            | Quien entra a la consola puede cerrar tareas y ver datos de clientes.  |
| `ledger` y `audit_log`                                                   | Evidencia contable y de auditoría.                                     |

## 2. Quién podría atacar (actores)

1. **Persona anónima en Internet**: prueba rutas, adivina códigos, intenta enumerar correos.
2. **Atacante con un correo del equipo comprometido** (phishing, contraseña filtrada).
3. **Cliente malintencionado**: intenta tocar la cuenta de otro cliente o saltarse el pago.
4. **Tercero que falsifica webhooks** (Coloca, Kapso, Meta).
5. **Interno con acceso de más** (operador que quiere ver o cambiar lo que no le corresponde).
6. **Cadena de suministro**: dependencia npm comprometida.

## 3. Análisis por flujo (STRIDE)

### 3.1 Ingreso del equipo a la consola

| Amenaza                                  | Control                                                                                                                                                                                                                | Estado |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Suplantación: adivinar o robar un código | Código de 6 dígitos de un solo uso, vence en 10 min, máximo 5 intentos, guardado solo como HMAC con `AUTH_SECRET`.                                                                                                     | ✅     |
| Suplantación: correo comprometido        | Segundo factor obligatorio: app TOTP (RFC 6238) con anti-repetición del código; 10 códigos de recuperación de un solo uso (solo hash en base de datos).                                                                | ✅     |
| Enumeración de correos                   | `/auth/login` responde siempre 202 con el mismo cuerpo; el rechazo del código es idéntico para cualquier causa.                                                                                                        | ✅     |
| Fuerza bruta / inundación de correos     | Límites por IP y por correo (Durable Object); la sesión a medias muere tras 5 fallos del segundo factor.                                                                                                               | ✅     |
| Robo de sesión                           | Cookie `__Host-` `HttpOnly; Secure; SameSite=Lax`; el token se guarda solo como SHA-256; expira a las 2 h sin uso y a las 12 h absolutas; se rota al completar el segundo factor; cierre de sesión revoca en servidor. | ✅     |
| CSRF                                     | `SameSite=Lax` + verificación de `Origin` + encabezado propio `x-fluvia-csrf` + CORS solo para `WEB_BASE_URL`.                                                                                                         | ✅     |
| Escalada de privilegios                  | Roles `admin`/`operator` verificados en servidor en cada ruta; solo admin gestiona personas; nadie puede deshabilitarse a sí mismo; deshabilitar revoca sesiones al instante.                                          | ✅     |
| Repudio                                  | Cada ingreso, fallo, cierre y acción sobre tareas o personas va a `audit_log`.                                                                                                                                         | ✅     |
| Secretos TOTP expuestos en la base       | Cifrados con AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, aad por usuario).                                                                                                                                                    | ✅     |
| Rotación de `TOKEN_ENCRYPTION_KEY`       | El formato `v1.` la permite, pero no hay procedimiento automático.                                                                                                                                                     | 🟡     |

### 3.2 API y consola web

| Amenaza                                 | Control                                                                                                                                   | Estado |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Inyección SQL                           | Drizzle con parámetros; filtros validados con Zod (tipo y estado de tarea en listas cerradas, ids como UUID, cursor validado).            | ✅     |
| XSS                                     | React escapa todo; el contenido de `payload` se muestra como texto; CSP `script-src 'self'` sin `unsafe-inline`; `X-Frame-Options: DENY`. | ✅     |
| Respuestas con datos sensibles en caché | `Cache-Control: no-store` en `/auth` y `/console`.                                                                                        | ✅     |
| Cuerpos enormes                         | Límite de tamaño en rutas de login y consola.                                                                                             | ✅     |
| Mensajes de error con detalles internos | Error handler central: 500 genérico con `request_id`; logs sin cabeceras ni cuerpos.                                                      | ✅     |
| Rutas de administración sin sesión      | Pruebas que recorren cada ruta de `/console` sin sesión y con sesión a medias.                                                            | ✅     |
| Límites en el borde (WAF)               | Reglas de Cloudflare recomendadas (ver `operacion.md`).                                                                                   | 🟡     |

### 3.3 Conexión con Meta

| Amenaza                                            | Control                                                                                                                                     | Estado |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Robo de tokens de clientes                         | Cifrados en reposo (AES-256-GCM, aad por cliente).                                                                                          | ✅     |
| Falsificar el retorno de OAuth                     | `state` firmado, de un solo uso y con vencimiento.                                                                                          | ✅     |
| Quien llame a `/meta/connections/*`                | Hoy usa `INTERNAL_API_TOKEN` (secreto compartido, comparación en tiempo constante). Debe migrar a sesión de equipo cuando exista el portal. | 🟡     |
| Cuenta publicitaria fuera del portafolio de Fluvia | Regla 3 de CLAUDE.md; la creación usa solo el usuario de sistema configurado.                                                               | ✅     |

### 3.4 Cobro y webhooks (pasos 3 y 4: por construir)

| Amenaza                              | Control previsto                                                                                                                                | Estado |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Webhook falso que "confirma" un pago | Verificar HMAC sobre el cuerpo crudo con WebCrypto y comparación en tiempo constante antes de leer el JSON (ver `docs/coloca/bloque-notas.md`). | ⏳     |
| Repetición de un webhook             | Idempotencia por id de evento externo (🔶 Bloque no documenta id ni marca de tiempo: usar URN de pago + estado).                                | ⏳     |
| Activar presupuesto sin pago         | Regla 2: solo con pago confirmado por webhook; prueba que lo garantice.                                                                         | ⏳     |
| Manejo de tarjetas                   | No pasar datos de tarjeta por el Worker; usar el checkout alojado.                                                                              | ⏳     |
| Montos manipulados                   | Montos en `bigint`, calculados en servidor desde la orden, nunca desde el cliente.                                                              | ⏳     |

### 3.5 Datos y operación

| Amenaza                            | Control                                                                                                                          | Estado |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Fuga de secretos en el repositorio | `.gitignore`, prueba automática que busca formatos de credenciales reales, `wrangler secret`.                                    | ✅     |
| Dependencia comprometida           | `pnpm-lock.yaml` con `--frozen-lockfile`, `pnpm audit` en CI y semanal, Dependabot.                                              | ✅     |
| Manipulación del `audit_log`       | Hoy solo por convención (solo se inserta). Recomendado: rol de base de datos sin `UPDATE`/`DELETE` sobre `audit_log` y `ledger`. | 🟡     |
| Pérdida de datos                   | Neon con restauración a un punto en el tiempo 🔶 (verificar el plan contratado).                                                 | 🔶     |
| Retención de datos personales      | Política de eliminación publicada; plazos de retención del `audit_log` 🔶 (los define el abogado).                               | 🔶     |

## 4. Riesgos pendientes, por prioridad

1. **Antes de recibir dinero real:** verificación de firma e idempotencia de webhooks (3.4) y una prueba de intrusión externa.
2. **Antes de dar acceso a más personas:** reglas de WAF en Cloudflare, rol de base de datos de solo inserción para `audit_log`/`ledger`, dominios propios del web y de la API (las cookies `SameSite=Lax` requieren que compartan dominio registrable).
3. **Con el portal de clientes:** pasar `/meta/connections/*` a sesión de equipo o de cliente y eliminar `INTERNAL_API_TOKEN` del uso por personas.
4. **Con el tiempo:** procedimiento de rotación de `TOKEN_ENCRYPTION_KEY` y de `AUTH_SECRET`; alertas sobre `auth.login_code_failed` repetidos.
