import { useState, useEffect, useRef, useCallback } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { getHotelState, setHotelState, type HotelStateKey } from '@/lib/hotel-state.functions';

const CHANGE_EVENT_PREFIX = 'sayohat-cloud-record-changed:';

/**
 * Syncs a dictionary `{ [recordId]: T }` to Supabase under `stateKey`.
 * Polls every 2s, writes are debounced 120ms, and a localStorage mirror
 * keeps things instant/offline-safe — same pattern as useBookings.ts.
 */
export function useCloudRecord<T extends Record<string, unknown>>(stateKey: HotelStateKey) {
  const storageKey = `sayohat-cloud:${stateKey}`;
  const changeEvent = CHANGE_EVENT_PREFIX + stateKey;
  const [records, setRecords] = useState<Record<string, T>>({});
  const getSharedState = useServerFn(getHotelState);
  const setSharedState = useServerFn(setHotelState);
  const cloudWriteRef = useRef<number | null>(null);
  const lastCloudVersionRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setRecords(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const loadCloud = async () => {
      try {
        const row = await getSharedState({ data: { key: stateKey } });
        if (cancelled) return;
        if (row?.stateData) {
          if (row.version <= lastCloudVersionRef.current || cloudWriteRef.current) return;
          lastCloudVersionRef.current = row.version;
          const next = row.stateData as Record<string, T>;
          setRecords(next);
          window.localStorage.setItem(storageKey, JSON.stringify(next));
          window.dispatchEvent(new Event(changeEvent));
        }
      } catch { /* keep local state if backend is temporarily unreachable */ }
    };
    loadCloud();
    const id = window.setInterval(loadCloud, 2000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [getSharedState, stateKey, storageKey, changeEvent]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reload = () => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) setRecords(JSON.parse(raw));
      } catch { /* ignore */ }
    };
    const onStorage = (e: StorageEvent) => { if (e.key === storageKey) reload(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(changeEvent, reload as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(changeEvent, reload as EventListener);
    };
  }, [storageKey, changeEvent]);

  const updateRecord = useCallback((recordId: string, value: T) => {
    setRecords(prev => {
      const next = { ...prev, [recordId]: value };
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event(changeEvent));
      if (cloudWriteRef.current) window.clearTimeout(cloudWriteRef.current);
      cloudWriteRef.current = window.setTimeout(() => {
        void setSharedState({ data: { key: stateKey, stateData: next } }).then((row) => {
          lastCloudVersionRef.current = row.version;
          cloudWriteRef.current = null;
        }).catch(() => undefined);
      }, 120);
      return next;
    });
  }, [setSharedState, stateKey, storageKey, changeEvent]);

  return { records, updateRecord };
}