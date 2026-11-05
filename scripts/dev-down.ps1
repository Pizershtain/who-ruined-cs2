[CmdletBinding()]
param(
  [ValidatePattern('^[a-z0-9][a-z0-9_-]*$')]
  [string]$ProjectName = 'wrc-local-dev'
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$baseCompose = Join-Path $repo 'docker-compose.yml'
$devCompose = Join-Path $repo 'docker-compose.local-dev.yml'
$passwordPath = Join-Path $repo '_local-dev\postgres-password.txt'

if (-not (Test-Path -LiteralPath $passwordPath)) {
  throw "PostgreSQL development password not found at $passwordPath. Run npm.cmd run dev:up first."
}

$env:POSTGRES_PASSWORD = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($env:POSTGRES_PASSWORD)) {
  throw "PostgreSQL development password file is empty: $passwordPath"
}

& docker compose -p $ProjectName -f $baseCompose -f $devCompose stop
if ($LASTEXITCODE -ne 0) { throw 'docker compose stop failed' }

Write-Host "Stopped $ProjectName. PostgreSQL volume and isolated artifacts were preserved."
