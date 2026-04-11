/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker deployment support
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  devIndicators: {
    buildActivity: false,
    appIsrStatus: false,
  },
}

export default nextConfig
