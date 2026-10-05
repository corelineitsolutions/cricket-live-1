/** Pinned so a token signed for another purpose or with another algorithm is rejected. */
export const ADMIN_JWT = {
  algorithm: 'HS256',
  issuer: 'cricket-live-api',
  audience: 'cricket-live-admin',
} as const;
