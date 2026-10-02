export type MetaRequest = {
  method: 'GET' | 'POST' | 'DELETE';
  /** Path after the version, e.g. `/me/accounts` or `/act_123/campaigns`. No query string. */
  path: string;
  query?: Record<string, string> | undefined;
  body?: unknown;
};

export type MetaResponse = {
  status: number;
  /** Header names are lowercase. */
  headers: Record<string, string>;
  body: unknown;
};

export type MetaTransport = (req: MetaRequest) => Promise<MetaResponse>;
