# DB Manager Companion — instalación del ejecutable nativo

El plugin de Beekeeper Studio corre en un iframe sandboxeado sin acceso al sistema de archivos ni a procesos del sistema operativo. Para todo lo que necesita ese acceso — `mysqldump`/`pg_dump`, escanear contenedores Docker, leer archivos `.env` locales, comparar esquemas entre dos conexiones — el plugin habla por HTTP con un pequeño daemon local llamado **Companion**, que solo escucha en `127.0.0.1:58765` (nunca sale de tu equipo).

Este documento es para quien instaló el plugin desde el marketplace de Beekeeper Studio y necesita el Companion para usar Clonado Stream, Auto-Discovery o Schema Diff. Si clonaste el repositorio para desarrollar, no necesitas nada de esto — `npm install` ya lo configura por ti (ver el README, "Opción B").

## 1. Descarga el ejecutable de tu sistema

Ve a la [página de releases](https://github.com/JonathanHerSa/bks-db-manager/releases/latest) y descarga el archivo de tu sistema operativo, o usa el botón "Descargar Companion" que aparece dentro del plugin cuando el daemon no responde (detecta tu sistema automáticamente):

| Sistema | Archivo |
|---|---|
| Linux (x64) | `bks-db-manager-companion-linux-x64.tar.gz` |
| Linux (ARM64) | `bks-db-manager-companion-linux-arm64.tar.gz` |
| macOS (Apple Silicon) | `bks-db-manager-companion-darwin-arm64.tar.gz` |
| macOS (Intel) | `bks-db-manager-companion-darwin-x64.tar.gz` |
| Windows (x64) | `bks-db-manager-companion-win-x64.zip` |

## 2. Verifica el checksum (opcional pero recomendado)

Cada archivo tiene un `.sha256` junto a él en la misma release.

```bash
# Linux/macOS
sha256sum -c bks-db-manager-companion-linux-x64.tar.gz.sha256

# Windows (PowerShell)
Get-FileHash .\bks-db-manager-companion-win-x64.zip -Algorithm SHA256
```

## 3. Descomprime y ejecútalo (doble clic)

Descomprime el archivo descargado y ejecuta el binario (`bks-db-manager-companion` o `.exe` en Windows) con doble clic. La primera vez:

- Se copia a una ubicación permanente fuera de tu carpeta de Descargas, así que puedes borrar el archivo original después.
- Se registra para arrancar solo con tu sesión (no necesitas volver a hacer esto nunca).
- Arranca inmediatamente.

Puedes cerrar la ventana/consola que se abra en cuanto confirme que quedó instalado — el daemon sigue corriendo en segundo plano.

### ⚠️ El instalador no está firmado (todavía)

Firmar código para Windows y notarizar para macOS tiene un costo recurrente (cuenta de desarrollador de Apple, certificado de firma de Windows) que este proyecto no ha asumido todavía. Eso significa que el sistema operativo va a advertirte antes de dejarte ejecutar el binario la primera vez — es la advertencia estándar para cualquier programa nuevo sin firma, no un indicio de que algo esté mal (puedes verificar el checksum del paso 2 si quieres confirmarlo tú mismo).

**Windows (SmartScreen):**
1. Verás "Windows protegió su PC". Haz clic en **"Más información"**.
2. Aparecerá un botón **"Ejecutar de todas formas"** — haz clic ahí.

**macOS (Gatekeeper):**
1. Verás que macOS no puede abrir el archivo porque "no se puede verificar el desarrollador".
2. Haz **clic derecho** (o Control+clic) sobre el archivo ➔ **"Abrir"** ➔ confirma en el diálogo que aparece.
3. Si sigue sin abrir, ejecuta en una terminal: `xattr -d com.apple.quarantine ./bks-db-manager-companion` y vuelve a intentar.

**Linux:** no hay advertencia del sistema, pero asegúrate de darle permisos de ejecución si tu gestor de archivos no lo hizo automáticamente: `chmod +x ./bks-db-manager-companion`.

## 4. Confirmar que quedó activo

Desde una terminal (o vuelve a ejecutar el binario, que detecta que ya está instalado y solo confirma):

```bash
./bks-db-manager-companion --status
```

Deberías ver `Daemon: ACTIVE on http://127.0.0.1:58765`, junto con qué herramientas de base de datos detectó (`mysqldump`, `pg_dump`, `docker`, etc.) — si te falta alguna, esa es la única razón por la que una feature específica pueda seguir sin funcionar aunque el Companion esté activo.

## 5. Desinstalar

```bash
./bks-db-manager-companion --uninstall
```

Detiene el servicio, lo desregistra del arranque automático y borra la copia instalada. No toca nada del propio Beekeeper Studio ni de tus bases de datos.

## Comandos disponibles

```
bks-db-manager-companion            Instala (primera vez) o verifica el servicio, y termina.
bks-db-manager-companion --serve    Corre el daemon en primer plano (lo usa el servicio internamente).
bks-db-manager-companion --install  (Re)instala y arranca el servicio en segundo plano.
bks-db-manager-companion --uninstall  Detiene y elimina el servicio.
bks-db-manager-companion --status   Muestra el estado de instalación, del daemon, y las herramientas detectadas.
bks-db-manager-companion --version  Imprime la versión.
```

## ¿Dónde quedan los archivos?

| | Ruta |
|---|---|
| Binario instalado (Linux) | `~/.local/share/bks-db-manager/bin/` |
| Binario instalado (macOS) | `~/Library/Application Support/bks-db-manager/bin/` |
| Binario instalado (Windows) | `%LOCALAPPDATA%\bks-db-manager\bin\` |
| Logs (macOS) | `~/Library/Logs/bks-db-manager/` |
| Registro del servicio (Linux) | `~/.config/systemd/user/bks-db-manager.service` |
| Registro del servicio (macOS) | `~/Library/LaunchAgents/com.t3zcadev.bks-db-manager.plist` |
| Registro del servicio (Windows) | Carpeta "Inicio" del menú de Windows |

## Lo que el instalador NO instala

El Companion **no incluye** `mysql`/`mysqldump`, `psql`/`pg_dump`, `mongodump`, `docker` ni `zstd` — son herramientas que el companion invoca, pero siguen siendo responsabilidad tuya tenerlas instaladas por separado (con tu gestor de paquetes de sistema: `brew`, `apt`, el instalador oficial de MySQL/PostgreSQL, Docker Desktop, etc.). Empaquetarlas dentro del instalador implicaría problemas de licencias y un tamaño de descarga mucho mayor, así que no forma parte de este proyecto.

Corre `bks-db-manager-companion --status` en cualquier momento para ver exactamente cuáles detecta en tu sistema.
