import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ZodError } from 'zod';

export type ApiEvent = APIGatewayProxyEventV2WithJWTAuthorizer;
export type ApiResult = APIGatewayProxyStructuredResultV2;
export type Handler = (event: ApiEvent) => Promise<ApiResult>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (statusCode: number, body: unknown): ApiResult => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/** The Cognito user id from the API Gateway JWT authorizer. Routes that need it are protected. */
export function playerId(event: ApiEvent): string {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== 'string' || !sub) throw new HttpError(401, 'Sign in required');
  return sub;
}

/** A public name for leaderboards. Never the email address. */
export function displayName(event: ApiEvent): string {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const name = claims.preferred_username ?? claims.given_name;
  return typeof name === 'string' && name.trim()
    ? name.trim().slice(0, 24)
    : `Architect-${playerId(event).slice(0, 6)}`;
}

const MAX_BODY_BYTES = 64 * 1024;

export function body(event: ApiEvent): unknown {
  if (!event.body) throw new HttpError(400, 'Missing request body');
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

/** Routes by API Gateway route key and turns thrown errors into JSON responses. */
export function router(routes: Record<string, Handler>): Handler {
  return async (event) => {
    const route = routes[event.routeKey];
    if (!route) return json(404, { error: 'Not found' });
    try {
      return await route(event);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      if (err instanceof ZodError)
        return json(400, { error: 'Invalid request', issues: err.issues.slice(0, 5) });
      console.error(
        JSON.stringify({ level: 'error', route: event.routeKey, message: (err as Error).message }),
      );
      return json(500, { error: 'Internal error' });
    }
  };
}
