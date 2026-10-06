$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$bundled = Join-Path $projectRoot 'node\node.exe'
$nodePath = if (Test-Path -LiteralPath $bundled) { $bundled } else { (Get-Command node.exe -ErrorAction Stop).Source }
# Version tested with this release; the official package from npm.
$codexVersion = '0.160.1'

# Use an installed Codex (e.g. the Codex app) if there is one; otherwise install the official CLI
# into this folder with the bundled npm. Nothing is installed system-wide.
$existing = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  Write-Host "Using the installed Codex: $($existing.Source)"
  & $nodePath scripts/configure-codex.mjs path $existing.Source
  $codex = @($existing.Source)
} else {
  Write-Host "Installing the Codex CLI $codexVersion into this folder (one time)..."
  $npm = Join-Path (Split-Path -Parent $nodePath) 'npm.cmd'
  & $npm install --prefix (Join-Path $projectRoot 'codex') --no-audit --no-fund --loglevel=error "@openai/codex@$codexVersion"
  if ($LASTEXITCODE -ne 0) { throw 'Installing Codex failed. Check your internet connection and try again.' }
  & $nodePath scripts/configure-codex.mjs bundled
  $codex = @($nodePath, (Join-Path $projectRoot 'codex\node_modules\@openai\codex\bin\codex.js'))
}
if ($LASTEXITCODE -ne 0) { throw 'Could not save the Codex setting' }

function Invoke-Codex([string[]] $Arguments) {
  if ($codex.Count -gt 1) { & $codex[0] $codex[1] @Arguments } else { & $codex[0] @Arguments }
}
Invoke-Codex @('login', 'status') | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'Sign in to Codex with your ChatGPT account in the browser window that opens.'
  Invoke-Codex @('login') | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Codex sign-in did not complete. Run "Set Up Codex.cmd" again.' }
}
Write-Host ''
Write-Host 'Codex is ready. If the service is already running, run "Stop Subtitles.cmd" and then "Start Subtitles.cmd".'
