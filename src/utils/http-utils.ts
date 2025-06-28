/**
 * HTTP utilities for API responses and error handling
 */

/**
 * Standard CORS headers for API responses
 */
export const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
} as const;

/**
 * Creates a standardized JSON response
 */
export function createJsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { 
    status, 
    headers: CORS_HEADERS 
  });
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(message: string, status = 500): Response {
  return createJsonResponse({ error: message }, status);
}

/**
 * Creates a response for CORS preflight requests
 */
export function createOptionsResponse(): Response {
  return new Response(null, { 
    status: 200, 
    headers: CORS_HEADERS 
  });
}

/**
 * Validates required query parameters
 */
export function validateRequiredParams(
  url: URL, 
  requiredParams: string[]
): { isValid: boolean; missing: string[] } {
  const missing = requiredParams.filter(param => !url.searchParams.get(param));
  return {
    isValid: missing.length === 0,
    missing
  };
}

/**
 * Safely gets a query parameter with a default value
 */
export function getQueryParam(url: URL, param: string, defaultValue = ''): string {
  return url.searchParams.get(param) || defaultValue;
}