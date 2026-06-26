Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$skillsDir = Join-Path $root ".agents\skills"
$validator = Join-Path $env:USERPROFILE ".codex\skills\.system\skill-creator\scripts\quick_validate.py"

if (-not (Test-Path -LiteralPath $skillsDir -PathType Container)) {
  throw "Repo skills directory not found: $skillsDir"
}

if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
  throw "Skill validator not found: $validator"
}

Get-ChildItem -Directory -LiteralPath $skillsDir | ForEach-Object {
  Write-Output "VALIDATING $($_.Name)"
  python $validator $_.FullName
}
