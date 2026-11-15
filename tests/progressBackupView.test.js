/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { i18n, t } from '../src/core/I18n.js';
import { ProgressBackupView } from '../src/ui/ProgressBackupView.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const gameConfig = readJson('../configs/game.json');
const en = readJson('../locales/en.json');

class MemoryLocalStorage {
  constructor(initial = [], beforeWrite = () => {}) {
    this.map = new Map(initial);
    this.beforeWrite = beforeWrite;
  }

  get length() {
    return this.map.size;
  }

  key(i) {
    return Array.from(this.map.keys())[i] ?? null;
  }

  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }

  setItem(k, v) {
    this.beforeWrite(k, v);
    this.map.set(k, String(v));
  }

  removeItem(k) {
    this.map.delete(k);
  }
}

function makeFakeElement(id) {
  const listeners = new Map();
  return {
    id,
    textContent: '',
    value: '',
    disabled: false,
    files: [],
    href: '',
    download: '',
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    click: () => {
      for (const fn of listeners.get('click') ?? []) fn();
    },
    remove: () => {}
  };
}

function withEnglishBackupEnv(fn, { beforeWrite = () => {}, quotaExceeded = false } = {}) {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevUrl = globalThis.URL;
  const prevLocale = i18n.currentLocale;
  const prevEn = i18n.dictionaries.get('en');

  const domById = new Map([
    ['btn-export-progress', makeFakeElement('btn-export-progress')],
    ['btn-import-progress', makeFakeElement('btn-import-progress')],
    ['input-import-progress', makeFakeElement('input-import-progress')],
    ['progress-backup-status', makeFakeElement('progress-backup-status')],
    ['progress-import-summary', makeFakeElement('progress-import-summary')],
    ['btn-cancel-progress-import', makeFakeElement('btn-cancel-progress-import')],
    ['btn-apply-progress-import', makeFakeElement('btn-apply-progress-import')]
  ]);

  let reloads = 0;
  let flushed = 0;
  let persisted = 0;
  let revoked = 0;
  const createdLinks = [];
  const storage = new MemoryLocalStorage([
    [`${gameConfig.storage.prefix}${gameConfig.storage.keys.unlockedLevel}`, '5'],
    [`${gameConfig.storage.prefix}${gameConfig.storage.keys.coins}`, '120']
  ], beforeWrite);

  globalThis.document = {
    getElementById: (id) => domById.get(id) ?? null,
    createElement: (tag) => {
      const el = makeFakeElement(tag);
      createdLinks.push(el);
      return el;
    },
    body: { append: () => {} }
  };
  globalThis.window = {
    localStorage: storage,
    location: { reload: () => { reloads += 1; } }
  };
  globalThis.URL = {
    createObjectURL: () => 'blob:mock-progress',
    revokeObjectURL: () => { revoked += 1; }
  };
  i18n.dictionaries.set('en', en);
  i18n.currentLocale = 'en';

  const modalSettings = { id: 'modal-settings' };
  const modalProgressImport = { id: 'modal-progress-import' };
  let activeTopModal = modalSettings;
  const uiCalls = { opened: [], closed: [] };
  const ui = {
    gameConfig,
    elements: { modalSettings, modalProgressImport },
    storageManager: { hasQuotaExceeded: () => quotaExceeded },
    engine: {
      persistRunHighScore: () => { persisted += 1; },
      flushPlayerStats: () => { flushed += 1; }
    },
    isRestoringProgress: false,
    stackedModalOpener: null,
    getActiveTopModal: () => activeTopModal,
    openOverlayModal: (modal, focusTarget) => uiCalls.opened.push({ modal, focusTarget }),
    closeOverlayModal: (modal) => uiCalls.closed.push(modal)
  };

  const setActiveTopModal = (modal) => {
    activeTopModal = modal;
  };

  return (async () => {
    try {
      const view = new ProgressBackupView(ui);
      await fn({
        view,
        ui,
        domById,
        storage,
        uiCalls,
        createdLinks,
        setActiveTopModal,
        getStats: () => ({ reloads, flushed, persisted, revoked })
      });
    } finally {
      globalThis.document = prevDoc;
      globalThis.window = prevWin;
      globalThis.URL = prevUrl;
      if (prevEn === undefined) i18n.dictionaries.delete('en');
      else i18n.dictionaries.set('en', prevEn);
      i18n.currentLocale = prevLocale;
    }
  })();
}

test('download exports localStorage snapshot cleanly and reports exportError on failure', async () => {
  await withEnglishBackupEnv(async ({ view, domById, createdLinks, getStats }) => {
    view.download();
    assert.equal(getStats().persisted, 1);
    assert.equal(getStats().flushed, 1);
    assert.equal(createdLinks[0].download, gameConfig.storage.progressBackup.filename);
    assert.equal(view.status, 'download');
    assert.equal(domById.get('progress-backup-status').textContent, t('modals.settings.progress.status.download'));

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(getStats().revoked, 1);

    globalThis.URL.createObjectURL = () => {
      throw new Error('blob error');
    };
    view.download();
    assert.equal(view.status, 'exportError');
    assert.equal(domById.get('progress-backup-status').textContent, t('modals.settings.progress.status.exportError'));
  });
});

test('prepare handles tooLarge, empty, non-Settings modal, invalid JSON, and valid pending payload', async () => {
  await withEnglishBackupEnv(async ({ view, domById, ui, uiCalls, setActiveTopModal }) => {
    const maxBytes = gameConfig.storage.progressBackup.maxBytes;

    await view.prepare({ size: maxBytes + 1, text: async () => '' });
    assert.equal(view.status, 'tooLarge');
    assert.equal(domById.get('btn-import-progress').disabled, false);

    const emptyPayload = JSON.stringify({
      format: gameConfig.storage.progressBackup.format,
      version: gameConfig.storage.progressBackup.version,
      fields: {}
    });
    await view.prepare({ size: emptyPayload.length, text: async () => emptyPayload });
    assert.equal(view.status, 'empty');

    await view.prepare({ size: 12, text: async () => '{bad-json' });
    assert.equal(view.status, 'invalid');

    const validPayload = JSON.stringify({
      format: gameConfig.storage.progressBackup.format,
      version: gameConfig.storage.progressBackup.version,
      fields: { unlockedLevel: '12', coins: '350' }
    });
    setActiveTopModal(ui.elements.modalProgressImport);
    await view.prepare({ size: validPayload.length, text: async () => validPayload });
    assert.equal(uiCalls.opened.length, 0);

    setActiveTopModal(ui.elements.modalSettings);
    await view.prepare({ size: validPayload.length, text: async () => validPayload });
    assert.equal(view.pending.count, 2);
    assert.equal(uiCalls.opened.length, 1);
    assert.equal(uiCalls.opened[0].modal, ui.elements.modalProgressImport);
    assert.match(domById.get('progress-import-summary').textContent, /2/);
  });
});

test('refresh surfaces storage quota warning when status is empty', async () => {
  await withEnglishBackupEnv(async ({ view, domById }) => {
    view.refresh();
    assert.equal(
      domById.get('progress-backup-status').textContent,
      t('modals.settings.progress.status.quotaExceeded')
    );

    view.setStatus('download');
    view.refresh();
    assert.equal(
      domById.get('progress-backup-status').textContent,
      t('modals.settings.progress.status.download')
    );
  }, { quotaExceeded: true });
});

test('restore reloads on success, reloads on AggregateError recovery, and sets importError on normal failure', async () => {
  await withEnglishBackupEnv(async ({ view, ui, getStats }) => {
    view.restore();
    assert.equal(getStats().reloads, 0);

    view.pending = { count: 1, fields: { coins: '900' } };
    view.restore();
    assert.equal(ui.isRestoringProgress, true);
    assert.equal(getStats().reloads, 1);
  });

  let coinsWrites = 0;
  await withEnglishBackupEnv(async ({ view, getStats }) => {
    view.pending = { count: 2, fields: { unlockedLevel: '12', coins: '900' } };
    view.restore();
    assert.equal(getStats().reloads, 1);
  }, {
    beforeWrite: (k) => {
      if (k.includes('coins')) {
        coinsWrites += 1;
        throw new Error('coins write failed');
      }
      if (coinsWrites > 0 && k.includes('unlocked')) {
        throw new Error('rollback failed too');
      }
    }
  });

  await withEnglishBackupEnv(async ({ view, ui, domById, uiCalls, getStats }) => {
    view.pending = { count: 1, fields: { coins: '900' } };
    view.restore();
    assert.equal(ui.isRestoringProgress, false);
    assert.equal(view.status, 'importError');
    assert.equal(uiCalls.closed.length, 1);
    assert.equal(ui.stackedModalOpener, domById.get('btn-import-progress'));
    assert.equal(getStats().reloads, 0);
  }, {
    beforeWrite: (k) => {
      if (k.includes('coins')) {
        throw new Error('quota exceeded');
      }
    }
  });
});
