import type { NextConfig } from "next";

// cacheComponents desactivado a propósito: todas las páginas leen la sesión en cada petición (app de gestión interna).
const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  agentRules: false,
};

export default nextConfig;
