/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Renderer is multi-tenant by Host, so dev is always served from a real
  // hostname — never `localhost`. Next 16 blocks /_next/* dev resources from
  // non-localhost origins, which kills the HMR socket the dev RSC stream rides
  // on: hydration then stalls forever and every client component stays inert.
  allowedDevOrigins: ["127.0.0.1", "**.my.id", "**.test"],
};
export default nextConfig;
