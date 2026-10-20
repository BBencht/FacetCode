/*
 * FACET — helyi motor
 * Kiszolgálja a szerkesztő felületét, kezeli a projektfájlokat,
 * lefordítja és interaktívan futtatja a Java programokat.
 *
 * Indítás (JDK 11+):   java Facet.java [munkaterület] [port]
 * Alapértelmezés:      ~/FacetProjects, 7777-es port
 */
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.io.StringWriter;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class Facet {

    static final String VERSION = "1.2.2";
    /** A megnyitott mappa (null, ha még nincs). */
    static volatile Path WS;
    /** A FACET saját adatai a megnyitott mappához (Időgép, fordítás, kuka) — nem a projektbe kerülnek. */
    static volatile Path META;
    static Path HOME;
    static Path WEB;
    static final boolean WIN = System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("win");
    static final boolean MAC = System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("mac");
    /** A külső programok (git, node, npm) környezete, a felhasználó teljes PATH-jával. */
    static volatile Map<String, String> ENV = new HashMap<>(System.getenv());
    static final java.util.concurrent.CountDownLatch ENV_READY = new java.util.concurrent.CountDownLatch(1);
    static volatile String GIT_VER = null, NODE_VER = null, NPM_VER = null, PY_VER = null;
    static volatile List<String> PY_CMD = null;
    static final Map<String, Proc> PROCS = new ConcurrentHashMap<>();
    static final Set<String> SKIP = Set.of(".facet", ".git", "node_modules", ".idea", ".vscode", "out", "target", ".DS_Store", "__pycache__", ".venv", "venv", ".pytest_cache", ".mypy_cache");
    static final Pattern MAIN = Pattern.compile("static\\s+(public\\s+)?void\\s+main\\s*\\(|public\\s+static\\s+void\\s+main\\s*\\(");
    static final Pattern PKG = Pattern.compile("^\\s*package\\s+([\\w.]+)\\s*;", Pattern.MULTILINE);

    public static void main(String[] args) throws Exception {
        System.setOut(new java.io.PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out), true, StandardCharsets.UTF_8));
        boolean open = true, app = false;
        List<String> pos = new ArrayList<>();
        Integer portArg = null;
        String webArg = null;
        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if (a.equals("--no-open")) open = false;
            else if (a.equals("--app")) { app = true; open = false; }
            else if (a.equals("--port") && i + 1 < args.length) portArg = Integer.parseInt(args[++i]);
            else if (a.equals("--web") && i + 1 < args.length) webArg = args[++i];
            else if (a.matches("\\d{2,5}")) portArg = Integer.parseInt(a);
            else if (a.startsWith("-")) System.err.println("Ismeretlen kapcsoló, kihagyom: " + a);
            else pos.add(a);
        }
        HOME = Paths.get(System.getProperty("user.home")).toAbsolutePath().normalize();
        WEB = findWeb(webArg);
        // A teljes PATH felderítése (login shell) a háttérben fut, hogy az indulás gyors maradjon.
        new Thread(() -> { ENV = buildEnv(); ENV_READY.countDown(); }, "facet-env").start();
        if (pos.size() > 0) {
            try {
                Path start = Paths.get(pos.get(0).replaceFirst("^~", HOME.toString())).toAbsolutePath().normalize();
                Files.createDirectories(start);
                openWorkspace(start);
            } catch (Exception e) {
                System.err.println("Nem tudom megnyitni a mappát: " + pos.get(0) + " (" + e.getMessage() + ")");
            }
        }

        int port = portArg != null ? portArg : 7777;
        HttpServer server = null;
        if (port == 0) {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        } else {
            for (int p = port; p < port + 30 && server == null; p++) {
                try {
                    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), p), 0);
                } catch (BindException e) { /* foglalt, próbáljuk a következőt */ }
            }
        }
        if (server == null) { System.err.println("Nem találtam szabad portot."); System.exit(1); }
        port = server.getAddress().getPort();
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/", Facet::route);
        server.start();
        new Thread(Facet::detectTools, "facet-tools").start();

        if (app) {
            // Az asztali alkalmazás ebből a sorból tudja meg a portot.
            System.out.println("FACET_PORT=" + port);
            // Ha az alkalmazás bezárul (a bemenet lezárul), a motor is leáll.
            Thread watch = new Thread(() -> {
                try { while (System.in.read() >= 0) { /* várunk */ } } catch (IOException ignored) { }
                PROCS.values().forEach(Proc::kill);
                System.exit(0);
            }, "facet-parent-watch");
            watch.setDaemon(true);
            watch.start();
        }
        String url = "http://localhost:" + port + "/";
        System.out.println();
        System.out.println("  ◆ FACET " + VERSION + " fut");
        System.out.println("  ▸ Megnyitás:     " + url);
        System.out.println("  ▸ Mappa:         " + (WS == null ? "(a felületen nyitod meg)" : WS));
        System.out.println("  ▸ Java:          " + System.getProperty("java.version") + (ToolProvider.getSystemJavaCompiler() == null ? "  (FIGYELEM: nincs javac — JDK kell, nem csak JRE)" : ""));
        System.out.println("  ▸ Leállítás:     Ctrl+C");
        System.out.println();
        if (open) openBrowser(url);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> PROCS.values().forEach(Proc::kill)));
    }

    static Path findWeb(String override) {
        List<Path> candidates = new ArrayList<>();
        if (override != null) {
            // Windowson a „\\?\” előtagú (hosszú) útvonalat a Java nem érti — levágjuk.
            String o = override.startsWith("\\\\?\\UNC\\") ? "\\\\" + override.substring(8)
                     : override.startsWith("\\\\?\\") ? override.substring(4) : override;
            try { candidates.add(Paths.get(o)); } catch (Exception e) { System.err.println("Hibás --web útvonal: " + override); }
        }
        try {
            Path self = Paths.get(Facet.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getParent();
            if (self != null) { candidates.add(self.resolve("web")); candidates.add(self.resolveSibling("web")); }
        } catch (Exception ignored) { }
        candidates.add(Paths.get("web"));
        candidates.add(Paths.get("."));
        candidates.add(Paths.get("facet", "web"));
        for (Path c : candidates) if (c != null && Files.exists(c.resolve("index.html"))) return c.toAbsolutePath().normalize();
        System.err.println("Nem találom a web/index.html fájlt. A FACET mappájából indítsd: java Facet.java");
        System.exit(1);
        return null;
    }

    static void openBrowser(String url) {
        String os = System.getProperty("os.name").toLowerCase(Locale.ROOT);
        String[] cmd = os.contains("mac") ? new String[]{"open", url}
                : os.contains("win") ? new String[]{"rundll32", "url.dll,FileProtocolHandler", url}
                : new String[]{"xdg-open", url};
        try { new ProcessBuilder(cmd).start(); } catch (IOException ignored) { }
    }

    // ───────────────────────────── útválasztás ─────────────────────────────

    static void route(HttpExchange ex) {
        try {
            String path = ex.getRequestURI().getRawPath();
            String method = ex.getRequestMethod();
            if (path.startsWith("/api/")) {
                if (!trusted(ex)) { send(ex, 403, "text/plain", "Tiltott kérés".getBytes(StandardCharsets.UTF_8)); return; }
                Map<String, List<String>> q = query(ex.getRequestURI().getRawQuery());
                switch (path) {
                    case "/api/ping": json(ex, 200, ping()); return;
                    case "/api/tools": detectTools(); json(ex, 200, ping()); return;
                    case "/api/openurl": openUrl(ex, one(q, "u")); return;
                    case "/api/prefs": prefs(ex, method); return;
                    case "/api/git/identity": gitIdentity(ex, new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)); return;
                    case "/api/browse": browse(ex, one(q, "path")); return;
                    case "/api/browse/mkdir": browseMkdir(ex, one(q, "path")); return;
                    case "/api/open": open(ex, one(q, "path"), q.containsKey("create")); return;
                    case "/api/close":
                        PROCS.values().forEach(Proc::kill); PROCS.clear();
                        WS = null; META = null;
                        json(ex, 200, ping()); return;
                }
                if (WS == null) { json(ex, 409, "{\"error\":\"Nincs megnyitott mappa\"}"); return; }
                switch (path) {
                    case "/api/tree": json(ex, 200, tree()); return;
                    case "/api/file":
                        if (method.equals("GET")) { readFile(ex, one(q, "path"), q.containsKey("opt")); return; }
                        if (method.equals("PUT")) { writeFile(ex, one(q, "path")); return; }
                        if (method.equals("DELETE")) { deleteFile(ex, one(q, "path")); return; }
                        break;
                    case "/api/mkdir": Files.createDirectories(resolve(one(q, "path"))); json(ex, 200, "{\"ok\":true}"); return;
                    case "/api/rename": rename(ex, one(q, "from"), one(q, "to")); return;
                    case "/api/java/compile": compileOnly(ex, one(q, "path")); return;
                    case "/api/java/run": runJava(ex, one(q, "path"), q.getOrDefault("arg", List.of())); return;
                    case "/api/proc/stream": stream(ex, one(q, "id")); return;
                    case "/api/proc/input": input(ex, one(q, "id"), q.containsKey("eof")); return;
                    case "/api/proc/kill": { Proc p = PROCS.get(one(q, "id")); if (p != null) p.kill(); json(ex, 200, "{\"ok\":true}"); return; }
                    case "/api/run": runShell(ex, one(q, "cwd"), new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)); return;
                    case "/api/node/run": runNode(ex, one(q, "path"), q.getOrDefault("arg", List.of())); return;
                    case "/api/py/run": runPython(ex, one(q, "path"), q.getOrDefault("arg", List.of())); return;
                    case "/api/py/info": pyInfo(ex, one(q, "path")); return;
                    case "/api/py/check": pyCheck(ex, one(q, "path")); return;
                    case "/api/py/format": pyFormat(ex, one(q, "path")); return;
                    case "/api/py/trace": pyTrace(ex, one(q, "path")); return;
                    case "/api/py/test": pyTest(ex, one(q, "path"), one(q, "only")); return;
                    case "/api/git/repos": gitRepos(ex); return;
                    case "/api/git/status": gitStatus(ex, one(q, "repo")); return;
                    case "/api/git/log": gitLog(ex, one(q, "repo")); return;
                    case "/api/git/show": gitShow(ex, one(q, "repo"), one(q, "path"), one(q, "ref")); return;
                    case "/api/git/do": gitDo(ex, one(q, "repo"), one(q, "action"), q.getOrDefault("p", List.of()), new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)); return;
                    case "/api/zip/read": zipRead(ex, one(q, "path")); return;
                    case "/api/zip/write": zipWrite(ex, one(q, "path")); return;
                    case "/api/reveal": reveal(ex, one(q, "path"), false); return;
                    case "/api/openext": reveal(ex, one(q, "path"), true); return;
                }
                json(ex, 404, "{\"error\":\"Ismeretlen végpont\"}");
                return;
            }
            if (path.startsWith("/ws/")) {
                if (WS == null) { send(ex, 404, "text/plain", new byte[0]); return; }
                serveFile(ex, resolve(decode(path.substring(4))), WS);
                return;
            }
            String rel = decode(path.equals("/") ? "index.html" : path.substring(1));
            Path p = WEB.resolve(rel).normalize();
            if (!p.startsWith(WEB)) { send(ex, 403, "text/plain", new byte[0]); return; }
            serveFile(ex, p, WEB);
        } catch (Throwable t) {
            try { json(ex, 500, "{\"error\":" + q(String.valueOf(t.getMessage())) + "}"); } catch (Exception ignored) { }
        } finally {
            if (!ex.getRequestURI().getPath().equals("/api/proc/stream")) ex.close();
        }
    }

    /** Csak a saját felületünkről jövő kérést fogadjuk el (védelem más weboldalak ellen). */
    static boolean trusted(HttpExchange ex) {
        String host = ex.getRequestHeaders().getFirst("Host");
        if (host == null) return false;
        String h = host.replaceAll(":\\d+$", "");
        boolean local = h.equals("localhost") || h.equals("127.0.0.1") || h.equals("[::1]");
        return local && "1".equals(ex.getRequestHeaders().getFirst("X-Facet"));
    }

    // ───────────────────────────── fájlok ─────────────────────────────

    static Path resolve(String rel) {
        if (WS == null) throw new IllegalStateException("Nincs megnyitott mappa");
        if (rel == null) rel = "";
        rel = rel.replace('\\', '/').replaceAll("^/+", "");
        if (rel.equals(".facet") || rel.startsWith(".facet/")) {
            Path m = META.resolve(rel.length() > 7 ? rel.substring(7) : "").normalize();
            if (!m.startsWith(META)) throw new IllegalArgumentException("Érvénytelen útvonal");
            return m;
        }
        Path p = WS.resolve(rel).normalize();
        if (!p.startsWith(WS)) throw new IllegalArgumentException("A megnyitott mappán kívüli útvonal");
        return p;
    }

    static String rel(Path p) {
        return WS.relativize(p).toString().replace(File.separatorChar, '/');
    }

    static void openWorkspace(Path dir) throws IOException {
        PROCS.values().forEach(Proc::kill);
        PROCS.clear();
        String key = dir.getFileName() == null ? "root" : dir.getFileName().toString().replaceAll("[^\\w.-]", "_");
        META = HOME.resolve(".facet").resolve("mappak").resolve(key + "-" + Integer.toHexString(dir.toString().hashCode()));
        Files.createDirectories(META);
        WS = dir;
    }

    /** A felület beállításai (~/.facet/prefs.json). Az asztali alkalmazás minden indításkor más
        porton fut, ezért a böngésző saját tárolója (localStorage) nem maradna meg — ide mentünk. */
    static final Object PREFS_LOCK = new Object();
    static void prefs(HttpExchange ex, String method) throws IOException {
        Path f = HOME.resolve(".facet").resolve("prefs.json");
        synchronized (PREFS_LOCK) {
            if (method.equals("PUT")) {
                byte[] body = readAll(ex.getRequestBody());
                if (body.length > 8_000_000) { json(ex, 413, "{\"error\":\"Túl nagy\"}"); return; }
                Files.createDirectories(f.getParent());
                Path tmp = f.resolveSibling("prefs.json.tmp");
                Files.write(tmp, body);
                Files.move(tmp, f, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                json(ex, 200, "{\"ok\":true}");
                return;
            }
            String body = Files.exists(f) ? new String(Files.readAllBytes(f), StandardCharsets.UTF_8) : "{}";
            if (!body.trim().startsWith("{")) body = "{}";
            json(ex, 200, body);
        }
    }

    static String ping() {
        boolean jdk = ToolProvider.getSystemJavaCompiler() != null;
        Path ws = WS;
        return "{\"ok\":true,\"version\":" + q(VERSION) + ",\"java\":" + q(System.getProperty("java.version"))
                + ",\"jdk\":" + jdk + ",\"workspace\":" + (ws == null ? "null" : q(ws.toString()))
                + ",\"name\":" + (ws == null ? "null" : q(ws.getFileName() == null ? ws.toString() : ws.getFileName().toString()))
                + ",\"project\":" + isProject(ws)
                + ",\"home\":" + q(HOME.toString()) + ",\"projects\":" + q(HOME.resolve("FacetProjects").toString())
                + ",\"git\":" + q(GIT_VER) + ",\"node\":" + q(NODE_VER) + ",\"npm\":" + q(NPM_VER) + ",\"python\":" + q(PY_VER)
                + ",\"sep\":" + q(File.separator)
                + ",\"os\":" + q(System.getProperty("os.name")) + "}";
    }

    // ───────────────────────────── mappaválasztó ─────────────────────────────

    static Path absPath(String s) {
        if (s == null || s.isBlank()) return HOME;
        return Paths.get(s.replaceFirst("^~", HOME.toString())).toAbsolutePath().normalize();
    }

    /** A gép mappáinak böngészése a „Mappa megnyitása” ablakhoz. */
    static void browse(HttpExchange ex, String pathStr) throws IOException {
        Path dir = absPath(pathStr);
        if (!Files.isDirectory(dir)) { json(ex, 404, "{\"error\":\"Nincs ilyen mappa\"}"); return; }
        StringBuilder sb = new StringBuilder("{\"path\":").append(q(dir.toString()))
                .append(",\"parent\":").append(dir.getParent() == null ? "null" : q(dir.getParent().toString()))
                .append(",\"home\":").append(q(HOME.toString())).append(",\"dirs\":[");
        List<Path> dirs = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            s.filter(p -> !p.getFileName().toString().startsWith("."))
             .filter(p -> { try { return Files.isDirectory(p) && Files.isReadable(p); } catch (Exception e) { return false; } })
             .sorted(Comparator.comparing(p -> p.getFileName().toString().toLowerCase(Locale.ROOT)))
             .limit(800).forEach(dirs::add);
        } catch (IOException | SecurityException e) {
            json(ex, 403, "{\"error\":\"Ehhez a mappához nincs hozzáférés\"}");
            return;
        }
        boolean first = true;
        for (Path d : dirs) {
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"name\":").append(q(d.getFileName().toString())).append(",\"path\":").append(q(d.toString()))
              .append(",\"kind\":").append(q(kindOf(d))).append('}');
        }
        sb.append("],\"kind\":").append(q(kindOf(dir))).append(",\"shortcuts\":[");
        String[][] sc = {{"Kezdőmappa", ""}, {"Asztal", "Desktop"}, {"Dokumentumok", "Documents"}, {"Letöltések", "Downloads"}, {"FacetProjects", "FacetProjects"}};
        first = true;
        for (String[] s : sc) {
            Path p = s[1].isEmpty() ? HOME : HOME.resolve(s[1]);
            if (!Files.isDirectory(p)) continue;
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"name\":").append(q(s[0])).append(",\"path\":").append(q(p.toString())).append('}');
        }
        json(ex, 200, sb.append("]}").toString());
    }

    /** Milyen projektnek tűnik a mappa (csak jelzésnek). */
    static String kindOf(Path d) {
        try {
            if (Files.exists(d.resolve("pom.xml")) || Files.exists(d.resolve("build.gradle")) || Files.isDirectory(d.resolve("src"))) return "java";
            if (Files.exists(d.resolve("index.html"))) return "web";
            if (Files.isDirectory(d.resolve(".git"))) return "git";
            try (Stream<Path> s = Files.list(d)) {
                List<String> names = s.limit(200).map(p -> p.getFileName().toString().toLowerCase(Locale.ROOT)).collect(Collectors.toList());
                if (names.stream().anyMatch(n -> n.endsWith(".java"))) return "java";
                if (names.stream().anyMatch(n -> n.endsWith(".html"))) return "web";
            }
        } catch (Exception ignored) { }
        return "";
    }

    static void browseMkdir(HttpExchange ex, String pathStr) throws IOException {
        Path dir = absPath(pathStr);
        if (Files.exists(dir)) { json(ex, 409, "{\"error\":\"Már létezik ilyen nevű mappa\"}"); return; }
        Files.createDirectories(dir);
        json(ex, 200, "{\"ok\":true,\"path\":" + q(dir.toString()) + "}");
    }

    static void open(HttpExchange ex, String pathStr, boolean create) throws IOException {
        Path dir = absPath(pathStr);
        if (create) Files.createDirectories(dir);
        if (!Files.isDirectory(dir)) { json(ex, 404, "{\"error\":\"Nincs ilyen mappa\"}"); return; }
        if (dir.equals(HOME) || dir.getParent() == null) {
            json(ex, 400, "{\"error\":\"A teljes kezdőmappát vagy a lemez gyökerét nem érdemes megnyitni. Válassz egy projektmappát.\"}");
            return;
        }
        openWorkspace(dir);
        json(ex, 200, ping());
    }

    static String tree() throws IOException {
        StringBuilder sb = new StringBuilder("[");
        try (Stream<Path> s = Files.walk(WS, 12)) {
            List<Path> all = s.filter(p -> !p.equals(WS))
                    .filter(p -> { for (Path part : WS.relativize(p)) if (SKIP.contains(part.toString())) return false; return true; })
                    .limit(6000).collect(Collectors.toList());
            boolean first = true;
            for (Path p : all) {
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"p\":").append(q(rel(p))).append(",\"d\":").append(Files.isDirectory(p)).append('}');
            }
        }
        return sb.append(']').toString();
    }

    /** opt: ha a fájl nem létezik, 204-et ad 404 helyett (pl. Időgép-előzmény). */
    static void readFile(HttpExchange ex, String rel, boolean optional) throws IOException {
        Path p = resolve(rel);
        if (!Files.isRegularFile(p)) {
            if (optional) send(ex, 204, "text/plain", new byte[0]);
            else json(ex, 404, "{\"error\":\"Nincs ilyen fájl\"}");
            return;
        }
        send(ex, 200, "text/plain; charset=utf-8", Files.readAllBytes(p));
    }

    static void writeFile(HttpExchange ex, String rel) throws IOException {
        Path p = resolve(rel);
        if (p.getParent() != null) Files.createDirectories(p.getParent());
        byte[] body = readAll(ex.getRequestBody());
        Path tmp = p.resolveSibling("." + p.getFileName() + ".facet-tmp");
        Files.write(tmp, body);
        Files.move(tmp, p, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        json(ex, 200, "{\"ok\":true,\"bytes\":" + body.length + "}");
    }

    /** A törlés nem végleges: a fájl a .facet/kuka mappába kerül. */
    static void deleteFile(HttpExchange ex, String rel) throws IOException {
        Path p = resolve(rel);
        if (p.equals(WS) || !Files.exists(p)) { json(ex, 404, "{\"error\":\"Nincs ilyen elem\"}"); return; }
        Path trash = META.resolve("kuka");
        Files.createDirectories(trash);
        Path target = trash.resolve(System.currentTimeMillis() + "_" + p.getFileName());
        Files.move(p, target);
        json(ex, 200, "{\"ok\":true}");
    }

    static void rename(HttpExchange ex, String from, String to) throws IOException {
        Path a = resolve(from), b = resolve(to);
        if (!Files.exists(a)) { json(ex, 404, "{\"error\":\"Nincs ilyen elem\"}"); return; }
        if (Files.exists(b)) { json(ex, 409, "{\"error\":\"Már létezik ilyen nevű elem\"}"); return; }
        if (b.getParent() != null) Files.createDirectories(b.getParent());
        Files.move(a, b);
        json(ex, 200, "{\"ok\":true}");
    }

    // ───────────────────────────── Java ─────────────────────────────

    /** Egyetlen projekt-e a megnyitott mappa (csak tájékoztatásnak a felületnek). */
    static boolean isProject(Path ws) {
        return ws != null && (Files.isDirectory(ws.resolve("src")) || Files.exists(ws.resolve("pom.xml")) || Files.exists(ws.resolve("build.gradle")));
    }

    /** Projektgyökér-e a mappa: pom.xml, Gradle, IntelliJ .iml, vagy src/ mappa, amelyben a fájl van. */
    static boolean isProjectDir(Path dir, Path file) {
        if (Files.exists(dir.resolve("pom.xml")) || Files.exists(dir.resolve("build.gradle")) || Files.exists(dir.resolve("build.gradle.kts"))) return true;
        Path src = dir.resolve("src");
        if (Files.isDirectory(src) && file.startsWith(src)) return true;
        try (Stream<Path> s = Files.list(dir)) {
            return s.anyMatch(p -> p.getFileName().toString().endsWith(".iml"));
        } catch (IOException e) { return false; }
    }

    /**
     * A fordítás köre, ahogy az IntelliJ is látja: a fájlhoz legközelebbi projektgyökér.
     * Ha nincs ilyen (egy magányos .java fájl), a csomagnév alapján számolt forrásgyökér.
     */
    static Path projectRoot(Path file) {
        for (Path dir = file.getParent(); dir != null && dir.startsWith(WS); dir = dir.getParent()) {
            if (isProjectDir(dir, file)) return dir;
            if (dir.equals(WS)) break;
        }
        return sourceRootOf(file);
    }

    static Path sourceRootOf(Path file) {
        Path dir = file.getParent();
        String pkg = packageOf(file);
        if (pkg.isEmpty()) return dir;
        String[] segs = pkg.split("\\.");
        for (int i = segs.length - 1; i >= 0 && dir != null; i--) {
            if (!dir.getFileName().toString().equals(segs[i])) return file.getParent();
            dir = dir.getParent();
        }
        return dir != null && dir.startsWith(WS) ? dir : file.getParent();
    }

    static String packageOf(Path file) {
        try {
            Matcher m = PKG.matcher(stripComments(Files.readString(file, StandardCharsets.UTF_8)));
            return m.find() ? m.group(1) : "";
        } catch (IOException e) { return ""; }
    }

    static List<Path> javaSources(Path root, Path file) throws IOException {
        boolean marked = isProjectDir(root, file);
        Path base = marked && Files.isDirectory(root.resolve("src")) ? root.resolve("src") : root;
        // magányos fájl csomag nélkül: csak az azonos mappában lévő .java fájlok tartoznak hozzá
        int depth = !marked && packageOf(file).isEmpty() ? 1 : Integer.MAX_VALUE;
        try (Stream<Path> s = Files.walk(base, depth)) {
            return s.filter(p -> p.toString().endsWith(".java") && Files.isRegularFile(p))
                    .filter(p -> { for (Path part : WS.relativize(p)) if (SKIP.contains(part.toString())) return false; return true; })
                    .sorted().collect(Collectors.toList());
        }
    }

    static class CompileResult {
        boolean ok; long ms; String json; Path out; Path root; List<Path> sources;
    }

    static CompileResult compile(Path file) throws IOException {
        CompileResult r = new CompileResult();
        JavaCompiler jc = ToolProvider.getSystemJavaCompiler();
        if (jc == null) {
            r.json = "[{\"file\":\"\",\"line\":0,\"col\":0,\"kind\":\"ERROR\",\"code\":\"facet.no.jdk\",\"message\":\"Nincs Java fordító. Telepíts JDK-t (pl. Temurin 21), ne csak JRE-t.\"}]";
            return r;
        }
        r.root = projectRoot(file);
        r.sources = javaSources(r.root, file);
        String key = r.root.equals(WS) ? "_" : WS.relativize(r.root).toString();
        r.out = META.resolve("build").resolve(key);
        deleteTree(r.out);
        Files.createDirectories(r.out);

        DiagnosticCollector<JavaFileObject> dc = new DiagnosticCollector<>();
        long t0 = System.nanoTime();
        try (StandardJavaFileManager fm = jc.getStandardFileManager(dc, Locale.ENGLISH, StandardCharsets.UTF_8)) {
            List<File> files = r.sources.stream().map(Path::toFile).collect(Collectors.toList());
            List<String> opts = List.of("-d", r.out.toString(), "-encoding", "UTF-8", "-g", "-proc:none", "-Xlint:-options");
            StringWriter sink = new StringWriter();
            r.ok = jc.getTask(sink, fm, dc, opts, null, fm.getJavaFileObjectsFromFiles(files)).call();
        }
        r.ms = (System.nanoTime() - t0) / 1_000_000;

        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (Diagnostic<? extends JavaFileObject> d : dc.getDiagnostics()) {
            if (d.getKind() == Diagnostic.Kind.NOTE) continue;
            String f = "";
            if (d.getSource() != null) {
                try { f = rel(Paths.get(d.getSource().toUri()).normalize()); } catch (Exception e) { f = d.getSource().getName(); }
            }
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"file\":").append(q(f))
              .append(",\"line\":").append(Math.max(0, d.getLineNumber()))
              .append(",\"col\":").append(Math.max(0, d.getColumnNumber()))
              .append(",\"endCol\":").append(endCol(d))
              .append(",\"kind\":").append(q(d.getKind().name()))
              .append(",\"code\":").append(q(String.valueOf(d.getCode())))
              .append(",\"message\":").append(q(d.getMessage(Locale.ENGLISH)))
              .append('}');
        }
        r.json = sb.append(']').toString();
        return r;
    }

    static long endCol(Diagnostic<?> d) {
        long len = d.getEndPosition() - d.getStartPosition();
        if (d.getStartPosition() < 0 || len <= 0 || len > 200) return Math.max(0, d.getColumnNumber()) + 1;
        return Math.max(0, d.getColumnNumber()) + len;
    }

    static void compileOnly(HttpExchange ex, String relPath) throws IOException {
        Path file = resolve(relPath);
        CompileResult r = compile(file);
        json(ex, 200, "{\"ok\":" + r.ok + ",\"ms\":" + r.ms + ",\"diagnostics\":" + r.json + "}");
    }

    static String mainClassFor(Path file, List<Path> sources) throws IOException {
        List<Path> order = new ArrayList<>();
        order.add(file);
        for (Path s : sources) if (!s.equals(file)) order.add(s);
        for (Path s : order) {
            if (!Files.isRegularFile(s) || !s.toString().endsWith(".java")) continue;
            String src = Files.readString(s, StandardCharsets.UTF_8);
            if (!MAIN.matcher(stripComments(src)).find()) continue;
            Matcher m = PKG.matcher(src);
            String cls = s.getFileName().toString().replaceAll("\\.java$", "");
            return m.find() ? m.group(1) + "." + cls : cls;
        }
        return null;
    }

    static String stripComments(String s) {
        return s.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\\n]*", "");
    }

    static void runJava(HttpExchange ex, String relPath, List<String> args) throws IOException {
        Path file = resolve(relPath);
        PROCS.values().forEach(Proc::kill);
        PROCS.clear();
        CompileResult r = compile(file);
        if (!r.ok) {
            json(ex, 200, "{\"ok\":false,\"phase\":\"compile\",\"ms\":" + r.ms + ",\"diagnostics\":" + r.json + "}");
            return;
        }
        String main = mainClassFor(file, r.sources);
        if (main == null) {
            json(ex, 200, "{\"ok\":false,\"phase\":\"main\",\"ms\":" + r.ms + ",\"diagnostics\":" + r.json
                    + ",\"error\":\"Nem találok main metódust ebben a projektben. Írj egy public static void main(String[] args) metódust.\"}");
            return;
        }
        String javaBin = Paths.get(System.getProperty("java.home"), "bin", "java").toString();
        List<String> cmd = new ArrayList<>(List.of(javaBin, "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8",
                "-Dstderr.encoding=UTF-8", "-Dstdin.encoding=UTF-8", "-Dsun.stdout.encoding=UTF-8", "-cp", r.out.toString(), main));
        cmd.addAll(args);
        ProcessBuilder pb = proc(cmd, r.root);
        pb.environment().remove("JAVA_TOOL_OPTIONS");
        pb.environment().remove("_JAVA_OPTIONS");
        Proc proc = new Proc(pb.start());
        String id = UUID.randomUUID().toString();
        PROCS.put(id, proc);
        json(ex, 200, "{\"ok\":true,\"phase\":\"run\",\"id\":" + q(id) + ",\"main\":" + q(main)
                + ",\"ms\":" + r.ms + ",\"diagnostics\":" + r.json + "}");
    }

    /** Egy futó program: kimenetét eseményekként sorba állítja. */
    static class Proc {
        final Process p;
        final BlockingQueue<String> events = new LinkedBlockingQueue<>();
        final long start = System.nanoTime();

        Proc(Process p) {
            this.p = p;
            Thread out = pump(p.getInputStream(), "out");
            Thread err = pump(p.getErrorStream(), "err");
            Thread w = new Thread(() -> {
                try {
                    int code = p.waitFor();
                    out.join(2000);
                    err.join(2000);
                    long ms = (System.nanoTime() - start) / 1_000_000;
                    events.add("{\"t\":\"exit\",\"code\":" + code + ",\"ms\":" + ms + "}");
                } catch (InterruptedException ignored) { }
            });
            w.setDaemon(true);
            w.start();
        }

        Thread pump(InputStream in, String type) {
            Thread t = new Thread(() -> {
                try (Reader r = new InputStreamReader(in, StandardCharsets.UTF_8)) {
                    char[] buf = new char[4096];
                    int n;
                    while ((n = r.read(buf)) > 0) {
                        events.add("{\"t\":\"" + type + "\",\"d\":" + q(new String(buf, 0, n)) + "}");
                    }
                } catch (IOException ignored) { }
            });
            t.setDaemon(true);
            t.start();
            return t;
        }

        void kill() {
            if (p.isAlive()) { p.descendants().forEach(ProcessHandle::destroyForcibly); p.destroyForcibly(); }
        }
    }

    /** Server-Sent Events: a program kimenete élőben érkezik a felületre. */
    static void stream(HttpExchange ex, String id) throws IOException {
        Proc proc = PROCS.get(id);
        if (proc == null) { json(ex, 404, "{\"error\":\"Nincs ilyen futás\"}"); ex.close(); return; }
        ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        ex.sendResponseHeaders(200, 0);
        OutputStream os = ex.getResponseBody();
        try {
            while (true) {
                String ev = proc.events.poll(15, TimeUnit.SECONDS);
                if (ev == null) { os.write(": ping\n\n".getBytes(StandardCharsets.UTF_8)); os.flush(); continue; }
                os.write(("data: " + ev + "\n\n").getBytes(StandardCharsets.UTF_8));
                os.flush();
                if (ev.startsWith("{\"t\":\"exit\"")) break;
            }
        } catch (IOException | InterruptedException e) {
            proc.kill(); // a felület bezárult vagy újratöltődött
        } finally {
            PROCS.remove(id);
            ex.close();
        }
    }

    static void input(HttpExchange ex, String id, boolean eof) throws IOException {
        Proc proc = PROCS.get(id);
        if (proc == null || !proc.p.isAlive()) { json(ex, 409, "{\"error\":\"A program már nem fut\"}"); return; }
        OutputStream in = proc.p.getOutputStream();
        byte[] body = readAll(ex.getRequestBody());
        try {
            in.write(body);
            in.flush();
            if (eof) in.close();
        } catch (IOException e) {
            json(ex, 409, "{\"error\":\"A program nem fogad bemenetet\"}");
            return;
        }
        json(ex, 200, "{\"ok\":true}");
    }

    // ───────────────────────────── külső programok ─────────────────────────────

    /** A felhasználó teljes PATH-ja: a Finderből/Dockból indított alkalmazás csak egy szűkített PATH-t kap. */
    static Map<String, String> buildEnv() {
        Map<String, String> env = new HashMap<>(System.getenv());
        String pathKey = env.keySet().stream().filter(k -> k.equalsIgnoreCase("PATH")).findFirst().orElse("PATH");
        List<String> parts = new ArrayList<>();
        if (!WIN) {
            String shell = env.getOrDefault("SHELL", MAC ? "/bin/zsh" : "/bin/bash");
            try {
                Process p = new ProcessBuilder(shell, "-ilc", "printf '__FACET__%s__FACET__' \"$PATH\"")
                        .redirectErrorStream(true).redirectInput(ProcessBuilder.Redirect.from(new File("/dev/null"))).start();
                if (p.waitFor(4, TimeUnit.SECONDS)) {
                    String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                    Matcher m = Pattern.compile("__FACET__(.*?)__FACET__", Pattern.DOTALL).matcher(out);
                    if (m.find()) for (String x : m.group(1).split(":")) if (!x.isBlank()) parts.add(x);
                } else p.destroyForcibly();
            } catch (Exception ignored) { }
            for (String extra : new String[]{"/opt/homebrew/bin", "/usr/local/bin", HOME + "/.volta/bin", HOME + "/.local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"}) parts.add(extra);
        }
        String cur = env.getOrDefault(pathKey, "");
        for (String x : cur.split(File.pathSeparator)) if (!x.isBlank()) parts.add(x);
        LinkedHashSet<String> uniq = new LinkedHashSet<>(parts);
        env.put(pathKey, String.join(File.pathSeparator, uniq));
        env.remove("JAVA_TOOL_OPTIONS");
        env.put("FORCE_COLOR", "0");
        env.put("NO_COLOR", "1");
        env.put("GIT_TERMINAL_PROMPT", "0");
        env.put("TERM", "dumb");
        return env;
    }

    static void awaitEnv() {
        try { ENV_READY.await(6, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
    }

    static ProcessBuilder proc(List<String> cmd, Path dir) {
        awaitEnv();
        ProcessBuilder pb = new ProcessBuilder(cmd);
        if (dir != null) pb.directory(dir.toFile());
        pb.environment().clear();
        pb.environment().putAll(ENV);
        return pb;
    }

    /** Egy program teljes útvonala a PATH alapján (Windowson .exe/.cmd kiterjesztéssel is). */
    static String which(String name) {
        awaitEnv();
        String path = ENV.entrySet().stream().filter(e -> e.getKey().equalsIgnoreCase("PATH")).map(Map.Entry::getValue).findFirst().orElse("");
        String[] exts = WIN ? new String[]{".exe", ".cmd", ".bat", ""} : new String[]{""};
        for (String dir : path.split(File.pathSeparator)) {
            if (dir.isBlank()) continue;
            for (String e : exts) {
                Path p = Paths.get(dir, name + e);
                if (Files.isRegularFile(p) && (WIN || Files.isExecutable(p))) return p.toString();
            }
        }
        return null;
    }

    static class Out { int code = -1; String out = "", err = ""; boolean timeout; }

    static Out exec(List<String> cmd, Path dir, byte[] stdin, long timeoutSec) {
        Out o = new Out();
        try {
            Process p = proc(cmd, dir).start();
            if (stdin != null) { try (OutputStream os = p.getOutputStream()) { os.write(stdin); } } else p.getOutputStream().close();
            ByteArrayOutputStream bo = new ByteArrayOutputStream(), be = new ByteArrayOutputStream();
            Thread t1 = new Thread(() -> { try { p.getInputStream().transferTo(bo); } catch (IOException ignored) { } });
            Thread t2 = new Thread(() -> { try { p.getErrorStream().transferTo(be); } catch (IOException ignored) { } });
            t1.start(); t2.start();
            if (!p.waitFor(timeoutSec, TimeUnit.SECONDS)) { p.destroyForcibly(); o.timeout = true; }
            t1.join(2000); t2.join(2000);
            o.code = o.timeout ? -1 : p.exitValue();
            o.out = bo.toString(StandardCharsets.UTF_8);
            o.err = be.toString(StandardCharsets.UTF_8);
        } catch (Exception e) {
            o.err = String.valueOf(e.getMessage());
        }
        return o;
    }

    static void detectTools() {
        String git = which("git"), node = which("node"), npm = which("npm");
        GIT_VER = git == null ? null : firstLine(exec(List.of(git, "--version"), null, null, 8).out).replace("git version ", "");
        NODE_VER = node == null ? null : firstLine(exec(List.of(node, "--version"), null, null, 8).out);
        NPM_VER = npm == null ? null : firstLine(exec(shellCmd("npm --version"), null, null, 15).out);
        if (GIT_VER != null && GIT_VER.isBlank()) GIT_VER = null;
        if (NODE_VER != null && NODE_VER.isBlank()) NODE_VER = null;
        if (NPM_VER != null && NPM_VER.isBlank()) NPM_VER = null;
        PY_CMD = systemPython();
        PY_VER = PY_CMD == null ? null : pyVersion(PY_CMD);
    }

    static String firstLine(String s) { return s == null ? "" : s.trim().split("\\R", 2)[0]; }

    static List<String> shellCmd(String command) {
        if (WIN) return List.of("cmd.exe", "/d", "/s", "/c", command);
        String sh = Files.isExecutable(Paths.get("/bin/bash")) ? "/bin/bash" : "/bin/sh";
        return List.of(sh, "-c", command);
    }

    static Path dirParam(String rel) {
        Path d = resolve(rel == null ? "" : rel);
        if (!Files.isDirectory(d)) d = d.getParent();
        return d;
    }

    /** Terminál: tetszőleges parancs futtatása a megadott mappában (npm install, git status…). */
    static void runShell(HttpExchange ex, String cwd, String command) throws IOException {
        if (command == null || command.isBlank()) { json(ex, 400, "{\"error\":\"Üres parancs\"}"); return; }
        PROCS.values().forEach(Proc::kill);
        PROCS.clear();
        Path dir = dirParam(cwd);
        Proc proc = new Proc(proc(shellCmd(command), dir).start());
        String id = UUID.randomUUID().toString();
        PROCS.put(id, proc);
        json(ex, 200, "{\"ok\":true,\"id\":" + q(id) + ",\"cwd\":" + q(rel(dir)) + "}");
    }

    static void runNode(HttpExchange ex, String relPath, List<String> args) throws IOException {
        Path file = resolve(relPath);
        String node = which("node");
        if (node == null) { json(ex, 200, "{\"ok\":false,\"error\":\"nonode\"}"); return; }
        PROCS.values().forEach(Proc::kill);
        PROCS.clear();
        List<String> cmd = new ArrayList<>(List.of(node, "--enable-source-maps", file.getFileName().toString()));
        cmd.addAll(args);
        Proc proc = new Proc(proc(cmd, file.getParent()).start());
        String id = UUID.randomUUID().toString();
        PROCS.put(id, proc);
        json(ex, 200, "{\"ok\":true,\"id\":" + q(id) + ",\"node\":" + q(NODE_VER) + "}");
    }

    // ───────────────────────────── Python ─────────────────────────────

    /** „Python 3.12.1” → „3.12.1”; ha a parancs nem igazi Python (pl. a Windows Store-os álparancs): null. */
    static String pyVersion(List<String> base) {
        List<String> c = new ArrayList<>(base); c.add("--version");
        Out o = exec(c, null, null, 10);
        String v = firstLine((o.out + "\n" + o.err).trim());
        return o.code == 0 && v.startsWith("Python 3") ? v.substring(7).trim() : null;
    }

    /** A gépen lévő Python 3: python3, python, Windowson a py indító is. */
    static List<String> systemPython() {
        List<List<String>> tries = new ArrayList<>();
        String p3 = which("python3"), p = which("python"), py = WIN ? which("py") : null;
        if (WIN && py != null) tries.add(List.of(py, "-3"));
        if (p3 != null) tries.add(List.of(p3));
        if (p != null) tries.add(List.of(p));
        for (List<String> t : tries) if (pyVersion(t) != null) return t;
        return null;
    }

    /** A fájlhoz tartozó virtuális környezet (.venv, venv, env) a fájl mappájától a megnyitott mappáig. */
    static Path findVenv(Path from) {
        for (Path d = from; d != null && d.startsWith(WS); d = d.getParent()) {
            for (String n : new String[]{".venv", "venv", "env"}) {
                Path exe = WIN ? d.resolve(n).resolve("Scripts").resolve("python.exe") : d.resolve(n).resolve("bin").resolve("python");
                if (Files.isRegularFile(exe)) return exe;
            }
            if (d.equals(WS)) break;
        }
        return null;
    }

    static List<String> pythonFor(Path dir) {
        Path v = dir == null ? null : findVenv(dir);
        if (v != null) return List.of(v.toString());
        if (PY_CMD == null) { awaitEnv(); PY_CMD = systemPython(); PY_VER = PY_CMD == null ? null : pyVersion(PY_CMD); }
        return PY_CMD;
    }

    static ProcessBuilder pyProc(List<String> cmd, Path dir) {
        ProcessBuilder pb = proc(cmd, dir);
        pb.environment().put("PYTHONUNBUFFERED", "1");
        pb.environment().put("PYTHONIOENCODING", "utf-8");
        pb.environment().put("PYTHONUTF8", "1");
        pb.environment().put("PYTHONDONTWRITEBYTECODE", "1");
        return pb;
    }

    static void runPython(HttpExchange ex, String relPath, List<String> args) throws IOException {
        Path file = resolve(relPath);
        List<String> py = pythonFor(file.getParent());
        if (py == null) { json(ex, 200, "{\"ok\":false,\"error\":\"nopython\"}"); return; }
        PROCS.values().forEach(Proc::kill);
        PROCS.clear();
        List<String> cmd = new ArrayList<>(py);
        cmd.add("-u");
        cmd.add(file.getFileName().toString());
        cmd.addAll(args);
        Proc proc = new Proc(pyProc(cmd, file.getParent()).start());
        String id = UUID.randomUUID().toString();
        PROCS.put(id, proc);
        json(ex, 200, "{\"ok\":true,\"id\":" + q(id) + ",\"cmd\":" + q(String.join(" ", cmd)) + "}");
    }

    /** Python-információ egy fájlhoz: melyik értelmező, verzió, venv, pip-parancs. */
    static void pyInfo(HttpExchange ex, String relPath) throws IOException {
        Path dir = relPath == null || relPath.isEmpty() ? WS : resolve(relPath);
        if (!Files.isDirectory(dir)) dir = dir.getParent();
        Path venv = findVenv(dir);
        List<String> py = pythonFor(dir);
        String ver = py == null ? null : (venv == null ? PY_VER : pyVersion(py));
        String cmdline = py == null ? null : py.stream().map(x -> x.contains(" ") ? "\"" + x + "\"" : x).collect(java.util.stream.Collectors.joining(" "));
        json(ex, 200, "{\"ok\":true,\"python\":" + q(cmdline) + ",\"version\":" + q(ver)
                + ",\"venv\":" + (venv == null ? "null" : q(WS.relativize(venv).toString().replace('\\', '/'))) + "}");
    }

    /** Szintaxis-ellenőrzés futtatás nélkül (ast.parse). */
    static void pyCheck(HttpExchange ex, String relPath) throws IOException {
        Path file = resolve(relPath);
        List<String> py = pythonFor(file.getParent());
        if (py == null) { json(ex, 200, "{\"ok\":false,\"error\":\"nopython\"}"); return; }
        List<String> cmd = new ArrayList<>(py);
        cmd.addAll(List.of("-c", "import ast,sys\nsrc=open(sys.argv[1],encoding='utf-8').read()\ntry:\n ast.parse(src,sys.argv[1])\nexcept SyntaxError as e:\n print('%s|%s|%s|%s'%(e.__class__.__name__,e.lineno or 0,e.offset or 0,e.msg))\n", file.toString()));
        Out o = exec(cmd, file.getParent(), null, 15);
        json(ex, 200, "{\"ok\":true,\"out\":" + q(o.out.trim()) + ",\"err\":" + q(o.err.trim()) + "}");
    }

    /** Lépésenkénti futtatás: a felület mappájában lévő nyomkövetővel (web/py/facet_tracer.py). */
    static void pyTrace(HttpExchange ex, String relPath) throws IOException {
        byte[] inputs = readAll(ex.getRequestBody());
        Path file = resolve(relPath);
        List<String> py = pythonFor(file.getParent());
        if (py == null) { json(ex, 200, "{\"ok\":false,\"error\":\"nopython\"}"); return; }
        Path tracer = WEB.resolve("py").resolve("facet_tracer.py");
        if (!Files.isRegularFile(tracer)) { json(ex, 500, "{\"error\":\"Hiányzik a nyomkövető\"}"); return; }
        List<String> cmd = new ArrayList<>(py);
        cmd.addAll(List.of(tracer.toString(), file.toString(), WS.toString(), "800"));
        Out o = new Out();
        try {
            Process p = pyProc(cmd, file.getParent()).start();
            try (OutputStream os = p.getOutputStream()) { os.write(inputs); }
            ByteArrayOutputStream bo = new ByteArrayOutputStream(), be = new ByteArrayOutputStream();
            Thread t1 = new Thread(() -> { try { p.getInputStream().transferTo(bo); } catch (IOException ignored) { } });
            Thread t2 = new Thread(() -> { try { p.getErrorStream().transferTo(be); } catch (IOException ignored) { } });
            t1.start(); t2.start();
            if (!p.waitFor(20, TimeUnit.SECONDS)) { p.destroyForcibly(); o.timeout = true; }
            t1.join(2000); t2.join(2000);
            o.out = bo.toString(StandardCharsets.UTF_8); o.err = be.toString(StandardCharsets.UTF_8);
        } catch (Exception e) { o.err = String.valueOf(e.getMessage()); }
        String out = o.out.trim();
        int i = out.lastIndexOf("\n{\"steps\"");
        if (i >= 0) out = out.substring(i + 1);
        if (o.timeout) { json(ex, 200, "{\"ok\":false,\"error\":\"timeout\"}"); return; }
        if (!out.startsWith("{")) { json(ex, 200, "{\"ok\":false,\"error\":" + q(o.err.isEmpty() ? out : o.err) + "}"); return; }
        json(ex, 200, out);
    }

    /** Tesztek futtatása: pytest, ha telepítve van, különben unittest. */
    static void pyTest(HttpExchange ex, String rel, String only) throws IOException {
        Path dir = rel == null || rel.isEmpty() ? WS : resolve(rel);
        if (!Files.isDirectory(dir)) dir = dir.getParent();
        List<String> py = pythonFor(dir);
        if (py == null) { json(ex, 200, "{\"ok\":false,\"error\":\"nopython\"}"); return; }
        List<String> probe = new ArrayList<>(py); probe.addAll(List.of("-m", "pytest", "--version"));
        boolean pytest = exec(probe, dir, null, 20).code == 0;
        List<String> cmd = new ArrayList<>(py);
        if (pytest) {
            cmd.addAll(List.of("-m", "pytest", "-q", "-rA", "--tb=short", "--no-header", "-p", "no:cacheprovider", "--color=no"));
            if (only != null && only.matches("[\\w./:\\[\\]-]+")) cmd.add(only);
        } else {
            cmd.addAll(List.of("-m", "unittest", "discover", "-v", "-p", "*test*.py"));
        }
        long t0 = System.currentTimeMillis();
        Out o = new Out();
        try {
            Process p = pyProc(cmd, dir).start();
            p.getOutputStream().close();
            ByteArrayOutputStream bo = new ByteArrayOutputStream(), be = new ByteArrayOutputStream();
            Thread t1 = new Thread(() -> { try { p.getInputStream().transferTo(bo); } catch (IOException ignored) { } });
            Thread t2 = new Thread(() -> { try { p.getErrorStream().transferTo(be); } catch (IOException ignored) { } });
            t1.start(); t2.start();
            if (!p.waitFor(180, TimeUnit.SECONDS)) { p.destroyForcibly(); o.timeout = true; }
            t1.join(2000); t2.join(2000);
            o.code = o.timeout ? -1 : p.exitValue();
            o.out = bo.toString(StandardCharsets.UTF_8); o.err = be.toString(StandardCharsets.UTF_8);
        } catch (Exception e) { o.err = String.valueOf(e.getMessage()); }
        json(ex, 200, "{\"ok\":true,\"tool\":" + q(pytest ? "pytest" : "unittest") + ",\"code\":" + o.code + ",\"ms\":" + (System.currentTimeMillis() - t0)
                + ",\"timeout\":" + o.timeout + ",\"dir\":" + q(WS.relativize(dir).toString().replace('\\', '/')) + ",\"cmd\":" + q(String.join(" ", cmd.subList(py.size(), cmd.size()))) + ",\"out\":" + q(o.out) + ",\"err\":" + q(o.err) + "}");
    }

    /** Formázás black-kel (ha telepítve van): a szöveg a kérés törzsében. */
    static void pyFormat(HttpExchange ex, String relPath) throws IOException {
        byte[] body = readAll(ex.getRequestBody());
        Path dir = relPath == null ? WS : resolve(relPath).getParent();
        List<String> py = pythonFor(dir);
        if (py == null) { json(ex, 200, "{\"ok\":false,\"error\":\"nopython\"}"); return; }
        List<String> cmd = new ArrayList<>(py);
        cmd.addAll(List.of("-m", "black", "-q", "-"));
        Out o = exec(cmd, dir, body, 30);
        if (o.code != 0) { json(ex, 200, "{\"ok\":false,\"error\":" + q(o.err.contains("No module named") ? "noblack" : o.err.trim()) + "}"); return; }
        json(ex, 200, "{\"ok\":true,\"text\":" + q(o.out) + "}");
    }

    /** Külső hivatkozás megnyitása a rendszer böngészőjében (az asztali alkalmazásból). */
    static void openUrl(HttpExchange ex, String url) throws IOException {
        if (url == null || !url.matches("(?i)(https?://|mailto:)\\S+")) { json(ex, 400, "{\"error\":\"Érvénytelen cím\"}"); return; }
        openBrowser(url);
        json(ex, 200, "{\"ok\":true}");
    }

    /** Megnyitás a Finderben/Intézőben (reveal), vagy az alapértelmezett programmal (openext). */
    static void reveal(HttpExchange ex, String relPath, boolean openWithApp) throws IOException {
        Path p = resolve(relPath == null ? "" : relPath);
        if (!Files.exists(p)) { json(ex, 404, "{\"error\":\"Nincs ilyen elem\"}"); return; }
        List<String> cmd;
        if (MAC) cmd = openWithApp ? List.of("open", p.toString()) : List.of("open", "-R", p.toString());
        else if (WIN) cmd = openWithApp ? List.of("cmd.exe", "/c", "start", "\"\"", p.toString()) : List.of("explorer.exe", "/select," + p);
        else cmd = List.of("xdg-open", (openWithApp || Files.isDirectory(p) ? p : p.getParent()).toString());
        proc(cmd, null).start();
        json(ex, 200, "{\"ok\":true}");
    }

    // ───────────────────────────── Git ─────────────────────────────

    static Path repoParam(String rel) {
        Path r = resolve(rel == null ? "" : rel);
        return r;
    }

    static Out git(Path repo, long timeout, String... args) {
        String g = which("git");
        List<String> cmd = new ArrayList<>();
        cmd.add(g == null ? "git" : g);
        cmd.add("-c"); cmd.add("core.quotepath=false");
        cmd.add("-c"); cmd.add("color.ui=false");
        cmd.addAll(Arrays.asList(args));
        return exec(cmd, repo, null, timeout);
    }

    /** A munkaterület git-tárolói: a megnyitott mappát tartalmazó tároló, és az almappákban lévők. */
    static void gitRepos(HttpExchange ex) throws IOException {
        if (which("git") == null) { json(ex, 200, "{\"git\":false,\"repos\":[]}"); return; }
        List<String> repos = new ArrayList<>();
        Out top = git(WS, 10, "rev-parse", "--show-toplevel");
        String outer = null;
        if (top.code == 0) {
            Path t = Paths.get(top.out.trim()).toAbsolutePath().normalize();
            outer = t.equals(WS) ? "" : null;
            if (outer == null) outer = ".."; // a megnyitott mappa egy nagyobb tároló része
        }
        try (Stream<Path> s = Files.walk(WS, 4)) {
            s.filter(p -> p.getFileName() != null && p.getFileName().toString().equals(".git"))
             .filter(p -> { for (Path part : WS.relativize(p.getParent() == null ? p : p.getParent())) if (part.toString().equals("node_modules")) return false; return true; })
             .map(p -> rel(p.getParent())).filter(r -> !r.isEmpty()).sorted().limit(100).forEach(repos::add);
        }
        StringBuilder sb = new StringBuilder("{\"git\":true,\"version\":").append(q(GIT_VER)).append(",\"root\":")
                .append(outer == null ? "null" : q(outer)).append(",\"rootPath\":").append(top.code == 0 ? q(top.out.trim()) : "null").append(",\"repos\":[");
        for (int i = 0; i < repos.size(); i++) { if (i > 0) sb.append(','); sb.append(q(repos.get(i))); }
        sb.append("],\"identity\":");
        Out name = git(WS, 5, "config", "user.name"), mail = git(WS, 5, "config", "user.email");
        sb.append(name.code == 0 && !name.out.isBlank() ? q(name.out.trim() + " <" + mail.out.trim() + ">") : "null");
        json(ex, 200, sb.append('}').toString());
    }

    /** A tároló gyökere a munkaterülethez képest (".." jelentése: a munkaterület egy külső tároló része). */
    static Path repoDir(String repo) {
        if (repo == null || repo.isEmpty() || repo.equals("..")) return WS;
        return resolve(repo);
    }

    /** Egy tárolóbeli útvonal átalakítása a munkaterülethez képest relatívvá. */
    static String toWs(Path repoTop, String inRepo) {
        Path abs = repoTop.resolve(inRepo).normalize();
        if (abs.startsWith(WS)) return rel(abs);
        return null;
    }

    static Path gitTop(Path dir) {
        Out t = git(dir, 10, "rev-parse", "--show-toplevel");
        return t.code == 0 ? Paths.get(t.out.trim()).toAbsolutePath().normalize() : null;
    }

    static void gitStatus(HttpExchange ex, String repo) throws IOException {
        Path dir = repoDir(repo);
        Path top = gitTop(dir);
        if (top == null) { json(ex, 200, "{\"repo\":false}"); return; }
        Out o = git(dir, 30, "status", "--porcelain=v1", "-b", "-z", "--untracked-files=all");
        if (o.code != 0) { json(ex, 200, "{\"repo\":true,\"error\":" + q(o.err) + "}"); return; }
        String[] parts = o.out.split("\0");
        StringBuilder files = new StringBuilder("[");
        String branch = "", upstream = "";
        int ahead = 0, behind = 0;
        boolean first = true, noCommits = false;
        for (int i = 0; i < parts.length; i++) {
            String e = parts[i];
            if (e.isEmpty()) continue;
            if (e.startsWith("## ")) {
                String b = e.substring(3);
                if (b.startsWith("No commits yet on ")) { noCommits = true; branch = b.substring(18); continue; }
                if (b.startsWith("Initial commit on ")) { noCommits = true; branch = b.substring(18); continue; }
                Matcher m = Pattern.compile("^(.+?)(?:\\.\\.\\.(\\S+))?(?: \\[(.*)\\])?$").matcher(b);
                if (m.find()) {
                    branch = m.group(1);
                    upstream = m.group(2) == null ? "" : m.group(2);
                    String ab = m.group(3) == null ? "" : m.group(3);
                    Matcher ma = Pattern.compile("ahead (\\d+)").matcher(ab); if (ma.find()) ahead = Integer.parseInt(ma.group(1));
                    Matcher mb = Pattern.compile("behind (\\d+)").matcher(ab); if (mb.find()) behind = Integer.parseInt(mb.group(1));
                }
                continue;
            }
            if (e.length() < 4) continue;
            char x = e.charAt(0), y = e.charAt(1);
            String path = e.substring(3);
            String from = null;
            if (x == 'R' || x == 'C') { from = i + 1 < parts.length ? parts[++i] : null; }
            String ws = toWs(top, path);
            if (ws == null) continue; // a megnyitott mappán kívüli fájl
            if (!first) files.append(',');
            first = false;
            files.append("{\"p\":").append(q(ws)).append(",\"x\":").append(q(String.valueOf(x))).append(",\"y\":").append(q(String.valueOf(y)));
            if (from != null) files.append(",\"from\":").append(q(from));
            files.append('}');
        }
        files.append(']');
        Out remotes = git(dir, 10, "remote");
        Out stash = git(dir, 10, "stash", "list");
        int stashCount = stash.code == 0 && !stash.out.isBlank() ? stash.out.trim().split("\\R").length : 0;
        String detached = branch.startsWith("HEAD (no branch)") ? "true" : "false";
        json(ex, 200, "{\"repo\":true,\"top\":" + q(top.toString()) + ",\"branch\":" + q(branch) + ",\"upstream\":" + q(upstream)
                + ",\"ahead\":" + ahead + ",\"behind\":" + behind + ",\"noCommits\":" + noCommits + ",\"detached\":" + detached
                + ",\"remotes\":" + jsonList(remotes.code == 0 ? remotes.out : "") + ",\"stash\":" + stashCount + ",\"files\":" + files + "}");
    }

    static String jsonList(String lines) {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (String l : lines.split("\\R")) {
            if (l.isBlank()) continue;
            if (!first) sb.append(',');
            first = false;
            sb.append(q(l.trim()));
        }
        return sb.append(']').toString();
    }

    static void gitLog(HttpExchange ex, String repo) throws IOException {
        Path dir = repoDir(repo);
        Out o = git(dir, 30, "log", "--all", "--date-order", "-n", "300", "--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e");
        StringBuilder sb = new StringBuilder("{\"commits\":[");
        boolean first = true;
        if (o.code == 0) {
            for (String rec : o.out.split("\u001e")) {
                String r = rec.replaceAll("^\\s+", "");
                if (r.isEmpty()) continue;
                String[] f = r.split("\u001f", -1);
                if (f.length < 6) continue;
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"h\":").append(q(f[0])).append(",\"p\":").append(q(f[1])).append(",\"a\":").append(q(f[2]))
                  .append(",\"t\":").append(f[3].isBlank() ? "0" : f[3].trim()).append(",\"d\":").append(q(f[4])).append(",\"s\":").append(q(f[5].trim())).append('}');
            }
        }
        sb.append("],\"branches\":[");
        Out b = git(dir, 10, "branch", "-a", "--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(objectname)");
        first = true;
        if (b.code == 0) for (String l : b.out.split("\\R")) {
            if (l.isBlank()) continue;
            String[] f = l.split("\u001f", -1);
            if (f.length < 4 || f[0].endsWith("/HEAD") || f[0].equals("HEAD") || f[0].startsWith("(")) continue;
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"n\":").append(q(f[0])).append(",\"cur\":").append(f[1].trim().equals("*")).append(",\"up\":").append(q(f[2])).append(",\"h\":").append(q(f[3])).append('}');
        }
        json(ex, 200, sb.append("]}").toString());
    }

    static void gitShow(HttpExchange ex, String repo, String wsPath, String ref) throws IOException {
        Path dir = repoDir(repo);
        Path top = gitTop(dir);
        if (top == null) { json(ex, 404, "{\"error\":\"Nem git-tároló\"}"); return; }
        Path abs = resolve(wsPath);
        String inRepo = top.relativize(abs).toString().replace('\\', '/');
        String r = ref == null || ref.isBlank() ? "HEAD" : ref;
        if (!r.matches("[\\w./~^-]+")) { json(ex, 400, "{\"error\":\"Érvénytelen hivatkozás\"}"); return; }
        Out o = git(top, 20, "show", r + ":" + inRepo);
        if (o.code != 0) { send(ex, 204, "text/plain", new byte[0]); return; }
        send(ex, 200, "text/plain; charset=utf-8", o.out.getBytes(StandardCharsets.UTF_8));
    }

    /** Git-műveletek. Minden válasz tartalmazza a lefuttatott parancsot, hogy a felület meg tudja mutatni. */
    static void gitDo(HttpExchange ex, String repo, String action, List<String> paths, String body) throws IOException {
        Path dir = repoDir(repo);
        Path top = action.equals("init") ? dir : gitTop(dir);
        if (top == null) { json(ex, 400, "{\"error\":\"Ez a mappa nem git-tároló\"}"); return; }
        List<String> ps = new ArrayList<>();
        for (String p : paths) ps.add(top.relativize(resolve(p)).toString().replace('\\', '/'));
        List<List<String>> steps = new ArrayList<>();
        Map<Integer, String> shown = new HashMap<>();
        String a1 = body == null ? "" : body.trim();
        switch (action) {
            case "init": steps.add(List.of("-c", "init.defaultBranch=main", "init")); break;
            case "stage": case "unstage": case "discard": {
                if (ps.isEmpty()) { json(ex, 400, "{\"error\":\"Nincs kiválasztott fájl\"}"); return; }
                // A fájlnevek fájlon át mennek (ékezetes nevek miatt).
                Path list = META.resolve("PATHSPEC");
                Files.write(list, String.join("\0", ps).getBytes(StandardCharsets.UTF_8));
                List<String> c = action.equals("stage") ? new ArrayList<>(List.of("add"))
                        : action.equals("unstage") ? new ArrayList<>(List.of("restore", "--staged")) : new ArrayList<>(List.of("restore"));
                c.add("--pathspec-from-file=" + list); c.add("--pathspec-file-nul");
                steps.add(c);
                List<String> shownCmd = new ArrayList<>(c.subList(0, c.size() - 2));
                shownCmd.addAll(ps);
                shown.put(steps.size() - 1, "git " + display(shownCmd));
                break;
            }
            case "stageAll": steps.add(List.of("add", "-A")); break;
            case "unstageAll": steps.add(List.of("restore", "--staged", ".")); break;
            case "clean": { List<String> c = new ArrayList<>(List.of("clean", "-f", "--")); c.addAll(ps); steps.add(c); break; }
            case "commit": case "commitAll": {
                if (a1.isEmpty()) { json(ex, 400, "{\"error\":\"Írj commit-üzenetet\"}"); return; }
                // Az üzenet fájlon át megy, így az ékezetek minden rendszeren épen maradnak.
                Path msg = META.resolve("COMMIT_MSG");
                Files.write(msg, a1.getBytes(StandardCharsets.UTF_8));
                if (action.equals("commitAll")) steps.add(List.of("add", "-A"));
                steps.add(List.of("commit", "-F", msg.toString()));
                shown.put(steps.size() - 1, "git commit -m " + display(List.of(a1)));
                break;
            }
            case "amend": steps.add(List.of("commit", "--amend", "--no-edit")); break;
            case "switch": if (!a1.matches("[\\w./-]+")) { json(ex, 400, "{\"error\":\"Érvénytelen ágnév\"}"); return; }
                if (a1.contains("/") && git(top, 10, "rev-parse", "--verify", "refs/remotes/" + a1).code == 0 && git(top, 10, "rev-parse", "--verify", "refs/heads/" + a1).code != 0)
                    steps.add(List.of("switch", "--track", a1));
                else steps.add(List.of("switch", a1));
                break;
            case "branch": if (!a1.matches("[\\w./-]+") || a1.startsWith("-")) { json(ex, 400, "{\"error\":\"Az ág neve csak betűt, számot, - _ / . jelet tartalmazhat, szóköz nélkül.\"}"); return; } steps.add(List.of("switch", "-c", a1)); break;
            case "deleteBranch": if (!a1.matches("[\\w./-]+")) { json(ex, 400, "{\"error\":\"Érvénytelen ágnév\"}"); return; } steps.add(List.of("branch", "-d", a1)); break;
            case "merge": if (!a1.matches("[\\w./-]+")) { json(ex, 400, "{\"error\":\"Érvénytelen ágnév\"}"); return; } steps.add(List.of("merge", "--no-edit", a1)); break;
            case "fetch": steps.add(List.of("fetch", "--all", "--prune")); break;
            case "pull": steps.add(List.of("pull", "--no-rebase", "--no-edit")); break;
            case "push": {
                Out up = git(top, 10, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
                if (up.code == 0) steps.add(List.of("push"));
                else {
                    String br = git(top, 10, "rev-parse", "--abbrev-ref", "HEAD").out.trim();
                    steps.add(List.of("push", "-u", "origin", br));
                }
                break;
            }
            case "stash": steps.add(List.of("stash", "push", "-u", "-m", a1.isEmpty() ? "FACET félretett munka" : a1)); break;
            case "stashPop": steps.add(List.of("stash", "pop")); break;
            case "remote": if (!a1.matches("(https?://|git@)[^\\s]+")) { json(ex, 400, "{\"error\":\"Adj meg egy érvényes tároló címet (https://… vagy git@…)\"}"); return; }
                if (git(top, 10, "remote", "get-url", "origin").code == 0) steps.add(List.of("remote", "set-url", "origin", a1));
                else steps.add(List.of("remote", "add", "origin", a1));
                break;
            default: json(ex, 400, "{\"error\":\"Ismeretlen git-művelet\"}"); return;
        }
        StringBuilder cmds = new StringBuilder("[");
        StringBuilder out = new StringBuilder(), err = new StringBuilder();
        int code = 0;
        for (int i = 0; i < steps.size(); i++) {
            List<String> st = steps.get(i);
            if (i > 0) cmds.append(',');
            cmds.append(q(shown.getOrDefault(i, "git " + display(st.get(0).equals("-c") ? st.subList(2, st.size()) : st))));
            boolean net = action.equals("push") || action.equals("pull") || action.equals("fetch");
            Out o = git(top, net ? 180 : 60, st.toArray(new String[0]));
            out.append(o.out);
            err.append(o.err);
            code = o.timeout ? 124 : o.code;
            if (code != 0) break;
        }
        cmds.append(']');
        json(ex, 200, "{\"ok\":" + (code == 0) + ",\"code\":" + code + ",\"cmds\":" + cmds + ",\"out\":" + q(out.toString()) + ",\"err\":" + q(err.toString()) + "}");
    }

    static String display(List<String> args) {
        StringBuilder sb = new StringBuilder();
        for (String a : args) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(a.matches("[\\w./@:=-]+") ? a : "\"" + a.replace("\"", "\\\"") + "\"");
        }
        return sb.toString();
    }

    static void gitIdentity(HttpExchange ex, String body) throws IOException {
        String[] f = body.split("\n", 2);
        if (f.length < 2 || f[0].isBlank() || !f[1].contains("@")) { json(ex, 400, "{\"error\":\"Add meg a neved és az e-mail címed\"}"); return; }
        Out a = git(HOME, 10, "config", "--global", "user.name", f[0].trim());
        Out b = git(HOME, 10, "config", "--global", "user.email", f[1].trim());
        json(ex, 200, "{\"ok\":" + (a.code == 0 && b.code == 0) + "}");
    }

    // ───────────────────────────── dokumentumok (.docx) ─────────────────────────────

    /** Egy zip-alapú dokumentum (docx) tartalma egyszerű konténerben: [névhossz][név][adathossz][adat]… */
    static void zipRead(HttpExchange ex, String relPath) throws IOException {
        Path p = resolve(relPath);
        if (!Files.isRegularFile(p)) { json(ex, 404, "{\"error\":\"Nincs ilyen fájl\"}"); return; }
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        java.io.DataOutputStream out = new java.io.DataOutputStream(bo);
        long total = 0;
        try (java.util.zip.ZipInputStream zin = new java.util.zip.ZipInputStream(Files.newInputStream(p))) {
            java.util.zip.ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                byte[] data = zin.readAllBytes();
                total += data.length;
                if (total > 60L * 1024 * 1024) { json(ex, 413, "{\"error\":\"A dokumentum túl nagy (60 MB fölött)\"}"); return; }
                byte[] name = e.getName().getBytes(StandardCharsets.UTF_8);
                out.writeInt(name.length); out.write(name);
                out.writeInt(data.length); out.write(data);
            }
        } catch (java.util.zip.ZipException ze) {
            json(ex, 415, "{\"error\":\"Ez nem érvényes .docx fájl\"}");
            return;
        }
        send(ex, 200, "application/octet-stream", bo.toByteArray());
    }

    static void zipWrite(HttpExchange ex, String relPath) throws IOException {
        Path p = resolve(relPath);
        byte[] body = readAll(ex.getRequestBody());
        java.io.DataInputStream in = new java.io.DataInputStream(new java.io.ByteArrayInputStream(body));
        if (p.getParent() != null) Files.createDirectories(p.getParent());
        // Az eredeti dokumentumról egyszer biztonsági másolat készül, mielőtt a FACET felülírja.
        if (Files.isRegularFile(p)) {
            Path bak = META.resolve("backup").resolve(rel(p) + ".eredeti");
            if (!Files.exists(bak)) { Files.createDirectories(bak.getParent()); Files.copy(p, bak); }
        }
        Path tmp = p.resolveSibling("." + p.getFileName() + ".facet-tmp");
        try (java.util.zip.ZipOutputStream zout = new java.util.zip.ZipOutputStream(Files.newOutputStream(tmp))) {
            while (in.available() > 0) {
                byte[] name = new byte[in.readInt()]; in.readFully(name);
                byte[] data = new byte[in.readInt()]; in.readFully(data);
                zout.putNextEntry(new java.util.zip.ZipEntry(new String(name, StandardCharsets.UTF_8)));
                zout.write(data);
                zout.closeEntry();
            }
        }
        Files.move(tmp, p, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        json(ex, 200, "{\"ok\":true,\"bytes\":" + Files.size(p) + "}");
    }

    // ───────────────────────────── segédek ─────────────────────────────

    static final Map<String, String> MIME = new HashMap<>();
    static {
        String[][] m = {
            {"html", "text/html; charset=utf-8"}, {"htm", "text/html; charset=utf-8"},
            {"css", "text/css; charset=utf-8"}, {"js", "text/javascript; charset=utf-8"}, {"mjs", "text/javascript; charset=utf-8"},
            {"json", "application/json; charset=utf-8"}, {"txt", "text/plain; charset=utf-8"}, {"md", "text/plain; charset=utf-8"},
            {"java", "text/plain; charset=utf-8"}, {"svg", "image/svg+xml"}, {"png", "image/png"}, {"jpg", "image/jpeg"},
            {"jpeg", "image/jpeg"}, {"gif", "image/gif"}, {"webp", "image/webp"}, {"ico", "image/x-icon"},
            {"woff", "font/woff"}, {"woff2", "font/woff2"}, {"ttf", "font/ttf"}, {"mp3", "audio/mpeg"},
            {"mp4", "video/mp4"}, {"wav", "audio/wav"}, {"pdf", "application/pdf"}
        };
        for (String[] e : m) MIME.put(e[0], e[1]);
    }

    static void serveFile(HttpExchange ex, Path p, Path base) throws IOException {
        if (!p.startsWith(base) || !Files.isRegularFile(p)) {
            send(ex, 404, "text/plain; charset=utf-8", "Nem található".getBytes(StandardCharsets.UTF_8));
            return;
        }
        String name = p.getFileName().toString();
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        if (base == WEB && WEB.relativize(p).toString().replace('\\', '/').startsWith("vendor/")) {
            ex.getResponseHeaders().set("Content-Type", MIME.getOrDefault(ext, "application/octet-stream"));
            ex.getResponseHeaders().set("Cache-Control", "max-age=86400");
            byte[] b = Files.readAllBytes(p);
            ex.sendResponseHeaders(200, b.length == 0 ? -1 : b.length);
            if (b.length > 0) try (OutputStream os = ex.getResponseBody()) { os.write(b); }
            return;
        }
        send(ex, 200, MIME.getOrDefault(ext, "application/octet-stream"), Files.readAllBytes(p));
    }

    static void deleteTree(Path p) throws IOException {
        if (!Files.exists(p)) return;
        try (Stream<Path> s = Files.walk(p)) {
            for (Path x : s.sorted(Comparator.reverseOrder()).collect(Collectors.toList())) Files.deleteIfExists(x);
        }
    }

    static void json(HttpExchange ex, int code, String body) throws IOException {
        send(ex, code, "application/json; charset=utf-8", body.getBytes(StandardCharsets.UTF_8));
    }

    static void send(HttpExchange ex, int code, String type, byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(code, body.length == 0 ? -1 : body.length);
        if (body.length > 0) try (OutputStream os = ex.getResponseBody()) { os.write(body); }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        in.transferTo(bo);
        return bo.toByteArray();
    }

    static Map<String, List<String>> query(String raw) {
        Map<String, List<String>> m = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) return m;
        for (String part : raw.split("&")) {
            int i = part.indexOf('=');
            String k = decode(i < 0 ? part : part.substring(0, i));
            String v = i < 0 ? "" : decode(part.substring(i + 1));
            m.computeIfAbsent(k, x -> new ArrayList<>()).add(v);
        }
        return m;
    }

    static String one(Map<String, List<String>> q, String k) {
        List<String> v = q.get(k);
        return v == null || v.isEmpty() ? null : v.get(0);
    }

    static String decode(String s) {
        return URLDecoder.decode(s.replace("+", "%2B"), StandardCharsets.UTF_8);
    }

    /** JSON szöveg idézése. */
    static String q(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.length() + 16).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
