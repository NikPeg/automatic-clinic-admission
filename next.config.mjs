/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hide the floating Next.js dev indicator (the little "N" badge).
  devIndicators: false,
  // Allow loading dev assets when you open the app via your LAN IP.
  allowedDevOrigins: ["192.168.1.2"],
  // Serve under a sub-path in production (e.g. nikpeg.me/clinic-intake).
  // Empty locally → app stays at the root for `npm run dev`.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
};

export default nextConfig;
