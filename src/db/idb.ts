/**
 * 历史记录持久化。
 *
 * ⚠️ 隐私红线：schema 里**没有**图像字段，也没有关键点坐标字段。
 * 这不是约定，是类型层面的保证 —— 想存图都存不进去。
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AnalysisEnvelope, AnalysisType } from '@/core/types'

export interface HistoryRecord {
  id: string
  type: AnalysisType
  createdAt: number
  /** 结构化特征 —— 不含图像、不含坐标 */
  envelope: AnalysisEnvelope
  /** 已过 guard 的报告正文 */
  report: string
  /** 多轮追问 */
  followUps: { question: string; answer: string; at: number }[]
}

interface XiangfateDB extends DBSchema {
  history: {
    key: string
    value: HistoryRecord
    indexes: { 'by-created': number; 'by-type': AnalysisType }
  }
}

const DB_NAME = 'xiangfate'
const VERSION = 1

let dbPromise: Promise<IDBPDatabase<XiangfateDB>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<XiangfateDB>(DB_NAME, VERSION, {
      upgrade(d) {
        const store = d.createObjectStore('history', { keyPath: 'id' })
        store.createIndex('by-created', 'createdAt')
        store.createIndex('by-type', 'type')
      },
    })
  }
  return dbPromise
}

export async function saveRecord(rec: HistoryRecord): Promise<void> {
  const d = await db()
  await d.put('history', rec)
}

export async function listRecords(type?: AnalysisType): Promise<HistoryRecord[]> {
  const d = await db()
  const all = type
    ? await d.getAllFromIndex('history', 'by-type', type)
    : await d.getAll('history')
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getRecord(id: string): Promise<HistoryRecord | undefined> {
  const d = await db()
  return d.get('history', id)
}

export async function deleteRecord(id: string): Promise<void> {
  const d = await db()
  await d.delete('history', id)
}

export async function clearAll(): Promise<void> {
  const d = await db()
  await d.clear('history')
}

export async function appendFollowUp(
  id: string,
  question: string,
  answer: string,
): Promise<void> {
  const d = await db()
  const rec = await d.get('history', id)
  if (!rec) return
  rec.followUps.push({ question, answer, at: Date.now() })
  await d.put('history', rec)
}

export async function countRecords(): Promise<number> {
  const d = await db()
  return d.count('history')
}
