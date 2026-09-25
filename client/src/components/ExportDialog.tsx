import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Image, FileImage } from "lucide-react";
import { ImageExporter, ImageFormat, ExportOptions } from '../lib/imageExport';
import { Shape, ShapeGroupClass } from '../lib/shapes';
import { CanvasSettings, Artboard } from '../lib/shapeTypes';
import { useToast } from "@/hooks/use-toast";

interface ExportDialogProps {
  shapes: Shape[];
  groups: ShapeGroupClass[];
  canvasSettings: CanvasSettings;
  artboards: Artboard[];
  selectedShapes: Shape[];
  selectedGroups: ShapeGroupClass[];
}

export default function ExportDialog({ shapes, groups, canvasSettings, artboards, selectedShapes, selectedGroups }: ExportDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [quality, setQuality] = useState(92);
  const [scale, setScale] = useState(1);
  const [customWidth, setCustomWidth] = useState(canvasSettings.width);
  const [customHeight, setCustomHeight] = useState(canvasSettings.height);
  const [useCustomSize, setUseCustomSize] = useState(false);
  const [includeBackground, setIncludeBackground] = useState(true);
  const [backgroundColor, setBackgroundColor] = useState('#1e293b');
  
  // Export scope options
  const [exportScope, setExportScope] = useState<'all' | 'selected' | 'artboard'>('all');
  const [selectedArtboardIds, setSelectedArtboardIds] = useState<string[]>([]);
  
  // Margin options
  const [useMargins, setUseMargins] = useState(false);
  const [uniformMargins, setUniformMargins] = useState(true);
  const [marginTop, setMarginTop] = useState(20);
  const [marginRight, setMarginRight] = useState(20);
  const [marginBottom, setMarginBottom] = useState(20);
  const [marginLeft, setMarginLeft] = useState(20);
  
  // Adornments option
  const [includeAdornments, setIncludeAdornments] = useState(false);
  
  // Grid and artboard options
  const [includeGrid, setIncludeGrid] = useState(false);
  const [includeArtboardGeometry, setIncludeArtboardGeometry] = useState(false);
  
  // Naming options
  const [filename, setFilename] = useState('');
  const [includeTypeInName, setIncludeTypeInName] = useState(false);
  const [includeArtboardInName, setIncludeArtboardInName] = useState(false);
  const [customPrefix, setCustomPrefix] = useState('');
  
  const { toast } = useToast();

  // Auto-update naming options based on export scope
  useEffect(() => {
    if (exportScope === 'selected' && selectedShapes.length > 0) {
      setIncludeTypeInName(true);
    }
    if (exportScope === 'artboard' && selectedArtboardIds.length === 1) {
      setIncludeArtboardInName(true);
    }
  }, [exportScope, selectedShapes.length, selectedArtboardIds.length]);

  const supportedFormats: { value: ImageFormat; label: string; description: string }[] = [
    { value: 'png' as ImageFormat, label: 'PNG', description: 'Lossless with transparency' },
    { value: 'jpeg' as ImageFormat, label: 'JPEG', description: 'Lossy compression, smaller files' },
    { value: 'webp' as ImageFormat, label: 'WebP', description: 'Modern format, excellent compression' },
    { value: 'avif' as ImageFormat, label: 'AVIF', description: 'Next-gen format, best compression' },
    { value: 'bmp' as ImageFormat, label: 'BMP', description: 'Uncompressed bitmap' }
  ].filter(f => ImageExporter.isFormatSupported(f.value));

  const getQualityLabel = () => {
    if (quality >= 90) return 'Highest';
    if (quality >= 80) return 'High';
    if (quality >= 60) return 'Medium';
    if (quality >= 40) return 'Low';
    return 'Lowest';
  };

  const getScaleLabel = () => {
    if (scale === 1) return '1x (Standard)';
    if (scale === 2) return '2x (Retina)';
    if (scale === 3) return '3x (Super Retina)';
    if (scale === 4) return '4x (Ultra High DPI)';
    if (scale >= 6) return `${scale}x (600dpi+)`;
    if (scale >= 5) return `${scale}x (High Resolution)`;
    return `${scale}x`;
  };

  const generateFilename = (baseName: string = '') => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const parts = [];
    
    // Use custom prefix if provided
    if (customPrefix) parts.push(customPrefix);
    
    // Use filename if provided, otherwise generate based on export scope
    if (filename.trim()) {
      parts.push(filename.trim());
    } else if (baseName) {
      parts.push(baseName);
    } else {
      // Auto-generate based on export scope
      switch(exportScope) {
        case 'selected':
          if (selectedShapes.length > 0) {
            parts.push('selected-shapes');
          } else {
            parts.push('selection');
          }
          break;
        case 'artboard':
          if (selectedArtboardIds.length === 1) {
            const artboard = artboards.find(a => a.id === selectedArtboardIds[0]);
            parts.push(artboard ? artboard.name.replace(/\s+/g, '-') : 'artboard');
          } else {
            parts.push('artboard');
          }
          break;
        default:
          parts.push('all-shapes');
      }
    }
    
    // Add type information if requested
    if (includeTypeInName && exportScope === 'selected' && selectedShapes.length > 0) {
      const types = Array.from(new Set(selectedShapes.map(s => s.type)));
      if (types.length === 1) parts.push(types[0]);
      else if (types.length <= 3) parts.push(types.join('-'));
      else parts.push('mixed');
    }
    
    // Add artboard name if requested
    if (includeArtboardInName && exportScope === 'artboard' && selectedArtboardIds.length === 1) {
      const artboard = artboards.find(a => a.id === selectedArtboardIds[0]);
      if (artboard && !parts.includes(artboard.name.replace(/\s+/g, '-'))) {
        parts.push(artboard.name.replace(/\s+/g, '-'));
      }
    }
    
    const name = parts.length > 0 ? parts.join('_') : 'shape-editor';
    return `${name}_${timestamp}.${ImageExporter.getFileExtension(format)}`;
  };

  const getExportShapes = () => {
    switch (exportScope) {
      case 'selected':
        return selectedShapes;
      case 'artboard':
        if (selectedArtboardIds.length === 0) return shapes;
        // Filter shapes that are within selected artboards
        return shapes.filter(shape => {
          return selectedArtboardIds.some(artboardId => {
            const artboard = artboards.find(a => a.id === artboardId);
            if (!artboard) return false;
            return shape.transform.x >= artboard.x && 
                   shape.transform.x <= artboard.x + artboard.width &&
                   shape.transform.y >= artboard.y && 
                   shape.transform.y <= artboard.y + artboard.height;
          });
        });
      default:
        return shapes;
    }
  };

  const getExportGroups = () => {
    switch (exportScope) {
      case 'selected':
        return selectedGroups;
      case 'artboard':
        // For artboards, include all groups for now
        return groups;
      default:
        return groups;
    }
  };

  const handleExport = async () => {
    const exportShapes = getExportShapes();
    const exportGroups = getExportGroups();
    
    if (exportShapes.length === 0 && exportGroups.length === 0) {
      toast({
        title: "No content to export",
        description: exportScope === 'selected' ? "Select shapes to export first." : "Add some shapes to the canvas before exporting.",
        variant: "destructive"
      });
      return;
    }

    setIsExporting(true);

    try {
      const exporter = new ImageExporter();
      
      // Calculate proper dimensions based on export scope
      let exportWidth = canvasSettings.width;
      let exportHeight = canvasSettings.height;

      if (exportScope === 'artboard' && selectedArtboardIds.length === 1) {
        const artboard = artboards.find(a => a.id === selectedArtboardIds[0]);
        if (artboard) {
          exportWidth = artboard.width;
          exportHeight = artboard.height;
        }
      }

      // Get artboard bounds for artboard exports
      let artboardBounds = undefined;
      if (exportScope === 'artboard' && selectedArtboardIds.length === 1) {
        const artboard = artboards.find(a => a.id === selectedArtboardIds[0]);
        if (artboard) {
          artboardBounds = {
            x: artboard.x,
            y: artboard.y,
            width: artboard.width,
            height: artboard.height
          };
        }
      }

      const options: ExportOptions = {
        format,
        quality: quality / 100,
        scale,
        width: useCustomSize ? customWidth : undefined, // Let exporter calculate based on content
        height: useCustomSize ? customHeight : undefined, // Let exporter calculate based on content
        backgroundColor: includeBackground ? backgroundColor : 'transparent',
        includeBackground,
        includeAdornments,
        includeGrid,
        includeArtboardGeometry,
        margins: useMargins ? {
          top: marginTop,
          right: uniformMargins ? marginTop : marginRight,
          bottom: uniformMargins ? marginTop : marginBottom,
          left: uniformMargins ? marginTop : marginLeft
        } : undefined,
        artboardBounds
      };

      const blob = await exporter.exportImage(exportShapes, exportGroups, canvasSettings, options, artboards);
      
      const filename = generateFilename();
      
      await ImageExporter.downloadImage(blob, filename);
      
      toast({
        title: "Export successful",
        description: `Image saved as ${filename}`,
      });
      
      setIsOpen(false);
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  const supportsQuality = ['jpeg', 'webp', 'avif'].includes(format);
  const supportsTransparency = ['png', 'webp', 'avif'].includes(format);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-white"
        >
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] bg-[var(--surface)] border-slate-700 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center text-white">
            <FileImage className="w-5 h-5 mr-2" />
            Export Image
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Export your shapes as high-quality images with customizable options
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Export Scope Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-slate-300">Export Scope</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={exportScope === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setExportScope('all')}
                className={exportScope === 'all' ? 
                  'bg-blue-600 hover:bg-blue-700 text-white' : 
                  'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'
                }
              >
                All Shapes
              </Button>
              <Button
                variant={exportScope === 'selected' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setExportScope('selected')}
                disabled={selectedShapes.length === 0 && selectedGroups.length === 0}
                className={exportScope === 'selected' ? 
                  'bg-blue-600 hover:bg-blue-700 text-white' : 
                  'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600 disabled:opacity-50'
                }
              >
                Selected ({selectedShapes.length + selectedGroups.length})
              </Button>
              <Button
                variant={exportScope === 'artboard' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setExportScope('artboard')}
                disabled={artboards.length === 0}
                className={exportScope === 'artboard' ? 
                  'bg-blue-600 hover:bg-blue-700 text-white' : 
                  'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600 disabled:opacity-50'
                }
              >
                Artboards
              </Button>
            </div>
            
            {/* Artboard Selection */}
            {exportScope === 'artboard' && artboards.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">Select Artboards</Label>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {artboards.map(artboard => (
                    <div key={artboard.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={artboard.id}
                        checked={selectedArtboardIds.includes(artboard.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedArtboardIds([...selectedArtboardIds, artboard.id]);
                          } else {
                            setSelectedArtboardIds(selectedArtboardIds.filter(id => id !== artboard.id));
                          }
                        }}
                      />
                      <Label htmlFor={artboard.id} className="text-xs text-slate-300 cursor-pointer">
                        {artboard.name} ({artboard.width}×{artboard.height})
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Format Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-300">Format</Label>
            <Select value={format} onValueChange={(value) => setFormat(value as ImageFormat)}>
              <SelectTrigger className="bg-[var(--surface-light)] border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[var(--surface-light)] border-slate-600" style={{ zIndex: 10002 }}>
                {supportedFormats.map(f => (
                  <SelectItem key={f.value} value={f.value}>
                    <div>
                      <div className="font-medium">{f.label}</div>
                      <div className="text-xs text-slate-400">{f.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quality Slider */}
          {supportsQuality && (
            <div className="space-y-3">
              <Label className="text-sm font-medium text-slate-300">
                Quality: {quality}% ({getQualityLabel()})
              </Label>
              <Slider
                value={[quality]}
                onValueChange={([value]) => setQuality(value)}
                min={10}
                max={100}
                step={5}
                className="w-full"
              />
            </div>
          )}

          {/* Scale Factor */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-slate-300">
              Scale: {getScaleLabel()}
            </Label>
            <Slider
              value={[scale]}
              onValueChange={([value]) => setScale(value)}
              min={0.1}
              max={8}
              step={0.1}
              className="w-full"
            />
            <div className="text-xs text-slate-400">
              Higher scales create larger, higher resolution images (up to 8x for 600dpi)
            </div>
          </div>

          {/* Custom Size */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Switch
                checked={useCustomSize}
                onCheckedChange={setUseCustomSize}
              />
              <Label className="text-sm font-medium text-slate-300">Custom Size</Label>
            </div>
            
            {useCustomSize && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-slate-400">Width</Label>
                  <NumericInput
                    value={customWidth}
                    onChange={setCustomWidth}
                    min={1}
                    max={8000}
                    step={1}
                    className="bg-[var(--surface-light)] border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-400">Height</Label>
                  <NumericInput
                    value={customHeight}
                    onChange={setCustomHeight}
                    min={1}
                    max={8000}
                    step={1}
                    className="bg-[var(--surface-light)] border-slate-600 text-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Filename Input */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-slate-300">Custom Filename</Label>
            <Input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="Leave empty for auto-generated name"
              className="bg-[var(--surface-light)] border-slate-600 text-white"
            />
            <div className="text-xs text-slate-400">
              Preview: {generateFilename()}
            </div>
          </div>

          {/* Shape Adornments */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Switch
                checked={includeAdornments}
                onCheckedChange={setIncludeAdornments}
              />
              <Label className="text-sm font-medium text-slate-300">Include Shape Adornments</Label>
            </div>
            {includeAdornments && (
              <div className="text-xs text-slate-400">
                Includes selection handles, control points, and other shape editing UI elements
              </div>
            )}
          </div>

          {/* Grid and Artboard Options */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Switch
                checked={includeGrid}
                onCheckedChange={setIncludeGrid}
              />
              <Label className="text-sm font-medium text-slate-300">Include Grid</Label>
            </div>
            
            {exportScope === 'artboard' && (
              <div className="flex items-center space-x-2">
                <Switch
                  checked={includeArtboardGeometry}
                  onCheckedChange={setIncludeArtboardGeometry}
                />
                <Label className="text-sm font-medium text-slate-300">Include Artboard Outlines</Label>
              </div>
            )}
          </div>

          {/* Background Options */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Switch
                checked={includeBackground}
                onCheckedChange={setIncludeBackground}
              />
              <Label className="text-sm font-medium text-slate-300">Include Background</Label>
            </div>
            
            {includeBackground && (
              <div className="flex items-center space-x-3">
                <Label className="text-xs text-slate-400">Color:</Label>
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-10 h-8 rounded border border-slate-600 bg-transparent"
                />
                <span className="text-xs text-slate-400">{backgroundColor}</span>
              </div>
            )}
            
            {!supportsTransparency && !includeBackground && (
              <div className="text-xs text-amber-400">
                ⚠ {format.toUpperCase()} doesn't support transparency. Background will be white.
              </div>
            )}
          </div>

          {/* Margins */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Switch
                checked={useMargins}
                onCheckedChange={setUseMargins}
              />
              <Label className="text-sm font-medium text-slate-300">Add Margins</Label>
            </div>
            
            {useMargins && (
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={uniformMargins}
                    onCheckedChange={setUniformMargins}
                  />
                  <Label className="text-xs text-slate-400">Uniform margins</Label>
                </div>
                
                {uniformMargins ? (
                  <div>
                    <Label className="text-xs text-slate-400">Margin (px)</Label>
                    <NumericInput
                      value={marginTop}
                      onChange={(value) => {
                        setMarginTop(value);
                        setMarginRight(value);
                        setMarginBottom(value);
                        setMarginLeft(value);
                      }}
                      min={0}
                      max={200}
                      step={1}
                      className="bg-[var(--surface-light)] border-slate-600 text-white slider-input"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-slate-400">Top</Label>
                      <NumericInput
                        value={marginTop}
                        onChange={setMarginTop}
                        min={0}
                        max={200}
                        step={1}
                        className="bg-[var(--surface-light)] border-slate-600 text-white slider-input"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Right</Label>
                      <NumericInput
                        value={marginRight}
                        onChange={setMarginRight}
                        min={0}
                        max={200}
                        step={1}
                        className="bg-[var(--surface-light)] border-slate-600 text-white slider-input"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Bottom</Label>
                      <NumericInput
                        value={marginBottom}
                        onChange={setMarginBottom}
                        min={0}
                        max={200}
                        step={1}
                        className="bg-[var(--surface-light)] border-slate-600 text-white slider-input"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Left</Label>
                      <NumericInput
                        value={marginLeft}
                        onChange={setMarginLeft}
                        min={0}
                        max={200}
                        step={1}
                        className="bg-[var(--surface-light)] border-slate-600 text-white slider-input"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Naming Options */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-slate-300">File Naming</Label>
            
            <div>
              <Label className="text-xs text-slate-400">Custom Prefix</Label>
              <Input
                value={customPrefix}
                onChange={(e) => setCustomPrefix(e.target.value)}
                placeholder="e.g. design, export"
                className="bg-[var(--surface-light)] border-slate-600 text-white"
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-type"
                  checked={includeTypeInName}
                  onCheckedChange={(checked) => setIncludeTypeInName(checked === true)}
                />
                <Label htmlFor="include-type" className="text-xs text-slate-300 cursor-pointer">
                  Include shape type in filename (for selected shapes)
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-artboard"
                  checked={includeArtboardInName}
                  onCheckedChange={(checked) => setIncludeArtboardInName(checked === true)}
                />
                <Label htmlFor="include-artboard" className="text-xs text-slate-300 cursor-pointer">
                  Include artboard name in filename (for artboard exports)
                </Label>
              </div>
            </div>
          </div>

          {/* Export Button */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-slate-700">
            <Button
              variant="ghost"
              onClick={() => setIsOpen(false)}
              disabled={isExporting}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleExport}
              disabled={isExporting}
              className="bg-[var(--editor-primary)] hover:bg-blue-700 text-white"
            >
              {isExporting ? (
                <>
                  <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}