import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, Code2 } from 'lucide-react';
import { BatchConfigSettings } from '@shared/schema';
import { Artboard, ShapeType, ScatterSettings } from '../lib/shapeTypes';

interface ApiCallGeneratorProps {
  // Real shape editor state
  enabledShapeTypes: Set<ShapeType>;
  scatterSettings: ScatterSettings;
  generationConfigSettings: BatchConfigSettings;
  // Export dialog state (with defaults for API)
  exportBatchModeEnabled?: boolean;
  exportSaveProjectFiles?: boolean;
  exportBatchCount?: number;
  exportShapeCountRange?: [number, number]; // [min, max] range
  // Export settings from current UI
  exportQuality?: number;
  exportScale?: number;
  exportFormat?: string;
  exportScope?: 'all' | 'selected' | 'artboard';
  // Packaging and selective export settings
  packageAsZip?: boolean;
  exportAllImages?: boolean;
  selectedImageIndices?: number[];
  // Artboard data
  artboards: Artboard[];
  activeArtboard: string;
  className?: string;
  sidebarCollapsed?: boolean;
}

interface GenerationCountConfig {
  mode: 'fixed' | 'range' | 'incremental';
  fixed?: number;
  min?: number;
  max?: number;
  start?: number;
  increment?: number;
  resetPerBatch?: boolean;
}

interface ApiV2Payload {
  // V1 (existing) parameters
  format?: string;
  quality?: number;
  scale?: number;
  includeBackground?: boolean;
  backgroundColor?: string;
  exportBatchCount?: number;
  exportSaveProjectFiles?: boolean;
  packageAsZip?: boolean;
  
  // V2 additions
  generationCount?: GenerationCountConfig;
  modulationValue?: number;
  
  // V3+ additions for selective export
  exportAllImages?: boolean;
  selectedImageIndices?: number[];
}

interface LiveStatePayload {
  apiMode: 'live';
  currentState: {
    // Shape types and settings from current UI
    enabledShapeTypes: string[];
    shapeCountMode: 'fixed' | 'range';
    shapeCount: number;
    shapeCountRange: [number, number];
    shapeSpecificSettings: Record<string, any>;
    // Export settings from current UI
    exportFormat: string;
    exportQuality: number;
    exportScale: number;
    exportScope: 'all' | 'selected' | 'artboard';
    // Batch settings from current UI  
    exportBatchModeEnabled: boolean;
    exportBatchCount: number;
    exportSaveProjectFiles: boolean;
    exportShapeCountRange: [number, number];
    // Packaging and selective export settings
    packageAsZip?: boolean;
    exportAllImages?: boolean;
    selectedImageIndices?: number[];
    // Artboard settings
    artboardBackgroundColor: string;
    // Only enabled generation config settings
    enabledGenerationSettings: Record<string, any>;
  };
}

type ApiPayload = ApiV2Payload | LiveStatePayload;

export default function ApiCallGenerator({ 
  enabledShapeTypes,
  scatterSettings,
  generationConfigSettings, 
  exportBatchModeEnabled = true,
  exportSaveProjectFiles = false,
  exportBatchCount = 5,
  exportShapeCountRange,
  exportQuality = 92,
  exportScale = 1,
  exportFormat = "png",
  exportScope = "all",
  packageAsZip = false,
  exportAllImages = true,
  selectedImageIndices = [],
  artboards,
  activeArtboard,
  className = "",
  sidebarCollapsed = false
}: ApiCallGeneratorProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedApiVersion, setSelectedApiVersion] = useState<'sets-enabled' | 'sets-execute' | 'live' | 'v1' | 'v2' | 'v3' | 'v4'>('sets-enabled');

  // Get current artboard background color
  const getCurrentArtboardBackground = (): string => {
    const currentArtboard = artboards.find(ab => ab.id === activeArtboard);
    return currentArtboard?.backgroundColor || '#ffffff';
  };

  // Get current shape count values based on mode
  const getCurrentShapeCount = () => {
    if (scatterSettings.shapeCountMode === 'fixed') {
      return {
        mode: 'fixed' as const,
        count: scatterSettings.fixedShapeCount,
        range: [scatterSettings.fixedShapeCount, scatterSettings.fixedShapeCount] as [number, number]
      };
    } else {
      return {
        mode: 'range' as const,
        count: scatterSettings.minCount,
        range: [scatterSettings.minCount, scatterSettings.maxCount] as [number, number]
      };
    }
  };

  // Get shape-specific settings for enabled shape types only
  const getEnabledShapeSettings = () => {
    const enabled: Record<string, any> = {};
    Array.from(enabledShapeTypes).forEach(shapeType => {
      const settings = scatterSettings.shapeSpecific[shapeType as keyof typeof scatterSettings.shapeSpecific];
      if (settings) {
        enabled[shapeType] = settings;
      }
    });
    return enabled;
  };

  // Filter generation config settings to only include enabled sections
  const getEnabledGenerationSettings = () => {
    const enabled: Record<string, any> = {};
    
    if (generationConfigSettings.distributionLayoutEnabled) {
      enabled.distributionLayout = {
        enabled: true,
        algorithm: 'grid'
      };
    }
    
    if (generationConfigSettings.generationCountModulationEnabled) {
      enabled.modulation = {
        enabled: true,
        value: generationConfigSettings.generationCountModulationValue
      };
    }
    
    return enabled;
  };

  // Generate Live State API payload
  const generateLiveStatePayload = (): LiveStatePayload => {
    const currentShapeCount = getCurrentShapeCount();
    const currentExportShapeCountRange = exportShapeCountRange || currentShapeCount.range;
    
    return {
      apiMode: 'live',
      currentState: {
        // Shape types and settings from current UI
        enabledShapeTypes: Array.from(enabledShapeTypes),
        shapeCountMode: currentShapeCount.mode,
        shapeCount: currentShapeCount.count,
        shapeCountRange: currentShapeCount.range,
        shapeSpecificSettings: getEnabledShapeSettings(),
        // Export settings from current UI
        exportFormat: exportFormat,
        exportQuality: exportQuality,
        exportScale: exportScale,
        exportScope: exportScope,
        // Batch settings from current UI
        exportBatchModeEnabled: exportBatchModeEnabled,
        exportBatchCount: exportBatchCount,
        exportSaveProjectFiles: exportSaveProjectFiles,
        exportShapeCountRange: currentExportShapeCountRange,
        // Packaging and selective export settings
        packageAsZip: packageAsZip,
        exportAllImages: exportAllImages,
        selectedImageIndices: selectedImageIndices,
        // Artboard settings
        artboardBackgroundColor: getCurrentArtboardBackground(),
        // Only enabled generation config settings
        enabledGenerationSettings: getEnabledGenerationSettings()
      }
    };
  };

  // Convert current settings to API payload (Detailed APIs)
  const generateDetailedApiPayload = (): ApiV2Payload => {
    const payload: ApiV2Payload = {
      // V1 parameters from actual export dialog state
      format: exportFormat,
      quality: exportQuality,
      scale: exportScale,
      includeBackground: true,
      backgroundColor: getCurrentArtboardBackground(),
      exportBatchCount: exportBatchCount,
      exportSaveProjectFiles: exportSaveProjectFiles,
      packageAsZip: packageAsZip,
    };

    // Only add V2+ features if V2+ version is selected
    if (selectedApiVersion !== 'v1') {
      // V2 parameters: Check if batch mode is enabled and shape count is configured as range
      if (exportBatchModeEnabled && exportShapeCountRange) {
        const [min, max] = exportShapeCountRange;
        
        // Add generation count configuration based on the export dialog range
        const generationCount: GenerationCountConfig = {
          mode: 'range' as const,
          min: min,
          max: max
        };

        payload.generationCount = generationCount;
      }

      // Add modulation if enabled from batch config dialog
      if (generationConfigSettings?.generationCountModulationEnabled) {
        payload.modulationValue = generationConfigSettings.generationCountModulationValue;
      }
      
      // V3+ selective export parameters  
      if (['v3', 'v4'].includes(selectedApiVersion)) {
        payload.exportAllImages = exportAllImages;
        payload.selectedImageIndices = selectedImageIndices;
      }
    }

    return payload;
  };

  // Choose payload based on selected API version
  const generateApiPayload = (): ApiPayload | { userId: string } | { data: any; dpr?: number } => {
    if (selectedApiVersion === 'sets-enabled') {
      // For /api/live/sets/enabled endpoint - simple userId payload
      return { userId: "your-user-id" };
    } else if (selectedApiVersion === 'sets-execute') {
      // For /api/live/sets/execute endpoint - use response from sets-enabled
      return {
        data: {
          generationSets: [
            {
              id: "set-1",
              name: "Example Set",
              enabled: true,
              enabledShapeTypes: ["circle", "rectangle"],
              shapeCountMode: "fixed",
              shapeCountFixed: 10,
              batchConfig: {
                selectedPreset: "none",
                distributionLayoutEnabled: false,
                propertiesEnabled: true
              }
            }
          ],
          exportSettings: {
            format: exportFormat,
            quality: exportQuality,
            scale: exportScale,
            mode: exportScope
          },
          artboardSettings: {
            width: 400,
            height: 400,
            backgroundColor: getCurrentArtboardBackground(),
            displayGrid: false,
            displayBorder: true
          },
          batchExportSettings: {
            enabled: exportBatchModeEnabled,
            count: exportBatchCount,
            setsPerExport: 1
          }
        },
        dpr: window.devicePixelRatio || 1
      };
    } else if (selectedApiVersion === 'live') {
      return generateLiveStatePayload();
    } else {
      return generateDetailedApiPayload();
    }
  };

  const generateCurlCommand = (platform: 'linux' | 'windows'): string => {
    const payload = generateApiPayload();
    const jsonPayload = JSON.stringify(payload, null, 2);
    const baseUrl = 'https://shape-studio-nsdesign.replit.app';
    
    // Choose endpoint based on API version
    let endpoint = '';
    if (selectedApiVersion === 'sets-enabled') {
      endpoint = '/api/live/sets/enabled';
    } else if (selectedApiVersion === 'sets-execute') {
      endpoint = '/api/live/sets/execute';
    } else if (selectedApiVersion === 'live') {
      endpoint = '/api/live/execute';
    } else {
      endpoint = `/api/export/batch/${selectedApiVersion}`;
    }
    
    if (platform === 'windows') {
      // Windows cmd/PowerShell format - use environment variable
      const escapedJson = jsonPayload.replace(/"/g, '\\"');
      return `curl -X POST ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: %LIVE_API_KEY%" ^
  -d "${escapedJson}" ^
  ${baseUrl}${endpoint}`;
    } else {
      // Linux/Mac bash format - use environment variable
      return `curl -X POST \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $LIVE_API_KEY" \\
  -d '${jsonPayload}' \\
  ${baseUrl}${endpoint}`;
    }
  };

  const generatePowerShellCommand = (): string => {
    const payload = generateApiPayload();
    const jsonPayload = JSON.stringify(payload, null, 2);
    const baseUrl = 'https://shape-studio-nsdesign.replit.app';
    
    // Choose endpoint based on API version
    let endpoint = '';
    if (selectedApiVersion === 'sets-enabled') {
      endpoint = '/api/live/sets/enabled';
    } else if (selectedApiVersion === 'sets-execute') {
      endpoint = '/api/live/sets/execute';
    } else if (selectedApiVersion === 'live') {
      endpoint = '/api/live/execute';
    } else {
      endpoint = `/api/export/batch/${selectedApiVersion}`;
    }
    
    // PowerShell with file-based approach (more reliable for complex JSON)
    return `# Save payload to temp file
$Payload = @'
${jsonPayload}
'@

$TempFile = "$env:TEMP\\api-payload.json"
$Payload | Out-File -FilePath $TempFile -Encoding UTF8 -NoNewline

# Execute API call
curl.exe -X POST \`
  -H "Content-Type: application/json" \`
  -H "x-api-key: $env:LIVE_API_KEY" \`
  -d "@$TempFile" \`
  ${baseUrl}${endpoint}`;
  };

  const generateN8nConfig = (): object => {
    const payload = generateApiPayload();
    
    // Choose endpoint based on API version
    let endpoint = '';
    if (selectedApiVersion === 'sets-enabled') {
      endpoint = '/api/live/sets/enabled';
    } else if (selectedApiVersion === 'sets-execute') {
      endpoint = '/api/live/sets/execute';
    } else if (selectedApiVersion === 'live') {
      endpoint = '/api/live/execute';
    } else {
      endpoint = `/api/export/batch/${selectedApiVersion}`;
    }
    
    return {
      "node": "HttpRequest",
      "parameters": {
        "method": "POST",
        "url": `https://shape-studio-nsdesign.replit.app${endpoint}`,
        "headers": {
          "Content-Type": "application/json",
          "x-api-key": "={{$credentials.ShapeEditorAPIKey}}"
        },
        "body": {
          "bodyType": "json",
          "jsonBody": JSON.stringify(payload, null, 2)
        },
        "options": {
          "timeout": 30000
        }
      }
    };
  };

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const payload = generateApiPayload();
  const curlLinux = generateCurlCommand('linux');
  const curlWindows = generateCurlCommand('windows');
  const powerShell = generatePowerShellCommand();
  const n8nConfig = generateN8nConfig();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button 
          variant="secondary" 
          size="sm" 
          className={`${sidebarCollapsed ? 'h-8 w-8 p-0 flex items-center justify-center' : 'h-8 gap-2'} ${className}`}
        >
          <Code2 className="h-4 w-4" />
          {!sidebarCollapsed && 'Generate API Call'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generated API Calls ({selectedApiVersion.toUpperCase()})</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Version Selector */}
          <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
            <label className="text-sm font-medium">API Version:</label>
            <Select value={selectedApiVersion} onValueChange={(value: 'sets-enabled' | 'sets-execute' | 'live' | 'v1' | 'v2' | 'v3' | 'v4') => setSelectedApiVersion(value)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select version" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sets-enabled">Get Config (Step 1)</SelectItem>
                {/* sets-execute removed (2026-05): /api/live/sets/execute is deprecated and now returns 410 Gone. */}
                <SelectItem value="live">Live State (Current UI)</SelectItem>
                <SelectItem value="v1">V1 (Basic)</SelectItem>
                <SelectItem value="v2">V2 (Advanced)</SelectItem>
                <SelectItem value="v3">V3 (Future)</SelectItem>
                <SelectItem value="v4">V4 (Future)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="text-sm text-slate-400">
            {selectedApiVersion === 'sets-enabled'
              ? 'Get your enabled generation sets configuration.' 
              : selectedApiVersion === 'live' 
              ? 'Executes with ALL your current app settings - export format, batch size, save options, generation config, everything!' 
              : 'Based on your current generation count settings. Ready to use with Shape Studio API.'}
          </div>

          <Tabs defaultValue="curl-linux" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="curl-linux" className="data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:font-medium">cURL (Linux/Mac)</TabsTrigger>
              <TabsTrigger value="curl-windows" className="data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:font-medium">cURL (Windows)</TabsTrigger>
              <TabsTrigger value="powershell" className="data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:font-medium">PowerShell</TabsTrigger>
              <TabsTrigger value="n8n" className="data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:font-medium">n8n HTTP Request</TabsTrigger>
            </TabsList>
            
            <TabsContent value="curl-linux" className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium">Linux/Mac Terminal</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(curlLinux, 'curl-linux')}
                  className="gap-2"
                >
                  <Copy className="h-4 w-4" />
                  {copied === 'curl-linux' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <pre className="bg-slate-900 p-4 rounded-lg text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">
                {curlLinux}
              </pre>
            </TabsContent>
            
            <TabsContent value="curl-windows" className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium">Windows Command Prompt</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(curlWindows, 'curl-windows')}
                  className="gap-2"
                >
                  <Copy className="h-4 w-4" />
                  {copied === 'curl-windows' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <pre className="bg-slate-900 p-4 rounded-lg text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">
                {curlWindows}
              </pre>
            </TabsContent>
            
            <TabsContent value="powershell" className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium">Windows PowerShell ISE</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(powerShell, 'powershell')}
                  className="gap-2"
                >
                  <Copy className="h-4 w-4" />
                  {copied === 'powershell' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <pre className="bg-slate-900 p-4 rounded-lg text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">
                {powerShell}
              </pre>
            </TabsContent>
            
            <TabsContent value="n8n" className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium">n8n HTTP Request Node Configuration</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(JSON.stringify(n8nConfig, null, 2), 'n8n')}
                  className="gap-2"
                >
                  <Copy className="h-4 w-4" />
                  {copied === 'n8n' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <pre className="bg-slate-900 p-4 rounded-lg text-xs text-slate-300 overflow-x-auto">
                {JSON.stringify(n8nConfig, null, 2)}
              </pre>
            </TabsContent>
          </Tabs>

          {/* Current Settings Summary - Show actual export dialog settings */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium mb-3 text-black">Current Export Configuration</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-400">Batch Mode:</span>
                <span className="ml-2 font-medium text-black">{exportBatchModeEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div>
                <span className="text-slate-400">Export Count:</span>
                <span className="ml-2 font-medium text-black">{exportBatchCount}</span>
              </div>
              <div>
                <span className="text-slate-400">Save Project Files:</span>
                <span className="ml-2 font-medium text-black">{exportSaveProjectFiles ? 'Yes' : 'No'}</span>
              </div>
              {selectedApiVersion !== 'live' && 'generationCount' in payload && payload.generationCount && (
                <>
                  <div>
                    <span className="text-slate-400">Generation Mode:</span>
                    <span className="ml-2 font-medium text-black">{payload.generationCount.mode}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Min Count:</span>
                    <span className="ml-2 font-medium text-black">{payload.generationCount.min}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Max Count:</span>
                    <span className="ml-2 font-medium text-black">{payload.generationCount.max}</span>
                  </div>
                </>
              )}
              {selectedApiVersion !== 'live' && 'modulationValue' in payload && payload.modulationValue !== undefined && (
                <div>
                  <span className="text-slate-400">Modulation Value:</span>
                  <span className="ml-2 font-medium text-black">{payload.modulationValue}</span>
                </div>
              )}
              {selectedApiVersion === 'live' && 'currentState' in payload && (
                <>
                  <div>
                    <span className="text-slate-400">API Mode:</span>
                    <span className="ml-2 font-medium text-black">Live State - All Current Settings</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Shape Types:</span>
                    <span className="ml-2 font-medium text-black">{payload.currentState.enabledShapeTypes.length} enabled ({payload.currentState.enabledShapeTypes.slice(0, 3).join(', ')}{payload.currentState.enabledShapeTypes.length > 3 ? '...' : ''})</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Shape Count:</span>
                    <span className="ml-2 font-medium text-black">{payload.currentState.shapeCountMode === 'fixed' ? `Fixed: ${payload.currentState.shapeCount}` : `Range: ${payload.currentState.shapeCountRange[0]}-${payload.currentState.shapeCountRange[1]}`}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Export:</span>
                    <span className="ml-2 font-medium text-black">{payload.currentState.exportFormat?.toUpperCase() || 'PNG'}, Q{payload.currentState.exportQuality}, {payload.currentState.exportScale}x, {payload.currentState.exportScope}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Background:</span>
                    <span className="ml-2 font-medium text-black">{payload.currentState.artboardBackgroundColor}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Enabled Sections:</span>
                    <span className="ml-2 font-medium text-black">{Object.keys(payload.currentState.enabledGenerationSettings).join(', ') || 'None'}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}