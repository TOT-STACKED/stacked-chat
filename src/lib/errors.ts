/** Throw these from services/routes; the app error handler turns them into the standard envelope. */
export class ApiHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export const unauthorized = (m = 'Authentication required') => new ApiHttpError(401, 'unauthorized', m);
export const forbidden = (m = 'You do not have permission to do that') => new ApiHttpError(403, 'forbidden', m);
export const notFound = (m = 'Not found') => new ApiHttpError(404, 'not_found', m);
export const conflict = (m: string) => new ApiHttpError(409, 'conflict', m);
export const badRequest = (m: string, details?: unknown) => new ApiHttpError(400, 'bad_request', m, details);
