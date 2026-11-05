param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
# Local ACL administration only: preserve ownership; never print identities.
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$sids = @($owner, (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')), (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))
foreach ($sid in $sids) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
[System.IO.Directory]::SetAccessControl($Directory, $acl)
