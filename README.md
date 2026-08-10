# Fica Tostadores — App de escritorio (Tauri v2)

Aplicación de escritorio para administración de Fica Tostadores, construida con [Tauri 2](https://tauri.app/) y frontend en TypeScript + Vite.

Reemplaza la versión anterior basada en Electron (`FIcaTostadoresAPP`).

## Requisitos

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (instalado vía `rustup`)
- En Windows: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) con el workload **Desktop development with C++**

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

## Sistema de seguridad (resiliencia y hardening)

La app incluye un sistema de seguridad/resiliencia distribuido en Rust y TS:

- **Store durable local** (`src-tauri/src/lib.rs`): SQLite (WAL) en `appDataDir`
  con comandos `kv_get/kv_set/kv_remove/kv_list`. Sobrevive a cierres forzosos.
- **Cola offline durable** (`src/lib/offline-queue.ts`): cambios de estado de
  solicitudes/OT, creación/edición/eliminación de productos y de cotizaciones se
  guardan en el store cuando no hay red y se reenvían en orden al reconectar.
- **Máquina de conectividad** (`src/lib/network.ts`): estados `online` /
  `degraded` / `offline`, backoff exponencial y reintento inmediato al volver la
  red (eventos `online/offline` + sonda real a la API).
- **Autosave de borradores** (`src/lib/drafts.ts` + `nueva-cotizacion.ts`): las
  cotizaciones en curso se guardan localmente y se ofrecen para reanudar.
- **Persistencia offline de Firestore** (`src/lib/firebase.ts`): el catálogo
  funciona sin internet.
- **Cierre controlado**: cerrar la ventana la oculta en la bandeja (no detiene
  el heartbeat); "Salir" marca un cierre limpio. `startup_health` detecta
  cierres forzosos y avisa al arrancar. Instancia única y autostart opcional.
- **Hardening**: CSP definida en `tauri.conf.json`, `withGlobalTauri: false`,
  e ID de instancia + secreto compartido leídos desde Rust. El secreto puede
  configurarse en el llavero del sistema (Windows Credential Manager) con el
  comando `set_app_secret` (no queda embebido en el instalador).
- **Notificaciones de escritorio** (`src/services/notifications.ts`): avisan
  al llegar una cotización o solicitud de soporte nueva (API de Notification
  del sistema, con fallback a toast). La primera ejecución establece la línea
  base; después notifica lo nuevo desde la última vez que se vio.

