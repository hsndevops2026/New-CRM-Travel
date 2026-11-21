import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  customRange,
  presetRange,
  type Preset,
  type Range,
} from '../../lib/reports'

type ReportRangeValue = {
  preset: Preset
  setPreset: (preset: Preset) => void
  customFrom: string
  setCustomFrom: (value: string) => void
  customTo: string
  setCustomTo: (value: string) => void
  range: Range | null
}

const ReportRangeContext = createContext<ReportRangeValue | null>(null)

export function ReportRangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const range = useMemo(
    () => (preset === 'custom' ? customRange(customFrom, customTo) : presetRange(preset)),
    [preset, customFrom, customTo],
  )
  const value = useMemo(
    () => ({ preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, range }),
    [preset, customFrom, customTo, range],
  )
  return <ReportRangeContext.Provider value={value}>{children}</ReportRangeContext.Provider>
}

export function useReportRange() {
  const ctx = useContext(ReportRangeContext)
  if (!ctx) throw new Error('useReportRange must be used within ReportRangeProvider')
  return ctx
}
