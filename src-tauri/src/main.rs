// FACET — asztali alkalmazás (Tauri)
//
// A Rust-réteg szándékosan vékony: megkeresi a gépen a Javát, a háttérben elindítja
// a FACET motort (facet-engine.jar), és az ablakban megnyitja a motor felületét.
// Kilépéskor a motort is leállítja.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Engine {
    child: Mutex<Option<Child>>,
}

/// A Java keresése: JAVA_HOME, macOS java_home, gyakori telepítési helyek, PATH.
/// Előnyben részesíti azt, amelyik mellett ott a javac is (JDK).
fn find_java() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "java.exe" } else { "java" };
    let javac = if cfg!(windows) { "javac.exe" } else { "javac" };
    let mut list: Vec<PathBuf> = Vec::new();

    if let Ok(home) = std::env::var("JAVA_HOME") {
        list.push(PathBuf::from(home).join("bin").join(exe));
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("/usr/libexec/java_home").args(["-v", "11+"]).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() {
                    list.push(PathBuf::from(p).join("bin").join("java"));
                }
            }
        }
        for p in [
            "/opt/homebrew/opt/openjdk/bin/java",
            "/opt/homebrew/opt/openjdk@21/bin/java",
            "/opt/homebrew/opt/openjdk@17/bin/java",
            "/usr/local/opt/openjdk/bin/java",
            "/usr/local/opt/openjdk@21/bin/java",
        ] {
            list.push(PathBuf::from(p));
        }
        if let Ok(rd) = std::fs::read_dir("/Library/Java/JavaVirtualMachines") {
            let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
            dirs.sort();
            dirs.reverse();
            for d in dirs {
                list.push(d.join("Contents").join("Home").join("bin").join("java"));
            }
        }
    }

    #[cfg(windows)]
    {
        for base in [
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\Java",
            r"C:\Program Files\Microsoft",
            r"C:\Program Files\Zulu",
            r"C:\Program Files\Amazon Corretto",
            r"C:\Program Files\BellSoft",
        ] {
            if let Ok(rd) = std::fs::read_dir(base) {
                let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
                dirs.sort();
                dirs.reverse();
                for d in dirs {
                    list.push(d.join("bin").join("java.exe"));
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(rd) = std::fs::read_dir("/usr/lib/jvm") {
            let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
            dirs.sort();
            dirs.reverse();
            for d in dirs {
                list.push(d.join("bin").join("java"));
            }
        }
    }

    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            list.push(dir.join(exe));
        }
    }

    // macOS-en a /usr/bin/java csak egy „telepítsd a Javát” ablakot nyit, ha nincs JDK — kihagyjuk.
    let usable = |p: &PathBuf| p.is_file() && !(cfg!(target_os = "macos") && p.as_path() == Path::new("/usr/bin/java"));
    if let Some(p) = list.iter().find(|p| usable(p) && p.parent().map(|d| d.join(javac).is_file()).unwrap_or(false)) {
        return Some(p.clone());
    }
    list.into_iter().find(|p| usable(p))
}

/// A motor és a felület helye az alkalmazás erőforrásai között.
fn locate(resources: &Path) -> Option<(PathBuf, PathBuf)> {
    for base in [resources.join("res"), resources.to_path_buf(), resources.join("_up_").join("res")] {
        let jar = base.join("engine").join("facet-engine.jar");
        let web = base.join("web");
        if jar.is_file() && web.join("index.html").is_file() {
            return Some((jar, web));
        }
    }
    None
}

fn start_engine(app: &tauri::AppHandle) -> Result<(Child, u16), String> {
    let res = app.path().resource_dir().map_err(|e| e.to_string())?;
    let (jar, web) = locate(&res).ok_or_else(|| "noresources".to_string())?;
    let java = find_java().ok_or_else(|| "nojava".to_string())?;

    let mut cmd = Command::new(&java);
    cmd.arg("-Dfile.encoding=UTF-8")
        .arg("-Dsun.stdout.encoding=UTF-8")
        .arg("-Dsun.jnu.encoding=UTF-8")
        .arg("-jar")
        .arg(&jar)
        .arg("--app")
        .arg("--port")
        .arg("0")
        .arg("--web")
        .arg(&web)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "nostdout".to_string())?;
    let (tx, rx) = mpsc::channel::<u16>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut sent = false;
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            if !sent {
                if let Some(p) = line.trim().strip_prefix("FACET_PORT=") {
                    if let Ok(n) = p.trim().parse::<u16>() {
                        let _ = tx.send(n);
                        sent = true;
                    }
                }
            }
            // a további kimenetet csak elolvassuk, hogy a cső ne teljen meg
        }
    });

    match rx.recv_timeout(Duration::from_secs(45)) {
        Ok(port) => Ok((child, port)),
        Err(_) => {
            let _ = child.kill();
            Err("timeout".to_string())
        }
    }
}

fn report(handle: &tauri::AppHandle, code: &str) {
    let script = format!("window.facetError && window.facetError({:?}, {:?})", code, std::env::consts::OS);
    // A betöltő oldal lehet, hogy még nem állt össze: többször is megpróbáljuk.
    for _ in 0..40 {
        if let Some(w) = handle.get_webview_window("main") {
            let _ = w.eval(&script);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Engine { child: Mutex::new(None) })
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("FACET")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 600.0)
                .center()
                .build()?;

            let handle = app.handle().clone();
            std::thread::spawn(move || match start_engine(&handle) {
                Ok((child, port)) => {
                    if let Ok(mut slot) = handle.state::<Engine>().child.lock() {
                        *slot = Some(child);
                    }
                    let url = format!("http://127.0.0.1:{port}/");
                    if let (Some(w), Ok(u)) = (handle.get_webview_window("main"), tauri::Url::parse(&url)) {
                        let _ = w.navigate(u);
                    }
                }
                Err(code) => report(&handle, &code),
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("A FACET nem tudott elindulni");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Ok(mut slot) = handle.state::<Engine>().child.lock() {
                if let Some(mut child) = slot.take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
