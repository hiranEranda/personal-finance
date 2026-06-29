import { Component, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RagService, RagDocument } from '../../shared/services/rag.service';

@Component({
  selector: 'app-rag-documents',
  imports: [CommonModule],
  templateUrl: './rag-documents.html',
  styleUrl: './rag-documents.css',
})
export class RagDocuments implements OnInit {
  private ragService = new RagService();

  documents = signal<RagDocument[]>([]);
  isLoading = signal(false);
  isUploading = signal(false);
  isDragging = signal(false);
  error = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  activeCount = computed(() => this.documents().filter(d => d.status !== 'deleted').length);

  async ngOnInit() {
    await this.loadDocuments();
  }

  async loadDocuments() {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const docs = await this.ragService.listDocuments();
      this.documents.set(docs.filter(d => d.status !== 'deleted'));
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load documents.');
    } finally {
      this.isLoading.set(false);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave() {
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.upload(file);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.upload(file);
    input.value = '';
  }

  private async upload(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      this.error.set('Only PDF files are supported.');
      return;
    }
    this.isUploading.set(true);
    this.error.set(null);
    this.successMessage.set(null);
    try {
      const result = await this.ragService.uploadDocument(file);
      this.successMessage.set(`"${file.name}" queued for ingestion (ID: ${result.doc_id}). Refresh in a moment to see the status.`);
      await this.loadDocuments();
    } catch (e: any) {
      this.error.set(e.message ?? 'Upload failed.');
    } finally {
      this.isUploading.set(false);
    }
  }

  async deleteDoc(docId: string, filename: string) {
    if (!confirm(`Remove "${filename}" from the knowledge base?`)) return;
    this.error.set(null);
    try {
      await this.ragService.deleteDocument(docId);
      this.documents.update(docs => docs.filter(d => d.doc_id !== docId));
    } catch (e: any) {
      this.error.set(e.message ?? 'Delete failed.');
    }
  }

  statusBadge(status: string): { label: string; classes: string } {
    switch (status) {
      case 'done':
        return { label: 'Ready', classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
      case 'processing':
        return { label: 'Processing', classes: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' };
      case 'error':
        return { label: 'Failed', classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
      case 'low_confidence':
        return { label: 'Low Confidence', classes: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' };
      default:
        return { label: status, classes: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' };
    }
  }

  formatDate(iso?: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }
}
