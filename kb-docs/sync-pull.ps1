# sync-pull.ps1 — Pull all KB documents from ElevenLabs and overwrite local files.
# Run this BEFORE editing any file in kb-docs/ to ensure you have the latest version.
#
# Usage:
#   cd "C:\Active Projects\AiAgentFrontBack"
#   .\kb-docs\sync-pull.ps1

$apiKey = $env:ELEVENLABS_API_KEY
if (-not $apiKey) {
  # Fallback: read from .env file next to this script's parent
  $envFile = Join-Path $PSScriptRoot "..\\.env"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match "^ELEVENLABS_API_KEY=" }
    if ($line) { $apiKey = $line -replace "^ELEVENLABS_API_KEY=", "" }
  }
}
if (-not $apiKey) {
  # Hardcoded fallback (replace with env var in production)
  $apiKey = "sk_25a11646b2c2388a7754203d2addfdf02c78388deafd3045"
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
  ($header + $content) | Out-File $filePath -Encoding UTF8
  Write-Host "  OK  $safeName  ($($content.Length) chars)"
}

# Update last-synced timestamp in README
$readmePath = Join-Path $outDir "README.md"
if (Test-Path $readmePath) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm"
  (Get-Content $readmePath -Raw) -replace 'Last synced: [\d\- :]+', "Last synced: $ts" |
    Out-File $readmePath -Encoding UTF8 -NoNewline
}

Write-Host "`nSync complete. $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
