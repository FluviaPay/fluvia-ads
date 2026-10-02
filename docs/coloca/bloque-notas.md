# Notas sobre Bloque (plataforma de Coloca)

Estado: investigación, sin código de producción. Sirve de insumo para el paso 3 (cobro Coloca).

## Leyenda y límites de esta investigación

- **`docs.bloque.app` no fue accesible** desde el entorno de la sesión (bloqueo de red). No se leyó ninguna página de la documentación oficial.
- La fuente fue el **código y README de los paquetes npm publicados**: `@bloque/payments`, `@bloque/payments-core`, `@bloque/payments-react`, `@bloque/sdk` y sus `sdk-*` (accounts, swap, compliance, identity, orgs, core).
- 📦 = confirmado en el código o README de esos paquetes.
- 🔶 = **no está en ninguna fuente leída**; no se confirmó. No suponerlo: validar con la documentación o con Coloca.

## 1. Autenticación (llave secreta y pública)

- 📦 Hay dos tipos de llave: secreta (`sk_…`, solo servidor) y pública (`pk_…`, para el navegador/React). `ApiKeysClient.create` devuelve `{ keyId, secretKey, publishableKey }`.
- 📦 El SDK intercambia la llave por un token: `POST {apiRoot}/api-keys/exchange` con `{ key }` → `{ access_token, expires_in }`. Las llamadas siguientes usan ese JWT como Bearer; el SDK lo renueva.
- 📦 Hosts: `apiRoot = sandbox ? https://dev.bloque.app/api : https://api.bloque.app/api`; el cliente de pagos usa `apiRoot + /payments`.
- 📦 `@bloque/sdk` (core) usa otros hosts: sandbox `https://api.dev-bloque.app`, producción `https://api.bloque.app`. 🔶 Inconsistencia entre `dev.bloque.app` y `api.dev-bloque.app`: confirmar cuál es el sandbox vigente.
- 🔶 Dónde y cómo se emiten las llaves (panel, API, quién las entrega a Fluvia).
- 🔶 Rotación, permisos por llave y expiración de las llaves.
- Para Fluvia: `COLOCA_API_KEY` es la llave secreta (`wrangler secret`); la pública solo si algún día hay checkout en el navegador.

## 2. Modo de prueba

- 📦 Existe: el cliente de pagos acepta `sandbox: true` y cambia el host (arriba). El `sdk-core` tiene el ambiente `sandbox`.
- 🔶 Cómo se obtienen llaves de prueba (¿prefijo distinto? ¿otro panel?).
- 🔶 Datos de prueba (tarjetas, bancos PSE, números) y cómo simular aprobado/rechazado/pendiente.
- 🔶 Si los webhooks también se disparan en sandbox.
- Consistente con la regla 7 de CLAUDE.md: desarrollo solo contra sandbox.

## 3. Métodos de pago disponibles para Colombia

| Método    | Cobro a clientes (payins)                     | Evidencia                                                                                                                                |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Tarjeta   | Sí                                            | 📦 `payment.type = "card"`                                                                                                               |
| PSE       | Sí                                            | 📦 `payment.type = "pse"`                                                                                                                |
| Efectivo  | Sí                                            | 📦 `payment.type = "cash"`; 🔶 qué redes/proveedores                                                                                     |
| **Bre-B** | **No como método de pago en la API de pagos** | 📦 solo en los módulos `accounts`/`swap`: depósito (`BrebClient.createDeposit`, llave de un solo uso) y pagos de salida; proveedor Cobre |
| **Nequi** | **No como método de cobro**                   | 📦 solo aparece como **banco destino de transferencias de salida** (`SupportedBank`, junto con Daviplata)                                |

Conclusión: según el SDK, el API de pagos soporta **solo tarjeta, PSE y efectivo**. Bre-B existe por otra vía (cuentas/swap, depósito) y Nequi solo como destino de salida.

- 🔶 Si el checkout alojado (link de pago) ofrece Bre-B o Nequi aunque el SDK no lo exponga.
- 🔶 Comisiones, límites por transacción y tiempos de liquidación por método.
- 🔶 Cuál es la ruta recomendada por Coloca para recibir Bre-B de un cliente (el módulo swap/accounts exige cuentas y posiblemente KYC).

## 4. Link de pago (checkout) y cobro directo

- 📦 **Checkout / link de pago:** `CheckoutResource.create` → `POST /payments/` con los datos del cobro. Devuelve una sesión/URL de checkout alojada. 🔶 Forma exacta de la respuesta, vencimiento del link, URLs de retorno/cancelación.
- 📦 **Cobro directo:** `PaymentResource.create` → `POST /payments/{type}` (`card` | `pse` | `cash`) con un `payment_urn` y los datos del medio de pago.
- 📦 Montos en **unidades menores** (centavos). 🔶 Convención exacta para COP: parece `COPM/2` (2 decimales) → pesos × 100. Confirmar antes de cobrar.
- 📦 El SDK define activos `DUSD/6`, `COPB/6`, `COPM/2`, `KSM/12`; el **valor por defecto es `DUSD/6`**, no pesos. Siempre pasar el activo explícito.
- 📦 El SDK de pagos **no** envía llave de idempotencia (el `sdk-core` sí agrega `Idempotency-Key` automático en POST/PUT). 🔶 Si el API de pagos acepta ese encabezado.
- 🔶 Si un cobro directo puede crearse sin sesión de checkout previa, y cómo se consulta/cancela un pago.
- Alerta PCI: un cobro directo con tarjeta implica manejar datos crudos de tarjeta. **No pasarlos por el Worker**; usar el link/checkout alojado o los componentes de `@bloque/payments-react`.

## 5. Webhooks y verificación de firma

- 📦 Verificación: `WebhookResource.verify` = HMAC-SHA256 en **hexadecimal** del **cuerpo crudo**, con un secreto, comparado en tiempo constante contra el encabezado `x-bloque-signature`.
- 📦 El secreto lo define el comercio (`upsertOriginWebhookSecret`). Mapea a `COLOCA_WEBHOOK_SECRET`.
- 📦 Para webhooks de tarjetas (`CardWebhookPayload`) hay tipos de evento definidos en `sdk-accounts`. 🔶 Lista completa y nombres.
- 🔶 **Eventos de webhook de pagos** (creado, aprobado, rechazado, vencido, reembolsado…), su payload y ejemplos.
- 🔶 Id único del evento, timestamp y política de reintentos. Sin ellos, la clave de idempotencia (regla CLAUDE.md) debería derivarse de `payment_urn + estado`.
- 🔶 Protección contra repetición (tolerancia de timestamp): no documentada.
- Para Fluvia: verificar con WebCrypto sobre el cuerpo crudo (`await req.text()`), **nunca** sobre `JSON.stringify` de un cuerpo ya parseado.

## 6. Tarjetas virtuales por API

- 📦 Sí: `@bloque/sdk` → `accounts.card.create`, con `cardType` por defecto `"VIRTUAL"`. Emisor: Pomelo. Requiere KYC/identidad del titular (módulos `identity`/`compliance`, Sumsub).
- 📦 Hay webhooks de tarjeta (movimientos).
- 🔶 Si la tarjeta puede recargarse/limitarse por monto, y si sirve para pagar pauta en Meta (red, moneda, aceptación de Meta como medio de pago).
- 🔶 Costos, límites y disponibilidad en Colombia.
- 🔶 Cómo se relaciona con el flujo de dinero de Fluvia (financiación → tarjeta → cuenta publicitaria): requiere confirmación con Coloca.

## 7. Implicaciones para Fluvia

1. Cobrar al cliente con **link de checkout** (tarjeta, PSE, efectivo). Bre-B/Nequi no están confirmados para payin.
2. Webhook: verificar firma sobre cuerpo crudo → guardar evento idempotente → asiento en `ledger` → publicar evento que activa presupuesto (regla "cobrar antes de gastar").
3. Convertir pesos → centavos (×100) y pasar siempre el activo explícito.
4. Sin llave de idempotencia en el SDK: desactivar reintentos automáticos en POST o añadir idempotencia propia (clave en `payments` por `order_id`).
5. Separar pauta (terceros) y servicio (propio) en `ledger`; 🔶 ver si `payout_route` u otra opción de Bloque permite separarlos y consultar tributarista.

## 8. Páginas de documentación necesarias

Para cerrar los 🔶, pásame el contenido de:

1. Autenticación / API keys y sandbox (cómo emitir llaves de prueba, datos de prueba).
2. Pagos: checkout/link de pago y pagos directos (referencia de API con request/response).
3. Webhooks: lista de eventos, payload, firma, reintentos.
4. Métodos de pago por país (Colombia): Bre-B, Nequi, PSE, efectivo, tarjetas; límites y comisiones.
5. Cuentas/swap: depósito Bre-B y payouts.
6. Tarjetas virtuales: creación, recarga, límites, webhooks, KYC.
7. Liquidación y precios.
