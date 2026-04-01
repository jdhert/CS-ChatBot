param(
  [int]$RunCount = 0,
  [int]$SleepSeconds = 180,
  [int]$BatchSize = 100,
  [int]$MaxBatches = 8,
  [int]$MinIntervalMs = 2000,
  [int]$MaxRetries = 10,
  [string]$Provider = "google",
  [string]$Model = "gemini-embedding-2-preview",
  [string]$PriorityMode = "answer_first",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$logDir = Join-Path $repoRoot "logs"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$logPath = Join-Path $logDir ("embedding-loop-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

function Write-Log {
  param(
    [string]$Message
  )

  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -Path $logPath -Value $line
}

function Invoke-EmbeddingRun {
  $env:EMBEDDING_PROVIDER = $Provider
  $env:GOOGLE_EMBEDDING_MODEL = $Model
  $env:GOOGLE_EMBEDDING_MIN_INTERVAL_MS = [string]$MinIntervalMs
  $env:GOOGLE_EMBEDDING_MAX_RETRIES = [string]$MaxRetries
  $env:EMBEDDING_PRIORITY_MODE = $PriorityMode

  $arguments = @(
    "run"
    "ingest:sync:scc-embeddings"
    "--"
    "--provider"
    $Provider
    "--batch-size"
    [string]$BatchSize
    "--max-batches"
    [string]$MaxBatches
    "--priority-mode"
    $PriorityMode
  )

  if ($DryRun) {
    $arguments += "--dry-run"
  }

  $output = & npm @arguments 2>&1
  $exitCode = $LASTEXITCODE

  foreach ($line in $output) {
    Write-Log "$line"
  }

  return @{
    ExitCode = $exitCode
    OutputText = ($output | Out-String)
  }
}

Write-Log "Embedding loop start"
Write-Log "Config: provider=$Provider, model=$Model, batchSize=$BatchSize, maxBatches=$MaxBatches, minIntervalMs=$MinIntervalMs, maxRetries=$MaxRetries, priorityMode=$PriorityMode, runCount=$RunCount, dryRun=$DryRun"
Write-Log "Log file: $logPath"

$iteration = 0

while ($true) {
  $iteration += 1
  Write-Log "Run #$iteration start"

  $result = Invoke-EmbeddingRun

  if ($result.ExitCode -ne 0) {
    Write-Log "Run #$iteration failed with exitCode=$($result.ExitCode)"
  } else {
    Write-Log "Run #$iteration completed successfully"
  }

  if ($result.OutputText -match "selected=0") {
    Write-Log "No pending chunks detected. Stopping loop."
    break
  }

  if ($RunCount -gt 0 -and $iteration -ge $RunCount) {
    Write-Log "Reached requested run count ($RunCount). Stopping loop."
    break
  }

  Write-Log "Sleeping for $SleepSeconds seconds before next run"
  Start-Sleep -Seconds $SleepSeconds
}

Write-Log "Embedding loop end"
