import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
