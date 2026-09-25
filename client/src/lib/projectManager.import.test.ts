import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectManager } from './projectManager';

class TestFileReader {
  onload: ((event: { target: { result: string } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsText(file: { contents?: string; interrupted?: boolean }) {
    if (file.interrupted) {
      this.onerror?.();
      return;
    }
    this.onload?.({ target: { result: file.contents ?? '' } });
  }
}

const file = (value: unknown) => ({ contents: JSON.stringify(value) }) as unknown as File;

describe('Generator and Generated import slots', () => {
  beforeEach(() => vi.stubGlobal('FileReader', TestFileReader));
  afterEach(() => vi.unstubAllGlobals());

  it('rejects a Generated file from the Generator slot with actionable guidance', async () => {
    await expect(ProjectManager.loadGeneratorProject(file({
      version: '1.0.0',
      type: 'generated',
      shapes: [],
    }))).rejects.toThrow('Use "Load Generated"');
  });

  it('rejects a Generator file from the Generated slot with actionable guidance', async () => {
    await expect(ProjectManager.loadProject(file({
      version: '1.0.0',
      type: 'generator',
      generationSets: [],
    }))).rejects.toThrow('Use "Load Generator"');
  });

  it('reports an interrupted file read without changing either import path', async () => {
    const interrupted = { interrupted: true } as unknown as File;
    await expect(ProjectManager.loadGeneratorProject(interrupted)).rejects.toThrow('Failed to read file');
    await expect(ProjectManager.loadProject(interrupted)).rejects.toThrow('Failed to read file');
  });
});