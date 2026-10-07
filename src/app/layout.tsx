import type { Metadata, Viewport } from "next";
import "@fontsource-variable/figtree";
import "@fontsource/fredoka/latin-500.css";
import "@fontsource/fredoka/latin-600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Estación Repostera",
  description: "Gestión de ventas, inventario y compras",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#32275e" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  );
}
