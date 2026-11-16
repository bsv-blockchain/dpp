// An error a route answers with a status and a code. It lives in a module of
// its own so that a group of routes can use it without importing the server,
// and through the server everything the server imports.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
    /** Further members of the answer, beside `error` and `description`. */
    readonly data: Record<string, unknown> = {}
  ) {
    super(detail)
  }
}
