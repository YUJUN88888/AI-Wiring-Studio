#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;

use std::{fs, path::PathBuf};

fn create_desktop_launcher() {
    let Ok(executable) = std::env::current_exe() else { return; };
    let Some(desktop) = dirs::desktop_dir() else { return; };
    let path = desktop.join("AI Wiring Studio.url");
    let content = format!("[InternetShortcut]\r\nURL=file:///{}\r\nIconFile={}\r\nIconIndex=0\r\n", executable.to_string_lossy().replace('\\', "/"), executable.to_string_lossy());
    let _ = fs::write(path, content);
}

fn project_path(path: String) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("aiws")) { return Err("Project file must use the .aiws extension".into()); }
    Ok(path)
}

fn startup_project_path_from(arguments: impl IntoIterator<Item = String>) -> Option<String> {
    arguments.into_iter().skip(1).find(|argument| project_path(argument.clone()).is_ok())
}

#[tauri::command]
fn startup_project_path() -> Option<String> {
    startup_project_path_from(std::env::args())
}

#[tauri::command]
fn read_project(path: String) -> Result<String, String> {
    fs::read_to_string(project_path(path)?).map_err(|error| format!("Unable to read project: {error}"))
}

#[tauri::command]
fn write_project_atomic(path: String, contents: String) -> Result<(), String> {
    let path = project_path(path)?;
    let parent = path.parent().ok_or("Project path has no parent directory")?;
    let temp = parent.join(format!(".{}.tmp", path.file_name().and_then(|x| x.to_str()).unwrap_or("project.aiws")));
    fs::write(&temp, contents).map_err(|error| format!("Unable to write temporary project: {error}"))?;
    if path.exists() { let backup = path.with_extension("aiws.bak"); let _ = fs::copy(&path, backup); }
    fs::rename(&temp, &path).map_err(|error| { let _ = fs::remove_file(&temp); format!("Unable to finalize project save: {error}") })
}

#[tauri::command]
fn write_project_default(contents: String) -> Result<String, String> {
    let desktop = dirs::desktop_dir().ok_or("Windows desktop folder was not found")?;
    let path = desktop.join("AI Wiring Studio - autosave.aiws");
    let path_text = path.to_string_lossy().into_owned();
    write_project_atomic(path_text.clone(), contents)?;
    Ok(path_text)
}

fn main() {
    create_desktop_launcher();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_project,
            write_project_atomic,
            write_project_default,
            startup_project_path,
            ai::ai_api_key_status,
            ai::ai_set_api_key,
            ai::ai_clear_api_key,
            ai::ai_import_extract
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Wiring Studio");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writes_reads_and_rejects_non_project_extension() {
        let path = std::env::temp_dir().join(format!("aiws-test-{}.aiws", std::process::id()));
        write_project_atomic(path.to_string_lossy().into_owned(), "A".into()).unwrap();
        write_project_atomic(path.to_string_lossy().into_owned(), "B".into()).unwrap();
        assert_eq!(read_project(path.to_string_lossy().into_owned()).unwrap(), "B");
        assert_eq!(fs::read_to_string(path.with_extension("aiws.bak")).unwrap(), "A");
        assert!(!path.with_file_name(format!(".{}.tmp", path.file_name().unwrap().to_string_lossy())).exists());
        assert!(write_project_atomic(path.with_extension("txt").to_string_lossy().into_owned(), "x".into()).is_err());
        let _ = fs::remove_file(&path); let _ = fs::remove_file(path.with_extension("aiws.bak"));
    }

    #[test]
    fn returns_only_aiws_startup_argument() {
        assert_eq!(startup_project_path_from(["app.exe".into(), "C:\\work\\wiring.aiws".into()]), Some("C:\\work\\wiring.aiws".into()));
        assert_eq!(startup_project_path_from(["app.exe".into(), "C:\\work\\wiring.AIWS".into()]), Some("C:\\work\\wiring.AIWS".into()));
        assert_eq!(startup_project_path_from(["app.exe".into(), "C:\\work\\notes.txt".into()]), None);
    }
}
