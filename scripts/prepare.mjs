// FACET — az asztali alkalmazás erőforrásainak előkészítése
//   1. lefordítja a motort (engine/Facet.java → facet-engine.jar, Java 11-re)
//   2. bemásolja a felületet (web/)
//   3. a kódszerkesztőt (Monaco) és az Emmetet helyben csomagolja, így internet nélkül is működik
// Futtatás: node scripts/prepare.mjs   (JDK és `npm install` kell hozzá)

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'src-tauri', 'res');
const build = join(root, 'build', 'engine');

const exe = (name) => {
  const home = process.env.JAVA_HOME;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  if (home && existsSync(join(home, 'bin', name + suffix))) return join(home, 'bin', name + suffix);
  return name;
};

console.log('◆ FACET előkészítés');
rmSync(res, { recursive: true, force: true });
rmSync(build, { recursive: true, force: true });
mkdirSync(join(res, 'engine'), { recursive: true });
mkdirSync(build, { recursive: true });

// 1. motor
console.log('  ▸ motor fordítása (Java 11)');
execFileSync(exe('javac'), ['--release', '11', '-encoding', 'UTF-8', '-Xlint:-options', '-d', build, join(root, 'engine', 'Facet.java')], { stdio: 'inherit' });
execFileSync(exe('jar'), ['--create', '--file', join(res, 'engine', 'facet-engine.jar'), '--main-class', 'Facet', '-C', build, '.'], { stdio: 'inherit' });

// 2. felület
console.log('  ▸ felület másolása');
cpSync(join(root, 'web'), join(res, 'web'), { recursive: true });

// 3. Monaco és Emmet helyben
const vendor = join(res, 'web', 'vendor');
const monaco = join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
if (existsSync(monaco)) {
  console.log('  ▸ Monaco szerkesztő csomagolása');
  cpSync(monaco, join(vendor, 'monaco', 'vs'), { recursive: true });
} else {
  console.warn('  ! A monaco-editor nincs telepítve (npm install) — a szerkesztő az internetről töltődik majd.');
}
const emmetDir = join(root, 'node_modules', 'emmet-monaco-es', 'dist');
if (existsSync(emmetDir)) {
  const files = readdirSync(emmetDir).filter((f) => f.endsWith('.js') && statSync(join(emmetDir, f)).isFile());
  const pick = files.find((f) => /emmet-monaco\.min\.js$/.test(f)) || files.find((f) => /min\.js$/.test(f)) || files.find((f) => /umd/i.test(f)) || files[0];
  if (pick) {
    mkdirSync(join(vendor, 'emmet'), { recursive: true });
    cpSync(join(emmetDir, pick), join(vendor, 'emmet', 'emmet-monaco.min.js'));
    console.log('  ▸ Emmet: ' + pick);
  }
}
writeFileSync(join(res, 'VERSION'), (process.env.npm_package_version || '') + '\n');
console.log('✓ Kész: src-tauri/res');
