// Throw HttpError anywhere in a route; the error middleware in app.ts renders
// { error: { code, message } } with the given status. Express 5 forwards async throws.
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Only Rohit can do that.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'That item no longer exists.') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const unprocessable = (code: string, message: string) => new HttpError(422, code, message);
