import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The reel card renderer reads these fonts from disk at runtime
  outputFileTracingIncludes: {
    "/api/director/card": ["./src/assets/fonts/**"],
  },
};

export default nextConfig;
