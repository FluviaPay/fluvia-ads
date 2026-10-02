import { p, template, ul, type LegalDoc } from './types';

/**
 * DRAFT for the lawyer's review. This is the "data deletion instructions" page Meta asks
 * for. Deletion is handled by a person today (there is no automatic deletion yet), and
 * the page says so instead of promising more.
 */
export const dataDeletion: LegalDoc = {
  title: 'Solicitud de eliminación de datos',
  intro: [
    'Aquí te explicamos cómo pedir que borremos tus datos personales y cómo retirar el acceso de Fluvia a tu página de Facebook y a tu Instagram. No te cuesta nada.',
  ],
  sections: [
    {
      id: 'que-puedes-pedir',
      heading: '1. Qué puedes pedir',
      blocks: [
        ul(
          'Que eliminemos los datos personales tuyos y de tu negocio que tenemos.',
          'Que dejemos de tener acceso a tu página de Facebook y a tu cuenta de Instagram.',
        ),
        p(
          'Es tu derecho a revocar la autorización y a pedir la supresión de tus datos, según la Ley 1581 de 2012.',
        ),
      ],
    },
    {
      id: 'retirar-acceso',
      heading: '2. Primero, retira el acceso de Fluvia en Facebook (opcional)',
      blocks: [
        p(
          'Puedes quitar a Fluvia desde la configuración de tu cuenta de Facebook, en la sección donde aparecen las aplicaciones e integraciones conectadas a tu cuenta. Busca «Fluvia» y elige quitarla. [[REVISAR: confirmar el nombre y la ruta actual de ese menú en Facebook]]',
        ),
        p(
          'Esto corta el acceso de Fluvia a Meta de inmediato, pero no borra por sí solo los datos que ya tenemos guardados. Para eso, envía la solicitud del siguiente punto.',
        ),
      ],
    },
    {
      id: 'como-pedirlo',
      heading: '3. Cómo pedir que borremos tus datos',
      blocks: [
        p(
          'Escríbenos al correo [[CORREO DE PRIVACIDAD: por definir]] o por WhatsApp al [[NÚMERO DE WHATSAPP DE PRIVACIDAD: por definir]], con el asunto «Eliminación de datos», e incluye:',
        ),
        ul(
          'Tu nombre completo.',
          'El número de WhatsApp con el que contrataste Fluvia.',
          'El nombre de tu negocio y el de tu página de Facebook.',
          'Tu correo electrónico, si lo tienes.',
          'Una frase en la que confirmes que eres el titular de los datos o su representante.',
        ),
        p('Puedes copiar este mensaje y completarlo:'),
        template(
          'Asunto: Eliminación de datos\n\nHola. Quiero que eliminen mis datos personales y los de mi negocio.\n\nNombre completo: (escríbelo aquí)\nNúmero de WhatsApp con el que contraté: (escríbelo aquí)\nNombre de mi negocio: (escríbelo aquí)\nNombre de mi página de Facebook: (escríbelo aquí)\nCorreo electrónico (opcional): (escríbelo aquí)\n\nConfirmo que soy el titular de estos datos o su representante.',
        ),
        p(
          'Para protegerte, podemos pedirte que confirmes tu identidad antes de borrar nada. [[ABOGADO: definir cómo se verifica la identidad del solicitante sin pedir más datos de los necesarios]]',
        ),
      ],
    },
    {
      id: 'que-pasa-despues',
      heading: '4. Qué pasa después',
      blocks: [
        ul(
          'Te confirmamos que recibimos tu solicitud. [[PLAZO DE CONFIRMACIÓN: por definir]]',
          'Una persona de nuestro equipo la revisa y borra los datos. Hoy este proceso es manual.',
          'Te avisamos por escrito cuando termine.',
        ),
        p(
          'Respondemos dentro de los plazos de la ley. [[ABOGADO: confirmar y escribir los plazos (consultas 10 días hábiles prorrogables; reclamos 15 días hábiles prorrogables)]]',
        ),
      ],
    },
    {
      id: 'que-borramos',
      heading: '5. Qué borramos',
      blocks: [
        ul(
          'Tus datos de contacto y los de tu negocio.',
          'Los identificadores de tu página de Facebook, tu Instagram y tu cuenta publicitaria asociados a ti.',
          'El token de acceso que Meta nos entregó, y los permisos que aceptaste.',
          'Los archivos que nos enviaste (logos, fotos, videos y textos).',
          'Las tareas internas relacionadas con tu cuenta.',
        ),
        p(
          '[[ABOGADO Y EQUIPO: confirmar la lista final, incluyendo el rendimiento de campañas, y cómo se hace el borrado técnicamente]]',
        ),
      ],
    },
    {
      id: 'que-conservamos',
      heading: '6. Qué podemos conservar y por qué',
      blocks: [
        p(
          'Hay información que la ley nos obliga a conservar, por ejemplo facturas y soportes contables, y no podemos borrarla antes de que termine ese plazo. Si la conservamos, solo la usamos para cumplir esa obligación.',
        ),
        p(
          '[[ABOGADO: listar qué se conserva, por cuánto tiempo y con qué base legal, y si el historial de acciones se conserva con datos mínimos o anonimizado]]',
        ),
      ],
    },
    {
      id: 'datos-en-meta',
      heading: '7. Los datos que Meta tiene',
      blocks: [
        p(
          'Meta guarda sus propios datos sobre ti y tus anuncios según su política de privacidad (facebook.com/privacy/policy). Para pedirle a Meta que borre los suyos, hazlo directamente con Meta.',
        ),
      ],
    },
    {
      id: 'quejas',
      heading: '8. Si no estás de acuerdo con nuestra respuesta',
      blocks: [
        p(
          'Puedes presentar una queja ante la Superintendencia de Industria y Comercio (SIC), la autoridad de protección de datos en Colombia.',
        ),
        p('Consulta también nuestra política de privacidad (/privacy).'),
      ],
    },
  ],
};
