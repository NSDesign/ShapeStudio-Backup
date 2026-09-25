# Shape Editor Live API - Reference Guide

This document provides security best practices, troubleshooting guides, API key management, and performance optimization tips for the Shape Editor Live API.

For working examples and usage instructions, see [API Usage Guide](./api-usage.md).

---

## Security Best Practices

### ✅ Do's

1. **Use Environment Variables:**
   - Store API keys in environment variables, never in code
   - In Replit: Use the Secrets pane
   - In external services: Use their credential management system

2. **Use HTTPS in Production:**
   - Always use `https://` when calling published Replit apps
   - Never send API keys over unencrypted connections

3. **Rotate Keys Regularly:**
   - Change API keys periodically
   - Update in all services using the key

4. **Restrict Access:**
   - Limit who can view/edit Replit secrets
   - Use separate keys for different environments (dev/prod)

### ❌ Don'ts

1. **Never Hardcode Keys:**
   ```bash
   # BAD - Key exposed in script
   curl -H "x-api-key: 3211d3f332fsss4t4tbebw5r653765h6brb4" ...
   
   # GOOD - Key from environment variable
   curl -H "x-api-key: $LIVE_API_KEY" ...
   ```

2. **Never Commit Keys to Git:**
   - Add `.env` files to `.gitignore`
   - Use Replit Secrets instead of `.env` files when possible

3. **Never Share Keys Publicly:**
   - Don't paste keys in chat, documentation, or screenshots
   - Revoke and regenerate if accidentally exposed

4. **Never Log Keys:**
   ```javascript
   // BAD
   console.log('API Key:', process.env.LIVE_API_KEY);
   
   // GOOD
   console.log('API Key:', '****');
   ```

---

## Troubleshooting

### Common Issues

1. **"Invalid API key" error**
   - Verify API key matches the value in `server/routes/liveApi.ts`
   - Check header name is exactly `x-api-key` (case-sensitive)
   - Ensure no extra whitespace in key value

2. **"User not found" error**
   - User must exist in database
   - Verify userId in request body matches a real user

3. **Connection refused**
   - Ensure the Replit app is running
   - Check the URL is correct (localhost:5000 for dev)
   - For published apps, use `https://shape-studio-nsdesign.replit.app`

4. **Export stuck in "processing"**
   - Check server logs for errors
   - Verify node-canvas is properly installed
   - Ensure sufficient memory/CPU resources

5. **File not found (404) on download**
   - Files expire after a certain period
   - Check that export completed successfully
   - Verify exportId is correct

### Debug Steps

1. **Verify Environment Variable:**
   ```bash
   echo $LIVE_API_KEY
   ```

2. **Test with Hardcoded Key (temporarily):**
   ```bash
   curl -X POST https://shape-studio-nsdesign.replit.app/api/live/sets/enabled \
     -H "x-api-key: 3211d3f332fsss4t4tbebw5r653765h6brb4" \
     -H "Content-Type: application/json" \
     -d '{"userId":"21294"}'
   ```

3. **Check Server Logs:**
   - View Replit console for error messages
   - Add console.log statements in `server/routes/liveApi.ts`

4. **Test Endpoint Availability:**
   ```bash
   curl -X POST https://shape-studio-nsdesign.replit.app/api/live/sets/enabled \
     -H "x-api-key: $LIVE_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"userId":"21294"}' -v
   ```

5. **Inspect Export Status:**
   ```bash
   # Get detailed status
   curl -s "https://shape-studio-nsdesign.replit.app/api/export/status/$EXPORT_ID" | jq
   ```

---

## API Key Management

### Setting Up the API Key

The API key is configured in `server/routes/liveApi.ts`:

```typescript
// API key from environment or fallback to hardcoded for development
const API_KEY = process.env.LIVE_API_KEY || '3211d3f332fsss4t4tbebw5r653765h6brb4';
```

### Updating the API Key

1. **Generate New Key:**
   ```bash
   # Generate random key
   openssl rand -hex 32
   ```

2. **Update in Replit:**
   - Go to Secrets pane
   - Update `LIVE_API_KEY` value
   - Restart the app

3. **Update in External Services:**
   - Update credentials in n8n
   - Update environment variables on external servers
   - Update any documentation

### Multiple API Keys (Future Enhancement)

Currently supports single API key. To add multiple keys:

```typescript
const VALID_API_KEYS = [
  process.env.LIVE_API_KEY_1,
  process.env.LIVE_API_KEY_2,
  process.env.LIVE_API_KEY_3
].filter(Boolean);

// In middleware
if (!VALID_API_KEYS.includes(apiKey)) {
  return res.status(401).json({ error: 'Invalid API key' });
}
```

---

## OpenAPI / Swagger Documentation

### Overview

OpenAPI (formerly Swagger) provides interactive API documentation with a web UI where users can test endpoints directly. While not yet implemented in Shape Editor, here's how to add it:

### Implementation Guide

#### 1. Install Dependencies

```bash
npm install swagger-ui-express swagger-jsdoc --save
npm install @types/swagger-ui-express --save-dev
```

#### 2. Create OpenAPI Configuration

Create `server/swagger.ts`:

```typescript
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Shape Editor API',
      version: '1.0.0',
      description: 'Live API for server-side shape generation and export',
      contact: {
        name: 'API Support',
        email: '21294'
      }
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development server'
      },
      {
        url: 'https://shape-studio-nsdesign.replit.app',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key'
        }
      }
    },
    security: [{
      ApiKeyAuth: []
    }]
  },
  apis: ['./server/routes/*.ts'] // Path to API route files
};

export const swaggerSpec = swaggerJsdoc(options);
```

#### 3. Add to Express Server

In `server/index.ts`:

```typescript
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';

// Add after other routes
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
```

#### 4. Annotate API Routes

Add JSDoc comments to `server/routes/liveApi.ts`:

```typescript
/**
 * @swagger
 * /api/live/sets/enabled:
 *   post:
 *     summary: Get enabled generation sets
 *     description: Returns configuration for all enabled generation sets with filtered batch settings
 *     tags:
 *       - Live API
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: 21294
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       401:
 *         description: Unauthorized - Invalid API key
 */
app.post('/api/live/sets/enabled', async (req, res) => {
  // ... existing code
});
```

#### 5. Access Documentation

Once implemented, visit:
- **Local:** http://localhost:5000/api-docs
- **Production:** https://shape-studio-nsdesign.replit.app/api-docs

### Benefits of OpenAPI/Swagger

✅ **Interactive Testing** - Test endpoints directly in browser
✅ **Auto-Generated Docs** - Always up-to-date with code
✅ **Client Code Generation** - Generate API clients for multiple languages
✅ **Type Safety** - Define schemas once, use everywhere
✅ **Team Collaboration** - Easy onboarding for new developers

### Alternative: Postman Collections

Another option is exporting a Postman collection:

```json
{
  "info": {
    "name": "Shape Editor API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Get Enabled Sets",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "x-api-key",
            "value": "{{API_KEY}}"
          }
        ],
        "url": "{{BASE_URL}}/api/live/sets/enabled",
        "body": {
          "mode": "raw",
          "raw": "{\"userId\":\"21294\"}"
        }
      }
    }
  ]
}
```

---

## Performance & Optimization

### Recommended Practices

1. **Batch Size Limits**
   - Keep exports under 50 images for faster processing
   - Use higher batch counts only when necessary

2. **Image Quality**
   - PNG: Lossless but larger files (recommended for graphics)
   - JPEG: Smaller files, quality 85-92 recommended
   - Adjust quality based on use case

3. **Polling Strategy**
   - Poll status every 2-3 seconds
   - Implement exponential backoff for long exports
   - Set reasonable timeout (30-60 seconds)

4. **Concurrent Requests**
   - Limit parallel export requests to avoid resource exhaustion
   - Queue requests if processing multiple users

---

## Rate Limiting (Future Enhancement)

Consider implementing rate limiting to prevent abuse:

```typescript
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests from this IP'
});

app.use('/api/live/', apiLimiter);
```

---

## Next Steps

- ✅ **Individual File Downloads** - Implemented in this guide
- ✅ **Complete Workflow Examples** - Provided with real URLs
- ⏳ **OpenAPI/Swagger Docs** - Implementation guide provided
- ⏳ **Webhooks** - Add webhook support for real-time updates
- ⏳ **Rate Limiting** - Implement to prevent abuse
- ⏳ **API Versioning** - Consider `/api/v1/live/sets/enabled`
- ⏳ **Monitoring** - Track API usage and performance metrics

---

## Troubleshooting

### Windows PowerShell Issues

#### Issue: "Permission denied" when downloading files

**Symptom:**
```
Warning: Failed to open the file image-001.png: Permission denied
curl: (23) client returned ERROR on write of 66 bytes
```

**Solution:**
Change to a directory where you have write permissions:

```powershell
# Create and navigate to a downloads folder
$DownloadDir = "$env:USERPROFILE\Downloads\shape-exports"
New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
Set-Location $DownloadDir

# Now download files
curl.exe -JO "https://shape-studio-nsdesign.replit.app/api/export/files/$EXPORT_ID/image-001.png"
```

#### Issue: "Expected property name or '}' in JSON at position 1"

**Symptom:**
```
{"message":"Expected property name or '}' in JSON at position 1"}
```

**Solution:**
Use the file-based approach for complex JSON payloads:

```powershell
# Instead of inline JSON string
$Payload = @{
    data = ($CONFIG | ConvertFrom-Json).data
} | ConvertTo-Json -Compress -Depth 10

# Save to temp file
$TempFile = "$env:TEMP\export-payload.json"
$Payload | Out-File -FilePath $TempFile -Encoding UTF8 -NoNewline

# Use @filename syntax
curl.exe -d "@$TempFile" ...
```

#### Issue: curl command not found or using wrong curl

**Symptom:**
```
curl : The 'Invoke-WebRequest' command was found in the module 'Microsoft.PowerShell.Utility'
```

**Solution:**
Always use `curl.exe` (not `curl`) to avoid PowerShell's alias:

```powershell
# Wrong - uses PowerShell alias
curl -X POST ...

# Correct - uses actual curl.exe
curl.exe -X POST ...
```

#### Issue: Environment variable not found

**Symptom:**
```
$env:LIVE_API_KEY is empty or null
```

**Solution:**
Set the environment variable properly:

```powershell
# For current session
$env:LIVE_API_KEY = "your_api_key_here"

# Verify it's set
echo $env:LIVE_API_KEY

# For persistent storage (survives restarts)
[System.Environment]::SetEnvironmentVariable('LIVE_API_KEY', 'your_api_key_here', 'User')
```

### General API Issues

#### Issue: Export returns empty imageFiles array

**Symptom:**
Status shows completed but no individual file URLs:
```json
{
  "status": {
    "status": "completed",
    "imageFiles": [],
    "projectFiles": []
  }
}
```

**Cause:**
This occurs when `packageAsZip` is set to `false` in your batch export settings. The individual file tracking is currently not fully implemented.

**Solution:**
Use `packageAsZip: true` (recommended for API usage):

```bash
# Ensure packageAsZip is true in your configuration
# This will provide a downloadPath in the status response
```

Alternatively, manually construct file URLs if you know the export ID and filename pattern:
```powershell
curl.exe -JO "https://shape-studio-nsdesign.replit.app/api/export/files/$EXPORT_ID/image-001.png"
```

#### Issue: Corrupted or invalid image files

**Symptom:**
Downloaded PNG files cannot be opened; error messages like "not a valid bitmap file" or "no decode delegate for this image format"

**Status:**
✅ **Resolved** - Server-side canvas image generation has been verified to produce valid PNG and JPEG files with correct signatures.

**Solution:**
If you encounter invalid image files:
1. Verify the export completed successfully (check status endpoint)
2. Ensure you're downloading the correct file format (PNG, JPEG, etc.)
3. Check that the file wasn't truncated during download
4. Test with a minimal export (1-2 images) to isolate the issue

All exports now generate valid image files that can be opened in standard image viewers.

---

## Support

For issues or questions:

1. Check this documentation first
2. Review troubleshooting section
3. Check server logs in Replit console
4. Test with the provided example scripts
5. Contact support with error messages and request details

**API Endpoints Summary:**
- Production: `https://shape-studio-nsdesign.replit.app`
- Development: `http://localhost:5000`
- User: `21294`
- Auth: `x-api-key` header required
