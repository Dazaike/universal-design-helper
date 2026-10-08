<#
.SYNOPSIS
  Creates a Windows shortcut that launches the Universal Design Helper MCP bridge
  server standalone, independent of any MCP client. Run this after `npm run build`.

.PARAMETER Location
  Where to place the shortcut:
    Downloads - manual double-click launch (default).
    Startup   - Windows Startup folder, so the bridge (127.0.0.1:7420) auto-launches
                on login, independent of whether OMP (or any MCP client) is running.
#>

param(
    [ValidateSet("Downloads", "Startup")]
    [string]$Location = "Downloads"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $repoRoot "mcp-server\dist\index.js"

if (-not (Test-Path $serverScript)) {
    Write-Error "Build output not found at '$serverScript'. Run 'npm run build' first."
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error "node.exe not found on PATH. Install Node.js before creating the shortcut."
}

if ($Location -eq "Startup") {
    $targetDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
    $windowStyle = 7 # minimized, so it doesn't pop a console over the desktop at login
} else {
    $targetDir = Join-Path $env:USERPROFILE "Downloads"
    $windowStyle = 1 # normal
}
$shortcutPath = Join-Path $targetDir "Design Helper MCP Server.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $node.Source
$shortcut.Arguments = "`"$serverScript`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$($node.Source),0"
$shortcut.Description = "Starts the Universal Design Helper MCP bridge server (127.0.0.1:7420) standalone."
$shortcut.WindowStyle = $windowStyle
$shortcut.Save()

Write-Host "Created shortcut: $shortcutPath"
