/**
 * HTTP status code constants
 *
 * @description Standardised HTTP status codes following RFC 7231.
 * Used throughout the server for consistent status code handling.
 *
 * @see https://tools.ietf.org/html/rfc7231#section-6
 */

/**
 * HTTP status codes enum
 */
export enum HttpStatus {
  // 2xx Success
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NO_CONTENT = 204,

  // 3xx Redirection
  MOVED_PERMANENTLY = 301,
  FOUND = 302,
  NOT_MODIFIED = 304,
  TEMPORARY_REDIRECT = 307,
  PERMANENT_REDIRECT = 308,

  // 4xx Client Errors
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  NOT_ACCEPTABLE = 406,
  REQUEST_TIMEOUT = 408,
  CONFLICT = 409,
  GONE = 410,
  PAYLOAD_TOO_LARGE = 413,
  UNSUPPORTED_MEDIA_TYPE = 415,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,

  // 5xx Server Errors
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
}

/**
 * Check if status code is informational (1xx)
 */
export const isInformational = (status: number): boolean => status >= 100 && status < 200;

/**
 * Check if status code is successful (2xx)
 */
export const isSuccessful = (status: number): boolean => status >= 200 && status < 300;

/**
 * Check if status code is redirection (3xx)
 */
export const isRedirection = (status: number): boolean => status >= 300 && status < 400;

/**
 * Check if status code is client error (4xx)
 */
export const isClientError = (status: number): boolean => status >= 400 && status < 500;

/**
 * Check if status code is server error (5xx)
 */
export const isServerError = (status: number): boolean => status >= 500 && status < 600;
