/** 128 random bits as 22 base64url characters. Unguessable, URL-safe. */
export function randomId(bytes = 16): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
