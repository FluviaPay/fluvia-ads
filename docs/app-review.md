# Preparación del App Review de Meta

Estado: **borrador de trabajo.** Fecha: 2026-10-02.
Complementa `docs/plan-meta.md` (diseño de la integración) y las páginas legales de `apps/web` (`/privacy` y `/data-deletion`).

## 0. Cómo leer este documento

**Límite de verificación.** Al escribirlo, `developers.facebook.com` estaba bloqueado desde el entorno de desarrollo. Los requisitos actuales del App Review (formato del video, duración, campos del formulario, qué permisos pide Meta justificar y cómo) salen de memoria y **hay que contrastarlos con la documentación oficial antes de enviar**. Se marcan con 🔶. Lo que depende de una decisión del equipo o del abogado se marca con 🔴.

Los textos para pegar en Meta están en **inglés** (los revisores trabajan en inglés); la explicación para el equipo está en español.

## 1. La conclusión que importa: hoy no se puede grabar el video completo

Meta pide mostrar **cada permiso funcionando** dentro de la aplicación. Hoy el sistema demuestra la conexión, las validaciones, la creación de la cuenta publicitaria y la asignación de la página, pero **no** el motor de campañas, las métricas ni una pantalla donde se vea lo que la aplicación hizo con los datos.

| Permiso                        | ¿Se puede mostrar su uso hoy?                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `pages_show_list`              | Parcial: se usa, pero ninguna pantalla muestra la lista (falta «Tu conexión»).     |
| `pages_read_engagement`        | Parcial: igual que el anterior.                                                    |
| `instagram_basic`              | Parcial: igual que el anterior.                                                    |
| `business_management`          | Sí, en Business Settings del portafolio de pruebas (cuenta creada y página).       |
| `whatsapp_business_management` | Parcial: se valida, pero el resultado solo se ve en una tarea (falta la consola).  |
| `pages_manage_ads`             | Parcial: se usa en la asignación y en la prueba `validate_only`; sin anuncios aún. |
| `ads_management`               | **No** como lo pide Meta: no hay campañas ni anuncios creados todavía.             |
| `ads_read`                     | **No**: no hay métricas ni reporte todavía.                                        |

Enviar el App Review con un permiso cuyo uso no se ve es la causa más común de rechazo 🔶. Hay dos caminos:

1. **Esperar** a tener el motor de campañas, el reporte y las pantallas de la sección 8, y enviar todo junto (recomendado).
2. **Enviar por tandas** los permisos que sí se pueden mostrar. Es más rápido, pero cada ronda de revisión toma tiempo y un rechazo parcial puede retrasarlo todo. 🔶 Confirmar con Meta si esto es posible para la app.

## 2. Antes de enviar (lista de verificación)

- [ ] 🔴 **Textos legales aprobados por el abogado:** apagar `LEGAL_REVIEW_PENDING` en `apps/web/src/legal/status.ts` (un test impide hacerlo mientras queden marcadores `[[…]]`).
- [ ] 🔴 **Datos de contacto reales** en la política: razón social, NIT, domicilio, correo y WhatsApp de privacidad.
- [ ] **Política publicada:** `{WEB_BASE_URL}/privacy` accesible sin iniciar sesión y enlazada desde las pantallas de la aplicación (ya está en el pie de página).
- [ ] **Instrucciones de eliminación publicadas:** `{WEB_BASE_URL}/data-deletion`. Es la URL de «instrucciones de eliminación de datos»; el callback automático descrito en `docs/plan-meta.md` §13 **no está implementado** (ver sección 8). 🔶 Confirmar que Meta acepta la URL de instrucciones para esta app.
- [ ] 🔶 **Verificación del negocio** de Fluvia en Meta (separada del portafolio de Roisense).
- [ ] 🔶 App de tipo Business vinculada al portafolio de Fluvia; producto _Facebook Login for Business_ con una **configuración** que incluya exactamente los permisos de la sección 5.
- [ ] 🔶 Dominios de la aplicación, ícono, categoría y descripción cargados en la app de Meta.
- [ ] URI de redirección registrada: `{API_BASE_URL}/meta/callback`, idéntica carácter por carácter.
- [ ] **Cuentas de prueba separadas de clientes reales y de Roisense** (regla 7): una página de Facebook y un Instagram profesional de una marca propia de Fluvia, y un portafolio de pruebas (`docs/plan-meta.md` §15). Nunca se graba con un cliente real.
- [ ] Ambiente donde se graba: staging con datos de prueba. El modo (`META_MODE`) debe ser el que haga llamadas reales a Meta para lo que se muestre; el modo `mock` no sirve para el video.
- [ ] Credenciales del usuario de prueba para el revisor, entregadas por el campo seguro de Meta. **Nunca se guardan en el repositorio.**

## 3. Cómo grabar

- **Idioma:** la interfaz de Facebook en inglés; la nuestra está en español, así que se agregan **subtítulos en inglés** (texto de cada escena en la sección 4). 🔶 Confirmar la preferencia de Meta.
- **Calidad:** pantalla completa, 1080p, cursor visible, sin prisa entre pasos, sin música.
- **Qué NO se muestra:** tokens, secretos, `.dev.vars`, respuestas de la base de datos con datos de personas reales, ni correos o teléfonos personales. Si hay que mostrar datos guardados, usar la consola con datos de prueba (sección 8).
- **Duración:** corta y ordenada por permiso. 🔶 Verificar el límite actual de Meta.
- **Un solo recorrido continuo** de una persona de negocio, de principio a fin, y luego las vistas de Meta (Business Settings y Ads Manager) que confirman lo que la aplicación hizo.

## 4. Guion del video

Leyenda de estado: ✅ se puede grabar hoy; ⏳ requiere algo de la sección 8; 🔶 depende de cómo se vea el diálogo real de Meta.

### Escena 0 — Presentación (10 a 15 s) ✅

- **Pantalla:** `{WEB_BASE_URL}/` o la portada de la presentación.
- **Narración (ES):** «Fluvia es un servicio que monta la publicidad de un negocio pequeño en Facebook e Instagram, sin que el dueño tenga que saber de pauta. Voy a mostrar cómo usa cada permiso que solicitamos.»
- **Subtítulo (EN):** "Fluvia is a turnkey advertising service that sets up a small business's ads on Facebook and Instagram. I will show how the app uses each permission we request."

### Escena 1 — El enlace de conexión y el pie legal ✅

- **Pantalla:** `/connect?state=…` (un enlace recién generado por el backend de Fluvia; vence a los 30 minutos y se usa una sola vez).
- **Acción:** mostrar el título y el texto; señalar los enlaces **Política de privacidad** y **Eliminación de datos** del pie; abrir cada uno un instante y volver.
- **Narración (ES):** «El dueño del negocio recibe este enlace por WhatsApp. Antes de conectar puede leer nuestra política de privacidad y cómo pedir que borremos sus datos.»
- **Subtítulo (EN):** "The business owner receives this link on WhatsApp. Before connecting, they can read our privacy policy and how to request deletion of their data."
- **Demuestra:** URL de la política y de eliminación de datos.

### Escena 2 — Facebook Login for Business y los permisos 🔶

- **Pantalla:** botón «Conectar con Facebook» y el diálogo de Facebook.
- **Acción:** hacer clic; **detener la imagen en la lista de permisos** del diálogo; elegir la página y la cuenta de Instagram de la marca de prueba; aceptar.
- **Narración (ES):** «Facebook le muestra exactamente qué permisos pedimos. El dueño elige su página y su Instagram, y acepta. Nunca vemos su contraseña.»
- **Subtítulo (EN):** "Facebook shows exactly which permissions we ask for. The owner chooses their Page and Instagram account and accepts. We never see their password."
- **Demuestra:** todos los permisos de la sección 5, y que la persona los concede de forma consciente.

### Escena 3 — Resultado de la conexión ✅

- **Pantalla:** `/connect/result?status=ok` («¡Listo, recibimos tu conexión!»).
- **Narración (ES):** «Fluvia recibe la conexión y empieza a revisarla.»
- **Subtítulo (EN):** "Fluvia receives the connection and starts reviewing it."

### Escena 4 — Qué leyó la aplicación y qué validó ⏳

- **Pantalla:** **«Tu conexión»** (no existe aún, sección 8): nombre de la página, cuenta de Instagram profesional, rol de administrador, página publicada, WhatsApp vinculado.
- **Acción:** recorrer cada fila y decir qué permiso la hizo posible.
- **Narración (ES):** «Con `pages_show_list` confirmamos que es administrador de la página; con `pages_read_engagement` vemos que está publicada; con `instagram_basic`, que su Instagram es profesional; y, si eligió WhatsApp, con `whatsapp_business_management` que su página tiene un número vinculado.»
- **Subtítulo (EN):** "pages_show_list confirms the user is an admin of the Page; pages_read_engagement shows it is published; instagram_basic confirms the Instagram account is professional; if WhatsApp was chosen, whatsapp_business_management confirms the Page has a number linked."
- **Variante de falla ⏳:** mostrar una conexión con un problema (por ejemplo Instagram personal) y la tarea que el equipo ve con la instrucción exacta. Demuestra que los datos se usan solo para validar.
- **Demuestra:** `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `whatsapp_business_management`.

### Escena 5 — La cuenta publicitaria creada para el cliente ✅

- **Pantalla:** Business Settings del portafolio de pruebas de Fluvia → cuentas publicitarias.
- **Acción:** señalar la cuenta nueva `FLV_{clientId}`, en COP y zona horaria `America/Bogota`, dentro del portafolio de Fluvia.
- **Narración (ES):** «Fluvia crea una cuenta publicitaria exclusiva para este cliente dentro de su propio portafolio. La página y el Instagram siguen siendo del cliente.»
- **Subtítulo (EN):** "Fluvia creates a dedicated ad account for this client inside Fluvia's own Business portfolio. The Page and Instagram account remain the client's."
- **Demuestra:** `business_management`. 🔴 Requiere haber resuelto el id de zona horaria y los campos de anunciante (`docs/plan-meta.md` §8.1).

### Escena 6 — Acceso a la página del cliente ✅ / 🔴

- **Pantalla:** Business Settings → páginas, mostrando que Fluvia tiene acceso de anunciante a la página de la marca de prueba (sin ser su dueña).
- **Narración (ES):** «Fluvia solo recibe permiso para anunciar desde la página. No se vuelve su dueña.»
- **Subtítulo (EN):** "Fluvia is only given permission to advertise from the Page. It does not become its owner."
- **Demuestra:** `business_management` y `pages_manage_ads`. 🔴 El mecanismo exacto de acceso no está confirmado (`docs/plan-meta.md` §9.1); si es manual, grabarlo tal como se hace.

### Escena 7 — Una campaña creada por Fluvia ⏳

- **Pantalla:** el flujo de la aplicación hasta «campaña creada» y luego Ads Manager con la campaña, el conjunto de anuncios y el anuncio **en pausa**, publicados desde la página de la marca de prueba.
- **Narración (ES):** «Con el pago confirmado, Fluvia crea la campaña: objetivo mensajes, audiencia, presupuesto y anuncios. El primer anuncio de cada cliente lo revisa una persona antes de salir.»
- **Subtítulo (EN):** "Once payment is confirmed, Fluvia creates the campaign: messages objective, audience, budget and ads. The first ad of every client is reviewed by a person before going live."
- **Demuestra:** `ads_management` y `pages_manage_ads`. Requiere el motor de campañas, la aprobación del primer anuncio y el cobro (pasos 3 y siguientes).

### Escena 8 — Reporte de resultados ⏳

- **Pantalla:** el reporte de la aplicación con gasto, impresiones, clics y conversaciones de la campaña de prueba, junto a Ads Manager mostrando los mismos números.
- **Narración (ES):** «Fluvia lee el rendimiento para mostrárselo al dueño del negocio.»
- **Subtítulo (EN):** "Fluvia reads performance data to show it to the business owner."
- **Demuestra:** `ads_read`. Requiere la lectura diaria de métricas y una pantalla de reporte.

### Escena 9 — Retirar el acceso y eliminar los datos ✅

- **Pantalla:** configuración de Facebook → aplicaciones conectadas → quitar Fluvia; luego `/data-deletion`.
- **Narración (ES):** «El dueño puede retirar el acceso de Fluvia cuando quiera, y pedir que borremos sus datos siguiendo estas instrucciones.»
- **Subtítulo (EN):** "The owner can remove Fluvia's access at any time and ask us to delete their data by following these instructions."
- **Demuestra:** retiro de acceso y eliminación de datos.

### Escena 10 — Cierre (5 s) ✅

- **Narración (ES):** «Eso es todo. Gracias.» **Subtítulo (EN):** "That is all. Thank you."

## 5. Justificación de cada permiso

Para cada permiso: qué hace en Fluvia, dónde se ve en el video, qué función del código lo usa hoy, su estado y el **texto para pegar en el formulario de Meta (inglés)**.

> El mapa permiso → función → endpoint es 🔶: nombres de endpoints y de permisos exigidos por cada uno salen de memoria (ver `docs/plan-meta.md` §4) y no se contrastaron con Meta.

### `ads_management`

- **Para qué (ES):** crear y administrar campañas, conjuntos de anuncios y anuncios en la cuenta publicitaria que Fluvia abre para el cliente, y validar anuncios antes de publicarlos.
- **Video:** escena 7.
- **Código hoy:** `probePageRestrictions` (`packages/meta/src/operations/restrictions.ts`), que valida un anuncio sin crearlo. La creación de campañas **aún no existe**.
- **Estado:** ⏳ parcial. No se puede mostrar el uso real todavía.

**Texto para pegar en Meta (EN):**

> Fluvia is a turnkey advertising service for small businesses in Colombia. After a business owner connects their Facebook Page and Instagram account through Facebook Login for Business and pays for the service, Fluvia creates and manages their campaigns, ad sets and ads in a dedicated ad account that Fluvia opens for that business inside Fluvia's own Business portfolio. We use ads_management to create campaigns (messages or traffic objective), ad sets, creatives and ads, to pause or resume them, and to validate a creative before publishing it. Budget is never activated before payment is confirmed, and a person at Fluvia reviews the first ad of every client before it goes live. We do not use this permission for anything else.

### `ads_read`

- **Para qué (ES):** leer el rendimiento de los anuncios (gasto, impresiones, clics y conversaciones) para el reporte del cliente y para optimizar, y leer el estado de la cuenta publicitaria.
- **Video:** escena 8.
- **Código hoy:** `getAdAccount` (`packages/meta/src/operations/adaccounts.ts`), que lee estado, moneda y zona horaria. La lectura de métricas **aún no existe**.
- **Estado:** ⏳ parcial.

**Texto para pegar en Meta (EN):**

> We use ads_read to read the delivery and performance data (spend, impressions, clicks and conversations started) of the campaigns that Fluvia runs for the business owner, in order to show them a results report and to optimize the campaigns. We also read the status of the ad account (active, disabled, in review) to detect problems early. We only read ad accounts that Fluvia itself creates and manages for the user.

### `business_management`

- **Para qué (ES):** crear la cuenta publicitaria del cliente dentro del portafolio de Fluvia, buscar las cuentas que ya existen (para no duplicarlas) y pedir acceso de anunciante a la página del cliente.
- **Video:** escenas 5 y 6.
- **Código hoy:** `createAdAccount` y `assignPageToAdAccount` (`packages/meta/src/operations/adaccounts.ts` y `assign.ts`).
- **Estado:** ✅ implementado; 🔴 pendiente confirmar con Meta el tope de cuentas, el id de zona horaria y el mecanismo de acceso a la página.

**Texto para pegar en Meta (EN):**

> Fluvia creates a separate ad account for each client inside Fluvia's own Business portfolio. We use business_management to create that ad account, to look up the ad accounts we already own (to avoid creating duplicates), and to request advertiser access to the client's Page. The client's Page and Instagram account always remain owned by the client: Fluvia is only given permission to advertise from them and is never made their owner.

### `pages_show_list`

- **Para qué (ES):** ver las páginas que administra la persona que conecta, para confirmar que es administradora y que eligió una sola página.
- **Video:** escena 4.
- **Código hoy:** `getPages` (`packages/meta/src/operations/pages.ts`).
- **Estado:** ✅ implementado; ⏳ falta una pantalla que muestre el resultado.

**Texto para pegar en Meta (EN):**

> After the business owner logs in to Fluvia with Facebook Login for Business, Fluvia lists the Pages they manage in order to confirm that they have an admin role on the Page that will be used to advertise, and that exactly one Page was selected. If something is wrong (for example, they are not an admin), we show them what to fix. We do not store the Page name: only its ID.

### `pages_read_engagement`

- **Para qué (ES):** leer datos básicos de la página (si está publicada, las tareas de la persona sobre ella, la cuenta de Instagram vinculada y el número de WhatsApp vinculado) para validar que se puede usar para anunciar.
- **Video:** escena 4.
- **Código hoy:** `getPages`, `getInstagramAccount` y `getWhatsAppLink` (`packages/meta/src/operations/`).
- **Estado:** ✅ implementado; ⏳ falta mostrarlo.

**Texto para pegar en Meta (EN):**

> Fluvia reads basic information about the Page (whether it is published, the user's tasks on it, the linked Instagram professional account and the linked WhatsApp number) to validate that the Page can be used to advertise. We do not read posts, comments, followers or any other content from the Page.

### `pages_manage_ads`

- **Para qué (ES):** que los anuncios que opera Fluvia se publiquen desde la página del cliente, y comprobar (en modo solo validación) que la página puede anunciar.
- **Video:** escenas 6 y 7.
- **Código hoy:** `assignPageToAdAccount` y `probePageRestrictions`.
- **Estado:** ⏳ parcial (sin anuncios publicados todavía).

**Texto para pegar en Meta (EN):**

> We need pages_manage_ads so that the ads that Fluvia runs for the business owner are published from the owner's Page, and to run a validation-only check (nothing is created) that the Page is allowed to run ads before the client's account is considered connected. We do not create organic posts and we do not manage the Page's content.

### `instagram_basic`

- **Para qué (ES):** identificar la cuenta de Instagram profesional vinculada a la página y verificar que es profesional.
- **Video:** escena 4.
- **Código hoy:** `getInstagramAccount` (`packages/meta/src/operations/pages.ts`).
- **Estado:** ✅ implementado; ⏳ falta mostrarlo.

**Texto para pegar en Meta (EN):**

> Fluvia reads the Instagram professional account that is linked to the user's Page (its ID and username) to verify that the client has a professional account, and to use it as the identity of their ads on Instagram. We do not read the account's media, followers or messages.

### `whatsapp_business_management` (solo si el cliente elige WhatsApp)

- **Para qué (ES):** comprobar que la página tiene un número de WhatsApp Business vinculado, para que los anuncios de «clic a WhatsApp» abran una conversación.
- **Video:** escena 4.
- **Código hoy:** `getWhatsAppLink` (`packages/meta/src/operations/whatsapp.ts`) y `checkPagePermissions` con `whatsapp: true`.
- **Estado:** ✅ implementado, 🔴 sin confirmar que Meta exponga ese dato; si no, la validación pasa a una tarea manual.

**Texto para pegar en Meta (EN):**

> Only when the business owner chooses WhatsApp as the destination of their ads, Fluvia checks that their Page has a WhatsApp Business number linked, so that click-to-WhatsApp ads can open a conversation with them. We do not send or read WhatsApp messages with this permission.

## 6. Permisos que NO pedimos, y por qué

Conviene decirlo en el formulario si Meta pregunta. Ningún permiso de mensajería es necesario, porque los anuncios que abren una conversación no exigen que la aplicación lea los mensajes 🔶.

| Permiso                       | Por qué no se pide                                                |
| ----------------------------- | ----------------------------------------------------------------- |
| `pages_messaging`             | No leemos ni enviamos mensajes de Messenger.                      |
| `instagram_manage_messages`   | No leemos ni enviamos mensajes de Instagram Direct.               |
| `whatsapp_business_messaging` | La conversación por WhatsApp la maneja nuestro proveedor (Kapso). |
| `instagram_content_publish`   | No publicamos contenido orgánico; solo anuncios pagados.          |
| `pages_manage_metadata`       | No nos suscribimos a webhooks de la página (por ahora).           |
| `instagram_manage_insights`   | No leemos métricas orgánicas; las de pauta vienen de `ads_read`.  |
| `catalog_management`          | Fuera del alcance del MVP.                                        |
| `leads_retrieval`             | Fuera del alcance del MVP.                                        |

🔶 Confirmar si el diálogo de Login for Business agrega por defecto `public_profile` u otros permisos básicos, y reflejarlo en la política.

## 7. Instrucciones para el revisor (EN, para pegar)

Las credenciales y el enlace los entrega el equipo por el campo seguro de Meta. **No se escriben aquí.**

> **How to test Fluvia**
>
> 1. Open the review entry link: `<REVIEW_ENTRY_URL — to be provided>`. It starts the connection flow for a demo client.
> 2. Click "Conectar con Facebook" (Connect with Facebook).
> 3. Log in with the test user: `<TEST_USER — provided in the secure credentials field>`.
> 4. In the Facebook dialog, review the requested permissions, select the test Page `<TEST_PAGE_NAME>` and its linked Instagram professional account, and accept.
> 5. You will return to a confirmation page. Fluvia then validates the connection and creates a dedicated ad account in Fluvia's Business portfolio.
> 6. Privacy policy: `<WEB_BASE_URL>/privacy`. Data deletion instructions: `<WEB_BASE_URL>/data-deletion`.
>
> All data belongs to a test brand owned by Fluvia. No real customer accounts are used.

🔴 Hoy **no existe** un enlace de entrada estable para el revisor (ver sección 8): los enlaces de conexión vencen a los 30 minutos y se usan una sola vez.

## 8. Lo que falta construir antes de grabar y enviar

Ordenado por lo que más bloquea:

1. **Pantalla «Tu conexión»** (y la consola de tareas, paso 5 del orden de construcción): mostrar la página, el Instagram, el rol, si está publicada, el WhatsApp vinculado y las tareas pendientes. Sin ella, `pages_show_list`, `pages_read_engagement`, `instagram_basic` y `whatsapp_business_management` no se ven. Requiere un endpoint con autenticación: hoy la URL de resultado solo lleva códigos, a propósito.
2. **Motor de campañas:** crear campaña, conjunto de anuncios y anuncios, con la aprobación humana del primer anuncio y el cobro previo (pasos 3 y siguientes). Sin él, `ads_management` y `pages_manage_ads` no se ven.
3. **Lectura de métricas y reporte:** `metrics_daily` y una pantalla de resultados. Sin ellos, `ads_read` no se ve.
4. **Entrada para el revisor:** un enlace estable (por ejemplo una ruta en staging que cree un cliente de demostración y su enlace de conexión, protegida con un código de revisión), porque los enlaces reales caducan.
5. **Eliminación de datos de verdad:** hoy es un proceso manual. Además, el esquema usa llaves foráneas sin cascada: borrar un cliente con historial exige **anonimizar** en vez de borrar filas. Hay que diseñarlo y, idealmente, automatizarlo.
6. **Callback de desautorización y de eliminación de datos** de Meta (`docs/plan-meta.md` §13): hoy no existe; la URL de instrucciones lo cubre solo si Meta la acepta.
7. **Revisión del abogado** de las dos páginas (sección 2).
8. **Verificación del negocio** y **configuración pendiente** de la cuenta publicitaria: id de zona horaria de Bogotá, anunciante final, agencia y socio (`docs/plan-meta.md` §8.1 y §18).
9. **Cuentas de prueba** de una marca propia, separadas de Roisense y de clientes (regla 7).

## 9. Riesgos de rechazo que ya conocemos 🔶

- **No se ve el uso de un permiso** (el más probable hoy; sección 1).
- **Política incompleta o genérica:** la nuestra enumera datos, finalidades, proveedores y permisos; falta el cierre legal (sección 2).
- **Datos que no coinciden:** si el video muestra datos que la política no menciona, o al revés. Un test mantiene la tabla de permisos de la política igual a los permisos que pide el código.
- **Instrucciones de prueba que no funcionan:** por eso el punto 4 de la sección 8.
- **Pedir más de lo necesario:** por eso la sección 6; si Meta sugiere quitar un permiso, se evalúa si la función puede hacerse sin él.
