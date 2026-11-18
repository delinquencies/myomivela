import type {en as uiEnglish} from './ui-copy.js';
import type {en as launchEnglish} from './myo-copy.js';

export type Language = 'en' | 'es';
export type ErrorCode =
  | 'time_unavailable' | 'window_too_short' | 'time_reserved' | 'hold_expired'
  | 'price_changed' | 'change_not_pending' | 'departure_check_required'
  | 'secure_note_required' | 'meet_is_free' | 'night_unavailable' | 'stay_length'
  | 'stay_reschedule_unsupported' | 'blocked' | 'invalid_date' | 'agreement_changed'
  | 'vault_unconfigured' | 'vault_decrypt_failed' | 'access_not_yet' | 'not_set'
  | 'invalid_method' | 'invalid_key_status' | 'unknown_field' | 'invalid_field'
  | 'invalid_score' | 'feedback_closed' | 'invalid_locale' | 'invalid_subject';
export type TranslationKey =
  | keyof typeof uiEnglish
  | `launch.${keyof typeof launchEnglish}`
  | `error.${ErrorCode}`
  | `status.${'Requested' | 'Confirmed' | 'In Progress' | 'Completed' | 'Cancelled'}`
  | `booking.${'nights' | 'pets' | 'visits'}`;
export type TranslationEntry = string | {one: string; other: string};
export const languages: readonly Language[];
export const catalogs: Record<Language, Record<TranslationKey, TranslationEntry>>;
export function locale(): Language;
export function setLocale(language: Language): void;
export function hasKey(key: string, language?: Language): key is TranslationKey;
export function t(key: TranslationKey, params?: Record<string, string | number>, language?: Language): string;
export function translateLabel(value: string): string;
export function formatDate(ms: number, style?: 'visit' | 'day' | 'time' | 'date', language?: Language): string;
export function formatMoney(cents: number, language?: Language): string;
