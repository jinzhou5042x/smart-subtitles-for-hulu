$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
# The release bundles Node in .\node; a development checkout uses the installed one.
$bundled = Join-Path $projectRoot 'node\node.exe'
$nodePath = if (Test-Path -LiteralPath $bundled) { $bundled } else { (Get-Command node.exe -ErrorAction Stop).Source }
# Development checkout only: rebuild the unpacked extension.
$build = Join-Path $PSScriptRoot 'build.mjs'
$development = Test-Path -LiteralPath $build
if ($development) { & $nodePath $build; if ($LASTEXITCODE -ne 0) { throw 'Build failed' } }
# First run: create config/local.json with this computer's own pairing code.
$localFile = Join-Path $projectRoot 'config/local.json'
if (-not (Test-Path -LiteralPath $localFile)) {
  & $nodePath -e "import('./service/config.mjs').then(m => m.loadConfig())"
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the configuration' }
}
# The pairing code (and any API key) is readable only by the current Windows user.
icacls $localFile /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(M)" | Out-Null
$defaults = Get-Content -LiteralPath (Join-Path $projectRoot 'config/default.json') -Raw | ConvertFrom-Json
$local = Get-Content -LiteralPath $localFile -Raw | ConvertFrom-Json
$servicePort = if ($local.port) { $local.port } else { $defaults.port }
try {
  $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$servicePort/health" -TimeoutSec 2
  if ($existing.app -eq 'hulu-context-subtitles') { Write-Host 'Subtitle service is already running.'; Write-Host "Pairing code: $($local.pairingToken)"; exit 0 }
} catch {}
$serverFile = Join-Path $projectRoot 'service/server.mjs'
Start-Process -FilePath $nodePath -ArgumentList @('"' + $serverFile + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'logs/stdout.log') -RedirectStandardError (Join-Path $projectRoot 'logs/stderr.log')
if ($development) { Write-Host 'Subtitle service started. Load dist/extension in Chrome and refresh Hulu.' }
else { Write-Host 'Smart Subtitles for Hulu is running. Keep it running while you watch; run "Stop Subtitles.cmd" to stop it.' }
Write-Host ''
Write-Host "Pairing code (paste it into the extension if it asks): $($local.pairingToken)"
