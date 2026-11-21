"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DEFAULT_DATA, type AppData, type Material } from "./types";

const LS_KEY = "jiayouxue-v1";
const DB_NAME = "jiayouxue";
const DB_VERSION = 1;

interface StudyDB extends DBSchema {
  materials: {
    key: string;
    value: Material;
  };
  meta: {
    key: string;
    value: string;
  };
}

let dbPromise: Promise<IDBPDatabase<StudyDB>> | null = null;

function getDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<StudyDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("materials")) {
          db.createObjectStore("materials", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}

export function loadLocal(): AppData {
  if (typeof localStorage === "undefined") return { ...DEFAULT_DATA };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_DATA, materials: [] };
    const parsed = JSON.parse(raw) as AppData;
    return {
      ...DEFAULT_DATA,
      ...parsed,
      materials: parsed.materials ?? [],
      windows: parsed.windows?.length ? parsed.windows : DEFAULT_DATA.windows,
      tasks: parsed.tasks ?? [],
      chatHistory: parsed.chatHistory ?? [],
    };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

export function saveLocal(data: AppData) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(data));
  void syncMaterialsToIdb(data.materials);
}

async function syncMaterialsToIdb(materials: Material[]) {
  const db = getDb();
  if (!db) return;
  const database = await db;
  const tx = database.transaction("materials", "readwrite");
  await tx.store.clear();
  for (const m of materials) {
    await tx.store.put(m);
  }
  await tx.done;
}

export async function loadMaterialsFromIdb(): Promise<Material[] | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const database = await db;
    return await database.getAll("materials");
  } catch {
    return null;
  }
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}
