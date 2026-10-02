import { PERMISSION_USES } from './permissions';
import { p, table, ul, type LegalDoc } from './types';

/**
 * DRAFT for the lawyer's review. Statements about data come from what the system really
 * does (docs/plan-meta.md, apps/api, packages/db). Anything the team or the lawyer must
 * decide or provide is a [[marker]]: no contact data or legal figure is invented here.
 */
export const privacyPolicy: LegalDoc = {
  title: 'Política de privacidad y tratamiento de datos personales',
  intro: [
    'En Fluvia Ads montamos y operamos la pauta publicitaria de tu negocio en Meta (Facebook e Instagram). Para hacerlo necesitamos algunos de tus datos. Aquí te explicamos cuáles, para qué los usamos, con quién los compartimos y cómo puedes ejercer tus derechos.',
  ],
  sections: [
    {
      id: 'responsable',
      heading: '1. Quién es el responsable de tus datos',
      blocks: [
        p(
          'El responsable del tratamiento es [[RAZÓN SOCIAL Y NIT de la empresa que opera Fluvia: los socios y el abogado deben definirlo]], con domicilio en [[DIRECCIÓN Y CIUDAD]].',
        ),
        p(
          'Para cualquier tema de privacidad puedes escribirnos al correo [[CORREO DE PRIVACIDAD: por definir]] o por WhatsApp al [[NÚMERO DE WHATSAPP DE PRIVACIDAD: por definir]].',
        ),
      ],
    },
    {
      id: 'marco-legal',
      heading: '2. A quién aplica y qué normas seguimos',
      blocks: [
        p(
          'Esta política aplica a los emprendedores que contratan Fluvia («clientes») y a quienes visitan este sitio. Tratamos tus datos de acuerdo con la Ley 1581 de 2012, el Decreto 1074 de 2015 (que compila el Decreto 1377 de 2013) y las demás normas colombianas de protección de datos personales.',
        ),
        p(
          '[[ABOGADO: confirmar las normas aplicables y si Fluvia debe inscribir sus bases de datos en el Registro Nacional de Bases de Datos (RNBD) de la Superintendencia de Industria y Comercio]]',
        ),
      ],
    },
    {
      id: 'autorizacion',
      heading: '3. Tu autorización',
      blocks: [
        p(
          'Al contratar Fluvia, conectar tu página de Facebook y aceptar los permisos que te muestra Facebook, nos autorizas de manera previa, expresa e informada para tratar tus datos según esta política. Puedes revocar esa autorización cuando quieras (ver «Tus derechos»).',
        ),
        p(
          '[[ABOGADO: texto definitivo de la autorización, en qué momento exacto se recoge y cómo se guarda la prueba de que el titular la dio]]',
        ),
      ],
    },
    {
      id: 'datos',
      heading: '4. Qué datos recolectamos',
      blocks: [
        p('Los que tú nos das:'),
        ul(
          'Tu nombre y tu número de WhatsApp, y tu correo electrónico si nos lo das.',
          'El nombre y la categoría de tu negocio, y tu sitio web si tienes uno.',
          'Los logos, fotos, videos y textos que nos entregues para tus anuncios.',
          'Datos de verificación de identidad que recoja nuestro proveedor de pagos y verificación. [[ABOGADO: precisar qué datos son, si alguno es sensible y quién es responsable de ellos]]',
        ),
        p('Los que recibimos de Meta cuando conectas tu cuenta:'),
        ul(
          'El identificador de tu página de Facebook y el de tu cuenta de Instagram profesional. Leemos el nombre y el estado de tu página para validar la conexión, pero guardamos solo su identificador.',
          'Tu rol en la página, si la página está publicada y si tiene un número de WhatsApp vinculado.',
          'Los permisos que aceptaste.',
          'Un token de acceso que Meta nos entrega, junto con su fecha de vencimiento. Lo guardamos cifrado.',
          'El identificador de la cuenta publicitaria que creamos para ti.',
          'El rendimiento de tus anuncios: gasto, impresiones, clics y conversaciones iniciadas.',
        ),
        p('Los que generamos al operar el servicio:'),
        ul(
          'Un historial de acciones: qué decisión tomó nuestro sistema o una persona de nuestro equipo, y cuándo.',
          'Tareas internas de nuestro equipo relacionadas con tu cuenta.',
          'Registros de pagos y facturación (montos en pesos colombianos y su estado).',
        ),
        p('Lo que no hacemos:'),
        ul(
          'No te pedimos tu contraseña de Facebook ni de Instagram: la escribes solo en Facebook.',
          'No pedimos permisos para leer tus mensajes privados (Messenger, Instagram Direct o WhatsApp) ni las conversaciones de tu negocio con tus clientes.',
          'No accedemos a tu perfil personal, a tus amigos ni a tus publicaciones personales.',
        ),
        p(
          'Las conversaciones que tienes con nosotros por WhatsApp se procesan a través de nuestro proveedor Kapso.',
        ),
        p(
          '[[ABOGADO: confirmar que no se tratan datos sensibles ni de menores, y si la verificación de identidad cambia esa respuesta]]',
        ),
      ],
    },
    {
      id: 'finalidades',
      heading: '5. Para qué usamos tus datos',
      blocks: [
        ul(
          'Crear una cuenta publicitaria para ti dentro del portafolio de Fluvia y montar, publicar y optimizar tus campañas. Tu página y tu Instagram siguen siendo tuyos.',
          'Validar que tu conexión con Meta cumple lo necesario (por ejemplo, que eres administrador de la página).',
          'Cobrarte, facturarte y llevar nuestra contabilidad.',
          'Comunicarnos contigo por WhatsApp sobre tu campaña y tus resultados.',
          'Mostrarte reportes de rendimiento.',
          'Cumplir obligaciones legales y atender requerimientos de autoridades.',
          'Proteger el servicio y prevenir fraudes.',
          '[[ABOGADO: confirmar si se usarán datos agregados o anonimizados para mejorar el servicio o para estadísticas, y cómo se informa]]',
        ),
        p(
          'Usamos inteligencia artificial (Claude, de Anthropic) para proponer la estrategia y los textos de tus anuncios y para revisar que cumplan las políticas de Meta. Solo le enviamos la información de tu negocio necesaria para eso (por ejemplo, tu categoría, tu oferta y tus textos). No le enviamos tus tokens de acceso ni datos de pago. Una persona de nuestro equipo revisa el primer anuncio de cada cliente antes de que se publique.',
        ),
        p(
          '[[REVISAR cuando el módulo de IA esté construido: confirmar exactamente qué datos se envían al proveedor de IA]]',
        ),
      ],
    },
    {
      id: 'permisos-meta',
      heading: '6. Permisos que pedimos a Meta y para qué',
      blocks: [
        p(
          'Cuando conectas tu cuenta, Facebook te muestra los permisos que pedimos. Pedimos solo los necesarios:',
        ),
        table(
          ['Permiso', 'Para qué lo usamos'],
          PERMISSION_USES.map((use) => [
            use.permission,
            use.conditional ? `${use.purpose} Solo si eliges WhatsApp.` : use.purpose,
          ]),
        ),
        p(
          'Puedes retirar el acceso de Fluvia en cualquier momento desde la configuración de tu cuenta de Facebook. Si lo haces, dejamos de poder operar tus campañas. Más abajo explicamos cómo pedir que borremos tus datos.',
        ),
      ],
    },
    {
      id: 'terceros',
      heading: '7. Con quién compartimos tus datos',
      blocks: [
        p('Para prestarte el servicio usamos proveedores que tratan datos en nuestro nombre:'),
        ul(
          'Meta (Facebook e Instagram): para crear y operar tus anuncios.',
          'Cloudflare: alojamiento de nuestra aplicación, colas de procesamiento y almacenamiento de archivos.',
          'Neon: base de datos.',
          'Coloca: pagos y verificación.',
          'Kapso: mensajería por WhatsApp.',
          'Alegra: facturación.',
          'Anthropic: inteligencia artificial para estrategia y textos.',
        ),
        p(
          'No vendemos tus datos. Solo los compartimos con las autoridades cuando la ley nos lo exige.',
        ),
        p(
          'Algunos de estos proveedores están fuera de Colombia (por ejemplo, en Estados Unidos). [[ABOGADO: transmisión o transferencia internacional de datos (Ley 1581, art. 26): confirmar el fundamento, los contratos con cada proveedor y el listado final de encargados]]',
        ),
      ],
    },
    {
      id: 'seguridad',
      heading: '8. Cómo protegemos tus datos',
      blocks: [
        ul(
          'Las comunicaciones con nuestra aplicación van por HTTPS.',
          'Los tokens de acceso de Meta se cifran antes de guardarse.',
          'Solo usamos las herramientas oficiales de Meta para operar tus campañas.',
          'Registramos las acciones sobre tu cuenta para poder revisarlas.',
        ),
        p('[[ABOGADO: revisar si se requiere una descripción adicional de medidas de seguridad]]'),
      ],
    },
    {
      id: 'conservacion',
      heading: '9. Cuánto tiempo guardamos tus datos',
      blocks: [
        p(
          'Guardamos tus datos mientras seas cliente y durante el tiempo que la ley nos obligue a conservarlos. [[ABOGADO: definir los plazos: datos de contacto, tokens de acceso, rendimiento de campañas, historial de acciones, y facturas y soportes contables (obligación legal)]]',
        ),
        p(
          'Eliminamos tu token de acceso cuando [[CONDICIÓN Y PLAZO: hoy el borrado lo hace una persona de nuestro equipo; definir cuándo se borra automáticamente]].',
        ),
      ],
    },
    {
      id: 'derechos',
      heading: '10. Tus derechos',
      blocks: [
        p('Como titular de los datos, según la Ley 1581 de 2012, tienes derecho a:'),
        ul(
          'Conocer, actualizar y rectificar tus datos.',
          'Pedir prueba de la autorización que nos diste.',
          'Ser informado sobre el uso que damos a tus datos.',
          'Presentar quejas ante la Superintendencia de Industria y Comercio (SIC) por infracciones a la ley.',
          'Revocar la autorización y pedir que suprimamos tus datos.',
          'Acceder de forma gratuita a tus datos personales.',
        ),
        p(
          'Para ejercerlos, escríbenos por el canal de privacidad del punto 1. Para pedir que borremos tus datos, sigue las instrucciones de la página de eliminación de datos (/data-deletion).',
        ),
        p(
          'Respondemos las consultas y los reclamos dentro de los plazos de la ley. [[ABOGADO: confirmar y escribir los plazos (consultas 10 días hábiles prorrogables; reclamos 15 días hábiles prorrogables) y el procedimiento]]',
        ),
      ],
    },
    {
      id: 'sitio',
      heading: '11. Este sitio',
      blocks: [
        p(
          'Hoy este sitio no usa cookies de seguimiento ni herramientas de analítica. Si eso cambia, lo diremos aquí. [[REVISAR antes de publicar: confirmar que sigue siendo cierto]]',
        ),
        p(
          'Fluvia está dirigido a personas mayores de edad con un negocio. No tratamos de forma deliberada datos de menores.',
        ),
      ],
    },
    {
      id: 'cambios',
      heading: '12. Cambios a esta política',
      blocks: [
        p(
          'Si cambiamos esta política, publicaremos la nueva versión en esta página con su fecha de actualización. [[ABOGADO: definir cómo se avisa a los clientes los cambios importantes]]',
        ),
      ],
    },
  ],
};
