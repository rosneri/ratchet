/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@ratchet/core'],
  experimental: { externalDir: true },
  serverExternalPackages: ['ts-morph'],
}
