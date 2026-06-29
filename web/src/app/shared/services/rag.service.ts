import { Injectable } from '@angular/core';

const RAG_BASE = 'http://localhost:3001/api/rag';

export interface RagDocument {
  doc_id: string;
  filename: string;
  status: 'processing' | 'done' | 'error' | 'low_confidence' | 'deleted';
  ingested_at?: string;
  institution?: string;
  period?: string;
  doc_type?: string;
}

export interface ChatSource {
  institution: string;
  period: string;
  section: string;
}

export interface ChatEvent {
  sources?: ChatSource[];
  text?: string;
}

@Injectable({ providedIn: 'root' })
export class RagService {

  async uploadDocument(file: File): Promise<{ doc_id: string; status: string }> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${RAG_BASE}/documents/upload`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `Upload failed (${res.status})`);
    }
    return res.json();
  }

  async listDocuments(): Promise<RagDocument[]> {
    const res = await fetch(`${RAG_BASE}/documents`);
    if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
    const data = await res.json();
    return data.documents ?? [];
  }

  async deleteDocument(docId: string): Promise<void> {
    const res = await fetch(`${RAG_BASE}/documents/${docId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
  }

  async *streamChat(
    question: string,
    institution?: string,
    period?: string,
  ): AsyncGenerator<ChatEvent> {
    const res = await fetch(`${RAG_BASE}/chat/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, institution: institution || undefined, period: period || undefined }),
    });

    if (!res.ok) {
      throw new Error(`Chat request failed (${res.status})`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          yield JSON.parse(payload) as ChatEvent;
        } catch {
          // skip malformed SSE frames
        }
      }
    }
  }
}
