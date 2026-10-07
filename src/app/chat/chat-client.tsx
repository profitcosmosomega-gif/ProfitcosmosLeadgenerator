'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { Button, ErrorText, Field, inputClass } from '@/components/ui';
import { errorMessage, type ApiResult } from '@/lib/client/api-client';

interface ChatMessage {
  id: string;
  author: 'lead' | 'assistant';
  text: string;
}

interface Session {
  conversationId: string;
  accessToken: string;
}

interface Props {
  copy: { aiDisclosure: string; unavailableNotice: string };
  consent: { wordingVersion: string; marketingEmail: string };
}

const STORAGE_KEY = 'pc-chat-session';
const POLL_MS = 1500;
const MAX_CHARS = 2000;

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: json?.data, error: json?.error };
}

// The session lives in sessionStorage (this tab only), read through an external store so the
// server render and the first client render agree.
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function snapshot(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing to persist.
  }
  listeners.forEach((listener) => listener());
}

export function ChatClient({ copy, consent }: Props) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const session = useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }, [raw]);
  const [closedNotice, setClosedNotice] = useState(false);

  return (
    <>
      <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
        {copy.aiDisclosure}
      </p>
      {closedNotice ? (
        <p className="text-sm text-slate-700">{copy.unavailableNotice}</p>
      ) : session ? (
        <Conversation session={session} copy={copy} onLost={() => writeSession(null)} />
      ) : (
        <PreChatForm
          consent={consent}
          onStarted={writeSession}
          onReceived={() => setClosedNotice(true)}
        />
      )}
    </>
  );
}

function PreChatForm({
  consent,
  onStarted,
  onReceived,
}: {
  consent: Props['consent'];
  onStarted: (session: Session) => void;
  onReceived: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim() || undefined;
    setPending(true);
    setError(null);
    const res = await call<{ status: string; conversationId?: string; accessToken?: string }>(
      '/api/public/conversations',
      {
        method: 'POST',
        body: {
          fullName: value('fullName'),
          email: value('email'),
          ageConfirmed18plus: form.get('adult') === 'on' ? true : false,
          consent: {
            wordingVersion: consent.wordingVersion,
            marketingEmail: form.get('marketingEmail') === 'on',
          },
          website: value('website'),
        },
      },
    );
    setPending(false);
    if (!res.ok || !res.data) return setError(errorMessage(res.error));
    if (res.data.conversationId && res.data.accessToken) {
      onStarted({ conversationId: res.data.conversationId, accessToken: res.data.accessToken });
    } else {
      onReceived();
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <Field label="Name">
        <input name="fullName" autoComplete="name" className={inputClass} />
      </Field>
      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <label className="flex gap-2 text-sm text-slate-700">
        <input type="checkbox" name="adult" required />I confirm I am 18 or older.
      </label>
      <label className="flex gap-2 text-sm text-slate-700">
        <input type="checkbox" name="marketingEmail" />
        {consent.marketingEmail}
      </label>
      {/* Honeypot, hidden from people. */}
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Starting…' : 'Start chat'}
      </Button>
      <ErrorText message={error} />
    </form>
  );
}

function Conversation({
  session,
  copy,
  onLost,
}: {
  session: Session;
  copy: Props['copy'];
  onLost: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState({ open: true, available: true, awaiting: false });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const lastId = useRef<string | undefined>(undefined);
  const base = `/api/public/conversations/${session.conversationId}/messages`;

  const poll = useCallback(async () => {
    const query = lastId.current ? `?after=${lastId.current}` : '';
    const res = await call<{
      messages: ChatMessage[];
      open: boolean;
      assistantAvailable: boolean;
      awaitingReply: boolean;
    }>(`${base}${query}`, { token: session.accessToken });
    if (res.status === 404) return onLost();
    if (!res.ok || !res.data) return;
    const { data } = res;
    if (data.messages.length) {
      lastId.current = data.messages[data.messages.length - 1]!.id;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...data.messages.filter((m) => !seen.has(m.id))];
      });
    }
    setState({ open: data.open, available: data.assistantAvailable, awaiting: data.awaitingReply });
  }, [base, session.accessToken, onLost]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    const res = await call(base, { method: 'POST', body: { text }, token: session.accessToken });
    setSending(false);
    if (!res.ok) return setError(errorMessage(res.error));
    setDraft('');
    void poll();
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <ol className="flex flex-1 flex-col gap-2" aria-live="polite">
        {messages.map((m) => (
          <li
            key={m.id}
            className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
              m.author === 'lead'
                ? 'self-end bg-brand text-brand-foreground'
                : 'self-start bg-white text-slate-800 shadow-sm'
            }`}
          >
            {m.text}
          </li>
        ))}
        {state.awaiting && <li className="self-start text-sm text-slate-500">…</li>}
      </ol>
      {!state.available && messages.length > 0 && (
        <p className="text-sm text-slate-600">{copy.unavailableNotice}</p>
      )}
      {state.open && (
        <form onSubmit={onSubmit} className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_CHARS}
            rows={2}
            aria-label="Your message"
            className={inputClass}
          />
          <Button type="submit" disabled={sending || !draft.trim()}>
            Send
          </Button>
        </form>
      )}
      <ErrorText message={error} />
    </div>
  );
}
