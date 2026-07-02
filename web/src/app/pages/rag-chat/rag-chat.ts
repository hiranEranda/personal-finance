import { Component, signal, computed, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RagService, ChatSource } from '../../shared/services/rag.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  streaming?: boolean;
}

@Component({
  selector: 'app-rag-chat',
  imports: [CommonModule, FormsModule],
  templateUrl: './rag-chat.html',
  styleUrl: './rag-chat.css',
})
export class RagChat implements AfterViewChecked {
  @ViewChild('messagesEnd') private messagesEnd!: ElementRef<HTMLDivElement>;

  private ragService = new RagService();

  messages = signal<ChatMessage[]>([]);
  question = signal('');
  institution = signal('');
  period = signal('');
  isStreaming = signal(false);
  error = signal<string | null>(null);
  showFilters = signal(false);
  private sessionId = signal<string | null>(null);

  hasMessages = computed(() => this.messages().length > 0);
  private shouldScroll = false;

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.messagesEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth' });
      this.shouldScroll = false;
    }
  }

  async send() {
    const q = this.question().trim();
    if (!q || this.isStreaming()) return;

    this.error.set(null);
    this.question.set('');

    this.messages.update(msgs => [
      ...msgs,
      { role: 'user', content: q },
      { role: 'assistant', content: '', streaming: true },
    ]);
    this.shouldScroll = true;

    this.isStreaming.set(true);
    try {
      for await (const event of this.ragService.streamChat(q, this.institution(), this.period(), this.sessionId() ?? undefined)) {
        if (event.session_id) {
          this.sessionId.set(event.session_id);
        }
        if (event.sources) {
          this.messages.update(msgs => {
            const updated = [...msgs];
            const last = { ...updated[updated.length - 1], sources: event.sources };
            updated[updated.length - 1] = last;
            return updated;
          });
        }
        if (event.text) {
          this.messages.update(msgs => {
            const updated = [...msgs];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = { ...last, content: last.content + event.text };
            return updated;
          });
          this.shouldScroll = true;
        }
      }
    } catch (e: any) {
      this.error.set(e.message ?? 'Something went wrong.');
      this.messages.update(msgs => {
        const updated = [...msgs];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: 'Sorry, I could not get a response. Make sure the RAG backend is running.',
          streaming: false,
        };
        return updated;
      });
    } finally {
      this.messages.update(msgs => {
        const updated = [...msgs];
        updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false };
        return updated;
      });
      this.isStreaming.set(false);
      this.shouldScroll = true;
    }
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  clearChat() {
    this.messages.set([]);
    this.error.set(null);
    this.sessionId.set(null);
  }
}
