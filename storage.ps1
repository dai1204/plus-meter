param([ValidateSet('Protect','Unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
    $payload = [Console]::In.ReadToEnd()
    if ($Mode -eq 'Protect') {
        $secure = ConvertTo-SecureString -String $payload -AsPlainText -Force
        [Console]::Write((ConvertFrom-SecureString -SecureString $secure))
    } else {
        $secure = ConvertTo-SecureString -String $payload
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
} catch { [Console]::Error.Write('Credential encryption failed.'); exit 1 }
