# Guía para ejecutar el ZIP actual en Windows (PostgreSQL local, sin servicios externos)

> **Estado (versión 0.1.0, 2026-10-07):** todos los pasos de esta guía se ejecutaron de verdad en Linux con Node 22.22.0 y PostgreSQL 16.15 (resultados en `docs/RESULTADOS-v0.1.md`). La aplicación web ya existe: inicio de sesión, cambio obligatorio de contraseña al primer ingreso, roles ADMINISTRADOR/VENDEDOR y cierre de sesión. En Windows no se probó; si algún paso falla, siga la sección 18 y envíeme el texto.

## Decisiones técnicas que usted debe conocer (no se necesita elegir nada, solo estar al tanto)
1. **`package.json` y `package-lock.json` ya fijan todas las versiones** (Next 16.4.0, Prisma 7.10.0, Better Auth 1.7.7, React 19.3.0, TypeScript 5.9.3). El paso 6 es solo `npm ci`.
2. **Python** se necesita únicamente para las 63 pruebas SQL (el script es Python) y para `check:schema`. Es la única herramienta extra.
3. La base se crea con codificación UTF-8 y ordenamiento "C" para evitar problemas de idioma de Windows. Solo afecta el orden alfabético de textos en desarrollo.

---
## 1. Versión de Node.js
**Node.js 22.22.0 (x64)**. Es la versión con la que se probó. El proyecto exige 22.18 o superior; no use Node 20 ni Node 18.

## 2. ¿Necesito PostgreSQL?
Sí. **PostgreSQL 16** (la 16 es la probada). Todo corre en su PC.

## 3. Instalar los requisitos
No instale nada más (ni Git, ni Docker, ni VS Code, ni Neon, ni Vercel).

**Node.js:** descargue `https://nodejs.org/dist/v22.22.0/node-v22.22.0-x64.msi`, ejecute, Siguiente en todo (deje marcado "Add to PATH"). No marque "Tools for native modules".

**PostgreSQL 16:** descargue el instalador de Windows desde `https://www.postgresql.org/download/windows/` (versión 16.x).
- Componentes: marque **PostgreSQL Server** y **Command Line Tools**. Puede desmarcar pgAdmin y Stack Builder.
- Contraseña del usuario `postgres`: use algo simple solo con letras y números, por ejemplo `PostgresDev2026` (evite símbolos).
- Puerto: `5432`. Idioma: el predeterminado.
- Agregue al PATH: Inicio → "Editar las variables de entorno del sistema" → Variables de entorno → Path (Usuario) → Nuevo → `C:\Program Files\PostgreSQL\16\bin`.

**Python 3.12 o superior:** `https://www.python.org/downloads/windows/`. En la primera pantalla marque **"Add python.exe to PATH"**.

Cierre y vuelva a abrir PowerShell, luego verifique (cada uno debe mostrar versión):
```
node -v          # v22.22.0
npm -v
psql --version   # psql (PostgreSQL) 16.x
python --version # Python 3.12 o superior
```
Si `psql` o `python` no se reconocen, vea la sección 18.

## 4. Preparar la carpeta y crear la base de datos
Descomprima el ZIP en `C:\estacion-repostera` (ruta corta, sin espacios). Abra **PowerShell** (no CMD) en esa carpeta: en el Explorador, entre a la carpeta, escriba `powershell` en la barra de direcciones y Enter.

Cada vez que abra una PowerShell nueva debe repetir las tres variables (sirven solo para esa ventana):
```
$env:PGPASSWORD = "PostgresDev2026"
$env:PGCLIENTENCODING = "UTF8"
$env:PYTHONUTF8 = "1"
```
Cree la base:
```
psql -U postgres -h localhost -c "CREATE DATABASE estacion_repostera_dev TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'"
psql -U postgres -h localhost -d estacion_repostera_dev -c "select version()"
```
Debe responder `CREATE DATABASE` y luego mostrar PostgreSQL 16.

## 5. Variables de entorno (archivo `.env`)
Genere el secreto y copie el resultado:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Cree el archivo (reemplace `PEGAR_SECRETO` por el texto generado). Este comando lo guarda en ASCII, sin los problemas de Notepad:
```
@"
DATABASE_URL="postgresql://app_user:AppDev2026@localhost:5432/estacion_repostera_dev"
DIRECT_URL="postgresql://postgres:PostgresDev2026@localhost:5432/estacion_repostera_dev"
BETTER_AUTH_SECRET="PEGAR_SECRETO"
BETTER_AUTH_URL="http://localhost:3000"
SEED_ADMIN_EMAIL="admin@example.com"
SEED_ADMIN_PASSWORD="AdminDev2026!"
SEED_DEMO="0"
"@ | Set-Content -Encoding ascii .env
```
(`app_user` aún no existe; se crea en el paso 9. `.env` nunca se sube a ningún lado.)

## 6. Instalar dependencias con npm
```
npm ci
npx prisma --version
```
Debe mostrar `prisma : 7.10.0`. Si npm da error 403 o de red, vea la sección 18.

## 12. Type-check con dependencias LOCALES (se hace aquí porque no depende de la base)
```
npm run typecheck:core
```
Resultado esperado: termina sin imprimir errores. Usa el `typescript` de `node_modules`.

## 7. `prisma validate`
```
npx prisma validate
```
Esperado: `The schema at prisma\schema.prisma is valid`. Si falla en `prisma.config.ts` (API de Prisma 7 distinta a la que escribí), **no lo arregle usted**: envíeme el mensaje completo.

## 8. Generar Prisma
```
npx prisma generate
```
Crea `src\generated\prisma`. Esa carpeta está ignorada a propósito.

## 9. Aplicar la migración real (ya incluida en el ZIP)
La migración `prisma\migrations\20261007010534_init` ya trae las tablas **y** las reglas SQL aprobadas (10_roles.sql + 20_reglas.sql anexadas una vez). No hay que crearla ni anexar nada:
```
npx prisma migrate deploy
npx prisma migrate status
```
Esperado: `All migrations have been successfully applied.` y `Database schema is up to date!`.

Ponga contraseña al rol de la aplicación (lo creó la migración):
```
psql -U postgres -h localhost -d estacion_repostera_dev -c "ALTER ROLE app_user LOGIN PASSWORD 'AppDev2026'"
```

## 10. Las 63 pruebas SQL sobre la migración real
**Hágalo ANTES del seed** (el seed inserta datos que chocan con los de las pruebas).
```
$env:PSQL_CMD = "psql -U postgres -h localhost -d estacion_repostera_dev -v ON_ERROR_STOP=1 -q -f -"
python tests/integration/sql/run.py
```
Esperado: cada prueba con ✓ y al final `63/63 correctas`. **Si alguna falla: deténgase y envíeme la salida completa.** No cambie schema ni reglas; yo se lo muestro antes de tocar nada. (No use `npm run test:sql-rules`: ese script llama a `python3`, que en Windows suele abrir la Microsoft Store.)

## 11. Las 110 pruebas de aplicación
```
npm run test:unit
```
Esperado al final: `# tests 110`, `# pass 110`, `# fail 0`. Estas corren contra datos en memoria, no contra PostgreSQL.

## 13. Seed
Agregue antes al `.env` el vendedor de prueba (dos líneas más, mismo método del paso 5 pero con `Add-Content`):
```
@"
SEED_SELLER_EMAIL="vendedor@example.com"
SEED_SELLER_PASSWORD="VendedorDev2026!"
"@ | Add-Content -Encoding ascii .env
npx prisma db seed
```
Esperado: `ADMINISTRADOR admin@example.com: creado.` y `VENDEDOR vendedor@example.com: creado.` Es repetible (la segunda vez dice `ya existe`). Opcional: `$env:SEED_DEMO="1"; npx prisma db seed` agrega 3 productos de ejemplo.

## 14. Iniciar el servidor
Modo desarrollo (recarga al editar):
```
npm run dev
```
Modo producción local (más rápido):
```
npm run build
npm start
```
Espere `Ready` en la ventana. Deje esa PowerShell abierta mientras usa la aplicación.

## 15. Dirección
Abra en el navegador: **http://localhost:3000** (lo envía a `/login`).
Desde un teléfono o tablet en la misma red Wi-Fi: `http://IP-DEL-PC:3000` (la IP aparece en la línea `Network:` al iniciar). Para que el ingreso funcione desde otro equipo, cambie `BETTER_AUTH_URL` en `.env` a esa dirección y reinicie.

## 16. Usuarios de prueba (solo desarrollo)
| Rol | Correo | Contraseña inicial |
|---|---|---|
| ADMINISTRADOR | admin@example.com | AdminDev2026! |
| VENDEDOR | vendedor@example.com | VendedorDev2026! |

Al primer ingreso cada uno debe elegir una contraseña nueva (mínimo 10 caracteres). El administrador ve 6 módulos; el vendedor solo Ventas y Productos. Tras 5 intentos fallidos en un minuto se bloquea el ingreso un minuto.

## 17. Detener
- Servidor: en la PowerShell donde corre `npm run dev` / `npm start`, presione `Ctrl + C` (si pregunta, `S`).
- Volver a iniciar otro día: abrir PowerShell en la carpeta y `npm run dev` (PostgreSQL arranca solo con Windows).
- PostgreSQL (si quiere apagarlo): `Win + R` → `services.msc` → "postgresql-x64-16" → Detener.

## 18. Si aparece un error
**Regla general:** no reintente con otros métodos, no instale otras versiones, no edite `schema.prisma` ni los `.sql`. Copie **todo el texto** de la ventana y envíemelo con el número de paso. Si puede, adjunte también:
```
node -v ; npm -v ; npx prisma --version
```
Casos frecuentes:
- **`npm` da 403 / ECONNRESET / certificado:** red o proxy de la empresa. Pruebe otra red (por ejemplo el celular como punto de acceso). No desactive la verificación SSL.
- **PowerShell dice "la ejecución de scripts está deshabilitada":** ejecute una vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y confirme con `S`.
- **`psql` no se reconoce:** falta agregar `C:\Program Files\PostgreSQL\16\bin` al PATH (paso 3); cierre y abra PowerShell.
- **`password authentication failed`:** la clave no coincide. Revise `$env:PGPASSWORD` (paso 4) y las claves del `.env`.
- **`P1001 Can't reach database server`:** PostgreSQL no está iniciado (`services.msc` → iniciar) o el puerto no es 5432.
- **`python` abre la Microsoft Store:** Inicio → "Administrar alias de ejecución de aplicaciones" → desactive los de python; o use `py` en lugar de `python`.
- **Caracteres raros o `UnicodeEncodeError`:** repita las tres variables del paso 4 en esa ventana.
- **`database ... already exists`:** ya la creó; siga.
- **Quiere repetir la migración desde cero (solo desarrollo):** avíseme antes; borra todos los datos locales.
