# Fica Tostadores — App de escritorio (Tauri v2)

Aplicación de escritorio para administración de Fica Tostadores, construida con [Tauri 2](https://tauri.app/) y frontend en TypeScript + Vite.

Reemplaza la versión anterior basada en Electron (`FIcaTostadoresAPP`).

## Requisitos

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (instalado vía `rustup`)
- En Windows: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) con el workload **Desktop development with C++**

## Configuración (.env)

Copia `.env.example` a `.env` y completa los valores (los de Firebase son los
mismos que usa la web; el secreto debe ser idéntico a
`COTIZACIONES_APP_SECRET` en el `.env` de FicaTostadoresWEB):

| Variable | Descripción |
|----------|-------------|
| `VITE_WEB_API_URL` | URL base de la web (`http://localhost:3000` en dev) |
| `VITE_FIREBASE_*` | Config pública de Firebase (6 variables) |
| `VITE_COTIZACIONES_APP_SECRET` | Secreto compartido para las rutas `/api/electron/*` |

## Comandos

```bash
# Instalar dependencias
npm install

# Desarrollo (frontend + ventana nativa)
npm run tauri:dev

# Compilar instalador
npm run tauri:build

# Regenerar iconos desde assets/icon.png
npm run tauri icon assets/icon.png
```

## Estructura

- `src/` — Frontend (HTML, CSS, TypeScript)
  - `src/lib/` — Config (.env), Firebase, cliente de API web, checks de conexión
  - `src/services/` — Heartbeat periódico y polling de solicitudes
  - `src/ui/` — Sidebar, vistas, Conexiones, Cotizaciones/Soporte en vivo
- `src-tauri/` — Backend Rust y configuración de Tauri
- `assets/` — Logo e icono de la marca

## Cómo se conecta con la web

La app **no usa login**; se autentica con el secreto compartido
(`Authorization: Bearer …`) contra las rutas `/api/electron/*` de
FicaTostadoresWEB, que leen Firestore con Admin SDK (las reglas de Firestore
exigen rol staff para las solicitudes):

- `POST /api/electron/heartbeat` — la app avisa cada 30 s que está en línea.
- `GET /api/electron/solicitudes?tipo=cotizaciones|soporte` — lectura de solicitudes.

Además, el SDK cliente de Firebase se usa para lecturas públicas (catálogo
`productos`), permitidas por las reglas sin autenticación.

## Secciones del panel

| Sección | Descripción |
|---------|-------------|
| **Cotizaciones** | Solicitudes de la web en vivo (polling cada 30 s) |
| **Órdenes de trabajo** | Producción y seguimiento *(placeholder)* |
| **Historial** | Cotizaciones y OT cerradas *(placeholder)* |
| **Clientes** | Directorio y reincidencia *(placeholder)* |
| **Productos** | Catálogo de tostadoras *(placeholder)* |
| **Reportes** | Métricas e ingresos *(placeholder)* |
| **Soporte técnico** | Tickets desde el sitio web en vivo |
| **Conexiones** | Estado del enlace app ↔ web, Firestore y heartbeat |

## Próximos pasos

Migrar gradualmente el resto de la lógica de `FIcaTostadoresAPP` (SQLite local,
PDFs, gestión de OT, etc.) hacia comandos Tauri en Rust o manteniendo parte del
frontend en TypeScript según convenga.
