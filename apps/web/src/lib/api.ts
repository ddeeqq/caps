import type {
  BalanceQuestion,
  GameId,
  GameMeta,
  Pack,
  PackInput,
  PresetId,
  RoomSettings,
  SessionReport,
} from '@caps/shared';

export interface PresetInfo {
  id: PresetId;
  label: string;
  description: string;
  personCompare: boolean;
  namesUsage: 'all' | 'vault' | 'none';
  finaleText: string;
  penalties: string[];
}

export interface PresetsResponse {
  presets: PresetInfo[];
  games: Record<GameId, GameMeta>;
  defaultFlow: GameId[];
  defaultSettings: RoomSettings;
}

export interface PackPreview {
  balancePool: BalanceQuestion[];
  balanceCount: number;
  vaultSymbols: string[];
  finaleText: string;
  penalties: string[];
  options: { personCompare: boolean };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요', 0);
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) throw new ApiError(body.message ?? '요청을 처리하지 못했어요', res.status, body.error);
  return body as T;
}

export const api = {
  presets: () => request<PresetsResponse>('/api/presets'),
  room: (code: string) =>
    request<{ exists: boolean; phase?: string; packName?: string; playerCount?: number }>(
      `/api/rooms/${encodeURIComponent(code)}`,
    ),
  getPack: (code: string) => request<{ pack: Pack }>(`/api/packs/${encodeURIComponent(code)}`),
  createPack: (input: PackInput) =>
    request<{ pack: Pack; editKey: string }>('/api/packs', { method: 'POST', body: JSON.stringify(input) }),
  updatePack: (code: string, editKey: string, input: PackInput) =>
    request<{ pack: Pack }>(`/api/packs/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      headers: { 'x-edit-key': editKey },
    }),
  previewPack: (input: Omit<PackInput, 'name'> & { name?: string }) =>
    request<PackPreview>('/api/packs/preview', { method: 'POST', body: JSON.stringify(input) }),
  session: (id: string) => request<{ report: SessionReport }>(`/api/sessions/${encodeURIComponent(id)}`),
};
