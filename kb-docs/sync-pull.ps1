# sync-pull.ps1 — Pull all KB documents from ElevenLabs and overwrite local files.
# Run this BEFORE editing any file in kb-docs/ to ensure you have the latest version.
#
# Usage (PowerShell 7+ / pwsh — see the version check below):
#   cd "C:\Active Projects\Shopify-PaintAccess-Site\app"
#   pwsh .\kb-docs\sync-pull.ps1

# Windows PowerShell 5.1 decodes these UTF-8 API responses as Latin-1, which turns every
# curly quote in the KB into mojibake ("can’t" -> "canâ€™t") and then writes it back to
# disk. That corruption is invisible until you diff, and pushing a mirror in that state
# would send the mangled text to the live agent. Refuse to run rather than corrupt.
if ($PSVersionTable.PSVersion.Major -lt 6) {
  Write-Error "Run this with PowerShell 7+ (pwsh). Windows PowerShell $($PSVersionTable.PSVersion) mis-decodes UTF-8 API responses and would corrupt kb-docs/."
  exit 1
}

$apiKey = $env:ELEVENLABS_API_KEY
if (-not $apiKey) {
  # Fallback: read from .env.local, then .env, beside this script's parent.
  foreach ($envName in @(".env.local", ".env")) {
    $envFile = Join-Path $PSScriptRoot "..\$envName"
    if (Test-Path $envFile) {
      $line = Get-Content $envFile | Where-Object { $_ -match "^ELEVENLABS_API_KEY=" } | Select-Object -First 1
      if ($line) {
        $apiKey = ($line -replace "^ELEVENLABS_API_KEY=", "").Trim().Trim('"').Trim("'")
        break
      }
    }
  }
}
if (-not $apiKey) {
  # NEVER hardcode a key here. This repo is PUBLIC, and the key that used to sit at this
  # line was readable by anyone on GitHub from the very first commit.
  Write-Error "ELEVENLABS_API_KEY is not set. Export it, or put it in app/.env.local (git-ignored)."
  exit 1
}

$agentId  = "agent_1001kn99pk1xefprh4gb665f6j3p"
$outDir   = $PSScriptRoot
$headers  = @{ "xi-api-key" = $apiKey }

Write-Host "Fetching agent KB list..."
$agent = Invoke-RestMethod -Uri "https://api.elevenlabs.io/v1/convai/agents/$agentId" -Headers $headers
$kbDocs = $agent.conversation_config.agent.prompt.knowledge_base

if (-not $kbDocs) {
  Write-Error "No KB documents found on agent. Aborting."
  exit 1
}

Write-Host "Found $($kbDocs.Count) KB documents. Pulling content..."

foreach ($doc in $kbDocs) {
  $detail  = Invoke-RestMethod -Uri "https://api.elevenlabs.io/v1/convai/knowledge-base/$($doc.id)" -Headers $headers
  $content = $detail.extracted_inner_html
  $safeName = $doc.name -replace '[\\/:*?"<>|]', '-'
  $filePath = Join-Path $outDir "$safeName.md"
  $header   = "<!-- ElevenLabs KB Doc | id: $($doc.id) | usage_mode: $($doc.usage_mode) -->`n"
  # Out-File -Encoding UTF8 prepends a BOM on some hosts, which shows up as a phantom
  # one-line diff on every sync. Write UTF-8 without BOM so the mirror stays byte-clean.
  # The trailing "`n" keeps the exact bytes Out-File used to produce, so re-syncing an
  # unchanged doc is a genuine no-op rather than a whitespace diff.
  [System.IO.File]::WriteAllText($filePath, ($header + $content + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "  OK  $safeName  ($($content.Length) chars)"
}

# Update last-synced timestamp in README
$readmePath = Join-Path $outDir "README.md"
if (Test-Path $readmePath) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm"
  $readme = (Get-Content $readmePath -Raw) -replace 'Last synced: [\d\- :]+', "Last synced: $ts"
  [System.IO.File]::WriteAllText($readmePath, $readme, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "`nSync complete. $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
