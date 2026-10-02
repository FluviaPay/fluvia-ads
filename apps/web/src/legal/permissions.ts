/**
 * What each Meta permission is used for, in plain Spanish, for the privacy policy.
 * A test keeps this list equal to the permissions the code really asks for
 * (packages/meta REQUIRED_PERMISSIONS + the WhatsApp one), so the policy cannot drift.
 */
export type PermissionUse = {
  permission: string;
  purpose: string;
  /** Only asked when the client chooses WhatsApp as a destination. */
  conditional?: true;
};

export const PERMISSION_USES: PermissionUse[] = [
  {
    permission: 'ads_management',
    purpose:
      'Crear y administrar tus campañas, conjuntos de anuncios y anuncios en la cuenta publicitaria que Fluvia abre para ti.',
  },
  {
    permission: 'ads_read',
    purpose:
      'Leer el rendimiento de tus anuncios (gasto, alcance, clics y conversaciones) para mostrarte resultados.',
  },
  {
    permission: 'business_management',
    purpose:
      'Crear tu cuenta publicitaria dentro del portafolio de Fluvia y gestionar el acceso de Fluvia a tu página.',
  },
  {
    permission: 'pages_show_list',
    purpose:
      'Ver la lista de páginas que administras, para que elijas la de tu negocio y confirmar que eres administrador.',
  },
  {
    permission: 'pages_read_engagement',
    purpose:
      'Leer datos básicos de tu página (por ejemplo, si está publicada y qué cuenta de Instagram tiene vinculada) para validar la conexión.',
  },
  {
    permission: 'pages_manage_ads',
    purpose: 'Publicar anuncios pagados desde tu página de Facebook.',
  },
  {
    permission: 'instagram_basic',
    purpose:
      'Identificar la cuenta de Instagram profesional vinculada a tu página y verificar que es una cuenta profesional.',
  },
  {
    permission: 'whatsapp_business_management',
    purpose:
      'Comprobar que tu página tiene un número de WhatsApp Business vinculado, para que tus anuncios abran una conversación contigo.',
    conditional: true,
  },
];
