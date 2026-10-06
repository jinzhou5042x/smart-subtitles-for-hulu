$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$defaults = Get-Content -LiteralPath (Join-Path $projectRoot 'config/default.json') -Raw | ConvertFrom-Json
$local = Get-Content -LiteralPath (Join-Path $projectRoot 'config/local.json') -Raw | ConvertFrom-Json
$servicePort = if ($local.port) { $local.port } else { $defaults.port }
try {
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$servicePort/shutdown" -Headers @{ Authorization = "Bearer $($local.pairingToken)" } | Out-Null
  Write-Host 'Subtitle service stopped.'
} catch { Write-Host 'No paired subtitle service is running.' }
