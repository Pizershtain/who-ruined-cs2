[CmdletBinding()]
param(
  [ValidateSet('create', 'check', 'rotate-password', 'revoke-sessions', 'disable')]
  [string]$Operation = 'create',
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$')]
  [string]$Username = 'dev-user',
  [string]$DisplayName = 'Developer',
  [ValidatePattern('^[a-z0-9][a-z0-9_-]*$')]
  [string]$ProjectName = 'wrc-local-dev'
)

$ErrorActionPreference = 'Stop'
$container = "$ProjectName-auth-1"
$command = @('exec', '-i', $container, 'node', 'apps/services/auth/dist/dev-user.js', $Operation, $Username)
if ($Operation -eq 'create') { $command += $DisplayName }
if ($Operation -in @('create', 'rotate-password')) {
  $secret = Read-Host -AsSecureString 'Auth password (at least 12 characters)'
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $previousEncoding = $OutputEncoding
  try {
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) | & docker @command
  } finally {
    $OutputEncoding = $previousEncoding
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secret.Dispose()
  }
} else {
  & docker @command
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
