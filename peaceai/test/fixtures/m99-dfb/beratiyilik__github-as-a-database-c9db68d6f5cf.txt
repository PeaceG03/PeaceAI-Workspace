import { Headers, HttpMethod } from './types';

export const isHead = (method: HttpMethod): boolean => method === 'HEAD';

export const hasBody = (statusCode: number, method?: HttpMethod): boolean => (statusCode !== 204 && statusCode !== 304) || (method && isHead(method));
export const isRedirection = (statusCode: number): boolean => statusCode >= 300 && statusCode < 400;
export const hasClientError = (statusCode: number): boolean => statusCode >= 400 && statusCode < 500;
export const hasServerError = (statusCode: number): boolean => statusCode >= 500 && statusCode < 600;
export const isInformational = (statusCode: number): boolean => statusCode >= 100 && statusCode < 200;
export const isSuccessful = (statusCode: number): boolean => statusCode >= 200 && statusCode < 300;
export const hasError = (statusCode: number): boolean => hasClientError(statusCode) || hasServerError(statusCode);

export const hasHeader = (headers: Headers, headerName: string): boolean => headers[headerName] !== undefined;

export const isTransferEncodingChunked = (headers: Headers): boolean =>
  hasHeader(headers, 'transfer-encoding') && headers['transfer-encoding'].includes('chunked');

export const isContentTypeJSON = (headers: Headers): boolean =>
  hasHeader(headers, 'content-type') && headers['content-type'].includes('application/json');
export const isContentTypeOctetStream = (headers: Headers): boolean =>
  hasHeader(headers, 'content-type') && headers['content-type'].includes('application/octet-stream');
export const isContentTypeXGzip = (headers: Headers): boolean =>
  hasHeader(headers, 'content-type') && headers['content-type'].includes('application/x-gzip');

export const isContentEncodingGzip = (headers: Headers): boolean =>
  hasHeader(headers, 'content-encoding') && headers['content-encoding'].includes('gzip');
export const isContentEncodingDeflate = (headers: Headers): boolean =>
  hasHeader(headers, 'content-encoding') && headers['content-encoding'].includes('deflate');
export const isContentEncodingBr = (headers: Headers): boolean =>
  hasHeader(headers, 'content-encoding') && headers['content-encoding'].includes('br');
