# Shape Editor Live API - Usage Guide

## Overview

The Shape Editor Live API provides endpoints to capture complete application state, execute server-side shape generation, and export images with real PNG/JPEG rendering. This guide covers the complete export workflow including individual file downloads, batch operations, and integration patterns.

---

## Available Endpoints

### 1. `/api/live/sets/enabled` (POST)
Returns only **enabled** generation sets with filtered batch configurations.

**Method:** POST  
**Required Headers:** `Content-Type: application/json`, `x-api-key`  
**Required Body:** `{"userId": "21294"}`

**Response includes:**
- Enabled generation sets with complete shape types data
- Filtered generation config settings (only enabled sections)
- Set manager settings (visibility, transforms, alignment, blend modes, compositing)
- Export settings, artboard settings, batch export settings

### 2. `/api/live/sets/execute` (POST)
Executes server-side shape generation and creates export job with real PNG/JPEG images.

**Method:** POST  
**Required Headers:** `Content-Type: application/json`, `x-api-key`  
**Required Body:** Configuration data from `/api/live/sets/enabled`

**Response includes:**
- Export job ID for tracking
- Initial status
- Estimated completion time

### 3. `/api/export/status/:exportId` (GET)
Polls export job progress and retrieves download URLs when complete.

**Method:** GET  
**Required Headers:** `x-api-key`  
**URL Parameter:** `:exportId` - The export ID returned from `/api/live/sets/execute`

**Response includes:**
- Job status (pending, processing, completed, failed)
- Progress percentage
- Download URLs (ZIP and individual files)
- File metadata

### 4. `/api/export/download/:exportId` (GET)
Downloads complete export as ZIP file.

**Method:** GET  
**Required Headers:** `x-api-key`  
**URL Parameter:** `:exportId` - The export ID  
**Returns:** Binary ZIP file (use `-JO` flags with curl)

### 5. `/api/export/files/:exportId/:filename` (GET)
Downloads individual image files from export.

**Method:** GET  
**Required Headers:** `x-api-key`  
**URL Parameters:** `:exportId`, `:filename`  
**Returns:** Binary image file (PNG, JPEG, etc.)

### 6. `/api/projects/download/:filename` (GET)
Downloads individual project JSON files.

**Method:** GET  
**Required Headers:** `x-api-key`  
**URL Parameter:** `:filename` - The project filename  
**Returns:** JSON file

### 7. `/api/projects/save` (POST)
Saves complete project data including shapes, groups, canvas settings, generation sets, and configuration.

**Method:** POST  
**Required Headers:** `Content-Type: application/json`, `x-api-key`  
**Required Body:** Project configuration (all fields optional)

**Request Body Fields:**
- `shapes`: Array of shape objects (optional)
- `groups`: Array of group objects (optional)
- `canvasSettings`: Canvas configuration object (optional)
- `batchConfigSettings`: Complete generation config settings (optional)
- `generationSets`: Array of generation set configurations (optional)
- `enabledShapeTypes`: Array of enabled shape type strings (optional)
- `projectName`: Custom project name (optional)
- `includeTimestamp`: Whether to include timestamp in filename (optional, default: true)

**Response includes:**
- Success status
- Saved file path
- Project metadata

---

## Supported Export Formats

The API supports the following image formats:
- **PNG**: Lossless compression with transparency support (recommended for graphics)
- **JPEG**: Lossy compression with smaller file sizes (quality: 1-100)
- **WebP**: Modern format with excellent compression
- **AVIF**: Next-generation format with best compression
- **BMP**: Uncompressed bitmap format

**Scale Factor:** Supports 0.1x to 8x scaling (up to 600dpi for high-resolution print-quality exports)

---

## Authentication

All endpoints require an API key passed via the `x-api-key` header.

**Security Note:** Never hardcode API keys in scripts or documentation. Always use secure credential management.

---

## Setting Up Environment Variables

### Bash/Linux/macOS

```bash
# Set API key for current session
export LIVE_API_KEY="your_api_key_here"

# Add to ~/.bashrc or ~/.zshrc for persistence
echo 'export LIVE_API_KEY="your_api_key_here"' >> ~/.bashrc
source ~/.bashrc
```

### Windows PowerShell ISE / PowerShell

```powershell
# Set API key for current session only
$env:LIVE_API_KEY = "your_api_key_here"

# Set persistently for current user (survives restarts)
[System.Environment]::SetEnvironmentVariable('LIVE_API_KEY', 'your_api_key_here', 'User')

# Verify it's set
echo $env:LIVE_API_KEY
```

**Important for PowerShell Users:**
- **Always use `curl.exe`** (not `curl`) to avoid the PowerShell alias that maps to `Invoke-WebRequest`
- **JSON Parsing:** PowerShell has built-in `ConvertFrom-Json` and `ConvertTo-Json` cmdlets - no need for `jq`
- **Line Continuation:** Use backtick (`` ` ``) for line continuation instead of backslash (`\`)
- **Environment Variables:** Access with `$env:VARIABLE_NAME` (not `$VARIABLE_NAME`)
- **String Escaping:** Double quotes inside JSON strings must be escaped with backslash: `'{\"key\":\"value\"}'`
- **Nested Quotes:** Use backtick to escape inner quotes in PowerShell: `"{`"data`":$ConfigData}"`
- **Sleep Command:** Use `Start-Sleep -Seconds 5` instead of `sleep 5`
- **Command Chaining:** Use semicolons (`;`) to chain commands instead of `&&`
- **ForEach-Object:** PowerShell's native looping for arrays - use `| ForEach-Object { }` for iteration
- **Array Slicing:** Use `Select-Object -First N` to limit array results instead of `jq` array slicing

---

## Complete Export Workflow

### Three-Step Process

The complete workflow follows this pattern:
1. **Get Configuration** - `/api/live/sets/enabled` retrieves current app state
2. **Execute Export** - `/api/live/sets/execute` generates images server-side
3. **Download Files** - `/api/export/download/:exportId` or individual file endpoints

---

## Quick Start Examples

### Example 1: Complete Workflow (Production URL)

**Bash/Linux/macOS:**

```bash
# Step 1: Get enabled sets configuration
CONFIG=$(curl -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LIVE_API_KEY" \
  -d '{"userId":"21294"}')

# Step 2: Execute export with configuration
EXPORT_ID=$(echo "$CONFIG" | jq -c '{data}' | \
  curl -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/execute" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $LIVE_API_KEY" \
    -d @- | jq -r '.data.exportId')

echo "Export ID: $EXPORT_ID"

# Step 3: Poll for completion (wait 5 seconds)
sleep 5

# Step 4: Get status and download path
STATUS=$(curl -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID")
DOWNLOAD_PATH=$(echo "$STATUS" | jq -r '.status.downloadPath')

# Step 5: Download ZIP with smart filename extraction
curl -JO "https://shape-studio-nsdesign.replit.app$DOWNLOAD_PATH"

echo "✅ Export complete! Check your directory for batch-export-*.zip"
```

**Windows PowerShell ISE:**

```powershell
# Step 1: Get enabled sets configuration
$CONFIG = curl.exe -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled" `
  -H "Content-Type: application/json" `
  -H "x-api-key: $env:LIVE_API_KEY" `
  -d '{\"userId\":\"21294\"}'

# Step 2: Execute export with configuration (using temp file for complex JSON)
$Payload = @{
    data = ($CONFIG | ConvertFrom-Json).data
} | ConvertTo-Json -Compress -Depth 10

$TempFile = "$env:TEMP\export-payload.json"
$Payload | Out-File -FilePath $TempFile -Encoding UTF8 -NoNewline

$ExportResponse = curl.exe -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/execute" `
  -H "Content-Type: application/json" `
  -H "x-api-key: $env:LIVE_API_KEY" `
  -d "@$TempFile"

$EXPORT_ID = ($ExportResponse | ConvertFrom-Json).data.exportId
Write-Host "Export ID: $EXPORT_ID"

# Step 3: Poll for completion (wait 5 seconds)
Start-Sleep -Seconds 5

# Step 4: Get status and download path
$STATUS = curl.exe -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID"
$DOWNLOAD_PATH = ($STATUS | ConvertFrom-Json).status.downloadPath

# Step 5: Download ZIP to accessible directory
$DownloadDir = "$env:USERPROFILE\Downloads\shape-exports"
New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
Set-Location $DownloadDir

curl.exe -JO "https://shape-studio-nsdesign.replit.app$DOWNLOAD_PATH"

Write-Host "✅ Export complete! Files saved to: $DownloadDir"
```

### Example 2: One-Line Chained Command (Local Development)

**Bash/Linux/macOS:**

```bash
CONFIG=$(curl -s -X POST "http://localhost:5000/api/live/sets/enabled" \
  -H "x-api-key: $LIVE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId":"21294"}') && \
EXPORT_ID=$(echo "$CONFIG" | jq -c '{data}' | curl -s -X POST "http://localhost:5000/api/live/sets/execute" \
  -H "x-api-key: $LIVE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- | jq -r '.data.exportId') && \
sleep 5 && \
curl -JO "http://localhost:5000$(curl -s "http://localhost:5000/api/export/status/$EXPORT_ID" | jq -r '.status.downloadPath')"
```

**Windows PowerShell ISE:**

```powershell
$CONFIG = curl.exe -s -X POST "http://localhost:5000/api/live/sets/enabled" -H "x-api-key: $env:LIVE_API_KEY" -H "Content-Type: application/json" -d '{\"userId\":\"21294\"}'; $Payload = (@{ data = ($CONFIG | ConvertFrom-Json).data } | ConvertTo-Json -Compress -Depth 10); $TempFile = "$env:TEMP\export-payload.json"; $Payload | Out-File -FilePath $TempFile -Encoding UTF8 -NoNewline; $EXPORT_ID = (curl.exe -s -X POST "http://localhost:5000/api/live/sets/execute" -H "x-api-key: $env:LIVE_API_KEY" -H "Content-Type: application/json" -d "@$TempFile" | ConvertFrom-Json).data.exportId; Start-Sleep -Seconds 5; $DOWNLOAD_PATH = (curl.exe -s "http://localhost:5000/api/export/status/$EXPORT_ID" | ConvertFrom-Json).status.downloadPath; $DownloadDir = "$env:USERPROFILE\Downloads\shape-exports"; New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null; Set-Location $DownloadDir; curl.exe -JO "http://localhost:5000$DOWNLOAD_PATH"
```

### Example 3: One-Line Chained Command (Production URL)

**Bash/Linux/macOS:**

```bash
CONFIG=$(curl -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled" \
  -H "x-api-key: $LIVE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId":"21294"}') && \
EXPORT_ID=$(echo "$CONFIG" | jq -c '{data}' | curl -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/execute" \
  -H "x-api-key: $LIVE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- | jq -r '.data.exportId') && \
sleep 5 && \
curl -JO "https://shape-studio-nsdesign.replit.app$(curl -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID" | jq -r '.status.downloadPath')"
```

**Windows PowerShell ISE:**

```powershell
$CONFIG = curl.exe -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled" -H "x-api-key: $env:LIVE_API_KEY" -H "Content-Type: application/json" -d '{\"userId\":\"21294\"}'; $Payload = (@{ data = ($CONFIG | ConvertFrom-Json).data } | ConvertTo-Json -Compress -Depth 10); $TempFile = "$env:TEMP\export-payload.json"; $Payload | Out-File -FilePath $TempFile -Encoding UTF8 -NoNewline; $EXPORT_ID = (curl.exe -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/execute" -H "x-api-key: $env:LIVE_API_KEY" -H "Content-Type: application/json" -d "@$TempFile" | ConvertFrom-Json).data.exportId; Start-Sleep -Seconds 5; $DOWNLOAD_PATH = (curl.exe -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID" | ConvertFrom-Json).status.downloadPath; $DownloadDir = "$env:USERPROFILE\Downloads\shape-exports"; New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null; Set-Location $DownloadDir; curl.exe -JO "https://shape-studio-nsdesign.replit.app$DOWNLOAD_PATH"
```

**What `-JO` does:**
- `-J` - Use filename from `Content-Disposition` header (e.g., `batch-export-2025-10-18T16-03-29.zip`)
- `-O` - Save file with the extracted filename

---

## Downloading Individual Files

When an export completes, the status response includes individual file URLs for both images and project files.

### Example: Extract and Download Individual Images

**Bash/Linux/macOS:**

```bash
# Get export status
STATUS=$(curl -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID")

# Extract image file URLs
IMAGE_URLS=$(echo "$STATUS" | jq -r '.status.imageFiles[]?.url')

# Download each image
echo "$IMAGE_URLS" | while read url; do
  curl -JO "https://shape-studio-nsdesign.replit.app$url"
done
```

**Windows PowerShell ISE:**

```powershell
# Get export status
$STATUS = curl.exe -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID"

# Extract image file URLs and download each
($STATUS | ConvertFrom-Json).status.imageFiles | ForEach-Object {
  curl.exe -JO "https://shape-studio-nsdesign.replit.app$($_.url)"
}
```

### Example: Download Specific Images by Index

**Bash/Linux/macOS:**

```bash
# Download only the first 3 images
STATUS=$(curl -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID")

echo "$STATUS" | jq -r '.status.imageFiles[0:3][]?.url' | while read url; do
  curl -JO "https://shape-studio-nsdesign.replit.app$url"
done
```

**Windows PowerShell ISE:**

```powershell
# Download only the first 3 images
$STATUS = curl.exe -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID"

($STATUS | ConvertFrom-Json).status.imageFiles | Select-Object -First 3 | ForEach-Object {
  curl.exe -JO "https://shape-studio-nsdesign.replit.app$($_.url)"
}
```

### Example: Download Project Files

**Bash/Linux/macOS:**

```bash
# Extract and download project JSON files
STATUS=$(curl -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID")

PROJECT_URLS=$(echo "$STATUS" | jq -r '.status.projectFiles[]?.url')

echo "$PROJECT_URLS" | while read url; do
  curl -JO "https://shape-studio-nsdesign.replit.app$url"
done
```

**Windows PowerShell ISE:**

```powershell
# Extract and download project JSON files
$STATUS = curl.exe -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID"

($STATUS | ConvertFrom-Json).status.projectFiles | ForEach-Object {
  curl.exe -JO "https://shape-studio-nsdesign.replit.app$($_.url)"
}
```

### Example: Organized Download Script

```bash
#!/bin/bash

# Configuration
API_BASE="https://shape-studio-nsdesign.replit.app"
EXPORT_ID="$1"
OUTPUT_DIR="./downloads"

# Validate export ID
if [ -z "$EXPORT_ID" ]; then
  echo "Usage: $0 <export_id>"
  exit 1
fi

# Create organized directory structure
mkdir -p "$OUTPUT_DIR/images"
mkdir -p "$OUTPUT_DIR/projects"
mkdir -p "$OUTPUT_DIR/zips"

# Get export status
echo "Fetching export status..."
STATUS=$(curl -s "$API_BASE/api/export/status/$EXPORT_ID")

# Check if completed
if [ "$(echo "$STATUS" | jq -r '.status.status')" != "completed" ]; then
  echo "Export not completed yet. Status: $(echo "$STATUS" | jq -r '.status.status')"
  exit 1
fi

# Download ZIP
echo "Downloading ZIP archive..."
ZIP_PATH=$(echo "$STATUS" | jq -r '.status.downloadPath')
curl -o "$OUTPUT_DIR/zips/export.zip" "$API_BASE$ZIP_PATH"

# Download individual images
echo "Downloading individual images..."
echo "$STATUS" | jq -r '.status.imageFiles[]?.url' | while read url; do
  filename=$(basename "$url")
  curl -o "$OUTPUT_DIR/images/$filename" "$API_BASE$url"
  echo "  ✓ $filename"
done

# Download project files
if [ "$(echo "$STATUS" | jq '.status.projectFiles | length')" -gt 0 ]; then
  echo "Downloading project files..."
  echo "$STATUS" | jq -r '.status.projectFiles[]?.url' | while read url; do
    filename=$(basename "$url")
    curl -o "$OUTPUT_DIR/projects/$filename" "$API_BASE$url"
    echo "  ✓ $filename"
  done
fi

# Summary
IMAGE_COUNT=$(echo "$STATUS" | jq '.status.imageFiles | length')
PROJECT_COUNT=$(echo "$STATUS" | jq '.status.projectFiles | length')

echo ""
echo "📦 Download Complete!"
echo "  Images: $IMAGE_COUNT files in $OUTPUT_DIR/images/"
echo "  Projects: $PROJECT_COUNT files in $OUTPUT_DIR/projects/"
echo "  ZIP: $OUTPUT_DIR/zips/export.zip"
```

**Usage:**
```bash
chmod +x download-export.sh
./download-export.sh export_1760803409714_xecxxxez9
```

---

## Usage Scenarios

### Scenario 1: Internal Usage (Replit Shell)

When running curl commands **inside the Replit environment** (Shell, workspace scripts, Replit workflows), you can use environment variables to access secrets securely.

#### Setup Instructions

1. **Add Secret to Replit:**
   - Open the **Secrets** pane in Replit (Tools → Secrets)
   - Click **New Secret**
   - Name: `LIVE_API_KEY`
   - Value: Your actual API key (e.g., `3211d3f332fsss4t4tbebw5r653765h6brb4`)
   - Click **Add**

2. **Verify Secret is Available:**
   ```bash
   printenv | grep LIVE_API_KEY
   ```
   You should see: `LIVE_API_KEY=your-api-key-value`

#### Example: curl Command in Replit Shell

```bash
curl -X POST http://localhost:5000/api/live/sets/enabled \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LIVE_API_KEY" \
  -d '{"userId":"21294"}'
```

**How it works:**
- `$LIVE_API_KEY` automatically expands to the secret value stored in Replit
- The key is never exposed in command history or scripts
- Anyone running this command will use their own secret value

---

### Scenario 2: External Usage (n8n, Zapier, Make, etc.)

When calling the API from **external services** outside the Replit environment, you cannot access Replit secrets. Instead, use the external service's own credential management system.

#### n8n Complete Workflow Example

**Workflow:** Fetch config → Execute export → Poll status → Download files

**Node 1: HTTP Request (Get Configuration)**
```json
{
  "method": "POST",
  "url": "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled",
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "httpHeaderAuth",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "userId": "21294"
  }
}
```

**Node 2: HTTP Request (Execute Export)**
```json
{
  "method": "POST",
  "url": "https://shape-studio-nsdesign.replit.app/api/live/sets/execute",
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "httpHeaderAuth",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "data": "={{ $json.data }}"
  }
}
```

**Node 3: Code (Wait for Completion)**
```javascript
// Wait 10 seconds for export to complete
return new Promise(resolve => {
  setTimeout(() => {
    resolve({ exportId: $input.item.json.data.exportId });
  }, 10000);
});
```

**Node 4: HTTP Request (Check Status)**
```json
{
  "method": "GET",
  "url": "https://shape-studio-nsdesign.replit.app/api/export/status/={{ $json.exportId }}",
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "httpHeaderAuth"
}
```

**Node 5: HTTP Request (Download ZIP)**
```json
{
  "method": "GET",
  "url": "https://shape-studio-nsdesign.replit.app={{ $json.status.downloadPath }}",
  "responseFormat": "file"
}
```

**Node 6: Move Binary Data (Save File)**
- Move the downloaded file to your desired storage location

---

### Scenario 3: Production Server

```bash
#!/bin/bash

# Store API key securely on your server
export LIVE_API_KEY="your-api-key-value"
API_BASE="https://shape-studio-nsdesign.replit.app"
USER_ID="21294"

# Function to check export status with timeout
wait_for_export() {
  local export_id=$1
  local max_attempts=30
  local attempt=0
  
  while [ $attempt -lt $max_attempts ]; do
    status=$(curl -s "$API_BASE/api/export/status/$export_id" | jq -r '.status.status')
    
    if [ "$status" = "completed" ]; then
      echo "✅ Export completed!"
      return 0
    elif [ "$status" = "failed" ]; then
      echo "❌ Export failed!"
      return 1
    fi
    
    echo "⏳ Status: $status (attempt $((attempt + 1))/$max_attempts)"
    sleep 2
    attempt=$((attempt + 1))
  done
  
  echo "⏰ Timeout waiting for export"
  return 1
}

# Execute workflow
echo "1. Fetching configuration..."
config=$(curl -s -X POST "$API_BASE/api/live/sets/enabled" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LIVE_API_KEY" \
  -d "{\"userId\":\"$USER_ID\"}")

echo "2. Executing export..."
response=$(echo "$config" | jq -c '{data}' | \
  curl -s -X POST "$API_BASE/api/live/sets/execute" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $LIVE_API_KEY" \
    -d @-)

export_id=$(echo "$response" | jq -r '.data.exportId')
echo "   Export ID: $export_id"

echo "3. Waiting for completion..."
if wait_for_export "$export_id"; then
  echo "4. Downloading files..."
  curl -JO "$API_BASE$(curl -s "$API_BASE/api/export/status/$export_id" | jq -r '.status.downloadPath')"
  echo "✨ Done!"
else
  echo "❌ Export workflow failed"
  exit 1
fi
```

---

## Request & Response Formats

### Understanding GET vs POST Requests

Before diving into the specific endpoints, here's what you need to know about making API calls:

#### 📨 **POST Requests** (Sending Data)
POST requests are used when you need to **send data** to the API. They require:

1. **Request Method:** `-X POST` flag
2. **Request Body:** `-d` flag with your JSON data
3. **Content-Type Header:** `-H "Content-Type: application/json"`
4. **API Key Header:** `-H "x-api-key: your-api-key"`

**Bash Example:**
```bash
curl -X POST "https://shape-studio-nsdesign.replit.app/api/projects/save" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LIVE_API_KEY" \
  -d '{"projectName": "test"}'
```

**PowerShell Example:**
```powershell
curl.exe -X POST "https://shape-studio-nsdesign.replit.app/api/projects/save" `
  -H "Content-Type: application/json" `
  -H "x-api-key: $env:LIVE_API_KEY" `
  -d '{\"projectName\": \"test\"}'
```

**Common POST Error:**
```
411 Length Required
POST requests require a Content-length header.
```
**Fix:** Add `-d "{}"` (even if empty) to automatically set Content-Length.

---

#### 📥 **GET Requests** (Retrieving Data)
GET requests are used when you need to **retrieve data** from the API. They are simpler:

1. **API Key Header:** `-H "x-api-key: your-api-key"` (or URL parameter)
2. **No Request Body:** Don't use `-d` flag
3. **No Content-Type:** Not needed for GET

**Bash Example:**
```bash
curl "https://shape-studio-nsdesign.replit.app/api/export/status/export_123" \
  -H "x-api-key: $LIVE_API_KEY"
```

**PowerShell Example:**
```powershell
curl.exe "https://shape-studio-nsdesign.replit.app/api/export/status/export_123" `
  -H "x-api-key: $env:LIVE_API_KEY"
```

---

### POST `/api/live/sets/enabled`

**Request Body:**
```json
{
  "userId": "21294"
}
```

**Request Headers:**
```json
{
  "Content-Type": "application/json",
  "x-api-key": "your-api-key"
}
```

**Success Response:**
```json
{
  "success": true,
  "data": {
    "generationSets": [...],
    "currentSetId": "set-...",
    "exportSettings": {...},
    "artboardSettings": {...},
    "batchExportSettings": {...}
  }
}
```

**How to Call (Bash):**
```bash
curl -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LIVE_API_KEY" \
  -d '{"userId": "21294"}'
```

**How to Call (PowerShell):**
```powershell
# Method 1: Inline JSON (escape quotes with backslash)
curl.exe -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled" `
  -H "Content-Type: application/json" `
  -H "x-api-key: $env:LIVE_API_KEY" `
  -d '{\"userId\": \"21294\"}'

# Method 2: Save to temp file (recommended for complex JSON)
$TempFile = [System.IO.Path]::GetTempFileName()
'{"userId": "21294"}' | Out-File -FilePath $TempFile -Encoding utf8
curl.exe -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled" `
  -H "Content-Type: application/json" `
  -H "x-api-key: $env:LIVE_API_KEY" `
  -d "@$TempFile"
Remove-Item $TempFile
```

---

### POST `/api/live/sets/execute`

**Request Body:**
```json
{
  "data": {
    "generationSets": [...],
    "exportSettings": {...},
    "artboardSettings": {...},
    "batchExportSettings": {...}
  }
}
```

**Success Response:**
```json
{
  "success": true,
  "data": {
    "exportId": "export_1760803409714_xecxxxez9",
    "status": "pending",
    "message": "Export job created successfully"
  }
}
```

**How to Call (Bash):**
```bash
# Step 1: Get configuration from /api/live/sets/enabled
CONFIG=$(curl -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LIVE_API_KEY" \
  -d '{"userId": "21294"}')

# Step 2: Execute export using that configuration
curl -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/execute" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LIVE_API_KEY" \
  -d "$CONFIG"
```

**How to Call (PowerShell):**
```powershell
# Step 1: Get configuration
$Config = curl.exe -s -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/enabled" `
  -H "Content-Type: application/json" `
  -H "x-api-key: $env:LIVE_API_KEY" `
  -d '{\"userId\": \"21294\"}'

# Step 2: Save to temp file
$TempFile = [System.IO.Path]::GetTempFileName()
$Config | Out-File -FilePath $TempFile -Encoding utf8

# Step 3: Execute export
curl.exe -X POST "https://shape-studio-nsdesign.replit.app/api/live/sets/execute" `
  -H "Content-Type: application/json" `
  -H "x-api-key: $env:LIVE_API_KEY" `
  -d "@$TempFile"

Remove-Item $TempFile
```

---

### GET `/api/export/status/:exportId`

**Success Response (Completed):**
```json
{
  "success": true,
  "status": {
    "id": "export_1760803409714_xecxxxez9",
    "status": "completed",
    "progress": 100,
    "totalImages": 4,
    "completedImages": 4,
    "downloadPath": "/api/export/download/export_1760803409714_xecxxxez9",
    "imageFiles": [
      {
        "filename": "batch-export-001.png",
        "url": "/api/export/files/export_1760803409714_xecxxxez9/batch-export-001.png",
        "size": 18432
      },
      {
        "filename": "batch-export-002.png",
        "url": "/api/export/files/export_1760803409714_xecxxxez9/batch-export-002.png",
        "size": 18521
      }
    ],
    "projectFiles": [
      {
        "filename": "project-001.json",
        "url": "/api/projects/download/project-001.json",
        "size": 2048
      }
    ],
    "createdAt": "2025-10-18T16:03:29.714Z",
    "completedAt": "2025-10-18T16:03:34.821Z"
  }
}
```

**How to Call (Bash):**
```bash
# Replace with your actual export ID
EXPORT_ID="export_1760803409714_xecxxxez9"

curl "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID" \
  -H "x-api-key: $LIVE_API_KEY"
```

**How to Call (PowerShell):**
```powershell
# Replace with your actual export ID
$ExportId = "export_1760803409714_xecxxxez9"

curl.exe "https://shape-studio-nsdesign.replit.app/api/export/status/$ExportId" `
  -H "x-api-key: $env:LIVE_API_KEY"
```

**Note:** For GET requests, you don't need `-X GET`, `-d` (data), or `Content-Type` header. Just the URL and API key!

---

### POST `/api/projects/save`

**Request Body (Complete Example):**
```json
{
  "projectName": "my-shape-project",
  "includeTimestamp": true,
  "shapes": [
    {
      "id": "shape-1",
      "type": "circle",
      "x": 200,
      "y": 200,
      "radius": 50,
      "fill": "#ff6b6b",
      "stroke": "#000000",
      "strokeWidth": 2
    }
  ],
  "groups": [],
  "canvasSettings": {
    "width": 800,
    "height": 600,
    "zoom": 1,
    "panX": 0,
    "panY": 0,
    "backgroundColor": "#1e293b",
    "showGrid": false
  },
  "batchConfigSettings": {
    "properties": {
      "position": { "enabled": true },
      "rotation": { "enabled": true },
      "scale": { "enabled": true }
    }
  },
  "generationSets": [],
  "enabledShapeTypes": ["circle", "rectangle", "polygon"]
}
```

**Success Response:**
```json
{
  "success": true,
  "filePath": "/tmp/projects/my-shape-project-2025-10-20T22-30-15.json",
  "filename": "my-shape-project-2025-10-20T22-30-15.json",
  "message": "Project saved successfully"
}
```

**How to Call (Bash):**
```bash
curl -X POST "https://shape-studio-nsdesign.replit.app/api/projects/save" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LIVE_API_KEY" \
  -d '{
    "projectName": "my-shape-project",
    "shapes": [{"id": "s1", "type": "circle", "x": 200, "y": 200, "radius": 50}],
    "canvasSettings": {"width": 800, "height": 600},
    "enabledShapeTypes": ["circle"]
  }'
```

**How to Call (PowerShell):**
```powershell
# Save JSON to temp file (recommended for complex data)
$TempFile = [System.IO.Path]::GetTempFileName()
@"
{
  "projectName": "my-shape-project",
  "shapes": [{"id": "s1", "type": "circle", "x": 200, "y": 200, "radius": 50}],
  "canvasSettings": {"width": 800, "height": 600},
  "enabledShapeTypes": ["circle"]
}
"@ | Out-File -FilePath $TempFile -Encoding utf8

curl.exe -X POST "https://shape-studio-nsdesign.replit.app/api/projects/save" `
  -H "Content-Type: application/json" `
  -H "x-api-key: $env:LIVE_API_KEY" `
  -d "@$TempFile"

Remove-Item $TempFile
```

---

### GET `/api/export/download/:exportId`

Downloads the complete export as a ZIP file containing all generated images and project files.

**How to Call (Bash):**
```bash
# The -JO flags automatically save with the correct filename
EXPORT_ID="export_1760803409714_xecxxxez9"

curl -JO "https://shape-studio-nsdesign.replit.app/api/export/download/$EXPORT_ID" \
  -H "x-api-key: $LIVE_API_KEY"
```

**How to Call (PowerShell):**
```powershell
$ExportId = "export_1760803409714_xecxxxez9"

curl.exe -JO "https://shape-studio-nsdesign.replit.app/api/export/download/$ExportId" `
  -H "x-api-key: $env:LIVE_API_KEY"
```

**Result:** Downloads a ZIP file named like `shape-export-20251018-160334.zip`

---

### GET `/api/export/files/:exportId/:filename`

Downloads a single image file from an export.

**How to Call (Bash):**
```bash
EXPORT_ID="export_1760803409714_xecxxxez9"
FILENAME="batch-export-001.png"

curl -JO "https://shape-studio-nsdesign.replit.app/api/export/files/$EXPORT_ID/$FILENAME" \
  -H "x-api-key: $LIVE_API_KEY"
```

**How to Call (PowerShell):**
```powershell
$ExportId = "export_1760803409714_xecxxxez9"
$Filename = "batch-export-001.png"

curl.exe -JO "https://shape-studio-nsdesign.replit.app/api/export/files/$ExportId/$Filename" `
  -H "x-api-key: $env:LIVE_API_KEY"
```

**Result:** Downloads the individual PNG file

---

### GET `/api/projects/download/:filename`

Downloads a saved project JSON file.

**How to Call (Bash):**
```bash
FILENAME="my-shape-project-2025-10-20T22-30-15.json"

curl -JO "https://shape-studio-nsdesign.replit.app/api/projects/download/$FILENAME" \
  -H "x-api-key: $LIVE_API_KEY"
```

**How to Call (PowerShell):**
```powershell
$Filename = "my-shape-project-2025-10-20T22-30-15.json"

curl.exe -JO "https://shape-studio-nsdesign.replit.app/api/projects/download/$Filename" `
  -H "x-api-key: $env:LIVE_API_KEY"
```

**Result:** Downloads the project JSON file

---

## Advanced Examples

### Example: Selective Image Download

Download only images matching a pattern:

```bash
# Get status
STATUS=$(curl -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID")

# Download only images 1-5
echo "$STATUS" | jq -r '.status.imageFiles[] | select(.filename | test("00[1-5]")) | .url' | \
  while read url; do
    curl -JO "https://shape-studio-nsdesign.replit.app$url"
  done
```

### Example: Parallel Downloads

Download all files in parallel (requires GNU parallel):

```bash
# Get all URLs
STATUS=$(curl -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID")

# Extract all file URLs
echo "$STATUS" | jq -r '.status.imageFiles[]?.url, .status.projectFiles[]?.url' | \
  parallel -j 4 "curl -JO https://shape-studio-nsdesign.replit.app{}"
```

### Example: Webhook Notification on Completion

```bash
#!/bin/bash

API_BASE="https://shape-studio-nsdesign.replit.app"
WEBHOOK_URL="https://your-webhook-endpoint.com/notify"

# Execute export
EXPORT_ID=$(curl -s -X POST "$API_BASE/api/live/sets/execute" \
  -H "x-api-key: $LIVE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @config.json | jq -r '.data.exportId')

# Poll and notify
while true; do
  status=$(curl -s "$API_BASE/api/export/status/$EXPORT_ID")
  current=$(echo "$status" | jq -r '.status.status')
  
  if [ "$current" = "completed" ]; then
    # Send webhook notification
    curl -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"exportId\":\"$EXPORT_ID\",\"status\":\"completed\",\"downloadPath\":\"$(echo "$status" | jq -r '.status.downloadPath')\"}"
    break
  elif [ "$current" = "failed" ]; then
    curl -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"exportId\":\"$EXPORT_ID\",\"status\":\"failed\"}"
    break
  fi
  
  sleep 2
done
```

---


---

## Additional Resources

For security best practices, troubleshooting, API key management, and performance optimization, see [API Reference](./api-reference.md).
