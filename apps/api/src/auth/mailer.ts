import { log } from '../logger';

export type Mailer = {
  sendLoginCode(input: { to: string; code: string; minutes: number }): Promise<void>;
};

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
  }
}

/** Sends through Resend's HTTP API (plain fetch, no SDK). The body never reaches the logs. */
export function resendMailer(options: {
  apiKey: string;
  from: string;
  fetchFn?: typeof fetch;
}): Mailer {
  const fetchFn = options.fetchFn ?? fetch;
  return {
    async sendLoginCode({ to, code, minutes }) {
      const response = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from,
          to: [to],
          subject: `Tu código de acceso a Fluvia Ads: ${code}`,
          text:
            `Tu código de acceso es ${code}.\n\n` +
            `Vence en ${minutes} minutos y solo sirve una vez. ` +
            'Si no lo pediste, ignora este mensaje y no lo compartas con nadie: ' +
            'el equipo de Fluvia nunca te lo pedirá.',
        }),
      });
      if (!response.ok) throw new MailError(`Email provider answered ${response.status}`);
    },
  };
}

/** Development only: prints the code instead of sending it. Never used outside development. */
export const consoleMailer: Mailer = {
  async sendLoginCode({ to, code }) {
    log('info', 'dev_login_code', { to, code });
  },
};
