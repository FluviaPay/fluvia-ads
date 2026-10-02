# Fluvia Ads — Pauta llave en mano

## Qué es
Plataforma donde un emprendedor sin conocimientos de publicidad contrata su pauta en Meta por WhatsApp (o web), paga en COP y recibe su campaña montada por IA en menos de 24 horas. El equipo humano solo interviene en excepciones. Socios: Mauricio Sabogal (Roisense), Angela Báez (pauta y operación), Luis Cajas (comercial).

Métrica que manda todas las decisiones: **minutos humanos por campaña** (meta: <30 al mes 3, <10 al mes 6).

## Alcance del MVP
- Meta (Facebook + Instagram), Colombia, COP, español.
- Objetivos: mensajes (destinos WhatsApp, Instagram Direct, Messenger) y tráfico.
- Píxel opcional solo si el cliente tiene web.
- Fuera del MVP (backlog fase 1 post-MVP): TikTok Ads, Google Ads, retargeting, listas de clientes, API de Conversiones, México, CRM.

## Reglas no negociables
1. **Solo API oficial de Meta** (Marketing API / Graph API) con app aprobada y usuario de sistema. Nunca scraping, robots de navegador ni cuentas compartidas.
2. **Cobrar antes de gastar.** Ningún presupuesto se activa en Meta sin pago confirmado por webhook de Coloca.
3. **Una cuenta publicitaria por cliente**, dentro del portafolio exclusivo de Fluvia (nunca el de Roisense).
4. **Dinero separado**: pauta = recurso de terceros (mandato de compra); servicio = ingreso propio. Toda transacción va al `ledger`.
5. **Todo auditable**: cada decisión de IA y cada acción humana se registra en `audit_log`.
6. **Primer anuncio de cada cliente requiere aprobación humana.** El filtro de políticas con IA corre antes de publicar.
7. **Nunca probar contra cuentas reales de clientes.** Desarrollo contra la cuenta sandbox de Meta; piloto solo con marcas propias.
8. Secretos solo en variables de entorno / `wrangler secret`. Nunca en el repo.

## Stack
- API y lógica: Cloudflare Workers + Hono (TypeScript estricto)
- Base de datos: Neon (PostgreSQL) + Drizzle ORM
- Colas y tareas: Cloudflare Queues + Cron Triggers
- Estado en tiempo real: Durable Objects (link de cobro con vencimiento, lock por cliente)
- Archivos: Cloudflare R2 (fotos, creativos, facturas)
- Front: React + Vite en Cloudflare Pages (portal cliente y consola interna)
- WhatsApp: Kapso · Pagos y verificación: Coloca (Bre-B, Nequi, PSE, tarjetas virtuales; Sumsub) · Facturación: Alegra
- IA: Claude API (estrategia, textos, filtro de políticas)
- Validación: Zod en todos los bordes (webhooks, API, salida de la IA)
- Tests: Vitest

## Estructura del monorepo (pnpm workspaces)
```
apps/
  api/          Worker principal (Hono): endpoints, webhooks, consumidores de colas
  web/          React + Vite: portal cliente + consola interna
packages/
  db/           esquema Drizzle, migraciones, cliente Neon
  meta/         cliente de la Marketing API (aislado, con reintentos y rate limits)
  coloca/       cliente Coloca
  kapso/        cliente Kapso
  ai/           agentes (estratega, redactor, filtro de políticas) y prompts
  templates/    plantillas de campaña por categoría (CONFIGURACIÓN, no código)
  shared/       tipos, esquemas Zod, utilidades
```

## Módulos y eventos
Captura → Verificación → Conexión Meta → Cobro → Activación de presupuesto → Motor de campañas → Operación → Reportes y facturación.
Cada módulo termina publicando un evento en Queues que dispara el siguiente. Cualquier falla crea una fila en `tasks` (cola humana) en lugar de detener el flujo.

## Modelo de datos (12 tablas)
clients, client_assets, meta_connections (page_id, ig_id, ad_account_id, destinos de mensajes, pixel_id, permisos), orders (presupuesto pauta, valor servicio, duración, KPI acordado, estado), payments, funding, campaigns, creatives, metrics_daily, tasks, ledger, audit_log.
Montos en COP como enteros (`bigint`), nunca float.

## Plantillas de campaña
Viven en `packages/templates` como JSON/TS tipado: categoría, objetivo, audiencia base, rango de presupuesto diario, número de anuncios, formatos (1:1, 4:5, 9:16), reglas de copy. Los valores actuales son **provisionales** hasta que Angela responda; deben poder cambiarse sin tocar lógica.
Categorías excluidas del MVP: crédito, financieras, banca, empleo, vivienda, política, salud.

## Convenciones
- Código y nombres en inglés; textos al usuario en español colombiano.
- Naming de campañas y UTMs generados por el sistema: `FLV_{clientId}_{categoria}_{objetivo}_{yyyymmdd}`.
- Idempotencia en todos los webhooks (clave por evento externo).
- Todo acceso a Meta pasa por `packages/meta`; nada de llamadas sueltas.
- Funciones pequeñas, sin abstracciones prematuras.

## Comandos
```
pnpm install
pnpm dev            # wrangler dev + vite
pnpm test
pnpm db:generate    # drizzle-kit generate
pnpm db:migrate
pnpm run deploy     # wrangler deploy --env staging (`pnpm deploy` es un comando propio de pnpm)
pnpm run deploy:production
```

## Variables de entorno
DATABASE_URL, META_APP_ID, META_APP_SECRET, META_SYSTEM_USER_TOKEN, META_BUSINESS_ID, META_SANDBOX_AD_ACCOUNT_ID, COLOCA_API_KEY, COLOCA_WEBHOOK_SECRET, KAPSO_API_KEY, KAPSO_WEBHOOK_SECRET, ALEGRA_USER, ALEGRA_TOKEN, ANTHROPIC_API_KEY
Además (no secretas): ENVIRONMENT (development | staging | production, la fija wrangler.toml), META_MODE (mock | sandbox | live; `live` solo con ENVIRONMENT=production) y META_MOCK_SCENARIO (solo en mock).
Conexión con Meta (login del cliente): secretos TOKEN_ENCRYPTION_KEY (32 bytes en base64; cifra los tokens de clientes), OAUTH_STATE_SECRET e INTERNAL_API_TOKEN (generar enlaces); variables META_LOGIN_CONFIG_ID, WEB_BASE_URL y API_BASE_URL (la fija wrangler.toml por ambiente). La web usa VITE_API_BASE_URL.
Crear la cuenta publicitaria del cliente (modo live) además requiere META_SYSTEM_USER_ID, META_AD_ACCOUNT_TIMEZONE_ID (id numérico de Bogotá en Meta), META_END_ADVERTISER, META_MEDIA_AGENCY y META_PARTNER: aún por decidir; si faltan se crea una tarea CONFIG_MISSING.
Cada ambiente tiene su propia DATABASE_URL; staging apunta a una rama de Neon. Los secretos se cargan por ambiente con `wrangler secret put <NOMBRE> --env staging|production`.

## Decisiones que dependen de terceros (no suponer)
- Qué expone la API de Meta sobre asignación de crédito, vínculo de WhatsApp y límites de cuentas → **Meta**. Si no está disponible, crear tarea humana de un clic.
- Tratamiento tributario del mandato y certificación → **tributarista**.
- Cláusula de datos (Ley 1581) → **abogado**.
- Endpoints exactos de Coloca y Kapso → su documentación; si hay duda, preguntar.

## Cómo trabajar
- Antes de una tarea grande, propón un plan corto y espera confirmación.
- Trabaja en pasos pequeños y verificables; corre tests al terminar cada paso.
- No instales dependencias nuevas sin justificarlo.
- Responde en español, directo y concreto.

## Orden de construcción (fase 1)
1. Monorepo, Drizzle con las 12 tablas, Worker base con /health.
2. Conexión con Meta: Login for Business, validación de permisos, creación de cuenta publicitaria en sandbox.
3. Cobro Coloca: payin, webhook idempotente, asiento en ledger.
4. Flujo de captura en Kapso ("proponemos y el cliente corrige").
5. Consola mínima de tareas.
