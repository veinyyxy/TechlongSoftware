# Evaluate only the production Node-selection expression with mocked discovery.
# No executable, wrapper, AWS SDK/CLI or ledger operation is invoked.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskWrapperPath = Join-Path $PSScriptRoot '../../ops/aws-sandbox/scripts/Invoke-ReviewedReadComparison.ps1'
$taskParseErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseFile($taskWrapperPath, [ref]$null, [ref]$taskParseErrors)
if ($taskParseErrors.Count) { throw 'Wrapper parse failed.' }
$taskNodeAssignment = $taskAst.Find({ param($item)
    $item -is [Management.Automation.Language.AssignmentStatementAst] -and
    $item.Left -is [Management.Automation.Language.VariableExpressionAst] -and
    $item.Left.VariablePath.UserPath -eq 'nodeBinary'
}, $true)
if ($null -eq $taskNodeAssignment) { throw 'Production Node selection missing.' }
$taskSelector = [scriptblock]::Create($taskNodeAssignment.Right.Extent.Text)
$script:taskCandidateCommands = @()
function Get-Command {
    [CmdletBinding()]
    param([string]$Name, [string]$CommandType)
    if ($Name -cne 'node' -or $CommandType -cne 'Application') { throw 'Unexpected discovery request.' }
    if (-not $script:taskCandidateCommands.Count) { throw 'Node application unavailable.' }
    return $script:taskCandidateCommands
}
$script:taskCandidateCommands = @([PSCustomObject]@{ Source = 'D:\Node\node.exe' })
$taskSelected = & $taskSelector
if ($taskSelected -isnot [string] -or $taskSelected -cne 'D:\Node\node.exe') { throw 'Single Node path drifted.' }
$script:taskCandidateCommands = @([PSCustomObject]@{ Source = 'C:\Program Files\Node\node.exe' }, [PSCustomObject]@{ Source = 'D:\Second\node.exe' })
$taskSelected = & $taskSelector
if ($taskSelected -isnot [string] -or $taskSelected -cne 'C:\Program Files\Node\node.exe') { throw 'Multiple paths were joined or PATH precedence changed.' }
$script:taskCandidateCommands = @()
$taskBlocked = $false
try { $null = & $taskSelector } catch { $taskBlocked = $true }
if (-not $taskBlocked) { throw 'Missing Node did not fail closed.' }
Write-Output 'Node binary discovery regression passed (single/multiple/missing; no AWS or ledger operations).'
