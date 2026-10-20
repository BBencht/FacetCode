/* FACET — projektsablonok és fájlvázak */
window.FacetSamples = (function () {

  const javaStart = {
    'src/Main.java':
`import java.util.Scanner;

public class Main {

    public static void main(String[] args) {
        Scanner be = new Scanner(System.in);
        System.out.print("Hogy hívnak? ");
        String nev = be.nextLine();

        System.out.print("Mennyi az átlagod? ");
        double atlag = Double.parseDouble(be.nextLine().replace(',', '.'));

        Diak diak = new Diak(nev, atlag);
        System.out.println("Szia, " + diak.getNev() + "!");
        System.out.println(diak.ertekeles());
    }
}
`,
    'src/Diak.java':
`public class Diak {
    private String nev;
    private double atlag;

    public Diak(String nev, double atlag) {
        this.nev = nev;
        this.atlag = atlag;
    }

    public String getNev() {
        return nev;
    }

    public double getAtlag() {
        return atlag;
    }

    public String ertekeles() {
        if (atlag >= 4.5) {
            return "Kitűnő munka, " + atlag + " az átlagod!";
        } else if (atlag >= 3.5) {
            return "Szép eredmény: " + atlag;
        }
        return "Van még hova fejlődni: " + atlag;
    }
}
`
  };

  const javaKonzol = {
    'src/Main.java':
`import java.util.Scanner;

public class Main {

    public static void main(String[] args) {
        Scanner be = new Scanner(System.in);
        System.out.print("Írj be egy számot: ");
        int szam = Integer.parseInt(be.nextLine().trim());

        for (int i = 1; i <= 10; i++) {
            System.out.println(szam + " × " + i + " = " + (szam * i));
        }
    }
}
`
  };

  const javaOop = {
    'src/hu/facet/allatok/Main.java':
`package hu.facet.allatok;

import java.util.ArrayList;
import java.util.List;

public class Main {

    public static void main(String[] args) {
        List<Allat> allatok = new ArrayList<>();
        allatok.add(new Kutya("Bodri"));
        allatok.add(new Macska("Cirmi"));

        for (Allat a : allatok) {
            System.out.println(a.getNev() + ": " + a.hang());
        }
    }
}
`,
    'src/hu/facet/allatok/Allat.java':
`package hu.facet.allatok;

public abstract class Allat implements Hangado {
    protected String nev;

    public Allat(String nev) {
        this.nev = nev;
    }

    public String getNev() {
        return nev;
    }
}
`,
    'src/hu/facet/allatok/Hangado.java':
`package hu.facet.allatok;

public interface Hangado {
    String hang();
}
`,
    'src/hu/facet/allatok/Kutya.java':
`package hu.facet.allatok;

public class Kutya extends Allat {

    public Kutya(String nev) {
        super(nev);
    }

    @Override
    public String hang() {
        return "Vau!";
    }
}
`,
    'src/hu/facet/allatok/Macska.java':
`package hu.facet.allatok;

public class Macska extends Allat {

    public Macska(String nev) {
        super(nev);
    }

    @Override
    public String hang() {
        return "Miau!";
    }
}
`
  };

  const web = {
    'index.html':
`<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pék &amp; Kávé</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="hero">
    <span class="eyebrow">Pék &amp; Kávé · Ráday utca</span>
    <h1 class="hero-title">Friss kenyér, reggel hétkor.</h1>
    <p>Kovászos kenyér és kávé a Ráday utcában.</p>
    <a class="btn" href="#menu">Napi kínálat</a>
  </header>

  <section id="menu" class="grid">
    <article class="card">
      <h2>Kovászos vekni</h2>
      <p class="price">1 450 Ft</p>
    </article>
    <article class="card">
      <h2>Kakaós csiga</h2>
      <p class="price">690 Ft</p>
    </article>
    <article class="card">
      <h2>Flat white</h2>
      <p class="price">950 Ft</p>
    </article>
  </section>

  <script src="script.js"></script>
</body>
</html>
`,
    'style.css':
`:root {
  --kenyer: #C8793A;
  --kakao: #3B2A20;
  --liszt: #F6EFE6;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: var(--kakao);
  background: #FFFDFA;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  padding: 64px 24px;
  background: var(--liszt);
}

.eyebrow {
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--kenyer);
  font-weight: 600;
}

.hero-title {
  margin: 0;
  font-family: Georgia, serif;
  font-size: clamp(2rem, 6vw, 3.5rem);
  line-height: 1.05;
}

.btn {
  padding: 12px 20px;
  border-radius: 999px;
  background: var(--kenyer);
  color: #FFF8F0;
  text-decoration: none;
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  padding: 32px 24px;
}

.card {
  padding: 20px;
  border-radius: 14px;
  background: white;
  box-shadow: 0 10px 24px -12px rgba(59, 42, 32, 0.35);
  cursor: pointer;
  transition: transform 0.2s;
}

.card:hover { transform: translateY(-3px); }
.card h2 { margin: 0 0 6px; font-size: 18px; }
.price { margin: 0; color: #8A7060; }
`,
    'script.js':
`const kartyak = document.querySelectorAll('.card');
console.log('Napi kínálat betöltve:', kartyak.length, 'tétel');

kartyak.forEach((kartya) => {
  kartya.addEventListener('click', () => {
    const nev = kartya.querySelector('h2').textContent;
    console.log('Kosárba téve:', nev);
    kartya.style.outline = '2px solid #C8793A';
  });
});
`
  };

  const python = {
    'main.py': `\"\"\"Egy kis Python bemutató: bemenet, függvény, osztály.\"\"\"

from diak import Diak


def udvozol(nev: str) -> str:
    return f"Szia, {nev}!"


def main() -> None:
    nev = input("Hogy hívnak? ")
    print(udvozol(nev))

    atlag = float(input("Mennyi az átlagod? ").replace(",", "."))
    diak = Diak(nev, atlag)
    print(diak.ertekeles())


if __name__ == "__main__":
    main()
`,
    'diak.py': `class Diak:
    \"\"\"Egy diák neve és tanulmányi átlaga.\"\"\"

    def __init__(self, nev: str, atlag: float) -> None:
        self.nev = nev
        self.atlag = atlag

    def ertekeles(self) -> str:
        if self.atlag >= 4.5:
            return f"Kitűnő munka, {self.atlag} az átlagod!"
        if self.atlag >= 3.5:
            return "Szép eredmény, csak így tovább!"
        return "Lesz ez még jobb is. Hajrá!"

    def __repr__(self) -> str:
        return f"Diak(nev={self.nev!r}, atlag={self.atlag})"
`,
    'szamkitalalo.py': `import random


def jatek() -> None:
    titok = random.randint(1, 100)
    probak = 0
    print("Gondoltam egy számra 1 és 100 között.")
    while True:
        tipp = int(input("Tipped: "))
        probak += 1
        if tipp < titok:
            print("Nagyobb!")
        elif tipp > titok:
            print("Kisebb!")
        else:
            print(f"Eltaláltad {probak} próbálkozásból!")
            break


if __name__ == "__main__":
    jatek()
`,
    'requirements.txt': '# Ide kerülnek a használt csomagok, soronként egy (pl. requests)\n'
  };

  const templates = [
    { id: 'java-konzol', name: 'Java konzolprogram', facet: 'java', desc: 'main metódus, Scanner bemenet, azonnal futtatható.', files: javaKonzol, open: 'src/Main.java',
      thumb: '<span style="color:#B9A6F7">public static void</span> <span style="color:#7FB4FF">main</span>(…) {<br>&nbsp;&nbsp;Scanner be = <span style="color:#B9A6F7">new</span> …<br><span style="color:#FF8A3D">▶ Írj be egy számot:</span>' },
    { id: 'java-oop', name: 'Java OOP projekt', facet: 'java', desc: 'Csomagok, öröklődés, interfész. Az osztálytérkép rögtön mutatja.', files: javaOop, open: 'src/hu/facet/allatok/Main.java',
      thumb: '<span style="display:flex;gap:10px;align-items:flex-start"><span style="padding:5px 8px;border-radius:6px;border:1px solid rgba(255,138,61,.4);color:#FFB27F">Allat</span><span style="align-self:center;width:20px;height:1px;background:#3A4558"></span><span style="padding:5px 8px;border-radius:6px;border:1px solid #2A3341;color:#A9B4C6">Kutya</span><span style="padding:5px 8px;border-radius:6px;border:1px solid #2A3341;color:#A9B4C6;margin-top:22px">Macska</span></span>' },
    { id: 'weboldal', name: 'Weboldal', facet: 'html', desc: 'HTML, CSS és JS összekötve, élő előnézettel telefonon és asztalin.', files: web, open: 'index.html', light: true,
      thumb: '<span style="display:flex;flex-direction:column;gap:6px"><b style="font:700 13px Georgia,serif;color:#3B2A20">Friss kenyér, reggel hétkor.</b><span style="width:70%;height:5px;border-radius:3px;background:#D9C9B6"></span><span style="width:64px;height:16px;border-radius:99px;background:#C8793A"></span></span>' },
    { id: 'python', name: 'Python projekt', facet: 'py', desc: 'Bemenet, függvények, osztály és egy kis számkitalálós játék.', files: python, open: 'main.py',
      thumb: '<span style="display:flex;flex-direction:column;gap:4px;font:12px ui-monospace,Menlo,monospace"><span><span style="color:#B9A6F7">def</span> <span style="color:#2EC4B6">udvozol</span>(nev):</span><span style="padding-left:16px"><span style="color:#B9A6F7">return</span> <span style="color:#E6C07B">f"Szia, {nev}!"</span></span></span>' },
    { id: 'ures', name: 'Üres projekt', facet: 'text', desc: 'Az első fájl kiterjesztése dönti el, milyen arcot kap.', files: {}, open: null,
      thumb: '<span style="display:flex;height:100%;align-items:center;justify-content:center">Üres mappa, saját szerkezet</span>' }
  ];

  function blank(path) {
    const name = path.split('/').pop();
    const ext = (name.split('.').pop() || '').toLowerCase();
    const stem = name.replace(/\.[^.]+$/, '');
    if (ext === 'java') return javaClass(path, stem, 'class', false);
    if (ext === 'html' || ext === 'htm') return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${stem}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>${stem}</h1>

  <script src="script.js"></script>
</body>
</html>
`;
    if (ext === 'css') return '';
    if (ext === 'js') return '';
    if (ext === 'py') return `def main() -> None:\n    print("Szia, ${stem}!")\n\n\nif __name__ == "__main__":\n    main()\n`;
    if (ext === 'json') return '{\n  \n}\n';
    if (ext === 'md') return `# ${stem}\n\n`;
    return '';
  }

  /** A csomagnév az útvonalból: src/hu/app/Main.java → hu.app */
  function packageFor(path) {
    const parts = path.split('/');
    parts.pop();
    const i = parts.indexOf('java') >= 0 && parts[parts.indexOf('java') - 1] === 'main' ? parts.indexOf('java') : parts.indexOf('src');
    if (i < 0) return '';
    const pkg = parts.slice(i + 1).filter(Boolean);
    return pkg.every((p) => /^[a-z_][a-z0-9_]*$/i.test(p)) ? pkg.join('.') : '';
  }

  function javaClass(path, name, kind, withMain) {
    const pkg = packageFor(path);
    const head = pkg ? `package ${pkg};\n\n` : '';
    let decl;
    if (kind === 'interface') decl = `public interface ${name} {\n\n}\n`;
    else if (kind === 'enum') decl = `public enum ${name} {\n    ELSO,\n    MASODIK\n}\n`;
    else if (kind === 'record') decl = `public record ${name}(String nev, int ertek) {\n\n}\n`;
    else if (kind === 'abstract') decl = `public abstract class ${name} {\n\n}\n`;
    else if (withMain) decl = `public class ${name} {\n\n    public static void main(String[] args) {\n        System.out.println("Szia, ${name}!");\n    }\n}\n`;
    else decl = `public class ${name} {\n\n    public ${name}() {\n    }\n}\n`;
    return head + decl;
  }

  return { javaStart, web, python, templates, blank, javaClass, packageFor };
})();
