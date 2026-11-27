/** An opaque storage ID for a sealed file: 16 random bytes, base64url. It says nothing about what it holds. */
export const newOpaqueId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
