[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$ApiPort = 3000,
  [ValidateSet('H2', 'H1')]
  [string]$RatingPolicy = 'H2'
)

$ErrorActionPreference = 'Stop'
$project = 'wrc-local-dev'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$devRoot = [IO.Path]::GetFullPath((Join-Path $repo '_local-dev'))
$dataRoot = [IO.Path]::GetFullPath((Join-Path $devRoot 'data'))
$ownerData = [IO.Path]::GetFullPath((Join-Path $repo 'data'))
$baseCompose = Join-Path $repo 'docker-compose.yml'
$devCompose = Join-Path $repo 'docker-compose.local-dev.yml'

if ($dataRoot -eq $ownerData -or $dataRoot.StartsWith($ownerData + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing owner data path: $dataRoot"
}

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $devRoot 'logs') | Out-Null

$env:LOCAL_DATA_DIR = $dataRoot
$env:API_PORT = [string]$ApiPort
$env:ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '1'
$env:ACTIVE_RATING_POLICY = $RatingPolicy
$env:API_CORS_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173'

$compose = @('compose', '-p', $project, '-f', $baseCompose, '-f', $devCompose)
$resolvedPath = Join-Path $devRoot 'compose.resolved.yml'
$resolved = & docker @compose config
if ($LASTEXITCODE -ne 0) { throw 'docker compose config failed' }
$resolved | Set-Content -LiteralPath $resolvedPath -Encoding utf8
$resolved | Write-Output

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
foreach ($serviceName in @('api', 'web')) {
  foreach ($port in @($configJson.services.$serviceName.ports)) {
    if ($port.host_ip -ne '127.0.0.1') { throw "$serviceName publishes a non-loopback port" }
  }
}

Write-Host "Verified isolated /data mount: $expectedData"
Write-Host "Resolved Compose config: $resolvedPath"
& docker @compose up --build -d
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed' }
& docker @compose ps
Write-Host "Web:     http://127.0.0.1:5173"
Write-Host "API:     http://127.0.0.1:$ApiPort/api/v1"
Write-Host "Swagger: http://127.0.0.1:$ApiPort/api/docs"
