/**
 * @fileoverview The static authorization header method of RevenueCat webhook verification: the
 * value the dashboard sends with each POST is compared, in constant time, against each value the
 * host configured. The comparison is exact: a different case, a prefix or a suffix is a refusal.
 * @layer revenuecat
 */
import type { Secret } from '@bymax-one/nest-subscription/internal'

/** The name of the header RevenueCat sends the configured value in. */
export const AUTHORIZATION_HEADER = 'authorization'

/**
 * The value of a header, whatever case its name was received in; `undefined` when it was not sent.
 * Header names are case-insensitive, and frameworks differ in how they hand them over.
 *
 * @param headers The request headers.
 * @param name The lower-case header name.
 */
export function headerValue(
  headers: Readonly<Record<string, string | undefined>>,
  name: string
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return undefined
}

/**
 * Whether the request carries one of the configured authorization values. Every configured value
 * is compared, whether or not an earlier one matched, so the time taken does not tell which one
 * was right, and the comparison is `timingSafeEqual` over equal-length digests.
 *
 * @param secret The configured value, or the pair of a rotation.
 * @param headers The request headers.
 */
export function verifyAuthorization(
  secret: Secret,
  headers: Readonly<Record<string, string | undefined>>
): boolean {
  const presented = headerValue(headers, AUTHORIZATION_HEADER)
  return presented !== undefined && secret.matches(presented)
}
