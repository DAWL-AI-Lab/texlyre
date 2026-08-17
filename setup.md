# Texlyre local setup (Windows)

This guide sets up this repository as a local Texlyre development instance with:

- browser-based BusyTeX compilation;
- local MiKTeX/LuaLaTeX compilation with Biber and SyncTeX;
- LTeX LS Plus grammar, spelling, diagnostics, and quick fixes through LSP;
- Zotero bibliography import;
- the optional inline rewrite assistant using either a remote vLLM server through SSH or local Ollama.

The instructions target Windows 10/11 and PowerShell. They do not modify an imported LaTeX source directory: compilation is performed in a disposable temporary copy, and Texlyre stores imported projects in browser storage.

## 1. Prerequisites

Install or obtain the following before starting. All links below are official project pages.

| Requirement                             | Why it is needed                                                                | Download / documentation                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Git                                     | Clone and update this repository                                                | [git-scm.com/download/win](https://git-scm.com/download/win)                                                               |
| Node.js 24.19.0 (Windows x64 Installer) | Build and run Texlyre; the supplied launcher is pinned to this portable version | [Download the Installer](https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi)                                           |
| MiKTeX                                  | Local pdfLaTeX, XeLaTeX, LuaLaTeX, `latexmk`, Biber, and SyncTeX compilation     | [MiKTeX for Windows](https://miktex.org/download)                                                                          |
| LTeX LS Plus 18.7.0 (Windows x64 ZIP)   | Grammar and spelling language server                                            | [Download the ZIP](https://github.com/ltex-plus/ltex-ls-plus/releases/download/18.7.0/ltex-ls-plus-18.7.0-windows-x64.zip) |
| Rust toolchain                          | Build the small WebSocket-to-LSP bridge                                         | [rustup.rs](https://rustup.rs/)                                                                                            |

Optional extras:

| Extra          | Use                                                                | Download / documentation                                                                                                      |
| -------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Zotero desktop | Synchronise your reference library before connecting it to Texlyre | [zotero.org/download](https://www.zotero.org/download/)                                                                       |
| Ollama         | Run the rewrite assistant on this computer                         | [ollama.com/download](https://ollama.com/download)                                                                            |
| OpenSSH Client | Tunnel to a remote vLLM server                                     | [Microsoft OpenSSH documentation](https://learn.microsoft.com/windows-server/administration/openssh/openssh_install_firstuse) |

You need an internet connection for `npm ci`, BusyTeX's on-demand TeX packages, and any optional service that you enable. Local MiKTeX, LTeX, and Ollama can otherwise run offline after their packages/models are installed.

## 2. Get the repository and install JavaScript dependencies

Open PowerShell. Clone the repository if you do not already have it, then enter it:

```powershell
git clone https://github.com/texlyre/texlyre.git
Set-Location texlyre
```

If the repository already exists, use its existing directory instead:

```powershell
Set-Location D:\path\to\texlyre
```

Install dependencies using the portable Node version configured below. This keeps the setup independent of any older system-wide Node installation.

## 3. Install the portable Node version used by the launcher

The supplied `scripts\start-texlyre.ps1` expects Node 24.19.0 at `%USERPROFILE%\.local\texlyre-tools\node-v24.19.0-win-x64`.

```powershell
$toolsRoot = Join-Path $env:USERPROFILE '.local\texlyre-tools'
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
Invoke-WebRequest `
  'https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip' `
  -OutFile (Join-Path $toolsRoot 'node-v24.19.0-win-x64.zip')
Expand-Archive `
  (Join-Path $toolsRoot 'node-v24.19.0-win-x64.zip') `
  -DestinationPath $toolsRoot -Force
```

Verify it and install the locked dependency set:

```powershell
$nodeHome = Join-Path $toolsRoot 'node-v24.19.0-win-x64'
& (Join-Path $nodeHome 'node.exe') --version
& (Join-Path $nodeHome 'npm.cmd') ci
```

The version command must print `v24.19.0`. Run the last command from the repository root; it creates `node_modules` but does not change application source files.

## 4. Install and prepare MiKTeX

1. Download and run the [MiKTeX installer](https://miktex.org/download). A per-user installation is sufficient.
2. In **MiKTeX Console**, open **Settings** and set **Install missing packages on-the-fly** to **Always**. This is important because the background compiler cannot respond to an interactive package-install prompt.
3. In the **Packages** tab, install at least `latexmk`, `biber`, `biblatex`, `fontspec`, and the pdfTeX/XeTeX/LuaTeX base packages required by your document. Install project-specific packages reported by the log as needed.
4. Close and reopen PowerShell so MiKTeX is on `PATH`, then verify:

```powershell
latexmk -v
lualatex --version
xelatex --version
pdflatex --version
biber --version
```

All five commands must succeed. The compiler menu selects the corresponding `latexmk` engine while keeping SyncTeX enabled.

## 5. Install LTeX LS Plus and the WebSocket bridge

Texlyre talks to language servers in the browser over WebSocket, whereas LTeX communicates over standard input/output. `lsp-ws-proxy` bridges those transports.

### 5.1 Install LTeX LS Plus

Download and extract the pinned LTeX package into `%USERPROFILE%\.local\texlyre-tools`:

```powershell
$toolsRoot = Join-Path $env:USERPROFILE '.local\texlyre-tools'
Invoke-WebRequest `
  'https://github.com/ltex-plus/ltex-ls-plus/releases/download/18.7.0/ltex-ls-plus-18.7.0-windows-x64.zip' `
  -OutFile (Join-Path $toolsRoot 'ltex-ls-plus-18.7.0-windows-x64.zip')
Expand-Archive `
  (Join-Path $toolsRoot 'ltex-ls-plus-18.7.0-windows-x64.zip') `
  -DestinationPath $toolsRoot -Force
```

After extraction, this exact file must exist:

```text
%USERPROFILE%\.local\texlyre-tools\ltex-ls-plus-18.7.0\bin\ltex-ls-plus.bat
```

The distribution includes its own Java runtime; do not install Java separately for this guide.

### 5.2 Build and place `lsp-ws-proxy`

Install Rust from [rustup.rs](https://rustup.rs/), restart PowerShell, and run:

```powershell
cargo install lsp-ws-proxy --version 0.8.0
$toolsRoot = Join-Path $env:USERPROFILE '.local\texlyre-tools'
Copy-Item (Join-Path $env:USERPROFILE '.cargo\bin\lsp-ws-proxy.exe') `
  (Join-Path $toolsRoot 'lsp-ws-proxy.exe') -Force
```

Verify both components:

```powershell
Test-Path "$env:USERPROFILE\.local\texlyre-tools\lsp-ws-proxy.exe"
Test-Path "$env:USERPROFILE\.local\texlyre-tools\ltex-ls-plus-18.7.0\bin\ltex-ls-plus.bat"
```

Both commands must return `True`. The configured server uses UK English (`en-GB`) for `.tex`, `.latex`, `.bib`, `.md`, and `.markdown` files. Change `ltex.language` in `texlyre.config.ts` if another default is required, then rebuild/restart Texlyre.

## 6. Start Texlyre and verify the local services

From the repository root, run:

```powershell
$nodeHome = Join-Path $env:USERPROFILE '.local\texlyre-tools\node-v24.19.0-win-x64'
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\start-texlyre.ps1
```

The script starts the following background services if their ports are unused, then starts Vite:

| Service                 | Address                                   | Purpose                                   |
| ----------------------- | ----------------------------------------- | ----------------------------------------- |
| LTeX + bridge           | `ws://127.0.0.1:7020`                     | LSP diagnostics, quick fixes, completions |
| Local MiKTeX typesetter | `ws://127.0.0.1:7021`                     | pdfLaTeX/XeLaTeX/LuaLaTeX/Biber/PDF/SyncTeX compilation |
| Optional vLLM tunnel    | `http://127.0.0.1:8000`                   | Remote rewrite assistant proxy            |
| Vite                    | normally `http://localhost:5173/texlyre/` | Texlyre web application                   |

To stop services left behind by an earlier run before starting again, use:

```powershell
.\scripts\stop-texlyre-services.ps1
```

This stops only recognised TeXlyre background services (LTeX, the local MiKTeX typesetter, and the vLLM tunnel). Add `-IncludeVite` to stop a lingering Vite server too. Use `-WhatIf` to preview, or `-ForceUnknownListeners` only after verifying an unrecognised listener belongs to TeXlyre.

Open the Vite URL printed in the console. Use normal HTTP for this setup. Starting Vite in HTTPS mode while the LSP/typesetter use `ws://` makes browsers block them as mixed content.

Check that the two required services are listening:

```powershell
Get-NetTCPConnection -LocalPort 7020,7021 -State Listen
```

Logs are written to `%USERPROFILE%\.local\texlyre-tools\logs`:

```powershell
Get-Content "$env:USERPROFILE\.local\texlyre-tools\logs\ltex-lsp.stderr.log" -Tail 80
Get-Content "$env:USERPROFILE\.local\texlyre-tools\logs\latex-typesetter.stderr.log" -Tail 80
```

For a code-only validation, run:

```powershell
& (Join-Path $nodeHome 'npm.cmd') run build:local
```

## 7. Import and compile a LaTeX folder safely

Texlyre imports files into browser storage. It does not edit the selected source folder. Empty source folders are not reported by browser folder pickers; create any needed empty folders inside Texlyre after import.

1. Create or open a Texlyre project.
2. Select **External → TeX** as the typesetter type.
3. Choose **Local MiKTeX (pdfLaTeX, XeLaTeX, LuaLaTeX, Biber, SyncTeX)** as the compiler.
4. In the **Files** toolbar, select **Upload Folder** (the folder icon next to **Upload Files**).
5. Select the project directory. Its nested file paths are preserved.
6. Open the project’s main `.tex` file and compile.

For the dissertation example, select `C:\Users\alang\OneDrive\Master in AI\Dissertation`, open `Dissertation/main.tex`, and compile. Do **not** enable **File System Backup** against that folder: it is a Texlyre backup feature, not a safe source-folder sync mechanism.

### Choosing a compiler

- **Local MiKTeX** is recommended for Biber/biblatex projects and projects needing installed fonts or packages. Select pdfLaTeX, XeLaTeX, or LuaLaTeX from the compilation menu; it compiles a temporary copy and returns the PDF and `.synctex.gz` file.

### Use MiKTeX on a remote TeXlyre server

The same typesetter service can run on a trusted remote TeXlyre host. TeXlyre sends the complete project tree for each compile, and receives the compiler log, PDF, and SyncTeX file back, so the output view behaves exactly like local compilation.

When the host is launched with `scripts\start-texlyre.ps1`, no client-side typesetter JSON is needed. The launcher starts MiKTeX on its loopback interface, waits until it is ready, and gives Vite a server-only proxy credential. A browser opened at a non-local HTTP(S) TeXlyre address probes the same-origin `/texlyre-typesetter` WebSocket endpoint; **Remote MiKTeX (server)** appears in the LaTeX compiler menu only after that probe returns the server's MiKTeX version. **Local MiKTeX** remains available as a separate option and addresses the browser machine's `ws://localhost:7021`, so it can coexist with the remote server compiler. The compiler port itself remains bound to the server.

Treat access to the remote TeXlyre web server as permission to compile documents: the same-origin proxy deliberately makes compilation available to its users. Restrict that host to trusted users and networks; do not expose port 7021 directly. The proxy credential is stored only in `%USERPROFILE%\.local\texlyre-tools\typesetter-proxy.token` on the host and is never sent to browser JavaScript.

On the remote Windows host, start the typesetter on a reachable interface and protect it with a high-entropy shared secret. Do not expose an unauthenticated compiler endpoint:

```powershell
.\scripts\start-local-latex-typesetter.ps1 `
  -ListenAddress 0.0.0.0 `
  -AccessToken 'replace-with-a-long-random-secret'
```

If TeXlyre is served over HTTPS, terminate TLS in a reverse proxy and use a `wss://` endpoint; browsers block an insecure `ws://` endpoint from an HTTPS page. Restrict the proxy or firewall to trusted users and networks.

For a separate typesetter deployment that is not the TeXlyre host, open **Settings → External Tools → Generic Typesetter** and add this object to the existing JSON array, replacing the URL and token. The `miktex` capability is what makes the compiler appear in the normal LaTeX compiler menu. Endpoint URLs may use either `ws(s)://` or `http(s)://`; Texlyre converts the latter to the matching WebSocket scheme. After connecting, the typesetter info control reports the remote MiKTeX version returned by the server.

```json
{
  "id": "remote-latexmk",
  "name": "Remote MiKTeX (pdfLaTeX, XeLaTeX, LuaLaTeX, Biber, SyncTeX)",
  "enabled": true,
  "projectType": "latex",
  "projectGroup": "tex",
  "inputExtensions": ["tex", "latex", "cls", "sty", "bib"],
  "outputFormats": [{ "id": "pdf", "mimeType": "application/pdf" }],
  "transportConfig": {
    "type": "websocket",
    "url": "wss://tex.example.org/typesetter",
    "authToken": "replace-with-the-same-secret"
  },
  "capabilities": { "outline": true, "miktex": true },
  "ui": {
    "compile": {
      "fields": [{
        "key": "engine",
        "label": "LaTeX Engine:",
        "kind": "select",
        "defaultValue": "lualatex",
        "options": [
          { "label": "pdfLaTeX", "value": "pdflatex" },
          { "label": "XeLaTeX", "value": "xelatex" },
          { "label": "LuaLaTeX", "value": "lualatex" }
        ]
      }]
    }
  }
}
```

After saving the setting, open the LaTeX compilation menu and choose **Remote MiKTeX**. It is available alongside the browser compilers and any local MiKTeX endpoint. A failed endpoint stays selectable but reports a normal compiler connection error rather than silently falling back to a browser compiler.
- **BusyTeX LuaLaTeX** is the browser-only fallback. It is convenient for quick/simple documents and has built-in SyncTeX support, but does not provide Biber. It cannot compile a project that requires Biber unless that project is changed to a supported bibliography workflow.

### SyncTeX use

1. Ensure **Settings → Compilation → LaTeX → Enable source map (SyncTeX)** is enabled.
2. Compile with local MiKTeX or BusyTeX.
3. In the editor, use the SyncTeX/locate control to find the PDF position for the cursor.
4. In the PDF, double-click a rendered location to jump back to the mapped source word. Exactness depends on the boxes TeX writes to SyncTeX; macros or generated text may map to the closest source token.

## 8. Zotero bibliography integration (optional)

Texlyre uses the Zotero Web API, not the desktop database directly. You can follow the integration steps from the documentation [here](https://texlyre.github.io/docs/integrations/zotero).

## 9. Inline rewrite assistant (optional)

The editor supports two local-network providers. It sends the entire sentence(s) containing the selection, marks the selected segment explicitly, and sends your instruction. The model returns a structured replacement. Texlyre displays the original text struck through beside the highlighted replacement, with **Accept** and **Reject** controls.

### Option A: Remote vLLM through SSH

By default, this repository uses an SSH host named `MariaBambinaSuperComputer` running vLLM on port 8000. You can change the host without editing source code:

```powershell
# One launch only
.\scripts\start-texlyre.ps1 -VllmHost 'your-ssh-host'

# Make the default persistent for your Windows user, then open a new PowerShell window
[Environment]::SetEnvironmentVariable('TEXLYRE_VLLM_HOST', 'your-ssh-host', 'User')
```

The `-VllmHost` argument takes precedence over `TEXLYRE_VLLM_HOST`; when neither is set, the default remains `MariaBambinaSuperComputer`.

1. Ensure Windows OpenSSH is installed and `ssh <your-host>` authenticates successfully without an interactive password prompt. Configure the host in `%USERPROFILE%\.ssh\config` if necessary.
2. Confirm that the remote server exposes its models:

```powershell
ssh <your-host> "curl http://127.0.0.1:8000/v1/models"
```

3. Start Texlyre. `start-texlyre.ps1` starts the tunnel automatically when local port 8000 is free.
4. Select text, click the rewrite icon, enter an instruction, and choose **vLLM (SSH)**. The first model returned by `/v1/models` is selected by default.

Test the tunnel independently:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/v1/models
```

For a different host or port, pass values when starting the tunnel manually:

```powershell
.\scripts\start-vllm-tunnel.ps1 -HostName your-ssh-host -Port 8000
```

### Option B: Local Ollama

1. Install [Ollama](https://ollama.com/download).
2. Download at least one model, for example:

```powershell
ollama pull qwen3-vl:4b
```

3. Ensure the local API is running and lists the model:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

4. Start Texlyre, select text, click the rewrite icon, select **Ollama (local)**, choose a model, and submit the instruction.

Texlyre proxies browser requests through Vite (`/vllm` and `/ollama`), so no model URL or SSH credentials are exposed to browser JavaScript. A failed connection, timeout, invalid model response, or malformed JSON is shown as an error and leaves the document unchanged.

## 10. Troubleshooting checklist

| Symptom                                         | Check / fix                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Node.js 24 was not found`                      | Repeat section 3 and ensure the extracted folder is exactly `%USERPROFILE%\.local\texlyre-tools\node-v24.19.0-win-x64`.                                  |
| `latexmk was not found on PATH`                 | Finish section 4, restart PowerShell, and verify `latexmk -v`.                                                                                           |
| Compile log reports a missing `.sty` or font    | Install the named MiKTeX package in MiKTeX Console, then compile again.                                                                                  |
| Biber/citations fail                            | Use Local MiKTeX, verify `biber --version`, the `.bib` filename, and all citation keys.                                                                  |
| LTeX has no diagnostics                         | Check port 7020 and `ltex-lsp.stderr.log`; verify both files in section 5.2 exist.                                                                       |
| SyncTeX only jumps to a line                    | Recompile after enabling SyncTeX. The app uses the returned column where TeX provides one, but TeX may emit only coarse positions for a macro/container. |
| vLLM models do not load                         | Check `Invoke-RestMethod http://127.0.0.1:8000/v1/models` and `%USERPROFILE%\.local\texlyre-tools\logs\vllm-tunnel.stderr.log`.                          |
| Ollama models do not load                       | Run `ollama list`, then check `http://127.0.0.1:11434/api/tags`.                                                                                         |
| Browser reports a WebSocket mixed-content error | Run `.\scripts\start-texlyre.ps1` without `-Https`.                                                                                                      |

## 11. What this repository configures

`texlyre.config.ts` contains the defaults for BusyTeX LuaLaTeX (`extra` bundle), SyncTeX, UK English LTeX (`en-GB`), the WebSocket LSP endpoint on port 7020, and the Local MiKTeX typesetter endpoint on port 7021. The launcher starts the required local services; do not change their ports unless you update the corresponding configuration as well.

## 12. Validation

The setup was validated with:

- a successful `npm run build:local` build using Node 24;
- an LTeX initialize handshake exposing diagnostics, completions, and quick fixes;
- local LuaLaTeX/Biber compilation returning both a PDF and `.synctex.gz`;
- `npm run test:remote-miktex`, which starts an authenticated MiKTeX WebSocket server and verifies that a real document returns a PDF, compiler log, and SyncTeX artifact;
- a read-only compile of the dissertation producing a 31-page PDF;
- a vLLM structured rewrite through the SSH tunnel.

Existing undefined-citation warnings in the dissertation are caused by citation keys absent from its `references.bib`; they are document-content warnings, not a setup failure.
