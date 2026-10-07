// Endpoints HTTP de Better Auth (/api/auth/*). El registro público está deshabilitado en src/core/auth/auth.ts.
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/core/auth/auth";

export const { GET, POST } = toNextJsHandler(auth);
