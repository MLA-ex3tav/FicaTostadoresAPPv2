#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hola, {name}. La app Tauri de Fica Tostadores está lista.")
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
