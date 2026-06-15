/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hide the floating Next.js dev indicator (the little "N" badge).
  devIndicators: false,
  // Allow loading dev assets when you open the app via your LAN IP.
  allowedDevOrigins: ["192.168.1.2"],
};

export default nextConfig;
