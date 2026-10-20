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

/// A Java fő verziója (8, 11, 17, 21…): először a JDK `release` fájljából, ha nincs, `java -version`-nel.
fn java_major(java: &Path) -> Option<u32> {
    let parse = |v: &str| -> Option<u32> {
        let v = v.trim().trim_matches('"');
        let mut it = v.split(|c: char| c == '.' || c == '_' || c == '-' || c == '+');
        let first: u32 = it.next()?.parse().ok()?;
        if first == 1 { it.next()?.parse().ok() } else { Some(first) }
    };
    if let Some(home) = java.parent().and_then(|b| b.parent()) {
        if let Ok(txt) = std::fs::read_to_string(home.join("release")) {
            for line in txt.lines() {
                if let Some(v) = line.strip_prefix("JAVA_VERSION=") {
                    if let Some(n) = parse(v) {
                        return Some(n);
                    }
                }
            }
        }
    }
    let mut cmd = Command::new(java);
    cmd.arg("-version").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    let txt = String::from_utf8_lossy(&out.stderr).to_string();
    let start = txt.find('"')? + 1;
    let end = start + txt[start..].find('"')?;
    parse(&txt[start..end])
}

/// Egy mappán belüli JDK-k (pl. C:\Program Files\Java\jdk-21), a legújabb elöl.
fn jdks_in(base: &Path, list: &mut Vec<PathBuf>, exe: &str) {
    if let Ok(rd) = std::fs::read_dir(base) {
        let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        dirs.reverse();
        for d in dirs {
            list.push(d.join("bin").join(exe));
            list.push(d.join("Contents").join("Home").join("bin").join(exe));
        }
    }
}

/// A Java keresése: JAVA_HOME, macOS java_home, gyakori telepítési helyek (IntelliJ ~/.jdks is), PATH.
/// Csak 11-es vagy újabb Java jó; azon belül előnyben a JDK (amelyik mellett ott a javac).
/// Hiba: "nojava" (egyáltalán nincs) vagy "oldjava:<verzió>" (csak régi van).
fn find_java() -> Result<PathBuf, String> {
    let exe = if cfg!(windows) { "java.exe" } else { "java" };
    let javac = if cfg!(windows) { "javac.exe" } else { "javac" };
    let mut list: Vec<PathBuf> = Vec::new();

    if let Ok(home) = std::env::var("JAVA_HOME") {
        list.push(PathBuf::from(home.trim_matches('"')).join("bin").join(exe));
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
        jdks_in(Path::new("/Library/Java/JavaVirtualMachines"), &mut list, exe);
        if let Some(h) = std::env::var_os("HOME") {
            jdks_in(&PathBuf::from(h).join("Library/Java/JavaVirtualMachines"), &mut list, exe);
        }
    }

    #[cfg(windows)]
    {
        let mut bases: Vec<PathBuf> = Vec::new();
        for pf in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(p) = std::env::var_os(pf) {
                let p = PathBuf::from(p);
                for v in ["Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Amazon Corretto", "BellSoft", "Semeru", "OpenJDK", "RedHat"] {
                    bases.push(p.join(v));
                }
            }
        }
        for b in bases {
            jdks_in(&b, &mut list, exe);
        }
    }

    #[cfg(target_os = "linux")]
    {
        jdks_in(Path::new("/usr/lib/jvm"), &mut list, exe);
    }

    // Az IntelliJ által letöltött JDK-k (pl. a Nix-es gépeken gyakori).
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    if let Some(h) = home {
        jdks_in(&PathBuf::from(h).join(".jdks"), &mut list, exe);
    }

    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            list.push(dir.join(exe));
        }
    }

    // macOS-en a /usr/bin/java csak egy „telepítsd a Javát” ablakot nyit, ha nincs JDK — kihagyjuk.
    let mut seen = std::collections::HashSet::new();
    let found: Vec<PathBuf> = list
        .into_iter()
        .filter(|p| p.is_file() && !(cfg!(target_os = "macos") && p.as_path() == Path::new("/usr/bin/java")))
        .filter(|p| seen.insert(p.clone()))
        .collect();
    if found.is_empty() {
        return Err("nojava".into());
    }

    let mut oldest: Option<u32> = None;
    let mut good_jre: Option<PathBuf> = None;
    for p in &found {
        match java_major(p) {
            Some(v) if v >= 11 => {
                if p.parent().map(|d| d.join(javac).is_file()).unwrap_or(false) {
                    return Ok(p.clone());
                }
                if good_jre.is_none() {
                    good_jre = Some(p.clone());
                }
            }
            Some(v) => oldest = Some(oldest.map_or(v, |o| o.max(v))),
            None => {}
        }
    }
    if let Some(p) = good_jre {
        return Ok(p);
    }
    match oldest {
        Some(v) => Err(format!("oldjava:{v}")),
        // Nem sikerült a verziót kiolvasni: megpróbáljuk az elsővel.
        None => Ok(found[0].clone()),
    }
}

/// Windowson a „\\?\” előtagot a Java nem érti — levágjuk.
fn plain(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
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

/// A motor naplója (stderr): a hibaüzenetben megmutatjuk, hol van.
fn log_path() -> PathBuf {
    std::env::temp_dir().join("facet-engine.log")
}

fn start_engine(app: &tauri::AppHandle) -> Result<(Child, u16), (String, String)> {
    let res = app.path().resource_dir().map_err(|e| ("noresources".to_string(), e.to_string()))?;
    let res = plain(&res);
    let (jar, web) = locate(&res).ok_or_else(|| ("noresources".to_string(), res.display().to_string()))?;
    let java = find_java().map_err(|c| (c, String::new()))?;

    let mut cmd = Command::new(&java);
    cmd.arg("-Dfile.encoding=UTF-8")
        .arg("-Dsun.stdout.encoding=UTF-8")
        .arg("-Dsun.stderr.encoding=UTF-8");
    // macOS/Linux: a Finderből indított alkalmazásnál a fájlnevek kódolása ASCII lehet.
    // Windowson nem kell (ott a Java UTF-16-ot használ). A JVM-kapcsolóknak a -jar ELŐTT kell lenniük.
    #[cfg(not(windows))]
    cmd.arg("-Dsun.jnu.encoding=UTF-8");
    cmd.arg("-jar")
        .arg(&jar)
        .arg("--app")
        .arg("--port")
        .arg("0")
        .arg("--web")
        .arg(&web)
        .env_remove("JAVA_TOOL_OPTIONS")
        .env_remove("_JAVA_OPTIONS")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }


    let mut child = cmd
        .spawn()
        .map_err(|e| ("spawn".to_string(), format!("{}\n{e}", java.display())))?;
    let stdout = child.stdout.take().ok_or_else(|| ("nostdout".to_string(), String::new()))?;
    let stderr = child.stderr.take();

    // stderr: naplófájlba és egy pufferbe (a hibaüzenethez).
    let errbuf = std::sync::Arc::new(Mutex::new(String::new()));
    if let Some(se) = stderr {
        let buf = errbuf.clone();
        let header = format!("FACET {} — java: {}\n", env!("CARGO_PKG_VERSION"), java.display());
        std::thread::spawn(move || {
            use std::io::Write;
            let mut log = std::fs::File::create(log_path()).ok();
            if let Some(f) = log.as_mut() {
                let _ = f.write_all(header.as_bytes());
            }
            for line in BufReader::new(se).lines().map_while(Result::ok) {
                if let Some(f) = log.as_mut() {
                    let _ = writeln!(f, "{line}");
                }
                if let Ok(mut b) = buf.lock() {
                    if b.len() < 64_000 {
                        b.push_str(&line);
                        b.push('\n');
                    }
                }
            }
        });
    }

    let (tx, rx) = mpsc::channel::<Option<u16>>();
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
                        let _ = tx.send(Some(n));
                        sent = true;
                    }
                }
            }
            // a további kimenetet csak elolvassuk, hogy a cső ne teljen meg
        }
        if !sent {
            // A motor kilépett, mielőtt elindult volna.
            let _ = tx.send(None);
        }
    });

    let detail = |buf: &std::sync::Arc<Mutex<String>>| -> String {
        std::thread::sleep(Duration::from_millis(300));
        let b = buf.lock().map(|b| b.clone()).unwrap_or_default();
        let tail: String = b.chars().rev().take(1500).collect::<Vec<_>>().into_iter().rev().collect();
        format!("Java: {}\n\n{}", java.display(), tail.trim())
    };

    match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(Some(port)) => Ok((child, port)),
        Ok(None) | Err(mpsc::RecvTimeoutError::Disconnected) => {
            let _ = child.wait();
            let d = detail(&errbuf);
            let code = if d.contains("UnsupportedClassVersionError") { "oldjava:?" } else { "crash" };
            Err((code.to_string(), d))
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            Err(("timeout".to_string(), detail(&errbuf)))
        }
    }
}

/// Biztonságos JavaScript-szöveg (JSON-szerű idézés).
fn js_str(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => {}
            '\t' => o.push_str("\\t"),
            '<' => o.push_str("\\u003c"),
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn report(handle: &tauri::AppHandle, code: &str, detail: &str) {
    let log = log_path().display().to_string();
    let script = format!(
        "window.facetError && window.facetError({}, {}, {}, {})",
        js_str(code),
        js_str(std::env::consts::OS),
        js_str(detail),
        js_str(&log)
    );
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
                // A fájlok behúzását a felület kezeli (HTML5): így a fájlfán belüli húzás is működik.
                .disable_drag_drop_handler()
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
                Err((code, detail)) => report(&handle, &code, &detail),
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
