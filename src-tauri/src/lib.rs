use rusqlite::{params, Connection};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

const DB_FILE: &str = "fica-store.db";
const KEYRING_SERVICE: &str = "com.fica.tostadores";
const KEYRING_SECRET: &str = "api_secret";

/// Store durable local (SQLite con WAL). Sobrevive a cierres forzosos.
struct Store(Mutex<Connection>);

/// Marca si el cierre de ventana debe permitirse (true = salir de verdad).
struct QuitState(AtomicBool);

fn unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join(DB_FILE)).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS kv (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn db_kv_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM kv WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map(params![key], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    match rows.next().transpose().map_err(|e| e.to_string())? {
        Some(value) => Ok(Some(value)),
        None => Ok(None),
    }
}

fn db_kv_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, unix_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn db_kv_remove(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let old = db_kv_get(conn, key)?;
    conn.execute("DELETE FROM kv WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(old)
}

fn db_kv_list(conn: &Connection, prefix: &str) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM kv WHERE key LIKE ?1 ORDER BY updated_at ASC")
        .map_err(|e| e.to_string())?;
    let pattern = format!("{}%", prefix);
    let rows = stmt
        .query_map(params![pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn db_instance_id(conn: &Connection) -> Result<String, String> {
    if let Some(id) = db_kv_get(conn, "instance_id")? {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    db_kv_set(conn, "instance_id", &id)?;
    Ok(id)
}

fn mark_clean_exit_db(conn: &Connection) -> Result<(), String> {
    db_kv_set(conn, "shutdown_clean", "1")
}

fn mark_clean_exit_handle(app: &AppHandle) {
    if let Some(store) = app.try_state::<Store>() {
        if let Ok(conn) = store.0.lock() {
            let _ = mark_clean_exit_db(&conn);
        }
    }
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_SECRET).map_err(|e| e.to_string())
}

fn keyring_secret() -> Option<String> {
    keyring_entry().ok()?.get_password().ok()
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hola, {name}. La app Tauri de Fica Tostadores está lista.")
}

#[tauri::command]
fn kv_get(state: State<'_, Store>, key: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db_kv_get(&conn, &key)
}

#[tauri::command]
fn kv_set(state: State<'_, Store>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db_kv_set(&conn, &key, &value)
}

#[tauri::command]
fn kv_remove(state: State<'_, Store>, key: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db_kv_remove(&conn, &key)
}

#[tauri::command]
fn kv_list(state: State<'_, Store>, prefix: String) -> Result<Vec<(String, String)>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db_kv_list(&conn, &prefix)
}

#[tauri::command]
fn get_instance_id(state: State<'_, Store>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db_instance_id(&conn)
}

#[tauri::command]
fn get_app_secret() -> Result<String, String> {
    Ok(keyring_secret().unwrap_or_default())
}

#[tauri::command]
fn set_app_secret(secret: String) -> Result<(), String> {
    let entry = keyring_entry()?;
    entry.set_password(&secret).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_app_secret() -> Result<(), String> {
    let entry = keyring_entry()?;
    let _ = entry.delete_credential();
    Ok(())
}

#[tauri::command]
fn mark_clean_exit(state: State<'_, Store>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    mark_clean_exit_db(&conn)
}

/// Información de salud al arrancar: detecta cierres forzosos y prepara
/// el id de instancia estable (fuente de verdad = SQLite, no localStorage).
#[tauri::command]
fn startup_health(state: State<'_, Store>) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let clean = db_kv_get(&conn, "shutdown_clean")?;
    let was_clean = clean.map(|v| v == "1").unwrap_or(true);
    db_kv_set(&conn, "shutdown_clean", "0")?;
    let instance = db_instance_id(&conn)?;
    let secret_available = keyring_secret().is_some();
    Ok(json!({
        "wasCleanExit": was_clean,
        "instanceId": instance,
        "secretInKeyring": secret_available
    }))
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())
    } else {
        autolaunch.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Mostrar / Ocultar ventana", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sincronizar ahora", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &sync, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => {
                app.state::<QuitState>().0.store(true, Ordering::SeqCst);
                mark_clean_exit_handle(app);
                app.exit(0);
            }
            "sync" => {
                let _ = app.emit("sync-now", ());
            }
            "toggle" => toggle_window(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let conn = open_db(app.handle())
                .map_err(|e| tauri::Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
            app.manage(Store(Mutex::new(conn)));
            app.manage(QuitState(AtomicBool::new(false)));
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let quit = window.state::<QuitState>().0.load(Ordering::SeqCst);
                if !quit {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            kv_get,
            kv_set,
            kv_remove,
            kv_list,
            get_instance_id,
            get_app_secret,
            set_app_secret,
            clear_app_secret,
            mark_clean_exit,
            startup_health,
            set_autostart,
            get_autostart
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                mark_clean_exit_handle(app);
            }
        });
}
