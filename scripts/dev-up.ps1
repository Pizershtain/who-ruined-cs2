[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$ApiPort = 3000,
  [ValidateRange(1, 65535)]
  [int]$WebPort = 5173,
  [ValidateRange(1, 65535)]
  [int]$PostgresPort = 54329,
  [ValidateRange(1, 65535)]
  [int]$ProfilesPort = 3001,
  [switch]$Profiles,
  [switch]$Auth,
  [switch]$CoreOnly,
  [ValidatePattern('^[a-z0-9][a-z0-9_-]*$')]
  [string]$ProjectName = 'wrc-local-dev',
  [switch]$WithoutProfiles,
  [switch]$WithoutAuth
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$devRoot = [IO.Path]::GetFullPath((Join-Path $repo '_local-dev'))
$dataRoot = [IO.Path]::GetFullPath((Join-Path $devRoot 'data'))
$ownerData = [IO.Path]::GetFullPath((Join-Path $repo 'data'))
$baseCompose = Join-Path $repo 'docker-compose.yml'
$devCompose = Join-Path $repo 'docker-compose.local-dev.yml'
$passwordPath = Join-Path $devRoot 'postgres-password.txt'

if ($CoreOnly -and ($Profiles -or $Auth)) { throw '-CoreOnly cannot be combined with optional services.' }
# Preserve explicit opt-in calls, including the local LAN helper.
$legacySelection = $PSBoundParameters.ContainsKey('Profiles') -or $PSBoundParameters.ContainsKey('Auth')
$startProfiles = -not ($CoreOnly -or $WithoutProfiles) -and ($Profiles -or -not $legacySelection)
$startAuth = -not ($CoreOnly -or $WithoutAuth) -and ($Auth -or -not $legacySelection)

$ports = @($ApiPort, $PostgresPort)
if (-not $CoreOnly) { $ports += $WebPort }
if ($startProfiles) { $ports += $ProfilesPort }
if (($ports | Select-Object -Unique).Count -ne $ports.Count) {
  throw 'Published ports must be distinct.'
}

if ($dataRoot -eq $ownerData -or $dataRoot.StartsWith($ownerData + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing owner data path: $dataRoot"
}

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $devRoot 'logs') | Out-Null
function Get-DevSecret([string]$secretPath) {
  if (Test-Path -LiteralPath $secretPath -PathType Leaf) {
    return (Get-Content -Raw -LiteralPath $secretPath).Trim()
  }
  $passwordBytes = New-Object byte[] 32
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($passwordBytes)
  } finally {
    $random.Dispose()
  }
  $password = ($passwordBytes | ForEach-Object { $_.ToString('x2') }) -join ''
  Set-Content -LiteralPath $secretPath -Value $password -Encoding ascii -NoNewline
  return $password
}
$postgresPassword = Get-DevSecret $passwordPath
if (-not $postgresPassword) { throw "PostgreSQL password file is empty: $passwordPath" }

$env:LOCAL_DATA_DIR = $dataRoot
$env:API_PORT = [string]$ApiPort
$env:WEB_PORT = [string]$WebPort
$env:POSTGRES_PORT = [string]$PostgresPort
$env:POSTGRES_PASSWORD = $postgresPassword
$env:ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '1'
$env:API_CORS_ORIGINS = "http://127.0.0.1:$WebPort,http://localhost:$WebPort"

$compose = @('compose', '-p', $ProjectName, '-f', $baseCompose, '-f', $devCompose)
$secrets = @($postgresPassword)
$publicationTokenPath = Join-Path $devRoot 'match-publication-token.txt'
$env:MATCH_PUBLICATION_TOKEN = $null
if ($startProfiles -or (Test-Path -LiteralPath $publicationTokenPath -PathType Leaf)) {
  $publicationToken = Get-DevSecret $publicationTokenPath
  if ($publicationToken -match '^[a-f0-9]{64}$') {
    # A Core-only start must preserve an existing subscriber's credentials.
    $env:MATCH_PUBLICATION_TOKEN = $publicationToken
    $secrets += $publicationToken
  } elseif ($startProfiles) {
    throw 'The publication token must contain 64 lowercase hexadecimal digits.'
  }
}
if ($startProfiles) {
  $env:PROFILES_PORT = [string]$ProfilesPort
  $env:PROFILES_DATABASE_PASSWORD = Get-DevSecret (Join-Path $devRoot 'profiles-postgres-password.txt')
  if ($env:PROFILES_DATABASE_PASSWORD -notmatch '^[a-f0-9]{64}$') {
    throw 'The Profiles database password must contain 64 lowercase hexadecimal digits.'
  }
  $secrets += $env:PROFILES_DATABASE_PASSWORD
  $compose += @('--profile', 'profiles')
}
if ($startAuth) {
  $authRoot = Join-Path $devRoot 'auth'
  New-Item -ItemType Directory -Force -Path $authRoot | Out-Null
  $env:AUTH_MODE = 'local-dev'
  $env:AUTH_ORIGIN = "http://127.0.0.1:$WebPort"
  $env:AUTH_DB_ADMIN_PASSWORD = Get-DevSecret (Join-Path $authRoot 'postgres-admin.txt')
  $env:AUTH_DB_PASSWORD = Get-DevSecret (Join-Path $authRoot 'postgres-auth.txt')
  foreach ($authSecret in @($env:AUTH_DB_ADMIN_PASSWORD, $env:AUTH_DB_PASSWORD)) {
    if ($authSecret -notmatch '^[a-f0-9]{64}$') { throw 'Auth database secrets must contain 64 lowercase hexadecimal digits.' }
    $secrets += $authSecret
  }
  $env:AUTH_SIGNING_KEY_SOURCE = Join-Path $authRoot 'signing.pem'
  if (!(Test-Path -LiteralPath $env:AUTH_SIGNING_KEY_SOURCE -PathType Leaf)) {
    & node -e "const c=require('node:crypto'),f=require('node:fs'); const pair=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'}); f.writeFileSync(process.env.AUTH_SIGNING_KEY_SOURCE,pair.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});"
    if ($LASTEXITCODE -ne 0) { throw 'Auth signing key generation failed' }
  }
  $compose += @('--profile', 'auth')
}
$resolvedPath = Join-Path $devRoot 'compose.resolved.yml'
$resolved = & docker @compose config
if ($LASTEXITCODE -ne 0) { throw 'docker compose config failed' }
$redactedResolved = $resolved -join [Environment]::NewLine
foreach ($secret in $secrets) { $redactedResolved = $redactedResolved.Replace($secret, '<redacted>') }
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
foreach ($service in $configJson.services.PSObject.Properties) {
  foreach ($port in $service.Value.ports) {
    if ($port.host_ip -ne '127.0.0.1') { throw "$($service.Name) publishes a non-loopback port" }
    if ($service.Name -notin @('gateway', 'api', 'postgres', 'profiles')) {
      throw "$($service.Name) must not publish a host port"
    }
  }
}

Write-Host "Verified isolated /data mount: $expectedData"
Write-Host "Resolved Compose config: $resolvedPath"
$targetServices = @('api', 'worker')
if (-not $CoreOnly) { $targetServices += @('web', 'gateway') }
if ($startProfiles) { $targetServices += 'profiles' }
if ($startAuth) { $targetServices += 'auth' }
& docker @compose up --build -d @targetServices
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed' }
& docker @compose ps
if (-not $CoreOnly) {
  Write-Host "Web:     http://127.0.0.1:$WebPort"
  Write-Host "API:     http://127.0.0.1:$WebPort/api/v1"
  Write-Host "Gateway: http://127.0.0.1:$WebPort/healthz"
}
Write-Host "Core diagnostics: http://127.0.0.1:$ApiPort/api/v1/health (Swagger: /api/docs)"
Write-Host "PostgreSQL (native clients only): 127.0.0.1:$PostgresPort"
if ($startProfiles) { Write-Host "Profiles diagnostics: http://127.0.0.1:$ProfilesPort/api/v1/ready" }
if ($startAuth) { Write-Host "Auth: http://127.0.0.1:$WebPort/api/v1/auth (Gateway only)" }
