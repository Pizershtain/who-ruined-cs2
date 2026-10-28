[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$baseCompose = Join-Path $repo 'docker-compose.yml'
$devCompose = Join-Path $repo 'docker-compose.local-dev.yml'

& docker compose -p wrc-local-dev -f $baseCompose -f $devCompose stop
if ($LASTEXITCODE -ne 0) { throw 'docker compose stop failed' }

Write-Host 'Stopped wrc-local-dev. Isolated data was preserved under _local-dev/data.'
