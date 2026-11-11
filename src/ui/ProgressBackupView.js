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

import { exportProgress, importProgress, parseProgress } from '../core/ProgressBackup.js';
import { formatNumber, t } from '../core/I18n.js';
import { setTextIfChanged } from './UIHelpers.js';

const KEY = 'modals.settings.progress';

export class ProgressBackupView {
  constructor(ui) {
    this.ui = ui;
    this.config = ui.gameConfig.storage;
    this.modal = ui.elements.modalProgressImport;
    this.exportButton = document.getElementById('btn-export-progress');
    this.importButton = document.getElementById('btn-import-progress');
    this.fileInput = document.getElementById('input-import-progress');
    this.message = document.getElementById('progress-backup-status');
    this.summary = document.getElementById('progress-import-summary');
    this.cancel = document.getElementById('btn-cancel-progress-import');
    this.apply = document.getElementById('btn-apply-progress-import');

    this.exportButton.addEventListener('click', () => this.download());
    this.importButton.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => this.prepare(this.fileInput.files?.[0]));
    this.cancel.addEventListener('click', () => this.dismiss());
    this.apply.addEventListener('click', () => this.restore());
  }

  setStatus(status) {
    this.status = status;
    setTextIfChanged(this.message, status ? t(`${KEY}.status.${status}`) : '');
  }

  download() {
    try {
      this.ui.engine.persistRunHighScore();
      this.ui.engine.flushPlayerStats();
      const text = exportProgress(window.localStorage, this.config);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = this.config.progressBackup.filename;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url));
      }
      this.setStatus('download');
    } catch {
      this.setStatus('exportError');
    }
  }

  async prepare(file) {
    this.fileInput.value = '';
    if (!file || this.importButton.disabled) return;
    this.importButton.disabled = true;
    this.setStatus(null);
    try {
      if (file.size > this.config.progressBackup.maxBytes) {
        this.setStatus('tooLarge');
        return;
      }
      const parsed = parseProgress(await file.text(), this.config);
      if (this.ui.getActiveTopModal() !== this.ui.elements.modalSettings) return;
      if (parsed.count === 0) {
        this.setStatus('empty');
        return;
      }
      this.pending = parsed;
      this.refresh();
      this.ui.openOverlayModal(this.modal, this.cancel);
    } catch {
      this.setStatus('invalid');
    } finally {
      this.importButton.disabled = false;
    }
  }

  refresh() {
    this.setStatus(this.status);
    if (this.pending) {
      setTextIfChanged(this.summary, t(`${KEY}.confirm.summary`, { count: formatNumber(this.pending.count) }));
    }
  }

  dismiss() {
    this.pending = null;
    this.ui.stackedModalOpener = this.importButton;
    this.ui.closeOverlayModal(this.modal);
  }

  restore() {
    if (!this.pending || this.ui.isRestoringProgress) return;
    this.ui.isRestoringProgress = true;
    try {
      importProgress(window.localStorage, this.config, this.pending);
    } catch (error) {
      if (error instanceof AggregateError) {
        // The boot recovery owns the journal while ordinary game writes are suspended.
        window.location.reload();
        return;
      }
      this.ui.isRestoringProgress = false;
      this.dismiss();
      this.setStatus('importError');
      return;
    }
    window.location.reload();
  }
}
