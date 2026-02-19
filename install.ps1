#
# PCB Lens MCP Server Installer for Windows
#
# Usage:
#   irm https://raw.githubusercontent.com/IntelligentElectron/pcb-lens/main/install.ps1 | iex
#
# Environment variables:
#   PCB_LENS_INSTALL_DIR  Installation directory (default: %LOCALAPPDATA%\pcb-lens)
#   PCB_LENS_VERSION      Specific version to install (default: latest)
#

$ErrorActionPreference = "Stop"

# Configuration
$Repo = "IntelligentElectron/pcb-lens"
$BinaryName = "pcb-lens"
$McpbName = "pcb-lens.mcpb"
$DefaultInstallDir = Join-Path $env:LOCALAPPDATA "pcb-lens"

# Logging functions
function Write-Info { param($Message) Write-Host "[INFO] " -ForegroundColor Blue -NoNewline; Write-Host $Message }
function Write-Success { param($Message) Write-Host "[OK] " -ForegroundColor Green -NoNewline; Write-Host $Message }
function Write-Warn { param($Message) Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $Message }
function Write-Err { param($Message) Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; Write-Host $Message }

function Get-Platform {
    $arch = $env:PROCESSOR_ARCHITECTURE

    switch ($arch) {
        "AMD64" { return "pcb-lens-windows-x64.exe" }
        "ARM64" {
            Write-Warn "Native ARM64 binary not available, using x64 (runs via emulation)"
            return "pcb-lens-windows-x64.exe"
        }
        "x86" {
            Write-Err "32-bit Windows is not supported"
            exit 1
        }
        default {
            Write-Err "Unsupported architecture: $arch"
            exit 1
        }
    }
}

function Get-LatestVersion {
    $url = "https://api.github.com/repos/$Repo/releases/latest"

    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -UseBasicParsing
        return $response.tag_name
    }
    catch {
        Write-Err "Failed to fetch latest version from GitHub API"
        Write-Err "Please check https://github.com/$Repo/releases"
        exit 1
    }
}

function Get-FileChecksum {
    param($FilePath)

    $hash = Get-FileHash -Path $FilePath -Algorithm SHA256
    return $hash.Hash.ToLower()
}

function Add-ToUserPath {
    param($BinDir)

    # Get current user PATH from registry
    $regPath = "HKCU:\Environment"
    $currentPath = (Get-ItemProperty -Path $regPath -Name Path -ErrorAction SilentlyContinue).Path

    if ($null -eq $currentPath) {
        $currentPath = ""
    }

    # Check if already in PATH
    $pathDirs = $currentPath -split ";"
    if ($pathDirs -contains $BinDir) {
        Write-Info "Already in PATH"
        return
    }

    # Add to PATH
    Write-Info "Adding to user PATH via registry"

    if ($currentPath -eq "") {
        $newPath = $BinDir
    }
    else {
        $newPath = "$currentPath;$BinDir"
    }

    Set-ItemProperty -Path $regPath -Name Path -Value $newPath

    # Notify the system of environment variable change
    $HWND_BROADCAST = [IntPtr]0xffff
    $WM_SETTINGCHANGE = 0x1a
    $result = [UIntPtr]::Zero

    if (-not ("Win32.NativeMethods" -as [Type])) {
        Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@
    }

    [Win32.NativeMethods]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result) | Out-Null

    Write-Success "Added to PATH"
}

function Install-PcbLensMcp {
    $installDir = if ($env:PCB_LENS_INSTALL_DIR) { $env:PCB_LENS_INSTALL_DIR } else { $DefaultInstallDir }
    $version = $env:PCB_LENS_VERSION

    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host "         PCB Lens MCP Server Installer" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host ""

    # Detect platform
    $platform = Get-Platform
    Write-Info "Detected platform: $platform"

    # Get version
    if (-not $version) {
        Write-Info "Fetching latest version..."
        $version = Get-LatestVersion
    }
    Write-Info "Version: $version"

    # Construct URLs
    $downloadUrl = "https://github.com/$Repo/releases/download/$version/$platform"
    $mcpbUrl = "https://github.com/$Repo/releases/download/$version/$McpbName"
    $checksumUrl = "https://github.com/$Repo/releases/download/$version/checksums.txt"

    # Create installation directory
    $binDir = Join-Path $installDir "bin"
    if (-not (Test-Path $binDir)) {
        New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    }
    Write-Info "Install directory: $installDir"

    # Download binary
    $tempFile = Join-Path $env:TEMP "$BinaryName-download.exe"
    Write-Info "Downloading from $downloadUrl"

    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing
    }
    catch {
        Write-Err "Download failed: $_"
        exit 1
    }

    # Download and verify checksum
    try {
        $checksumFile = Join-Path $env:TEMP "checksums.txt"
        Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumFile -UseBasicParsing

        $checksumContent = Get-Content $checksumFile
        $expectedLine = $checksumContent | Where-Object { $_ -match $platform }

        if ($expectedLine) {
            $expectedChecksum = ($expectedLine -split "\s+")[0].ToLower()
            $actualChecksum = Get-FileChecksum -FilePath $tempFile

            if ($actualChecksum -ne $expectedChecksum) {
                Write-Err "Checksum verification failed"
                Write-Err "Expected: $expectedChecksum"
                Write-Err "Got: $actualChecksum"
                Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
                exit 1
            }
            Write-Success "Checksum verified"
        }
        else {
            Write-Warn "No checksum found for $platform, skipping verification"
        }

        Remove-Item $checksumFile -Force -ErrorAction SilentlyContinue
    }
    catch {
        Write-Warn "Checksums not available, skipping verification"
    }

    # Install binary
    $binaryPath = Join-Path $binDir "$BinaryName.exe"

    # Remove existing binary if present
    if (Test-Path $binaryPath) {
        Remove-Item $binaryPath -Force
    }

    Move-Item $tempFile $binaryPath -Force
    Write-Success "Installed binary to $binaryPath"

    # Download .mcpb package for Claude Desktop
    $mcpbPath = Join-Path $installDir $McpbName
    $mcpbDownloaded = $false

    try {
        $mcpbTemp = Join-Path $env:TEMP $McpbName
        Invoke-WebRequest -Uri $mcpbUrl -OutFile $mcpbTemp -UseBasicParsing

        if (Test-Path $mcpbPath) {
            Remove-Item $mcpbPath -Force
        }

        Move-Item $mcpbTemp $mcpbPath -Force
        Write-Success "Installed Claude Desktop extension to $mcpbPath"
        $mcpbDownloaded = $true
    }
    catch {
        Write-Warn "Could not download .mcpb package (Claude Desktop extension)"
    }

    # Add to PATH
    Add-ToUserPath -BinDir $binDir

    # Print success message
    Write-Host ""
    Write-Success "Installation complete!"
    Write-Host ""
    Write-Host "Installed files:"
    Write-Host "  Binary: $binaryPath"
    if ($mcpbDownloaded) {
        Write-Host "  Claude Desktop extension: $mcpbPath"
    }
    Write-Host ""
    Write-Host "To start using pcb-lens CLI, either:"
    Write-Host "  1. Open a new PowerShell window, or"
    Write-Host "  2. Run: `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','User') + ';' + `$env:Path"
    Write-Host ""
    Write-Host "Then verify with:"
    Write-Host "  pcb-lens --version"
    Write-Host ""
    Write-Host "To update, run:"
    Write-Host "  pcb-lens --update"
    Write-Host ""
    Write-Host "For Claude Desktop:"
    Write-Host "  1. Open Claude Desktop -> Settings -> Extensions -> Advanced settings"
    Write-Host "  2. Click 'Install Extension...' and select:"
    Write-Host "     $mcpbPath"
    Write-Host ""
}

# Run installer
Install-PcbLensMcp
