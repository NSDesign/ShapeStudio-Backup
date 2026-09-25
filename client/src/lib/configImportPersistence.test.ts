import { describe, expect, it } from 'vitest';
import { persistImportedConfiguration } from './configImportPersistence';

type Store = { sets: string; preferences: string; overlay: string };

describe('coordinated configuration import persistence', () => {
  const keys: (keyof Store)[] = ['sets', 'preferences', 'overlay'];

  for (const failedKey of keys) {
    for (const timing of ['before', 'after'] as const) {
      it(`restores every attempted write when ${failedKey} fails ${timing} persistence`, async () => {
        const store: Store = { sets: 'old sets', preferences: 'old + pending edit', overlay: 'old + pending overlay' };
        let runtime = 'old runtime';
        const steps = keys.map(key => ({
          saveNext: async () => {
            if (key === failedKey && timing === 'before') throw new Error(`${key} failed`);
            store[key] = `new ${key}`;
            if (key === failedKey && timing === 'after') throw new Error(`${key} failed`);
          },
          restorePrevious: async () => { store[key] = key === 'sets' ? 'old sets' : `old + pending ${key === 'preferences' ? 'edit' : 'overlay'}`; },
        }));

        await expect(persistImportedConfiguration({
          steps,
          commitRuntime: () => { runtime = 'new runtime'; },
          restoreRuntime: () => { runtime = 'old runtime'; },
        })).rejects.toThrow(`${failedKey} failed`);

        expect(store).toEqual({ sets: 'old sets', preferences: 'old + pending edit', overlay: 'old + pending overlay' });
        expect(runtime).toBe('old runtime');
      });
    }
  }

  it('preserves pending edits, commits only after all writes, and reloads imported state', async () => {
    const store: Store = { sets: 'old', preferences: 'pending canvas edit', overlay: 'pending overlay edit' };
    let runtime = 'old runtime';
    const observedRuntime: string[] = [];
    const next: Store = { sets: 'imported sets', preferences: 'imported artboards + pending canvas edit', overlay: 'pending overlay edit' };
    await persistImportedConfiguration({
      steps: keys.map(key => ({
        saveNext: async () => { observedRuntime.push(runtime); store[key] = next[key]; },
        restorePrevious: async () => undefined,
      })),
      commitRuntime: () => { runtime = 'imported runtime'; },
      restoreRuntime: () => { runtime = 'old runtime'; },
    });
    expect(observedRuntime).toEqual(['old runtime', 'old runtime', 'old runtime']);
    expect(runtime).toBe('imported runtime');
    expect({ ...store }).toEqual(next);
  });
});