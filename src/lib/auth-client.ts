"use client";
// Cliente de Better Auth para el navegador: el ingreso pasa por /api/auth/sign-in/email
// para que se aplique el límite de intentos (5 por minuto) configurado en el servidor.
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
