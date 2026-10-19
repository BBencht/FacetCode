#!/bin/bash
# FACET indító macOS-re — dupla kattintással indul.
cd "$(dirname "$0")" || exit 1
clear
echo ""
echo "  ◆ FACET indítása…"
echo ""

JAVA_BIN=""
if [ -x /usr/libexec/java_home ]; then
  JH=$(/usr/libexec/java_home -v 11+ 2>/dev/null)
  if [ -n "$JH" ] && [ -x "$JH/bin/javac" ]; then JAVA_BIN="$JH/bin/java"; fi
fi
if [ -z "$JAVA_BIN" ] && command -v javac >/dev/null 2>&1 && javac -version >/dev/null 2>&1; then
  JAVA_BIN="java"
fi

if [ -z "$JAVA_BIN" ]; then
  echo "  Nem találok JDK-t (Java 11 vagy újabb kell, fordítóval)."
  echo "  Telepítsd innen: https://adoptium.net  (Temurin 21, macOS .pkg)"
  echo "  Utána indítsd újra ezt a fájlt."
  echo ""
  open "https://adoptium.net/temurin/releases/?os=mac&package=jdk" 2>/dev/null
  read -n 1 -s -r -p "  Nyomj meg egy gombot a kilépéshez…"
  exit 1
fi

"$JAVA_BIN" Facet.java "$@"
