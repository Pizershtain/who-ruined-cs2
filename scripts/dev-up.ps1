[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$ApiPort = 3000,
  [ValidateRange(1, 65535)]
  [int]$WebPort = 5173,
  [ValidateRange(1, 65535)]
  [int]$PostgresPort = 54329,
  [ValidatePattern('^[a-z0-9][a-z0-9_-]*$')]
  [string]$ProjectName = 'wrc-local-dev'
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$devRoot = [IO.Path]::GetFullPath((Join-Path $repo '_local-dev'))
$dataRoot = [IO.Path]::GetFullPath((Join-Path $devRoot 'data'))
$ownerData = [IO.Path]::GetFullPath((Join-Path $repo 'data'))
$baseCompose = Join-Path $repo 'docker-compose.yml'
$devCompose = Join-Path $repo 'docker-compose.local-dev.yml'
$passwordPath = Join-Path $devRoot 'postgres-password.txt'

if ((@($ApiPort, $WebPort, $PostgresPort) | Select-Object -Unique).Count -ne 3) {
  throw 'ApiPort, WebPort and PostgresPort must be distinct.'
}

if ($dataRoot -eq $ownerData -or $dataRoot.StartsWith($ownerData + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing owner data path: $dataRoot"
}

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $devRoot 'logs') | Out-Null
if (-not (Test-Path -LiteralPath $passwordPath -PathType Leaf)) {
  $passwordBytes = New-Object byte[] 32
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($passwordBytes)
  } finally {
    $random.Dispose()
  }
  $password = ($passwordBytes | ForEach-Object { $_.ToString('x2') }) -join ''
  Set-Content -LiteralPath $passwordPath -Value $password -Encoding ascii -NoNewline
}
$postgresPassword = (Get-Content -Raw -LiteralPath $passwordPath).Trim()
if (-not $postgresPassword) { throw "PostgreSQL password file is empty: $passwordPath" }

$env:LOCAL_DATA_DIR = $dataRoot
$env:API_PORT = [string]$ApiPort
$env:WEB_PORT = [string]$WebPort
$env:POSTGRES_PORT = [string]$PostgresPort
$env:POSTGRES_PASSWORD = $postgresPassword
$env:ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '1'
$env:API_CORS_ORIGINS = "http://127.0.0.1:$WebPort,http://localhost:$WebPort"

$compose = @('compose', '-p', $ProjectName, '-f', $baseCompose, '-f', $devCompose)
$resolvedPath = Join-Path $devRoot 'compose.resolved.yml'
$resolved = & docker @compose config
if ($LASTEXITCODE -ne 0) { throw 'docker compose config failed' }
$redactedResolved = ($resolved -join [Environment]::NewLine).Replace($postgresPassword, '<redacted>')
$redactedResolved | Set-Content -LiteralPath $resolvedPath -Encoding utf8

$configJson = (& docker @compose config --format json) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'docker compose config --format json failed' }
$expectedData = [IO.Path]::GetFullPath($dataRoot)
foreach ($serviceName in @('api', 'worker')) {
  $service = $configJson.services.$serviceName
  $dataMount = @($service.volumes | Where-Object { $_.target -eq '/data' })
  if ($dataMount.Count -ne 1) { throw "$serviceName must have exactly one /data mount" }
  $actualSource = [IO.Path]::GetFullPath([string]$dataMount[0].source)
  if ($actualSource -ne $expectedData) { throw "$serviceName /data source is $actualSource, expected $expectedData" }
}
foreach ($serviceName in @('api', 'web', 'postgres')) {
  foreach ($port in @($configJson.services.$serviceName.ports)) {
    if ($port.host_ip -ne '127.0.0.1') { throw "$serviceName publishes a non-loopback port" }
  }
}

Write-Host "Verified isolated /data mount: $expectedData"
Write-Host "Resolved Compose config: $resolvedPath"
& docker @compose up --build -d
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed' }
& docker @compose ps
Write-Host "Web:     http://127.0.0.1:$WebPort"
Write-Host "API:     http://127.0.0.1:$ApiPort/api/v1"
Write-Host "Swagger: http://127.0.0.1:$ApiPort/api/docs"
Write-Host "PostgreSQL (native clients only): 127.0.0.1:$PostgresPort"
