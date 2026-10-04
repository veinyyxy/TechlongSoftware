# Separate fresh Create/Execute approvals. No retirement, automatic approval,
# write retry, slot reset or successor selection. MFA stays in the local terminal.
[CmdletBinding(DefaultParameterSetName = 'Create')]
param(
    [Parameter(Mandatory)][string]$Evidence,
    [Parameter(Mandatory)][string]$RetirementProof,
    [Parameter(Mandatory)][string]$CreationReview,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory, ParameterSetName = 'Create')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedCreationReviewSha,
    [Parameter(Mandatory, ParameterSetName = 'Execute')]
    [Parameter(Mandatory, ParameterSetName = 'RecoverRevoke')][string]$ExecutionReview,
    [Parameter(Mandatory, ParameterSetName = 'Execute')]
    [Parameter(Mandatory, ParameterSetName = 'RecoverRevoke')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedManifestSha,
    [Parameter(Mandatory, ParameterSetName = 'RecoverRevoke')][switch]$RecoverRevoke
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'ReadComparisonApprovalWindow.psm1') -Scope Local -Force -DisableNameChecking
function Read-OrdinaryJson([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Every input must be absolute.' }
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 600000) { throw 'Bounded ordinary input required.' }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
$null = Read-OrdinaryJson $Evidence
$proof = Read-OrdinaryJson $RetirementProof
$creation = Read-OrdinaryJson $CreationReview
if ($proof.stage -cne 'B5-J5g-j20-retirement' -or $proof.outcome -cne 'RETIRED_LOCKED_VERIFIED' -or $creation.stage -cne 'B5-J5g-j20') { throw 'Generation4 requires its own exact independent retirement proof and creation review. No AWS write.' }
if (-not [IO.Path]::IsPathRooted($Output)) { throw 'Output must be absolute.' }
$recoverOutput = [IO.Path]::ChangeExtension($Output, '.recover.json')
$workflowOutput = [IO.Path]::ChangeExtension($Output, '.execution-review.json')
$inspectOutput = [IO.Path]::ChangeExtension($Output, '.inspect.json')
$requiredOutputs = @($Output)
if ($PSCmdlet.ParameterSetName -eq 'Create') { $requiredOutputs += @($recoverOutput, $workflowOutput) } else { $requiredOutputs += $inspectOutput }
foreach ($path in $requiredOutputs) { if (Test-Path -LiteralPath $path) { throw 'Every write/read output must be new before starting. Never replay a write.' } }
$taskNodeBinary = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$createEntry = Join-Path $PSScriptRoot 's3-b5-arn-probe-read-comparison-generation4-create.ts'
$workflowEntry = Join-Path $PSScriptRoot 's3-b5-arn-probe-read-comparison-generation4-workflow.ts'
$common = @('--evidence', $Evidence, '--retirement-proof', $RetirementProof)
if ($PSCmdlet.ParameterSetName -eq 'Create') {
    if ($creation.reviewSha256 -cne $ApprovedCreationReviewSha) { throw 'New complete creation SHA approval required. No AWS write.' }
    Assert-ReadComparisonApprovalWindow $creation.issuedAt $creation.expiresAt
    & $taskNodeBinary --experimental-strip-types $createEntry @common --mode CreateReviewed --review $CreationReview --output $Output --approved-review-sha256 $ApprovedCreationReviewSha --execution-phrase $creation.requiredPhrase --acknowledge-aws-write --acknowledge-named-iam-change-set-only --acknowledge-low-cost-not-zero --acknowledge-preserves-predecessor-and-consumes-generation4
    # Even a lost Create response requires independent read-only reconciliation,
    # never a retry or a replacement request. No installation is invoked here.
    & $taskNodeBinary --experimental-strip-types $createEntry @common --mode RecoverCreate --review $CreationReview --output $recoverOutput --acknowledge-read-only
    if ($LASTEXITCODE -ne 0) { throw 'Independent Create reconciliation blocked. Never replay Create.' }
    $recovered = Read-OrdinaryJson $recoverOutput
    if ($recovered.outcome -cne 'READY_UNEXECUTED') { throw 'Ready Grant unproved; no installation review. Never reset the slot.' }
    & $taskNodeBinary --experimental-strip-types $workflowEntry @common --mode Review --creation-review $CreationReview --output $workflowOutput --acknowledge-read-only
    if ($LASTEXITCODE -ne 0) { throw 'Execution review blocked; Grant was not installed by this wrapper.' }
    $workflow = Read-OrdinaryJson $workflowOutput
    if ($null -eq $workflow.manifest) { throw 'No executable manifest; no installation approval.' }
    Write-Host "Execution review (not approved): $workflowOutput"
    Write-Host "Manifest SHA: $($workflow.manifest.manifestSha256)"
    Write-Host "Grant action SHA: $($workflow.manifest.actionSha256.grantExecute)"
    Write-Host "Reads action SHA: $($workflow.manifest.actionSha256.operatorReads)"
    Write-Host "Revoke action SHA: $($workflow.manifest.actionSha256.revoke)"
    Write-Host "Expires: $($workflow.manifest.input.expiresAt)"
    $executeOutput = [IO.Path]::ChangeExtension($Output, '.execute.json')
    $quoted = @($PSCommandPath, $Evidence, $RetirementProof, $CreationReview, $executeOutput, $workflowOutput) | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }
    # Display only. The user separately reviews and explicitly supplies this SHA.
    Write-Host "& $($quoted[0]) -Evidence $($quoted[1]) -RetirementProof $($quoted[2]) -CreationReview $($quoted[3]) -Output $($quoted[4]) -ExecutionReview $($quoted[5]) -ApprovedManifestSha '$($workflow.manifest.manifestSha256)'"
} else {
    $review = Read-OrdinaryJson $ExecutionReview
    $manifest = $review.manifest
    if ($null -eq $manifest -or $manifest.stage -cne 'B5-J5g-j20' -or $manifest.manifestSha256 -cne $ApprovedManifestSha) { throw 'New complete generation4 execution/revoke-only approval required. No AWS write.' }
    $arguments = $common + @('--creation-review', $CreationReview, '--manifest', $ExecutionReview, '--output', $Output, '--approved-manifest-sha', $ApprovedManifestSha, '--approved-revoke-sha', $manifest.actionSha256.revoke, '--acknowledge-aws-write', '--acknowledge-low-cost-not-zero')
    if ($PSCmdlet.ParameterSetName -eq 'Execute') {
        Assert-ReadComparisonApprovalWindow $manifest.input.reviewedAt $manifest.input.expiresAt
        $arguments += @('--mode', 'RunReviewed', '--approved-grant-sha', $manifest.actionSha256.grantExecute, '--approved-reads-sha', $manifest.actionSha256.operatorReads, '--execution-phrase', $manifest.requiredPhrase)
    } else {
        # Separate explicit revoke-only approval; expiration does not suppress
        # recovery, and this branch cannot AssumeRole, install or read Operator.
        $arguments += @('--mode', 'RecoverRevoke', '--execution-phrase', 'I_CONFIRM_J5GJ20_REVOKE_ONLY')
    }
    & $taskNodeBinary --experimental-strip-types $workflowEntry @arguments
    # Independent read-only Inspect runs on success or failure, never a write retry.
    & $taskNodeBinary --experimental-strip-types $workflowEntry @common --mode Inspect --creation-review $CreationReview --output $inspectOutput --acknowledge-read-only
    if ($LASTEXITCODE -ne 0) { throw 'Independent Inspect blocked; never replay Grant/reads. Revoke-only recovery needs separate approval.' }
    $inspected = Read-OrdinaryJson $inspectOutput
    if ($inspected.outcome -cne 'LOCKED_VERIFIED') { throw 'Revoke required; no automatic recovery write. Approve exact revoke-only recovery separately.' }
    Write-Host "Independent Locked proof: $inspectOutput"
}
Write-Host 'Finished one approved stage only. No child, DeleteStack, paid Cell or automatic next generation.'
