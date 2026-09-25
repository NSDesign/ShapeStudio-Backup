import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_OVERLAY_MANAGER_STATE, GenerationSetUtils } from '../shared/schema';

type JsonObject = Record<string, any>;

async function openProjectManagement(page: Page) {
  await page.goto('/');
  const scopeTrigger = page.getByTestId('shape-set-export-scope-trigger');
  if (!await scopeTrigger.isVisible()) {
    await page.getByRole('button', { name: 'Project Management' }).click();
  }
  await expect(scopeTrigger).toBeVisible();
  await expect(page.getByTitle('Loading saved settings…')).toHaveCount(0);
}

async function installDeterministicData(page: Page) {
  const firstSet = GenerationSetUtils.createDefault('e2e-current-set', 'E2E Current Set');
  const secondSet = GenerationSetUtils.createDefault('e2e-other-set', 'E2E Other Set');
  const generationSets = [firstSet, secondSet];
  const artboards = [
    {
      id: 'e2e-active-artboard', name: 'E2E Active Artboard', x: 0, y: 0,
      width: 400, height: 300, dpi: 72, unitType: 'pixels',
      backgroundColor: '#ffffff', displayGrid: false, displayBorder: true,
    },
    {
      id: 'e2e-other-artboard', name: 'E2E Other Artboard', x: 450, y: 0,
      width: 500, height: 350, dpi: 72, unitType: 'pixels',
      backgroundColor: '#ffffff', displayGrid: false, displayBorder: true,
    },
  ];
  const preferencesResponse = await page.request.get('/api/user/preferences');
  expect(preferencesResponse.ok()).toBe(true);
  const basePreferences = await preferencesResponse.json();
  const preferences = {
    ...basePreferences,
    sidebarSections: {
      ...(basePreferences.sidebarSections ?? {}),
      project: { enabled: true, displayOrder: 5 },
    },
    appSettingsDefaults: {
      ...(basePreferences.appSettingsDefaults ?? {}),
      savedArtboards: artboards,
      activeArtboardId: artboards[0].id,
      sidebarCollapsed: false,
    },
    overlayManagerState: {
      ...DEFAULT_OVERLAY_MANAGER_STATE,
      debugGrid: {
        sets: {
          [firstSet.id]: { visible: true },
          [secondSet.id]: { visible: true },
        },
      },
      ctpProperties: {
        [`${firstSet.id}:point`]: { visible: true },
        [`${secondSet.id}:point`]: { visible: true },
      },
    },
  };

  await page.route('**/api/user/generation-sets', async route => {
    return route.fulfill({ json: { generationSets, currentSetId: firstSet.id } });
  });
  await page.route('**/api/user/preferences', async route => {
    return route.fulfill({ json: preferences });
  });
  await openProjectManagement(page);
}

async function choose(page: Page, testId: string, label: string) {
  const trigger = page.getByTestId(testId);
  await trigger.focus();
  await trigger.pressSequentially(label);
  await expect(trigger).toContainText(label);
}

async function downloadJson(page: Page, button: string) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId(button).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  return JSON.parse(await readFile(path!, 'utf8'));
}

test.describe('portable configuration scopes', () => {
  test('downloads current, selected, and all shape-set scopes exactly', async ({ page }) => {
    await installDeterministicData(page);
    await choose(page, 'shape-set-export-scope-trigger', 'Current set');
    const current = await downloadJson(page, 'save-shape-sets');
    expect(current.sets.map((item: JsonObject) => item.name)).toEqual(['E2E Current Set']);
    expect(current.currentSetId).toBe(current.sets[0].id);

    await openProjectManagement(page);
    await choose(page, 'shape-set-export-scope-trigger', 'Selected sets');
    const setNames = await page.getByTestId('shape-set-export-item').allTextContents();
    expect(setNames).toHaveLength(2);

    await page.getByText(setNames[1].trim(), { exact: true }).click();
    const selected = await downloadJson(page, 'save-shape-sets');
    expect(selected.sets.map((item: JsonObject) => item.name)).toEqual([setNames[1].trim()]);
    expect(selected.currentSetId).toBeNull();
    expect(Object.keys(selected.overlayManagerState?.debugGrid?.sets ?? {})).toEqual([selected.sets[0].id]);
    expect(Object.keys(selected.overlayManagerState?.ctpProperties ?? {})).toEqual([`${selected.sets[0].id}:point`]);

    await openProjectManagement(page);
    const all = await downloadJson(page, 'save-shape-sets');
    expect(all.sets.map((item: JsonObject) => item.name).sort()).toEqual(setNames.map(name => name.trim()).sort());
    expect(all.currentSetId).toBe(current.currentSetId);
  });

  test('downloads active, selected, and all artboard scopes exactly', async ({ page }) => {
    await installDeterministicData(page);
    await choose(page, 'artboard-export-scope-trigger', 'Active artboard');
    const active = await downloadJson(page, 'save-artboards');
    expect(active.artboards.map((item: JsonObject) => item.name)).toEqual(['E2E Active Artboard']);
    expect(active.activeArtboardId).toBe(active.artboards[0].id);

    await openProjectManagement(page);
    await choose(page, 'artboard-export-scope-trigger', 'Selected artboards');
    const names = await page.getByTestId('artboard-export-item').allTextContents();
    expect(names).toHaveLength(2);

    await page.getByText(names[1].trim(), { exact: true }).click();
    const selected = await downloadJson(page, 'save-artboards');
    expect(selected.artboards.map((item: JsonObject) => item.name)).toEqual([names[1].trim()]);
    expect(selected.activeArtboardId).toBeNull();

    await openProjectManagement(page);
    const all = await downloadJson(page, 'save-artboards');
    expect(all.artboards.map((item: JsonObject) => item.name).sort()).toEqual(names.map(name => name.trim()).sort());
    expect(all.activeArtboardId).toBe(active.activeArtboardId);
  });

  test('re-import preview warns about omitted shape-set references', async ({ page }) => {
    await installDeterministicData(page);
    await choose(page, 'shape-set-export-scope-trigger', 'Current set');
    const exported = await downloadJson(page, 'save-shape-sets');
    const source = exported.sets[0];
    source.artboardAlignment = { ...(source.artboardAlignment ?? {}), targetSetId: 'omitted-shape-set' };
    for (const effect of ['opacity', 'blur', 'scale', 'rotation', 'colorShift']) {
      source.batchConfig.echoSpread[effect].jitter = {
        enabled: source.batchConfig.echoSpread[effect].jitter.enabled,
        range: 0,
      };
    }
    const file = {
      name: 'subset.shapesets.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    };
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('load-shape-sets').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(file);
    await expect(page.getByRole('heading', { name: 'Import portable configuration' })).toBeVisible();
    await expect(page.getByText(/references shape set "omitted-shape-set", which is not included in this file/)).toBeVisible();
  });
});