import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Accept the names Vercel's Supabase integration uses as well as our own
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "",
  },
  // Course photos (free-licence, credited) are fetched and resized by the image service
  images: {
    remotePatterns: [new URL("https://s0.geograph.org.uk/**")],
    qualities: [75],
  },
  // The reel card renderer reads these fonts from disk at runtime
  outputFileTracingIncludes: {
    "/api/director/card": ["./src/assets/fonts/**"],
  },
};

export default nextConfig;
