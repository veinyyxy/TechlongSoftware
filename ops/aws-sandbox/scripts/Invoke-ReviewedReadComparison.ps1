# A supplied full SHA is the approval. No SHA Read-Host and no automatic approval,
# refresh, replay, next-generation selection or cloud operation chaining.
[CmdletBinding(DefaultParameterSetName = 'Retire')]
param(
    [Parameter(Mandatory)][string]$Evidence,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory, ParameterSetName = 'Retire')][string]$RetirementManifest,
    [Parameter(Mandatory, ParameterSetName = 'Retire')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedRetirementManifestSha,
    [Parameter(Mandatory, ParameterSetName = 'Create')]
    [Parameter(Mandatory, ParameterSetName = 'Execute')][string]$CreationReview,
    [Parameter(Mandatory, ParameterSetName = 'Create')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedCreationReviewSha,
    [Parameter(Mandatory, ParameterSetName = 'Create')]
    [Parameter(Mandatory, ParameterSetName = 'Execute')][string]$RetirementProof,
    [Parameter(Mandatory, ParameterSetName = 'Execute')][string]$ExecutionReview,
    [Parameter(Mandatory, ParameterSetName = 'Execute')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedManifestSha
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'ReadComparisonApprovalWindow.psm1') -Scope Local -Force -DisableNameChecking
function Read-OrdinaryJson([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Every input path must be absolute.' }
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 600000) {
        throw 'Input must be a bounded ordinary file.'
    }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
if (-not [IO.Path]::IsPathRooted($Output) -or (Test-Path -LiteralPath $Output)) { throw 'Output must be a new absolute file.' }
$null = Read-OrdinaryJson $Evidence
$nodeBinary = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$entry = $null
$arguments = @('--evidence', $Evidence, '--output', $Output)
switch ($PSCmdlet.ParameterSetName) {
    'Retire' {
        $manifest = Read-OrdinaryJson $RetirementManifest
        if ($manifest.manifestSha256 -cne $ApprovedRetirementManifestSha) { throw 'Exact new retirement approval not supplied. No AWS write.' }
        Assert-ReadComparisonApprovalWindow $manifest.input.reviewedAt $manifest.input.expiresAt
        $entry = Join-Path $PSScriptRoot 's3-b5-arn-probe-read-comparison-retirement.ts'
        $arguments += @('--mode', 'RetireReviewed', '--manifest', $RetirementManifest,
            '--approved-manifest-sha', $ApprovedRetirementManifestSha, '--execution-phrase', $manifest.requiredPhrase,
            '--acknowledge-irreversible-deletion', '--acknowledge-low-cost-not-zero')
    }
    'Create' {
        $review = Read-OrdinaryJson $CreationReview
        $null = Read-OrdinaryJson $RetirementProof
        if ($review.reviewSha256 -cne $ApprovedCreationReviewSha) { throw 'Exact new creation approval not supplied. No AWS write.' }
        Assert-ReadComparisonApprovalWindow $review.issuedAt $review.expiresAt
        $entry = Join-Path $PSScriptRoot 's3-b5-arn-probe-read-comparison-generation3-create.ts'
        $arguments += @('--mode', 'CreateReviewed', '--review', $CreationReview, '--retirement-proof', $RetirementProof,
            '--approved-review-sha256', $ApprovedCreationReviewSha, '--execution-phrase', $review.requiredPhrase,
            '--acknowledge-aws-write', '--acknowledge-named-iam-change-set-only', '--acknowledge-low-cost-not-zero',
            '--acknowledge-preserves-predecessor-and-consumes-generation3')
    }
    'Execute' {
        $review = Read-OrdinaryJson $ExecutionReview
        $null = Read-OrdinaryJson $CreationReview
        $null = Read-OrdinaryJson $RetirementProof
        $manifest = $review.manifest
        if ($null -eq $manifest -or $manifest.manifestSha256 -cne $ApprovedManifestSha) { throw 'Exact new execution approval not supplied. No AWS write.' }
        Assert-ReadComparisonApprovalWindow $manifest.input.reviewedAt $manifest.input.expiresAt
        $entry = Join-Path $PSScriptRoot 's3-b5-arn-probe-read-comparison-generation3-workflow.ts'
        # These action digests are inside the human-approved manifest; the CLI
        # independently recompiles all three. No manifest SHA is filled for users.
        $arguments += @('--mode', 'RunReviewed', '--creation-review', $CreationReview, '--retirement-proof', $RetirementProof,
            '--manifest', $ExecutionReview, '--approved-manifest-sha', $ApprovedManifestSha,
            '--approved-grant-sha', $manifest.actionSha256.grantExecute, '--approved-reads-sha', $manifest.actionSha256.operatorReads,
            '--approved-revoke-sha', $manifest.actionSha256.revoke, '--execution-phrase', $manifest.requiredPhrase,
            '--acknowledge-aws-write', '--acknowledge-low-cost-not-zero')
    }
}
& $nodeBinary --experimental-strip-types $entry @arguments
if ($LASTEXITCODE -ne 0) { throw 'Entry failed closed. Do not rerun a write. Use independent read-only Inspect; recovery Revoke requires separate approval.' }
if ($PSCmdlet.ParameterSetName -eq 'Retire') {
    $proofOutput = [IO.Path]::ChangeExtension($Output, '.inspect.json')
    if (Test-Path -LiteralPath $proofOutput) { throw 'Independent Inspect output exists. Do not replay Delete.' }
    & $nodeBinary --experimental-strip-types $entry --mode Inspect --evidence $Evidence --output $proofOutput --acknowledge-read-only
    if ($LASTEXITCODE -ne 0) { throw 'Retirement inspection blocked. Do not replay Delete or admit generation3.' }
    $proof = Read-OrdinaryJson $proofOutput
    if ($proof.outcome -ne 'RETIRED_LOCKED_VERIFIED') { throw 'Retirement remains unproved. Do not replay Delete or admit generation3.' }
    Write-Host "Independent retirement proof: $proofOutput"
}
if ($PSCmdlet.ParameterSetName -eq 'Create') {
    $recoverOutput = [IO.Path]::ChangeExtension($Output, '.recover.json')
    $workflowOutput = [IO.Path]::ChangeExtension($Output, '.execution-review.json')
    if ((Test-Path -LiteralPath $recoverOutput) -or (Test-Path -LiteralPath $workflowOutput)) { throw 'Read-only output exists. Do not replay Create.' }
    & $nodeBinary --experimental-strip-types $entry --mode RecoverCreate --evidence $Evidence --retirement-proof $RetirementProof --review $CreationReview --output $recoverOutput --acknowledge-read-only
    if ($LASTEXITCODE -ne 0) { throw 'Creation reconciliation blocked. Do not replay Create.' }
    $recovered = Read-OrdinaryJson $recoverOutput
    if ($recovered.outcome -ne 'READY_UNEXECUTED') { throw 'No exact ready Grant. No installation approval can be issued; do not replay Create.' }
    $workflowEntry = Join-Path $PSScriptRoot 's3-b5-arn-probe-read-comparison-generation3-workflow.ts'
    & $nodeBinary --experimental-strip-types $workflowEntry --mode Review --evidence $Evidence --retirement-proof $RetirementProof --creation-review $CreationReview --output $workflowOutput --acknowledge-read-only
    if ($LASTEXITCODE -ne 0) { throw 'Execution review blocked. No Grant/Operator action was submitted by this wrapper.' }
    $workflow = Read-OrdinaryJson $workflowOutput
    if ($null -eq $workflow.manifest) { throw 'No executable manifest. Do not replay Create.' }
    Write-Host "New execution review (not approved): $workflowOutput"
    Write-Host "Manifest SHA: $($workflow.manifest.manifestSha256)"
    Write-Host "Expires: $($workflow.manifest.input.expiresAt)"
    Write-Host 'Review all three bound action scopes, then supply this new full SHA explicitly with -ApprovedManifestSha. Never paste MFA into chat.'
    # Display a command; never invoke it. Running it is the separate human approval.
    $executeOutput = [IO.Path]::ChangeExtension($Output, '.execute.json')
    $quoted = @($PSCommandPath, $Evidence, $executeOutput, $CreationReview, $RetirementProof, $workflowOutput) | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }
    Write-Host "& $($quoted[0]) -Evidence $($quoted[1]) -Output $($quoted[2]) -CreationReview $($quoted[3]) -RetirementProof $($quoted[4]) -ExecutionReview $($quoted[5]) -ApprovedManifestSha '$($workflow.manifest.manifestSha256)'"
}
Write-Host 'Command finished. Submission alone is not proof; independent read-only verification is required.'
