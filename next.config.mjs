/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@xenova/transformers'],
  },
  webpack: (config) => {
    config.resolve.alias['sharp$'] = false;
    config.resolve.alias['onnxruntime-node$'] = false;
    return config;
  },
};

export default nextConfig;
