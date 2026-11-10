import { createContext } from 'react'

export type SearchContextValue = {
  query: string
  setQuery: (value: string) => void
  placeholder: string
  setPlaceholder: (value: string) => void
}

export const SearchContext = createContext<SearchContextValue | null>(null)
